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

The site runs straight from `public/`. No build step is needed.

### Order tracking

The tracker calls `GET /api/panel/track?order_id=<9 digits>`, which `src/panel_api.js`
handles. `config.js` chooses the API host:

```js
const API_BASE = location.hostname.includes("workers.dev") ? "" : "https://adpartsol.storzen-io.workers.dev";
```

Stage mapping, using whichever of `dispatch_stage` or `status` is further along:

| Step | Values |
|---|---|
| 1. Order received | `ORDER_RECEIVED`, `QUOTED`, `BIDDING`, `SUBMITTED`, `PENDING`, `CONFIRMATION_PENDING`, `NEEDS_SOURCING_REVIEW`, `OUTSOURCE_REVIEW`, `PIGGYBACK_QUEUED`, `WE_ARE_COLLECTING`, `COLLECTING` |
| 2. Parts collected | `COLLECTION_DONE`, `CHECKING_HUB`, `PACKING` |
| 3. Quality check passed | `QC_PASSED`, `PACKAGED_AND_LABELLED`, `AWAITING_80_PAYMENT` |
| 4. Handed to dispatch | `DISPATCH_HANDOVER`, `READY_TO_SHIP`, `OUT_FOR_BUS_STAND` |
| 5. Shipped | `BUS_STAND_DROPPED`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED` |

A status of `DECLINED`, `NO_BIDS`, `CANCELLED` or `REJECTED` shows the order as Closed.
If `hold_reason` is set, it appears under the timeline as "On hold".

A response of `{"ok": false}` or HTTP 404 shows "No order found". A 5xx response, a network
error or a 12 second timeout shows "Tracking is unreachable" with a retry button.
Links like `/?order_id=123456789#track` open with that order already loaded.

### Custom domain

`adpartsol.storzen.io` is served by a Cloudflare Pages project with output directory `public`,
so it shows these same files. Pages does not run `src/worker.js`, so `/api/*` on that domain
returns HTML. That is why `config.js` (and every staff panel) sends API calls to
`https://adpartsol.storzen-io.workers.dev` everywhere except on `workers.dev` itself.
The Worker sends `Access-Control-Allow-Origin: *`, so this works from any domain.

### Parts Studio (`/dev/`)

The Studio is a JavaScript module page. It only runs when served over HTTP:

- Live: `https://adpartsol.storzen-io.workers.dev/dev/` or `https://adpartsol.storzen.io/dev/`.
- Local: `npx wrangler dev`, then open `http://localhost:8787/dev/`.

Opening `public/dev/index.html` by double-clicking it (a `file://` address) blocks the
modules, so the page shows a notice instead of the 3D model. If
`public/assets/vendor/three/` or `public/assets/fonts/` is missing, the model and fonts
fail too. Upload the whole `public/assets/` folder.

`GET /api/health` (in `src/worker.js`) returns `{"ok": true, "orders": <count>}`. The Studio
uses it for the Order API latency and Orders logged tiles. If the route is not deployed yet,
it measures latency against the tracker endpoint and shows Orders logged as `--`.

## Deploy steps

1. Merge the `website-live-tracking` branch into `main` (or upload this folder's contents to
   the repo root, keeping your `.git` folder). Nothing in `src/` changes except the
   4-line `/api/health` route.
2. Cloudflare Workers Builds deploys the Worker automatically on push to `main`. No new
   secrets, bindings or D1 migrations are needed.
3. The Pages project for `adpartsol.storzen.io` also rebuilds from `main`. Open
   `https://adpartsol.storzen.io/`, `/dev/` and `/?order_id=<real id>#track` to check.
