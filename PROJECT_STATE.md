# SubBubble Project State

## Current Status

SubBubble is a mobile-first vanilla PWA for visualizing recurring expenses as physical bubbles. Current production priority is preserving the restored raw visual baseline while improving closed-test feedback loops and recovery-key ergonomics.

## Current Branch

`codex/billing-periods-recovery-key`

Protected recovery point mentioned by the product owner: `backup/raw-prototype-2026-08-24`. Do not modify or delete it if it appears locally/remotely.

## Implemented / Preserved

- Production design, Bubble World, physics, UX, and app structure are not changed in the current analytics batch.
- Existing local-first sync server behavior is preserved.
- Server-side Space Key hashing is used for privacy-safe isolated space identifiers; raw Space Keys are not stored in analytics.
- Anonymous analytics records only aggregate counters and metadata: created/last seen timestamps, visit count, expense presence/count, platform, PWA flag, and daily counters.
- Events supported: `space_created`, `app_open`, `expense_added`, `expense_deleted`.
- Protected `GET /stats` requires separate `ADMIN_TOKEN`.
- Billing periods now support `day / week / month / year`; monthly value is normalized from yearly cost.
- Recovery-key UX exposes the current Space Key as `Ключ восстановления`, hidden by default, with show/hide, copy feedback, and guarded switching to an existing space.

## Next Stage

User review of billing-period and recovery-key changes before merge/deploy.

## Open Questions

- Future admin dashboard can be added later if Termius/curl stats become insufficient.
