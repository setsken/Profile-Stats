# Profile Stats

Profile Stats is the model-analytics half of the original "Of Stats Editor" product line.
This monorepo contains the dedicated Chrome extension and the backend that serves it.

## Layout

- `backend/` — Node.js + PostgreSQL service (deployed to Railway).
- `extension/` — Chrome extension (added in a later phase).

## Companion product

Profile Stats relies on the **Stats Editor** service for authentication and
subscription billing. JWTs issued by Stats Editor are accepted here as well
(shared `JWT_SECRET`). Subscription gating is delegated to Stats Editor via
`/api/subscription/status?product=profile_stats`.

A user with an active Stats Editor `pro` ($50) plan is granted Profile Stats
access for the same duration; otherwise a separate Profile Stats subscription
is required.
