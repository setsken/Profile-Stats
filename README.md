# Profile Stats

Profile Stats is the model-analytics half of the original "Of Stats Editor" product line.
This monorepo contains the dedicated Chrome extension and the backend that serves it.

## Layout

- `backend/` — Node.js + PostgreSQL service (deployed to Railway).
- `extension/` — Chrome extension (MV3).
- `docs/` — marketing site + privacy policy / terms (GitHub Pages, ofstats.pro).

## Extension anatomy

| File | Role |
| --- | --- |
| `page-interceptor.js` | Runs in page context. Hooks `fetch`/XHR and emits an event with the OnlyFans profile payload. |
| `inject-early.js` | Content script at `document_start`. Scores the profile, renders the badge (radar, fan trend, notes, alerts, comparison, AI verdict). |
| `background.js` | Service worker. The only place that talks to the network; also owns the auth token and the SSO handshake with Stats Editor. |
| `popup.js` / `popup.html` | Leaderboard, notes, settings, subscription and payment UI. Also served as the side panel. |

## Companion product

Profile Stats relies on the **Stats Editor** service for authentication and
subscription billing. JWTs issued by Stats Editor are accepted here as well
(shared `JWT_SECRET`). Subscription gating is delegated to Stats Editor via
`/api/subscription/status?product=profile_stats`.

A user with an active Stats Editor `pro` ($50) plan is granted Profile Stats
access for the same duration; otherwise a separate Profile Stats subscription
is required.

## Trust boundaries

Two rules the code depends on — breaking either reintroduces a fixed vulnerability:

1. **Profile fields belong to someone else.** Display name, location, avatar and
   every other value coming off a scored profile is chosen by that creator. Run
   it through `_esc()` before putting it in badge markup.
2. **Alerts are shared state.** `/api/alerts/*` is public on both ends, so alert
   rows are untrusted input. The server accepts only a fixed vocabulary
   (`routes/alerts.js`) and the badge builds alert rows as DOM nodes, never as
   an HTML string.
