# SubBubble Project State

## Current Status

SubBubble is a mobile-first vanilla PWA for visualizing recurring expenses as physical bubbles. Current production priority is preserving the restored raw visual baseline while improving the backend architecture for safe closed testing.

## Current Branch

`codex/anonymous-product-analytics`

Protected recovery point mentioned by the product owner: `backup/raw-prototype-2026-08-24`. Do not modify or delete it if it appears locally/remotely.

## Implemented / Preserved

- Production design, Bubble World, physics, UX, and app structure are not changed in the current analytics batch.
- Existing local-first sync server behavior is preserved.
- Server-side Space Key hashing is used for privacy-safe isolated space identifiers; raw Space Keys are not stored in analytics.
- Anonymous analytics records only aggregate counters and metadata: created/last seen timestamps, visit count, expense presence/count, platform, PWA flag, and daily counters.
- Events supported: `space_created`, `app_open`, `expense_added`, `expense_deleted`.
- Protected `GET /stats` requires separate `ADMIN_TOKEN`.

## Next Stage

Deploy the sync server update to VPS, create `ADMIN_TOKEN`, then use protected `/stats` for closed-test usage checks.

## Open Questions

- Future admin dashboard can be added later if Termius/curl stats become insufficient.
