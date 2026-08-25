#!/usr/bin/env python3
import json
import os
import hashlib
import tempfile
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
DATA_FILE = Path(os.environ.get("DATA_FILE", "/opt/subbubble/data/subbubble.json"))
DATA_DIR = Path(os.environ.get("DATA_DIR", str(DATA_FILE.parent / "spaces")))
ANALYTICS_FILE = Path(os.environ.get("ANALYTICS_FILE", "/opt/subbubble/data/analytics.json"))
SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
SPACE_HASH_SALT = os.environ.get("SPACE_HASH_SALT", SYNC_TOKEN or "subbubble")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_BODY = 1_000_000
lock = threading.Lock()
analytics_lock = threading.Lock()


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


def read_state():
    try:
        return normalize(json.loads(DATA_FILE.read_text(encoding="utf-8")))
    except Exception:
        return normalize(None)


def write_state(state):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix="subbubble-", suffix=".json", dir=str(DATA_FILE.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, DATA_FILE)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def atomic_write_json(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f"{path.stem}-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(body, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def bearer_token(headers):
    value = headers.get("Authorization", "")
    if value.startswith("Bearer "):
        return value[7:].strip()
    return ""


def space_hash_from_token(token):
    if token:
        source = f"{SPACE_HASH_SALT}:{token}".encode("utf-8")
    else:
        source = f"{SPACE_HASH_SALT}:anonymous-default".encode("utf-8")
    return hashlib.sha256(source).hexdigest()[:32]


def state_file_for(space_hash):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    target = DATA_DIR / f"{space_hash}.json"
    if not target.exists() and DATA_FILE.exists() and space_hash == space_hash_from_token(SYNC_TOKEN):
        return DATA_FILE
    return target


def read_space_state(space_hash):
    path = state_file_for(space_hash)
    try:
        return normalize(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return normalize(None)


def write_space_state(space_hash, state):
    atomic_write_json(DATA_DIR / f"{space_hash}.json", normalize(state))


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def today_key():
    return datetime.now(timezone.utc).date().isoformat()


def normalize_platform(value):
    value = str(value or "").lower()
    return value if value in {"ios", "android", "desktop", "unknown"} else "unknown"


def clean_analytics_meta(raw):
    if not isinstance(raw, dict):
        raw = {}
    return {
        "platform": normalize_platform(raw.get("platform")),
        "pwa": raw.get("pwa") is True,
    }


def read_analytics():
    try:
        raw = json.loads(ANALYTICS_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("spaces"), dict):
            return raw
    except Exception:
        pass
    return {"version": 1, "spaces": {}}


def write_analytics(data):
    atomic_write_json(ANALYTICS_FILE, data)


def track_event(space_hash, event, state=None, meta=None):
    if event not in {"space_created", "app_open", "expense_added", "expense_deleted"}:
        return
    meta = clean_analytics_meta(meta or {})
    at = now_iso()
    day = today_key()
    expense_count = len(normalize(state).get("subscriptions", [])) if state is not None else None
    with analytics_lock:
        data = read_analytics()
        spaces = data.setdefault("spaces", {})
        existing = spaces.get(space_hash)
        created = existing is None
        space = existing or {
            "created_at": at,
            "last_seen_at": at,
            "visit_count": 0,
            "has_expenses": False,
            "expense_count": 0,
            "platform": meta["platform"],
            "pwa": meta["pwa"],
            "events": {},
            "daily": {},
        }
        if event == "app_open":
            space["visit_count"] = int(space.get("visit_count") or 0) + 1
            space["last_seen_at"] = at
        elif event == "space_created":
            space["created_at"] = space.get("created_at") or at
            space["last_seen_at"] = at
        else:
            space["last_seen_at"] = at
        if meta["platform"] != "unknown":
            space["platform"] = meta["platform"]
        if meta["pwa"]:
            space["pwa"] = True
        if expense_count is not None:
            space["expense_count"] = max(0, int(expense_count))
            space["has_expenses"] = space["expense_count"] > 0
        events = space.setdefault("events", {})
        events[event] = int(events.get(event) or 0) + 1
        daily = space.setdefault("daily", {})
        day_stats = daily.setdefault(day, {"opens": 0, "created": 0, "added": 0, "deleted": 0})
        if event == "app_open":
            day_stats["opens"] = int(day_stats.get("opens") or 0) + 1
        elif event == "space_created" and created:
            day_stats["created"] = 1
        elif event == "expense_added":
            day_stats["added"] = int(day_stats.get("added") or 0) + 1
        elif event == "expense_deleted":
            day_stats["deleted"] = int(day_stats.get("deleted") or 0) + 1
        spaces[space_hash] = space
        write_analytics(data)


def bootstrap_existing_spaces():
    with analytics_lock:
        data = read_analytics()
        spaces = data.setdefault("spaces", {})
        for path in [DATA_FILE, *DATA_DIR.glob("*.json")]:
            if not path.exists():
                continue
            key = path.stem if path.parent == DATA_DIR else space_hash_from_token(SYNC_TOKEN)
            if key in spaces:
                continue
            state = normalize(json.loads(path.read_text(encoding="utf-8")))
            spaces[key] = {
                "created_at": None,
                "last_seen_at": None,
                "visit_count": 0,
                "has_expenses": len(state["subscriptions"]) > 0,
                "expense_count": len(state["subscriptions"]),
                "platform": "unknown",
                "pwa": False,
                "events": {},
                "daily": {},
            }
        write_analytics(data)


def stats_response():
    bootstrap_existing_spaces()
    data = read_analytics()
    spaces = list((data.get("spaces") or {}).values())
    today = today_key()
    total = len(spaces)
    activated = sum(1 for s in spaces if s.get("last_seen_at") or int(s.get("visit_count") or 0) > 0)
    active_today = sum(1 for s in spaces if today in (s.get("daily") or {}) and int((s["daily"][today] or {}).get("opens") or 0) > 0)
    returning = sum(1 for s in spaces if int(s.get("visit_count") or 0) > 1)
    platforms = {"ios": 0, "android": 0, "desktop": 0, "unknown": 0}
    for s in spaces:
        platforms[normalize_platform(s.get("platform"))] += 1
    daily = []
    now_day = datetime.now(timezone.utc).date()
    for offset in range(6, -1, -1):
        day = (now_day.fromordinal(now_day.toordinal() - offset)).isoformat()
        daily.append({
            "date": day,
            "new_spaces": sum(1 for s in spaces if day in (s.get("daily") or {}) and int((s["daily"][day] or {}).get("created") or 0) > 0),
            "active_spaces": sum(1 for s in spaces if day in (s.get("daily") or {}) and int((s["daily"][day] or {}).get("opens") or 0) > 0),
            "expense_added": sum(int(((s.get("daily") or {}).get(day) or {}).get("added") or 0) for s in spaces),
            "expense_deleted": sum(int(((s.get("daily") or {}).get(day) or {}).get("deleted") or 0) for s in spaces),
        })
    last_activity = max([s.get("last_seen_at") for s in spaces if s.get("last_seen_at")] or [None])
    return {
        "total_spaces": total,
        "activated_spaces": activated,
        "activation_rate": round(activated / total, 4) if total else 0,
        "empty_spaces": sum(1 for s in spaces if not s.get("has_expenses")),
        "total_expenses": sum(int(s.get("expense_count") or 0) for s in spaces),
        "new_spaces_today": daily[-1]["new_spaces"],
        "active_today": active_today,
        "returning_spaces": returning,
        "platform_distribution": platforms,
        "pwa": {
            "spaces": sum(1 for s in spaces if s.get("pwa") is True),
            "opens": sum(int(s.get("visit_count") or 0) for s in spaces if s.get("pwa") is True),
        },
        "last_activity_at": last_activity,
        "daily_7d": daily,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SubBubbleSync/1.0"

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

    def _authorized(self):
        return bool(bearer_token(self.headers)) or not SYNC_TOKEN

    def _admin_authorized(self):
        return bool(ADMIN_TOKEN) and self.headers.get("Authorization") == f"Bearer {ADMIN_TOKEN}"

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {"ok": True})
        if path == "/stats":
            if not self._admin_authorized():
                return self._json(401, {"error": "unauthorized"})
            return self._json(200, stats_response())
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in {"/sync", "/analytics"}:
            return self._json(404, {"error": "not_found"})
        if not self._authorized():
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
        token = bearer_token(self.headers)
        space_hash = space_hash_from_token(token)
        if path == "/analytics":
            event = str(incoming.get("event") or "")
            with lock:
                state = read_space_state(space_hash)
            track_event(space_hash, event, state=state, meta=incoming.get("meta"))
            return self._json(200, {"ok": True})
        with lock:
            current = read_space_state(space_hash)
            is_new_space = not state_file_for(space_hash).exists()
            merged = merge(current, incoming.get("state"))
            write_space_state(space_hash, merged)
        meta = incoming.get("meta") if isinstance(incoming, dict) else None
        if is_new_space:
            track_event(space_hash, "space_created", state=merged, meta=meta)
        track_event(space_hash, "app_open", state=merged, meta=meta)
        return self._json(200, {"state": merged})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"SubBubble sync listening on {HOST}:{PORT}; data={DATA_FILE}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
