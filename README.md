# adpartsol

Cloudflare Worker for AD PARTSOL: Telegram and WhatsApp bots, D1 database, staff and
supplier panels, cron engine, and the public website. Everything deploys with one
`wrangler deploy`. `wrangler.toml` serves `public/` as static assets, and `src/worker.js`
handles `/api/*` and `/webhook/*` before falling back to the assets.

## Public website

| Path | Purpose |
|---|---|
| `public/index.html` | Main site: 3D handset hero, parts catalogue, live order tracker |
| `public/dev/` | Parts Studio, an interactive 3D teardown |
| `public/assets/config.js` | API base URL, WhatsApp number, Telegram bot, contact details |
| `public/assets/app.js` | UI logic, including the tracker |
| `public/assets/site.css` | All styles |
| `public/assets/hero3d.js`, `parts3d.js`, `credit3d.js`, `phone-model.js` | 3D scenes |
| `public/assets/vendor/three/` | three.js r165, loaded through an import map |
| `public/assets/fonts/` | Satoshi and Clash Display (Fontshare, free for commercial use) |
| `functions/api/[[path]].js` | Only used if a Cloudflare Pages project serves this repo: forwards `/api/*` to the Worker |

The site runs straight from `public/`. No build step is needed.

### Order tracking

The tracker calls `GET /api/panel/track?order_id=<9 digits>`, which `src/panel_api.js`
handles. `config.js` chooses the API host:

```js
const API_BASE = location.hostname.includes("workers.dev") || location.hostname.includes("storzen.io") ? "" : "https://adpartsol.storzen-io.workers.dev";
```

Stage mapping, using whichever of `dispatch_stage` or `status` is further along:

| Step | Values |
|---|---|
| 1. Order received | `ORDER_RECEIVED`, `QUOTED` |
| 2. Parts collected | `COLLECTION_DONE` |
| 3. Quality check passed | `QC_PASSED` |
| 4. Handed to dispatch | `DISPATCH_HANDOVER` |
| 5. Shipped | `BUS_STAND_DROPPED`, `SHIPPED` |

A response of `{"ok": false}` or HTTP 404 shows "No order found". A 5xx response, a network
error or a 12 second timeout shows "Tracking is unreachable" with a retry button.
Links like `/?order_id=123456789#track` open with that order already loaded.

### Custom domain

`adpartsol.storzen.io` currently serves an older copy of the site from a separate Cloudflare
Pages project, not from this Worker. To make it show this site with working tracking, do one
of the following:

- Recommended: remove the domain from the Pages project, then add it to this Worker under
  Workers and Pages > adpartsol > Settings > Domains and Routes > Add > Custom domain.
- Or keep the Pages project, point it at this repo with output directory `public`, and keep
  `functions/` at the repo root so `/api/*` is forwarded to the Worker.

### Optional

`/dev/` pings `GET /api/health` to show the API as live. That route does not exist yet, so
the page shows "standby".
