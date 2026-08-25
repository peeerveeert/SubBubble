#!/usr/bin/env python3
import hashlib
import json
import os
import re
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
DATA_FILE = Path(os.environ.get("DATA_FILE", "/opt/subbubble/data/subbubble.json"))
SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_BODY = 1_000_000
SPACE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
lock = threading.Lock()


def normalize(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("subscriptions"), list):
        return {"version": 2, "rates": {}, "ratesUpdatedAt": 0, "subscriptions": [], "tombstones": {}}
    subscriptions = []
    for item in raw.get("subscriptions", []):
        if isinstance(item, dict) and item.get("id"):
            clean = dict(item)
            try:
                clean["updatedAt"] = int(clean.get("updatedAt") or 0)
            except (TypeError, ValueError):
                clean["updatedAt"] = 0
            subscriptions.append(clean)
    tombstones = {}
    for key, value in (raw.get("tombstones") or {}).items():
        try:
            tombstones[str(key)] = int(value or 0)
        except (TypeError, ValueError):
            pass
    try:
        rates_updated_at = int(raw.get("ratesUpdatedAt") or 0)
    except (TypeError, ValueError):
        rates_updated_at = 0
    return {
        "version": 2,
        "rates": dict(raw.get("rates") or {}),
        "ratesUpdatedAt": rates_updated_at,
        "subscriptions": subscriptions,
        "tombstones": tombstones,
    }


def merge(left_raw, right_raw):
    left, right = normalize(left_raw), normalize(right_raw)
    left_by_id = {x["id"]: x for x in left["subscriptions"]}
    right_by_id = {x["id"]: x for x in right["subscriptions"]}
    ids = set(left_by_id) | set(right_by_id) | set(left["tombstones"]) | set(right["tombstones"])
    live, tombstones = {}, {}

    for sub_id in ids:
        l, r = left_by_id.get(sub_id), right_by_id.get(sub_id)
        deleted_at = max(int(left["tombstones"].get(sub_id, 0)), int(right["tombstones"].get(sub_id, 0)))
        if l is None:
            newest = r
        elif r is None:
            newest = l
        else:
            newest = l if int(l.get("updatedAt", 0)) >= int(r.get("updatedAt", 0)) else r
        if newest is not None and int(newest.get("updatedAt", 0)) > deleted_at:
            live[sub_id] = dict(newest)
        elif deleted_at:
            tombstones[sub_id] = deleted_at

    right_rates_newer = right["ratesUpdatedAt"] > left["ratesUpdatedAt"]
    subscriptions = sorted(live.values(), key=lambda x: int(x.get("updatedAt", 0)))
    return {
        "version": 2,
        "rates": dict(right["rates"] if right_rates_newer else left["rates"]),
        "ratesUpdatedAt": max(left["ratesUpdatedAt"], right["ratesUpdatedAt"]),
        "subscriptions": subscriptions,
        "tombstones": tombstones,
    }


def read_state(path):
    try:
        return normalize(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return normalize(None)


def write_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix="subbubble-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def data_file_for_token(token):
    # Preserve the original owner's database exactly where it already lives.
    if SYNC_TOKEN and token == SYNC_TOKEN:
        return DATA_FILE
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return DATA_FILE.parent / "spaces" / f"{digest}.json"


class Handler(BaseHTTPRequestHandler):
    server_version = "SubBubbleSync/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Vary", "Origin")

    def _json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def _space_token(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        token = header[7:].strip()
        if SYNC_TOKEN and token == SYNC_TOKEN:
            return token
        return token if SPACE_TOKEN_RE.fullmatch(token) else None

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "spaces": True})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/sync":
            return self._json(404, {"error": "not_found"})
        token = self._space_token()
        if not token:
            return self._json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json(400, {"error": "bad_content_length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(413 if length > MAX_BODY else 400, {"error": "invalid_payload_size"})
        try:
            incoming = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "bad_json"})
        path = data_file_for_token(token)
        with lock:
            current = read_state(path)
            merged = merge(current, incoming.get("state"))
            write_state(path, merged)
        return self._json(200, {"state": merged})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"SubBubble sync listening on {HOST}:{PORT}; data={DATA_FILE}; isolated_spaces=on", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
