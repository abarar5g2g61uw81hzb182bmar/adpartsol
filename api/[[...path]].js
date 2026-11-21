/**
 * Vercel serverless entry — mirrors Cloudflare Worker fetch router.
 * Routes: /webhook/*, /api/*, static handled by Vercel public/
 */
import { initDB, jsonRes, sendLog, migrateCustomersSchema } from "../src/db.js";
import { setTgWebhook, handleTelegramUpdate } from "../src/telegram.js";
import { handleWhatsAppUpdate } from "../src/whatsapp.js";
import { handleSupplierPortalAPI, handleCustomerPortalAPI, runAutomatedEngine } from "../src/supplier_staff.js";
import { handlePanelAPI } from "../src/panel_api.js";
import { buildEnv } from "../src/turso.js";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true
  },
  maxDuration: 60
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getPath(req) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url, `https://${host}`);
  const segs = req.query?.path;
  let path;
  if (Array.isArray(segs) && segs.length) {
    path = "/" + segs.join("/");
  } else if (typeof segs === "string" && segs) {
    path = "/" + segs;
  } else {
    path = url.pathname.replace(/^\/api$/, "/").replace(/^\/api\//, "/");
    if (!path.startsWith("/")) path = "/" + path;
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, url };
}

export default async function handler(req, res) {
  const env = buildEnv();
  const { path, url } = getPath(req);
  const baseUrl = `https://${req.headers.host || url.host}`;
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, x-staff-phone, x-staff-token, x-login-attempt, x-supplier-code"
    });
    return res.end();
  }

  try {
    if (path === "/init-db" || path === "/api/init-db") {
      await initDB(env.DB);
      await migrateCustomersSchema(env.DB);
      return sendJson(res, { ok: true, msg: "Database initialized & verified" });
    }

    if (path === "/setup-webhooks" || path === "/api/setup-webhooks") {
      const results = {
        customer: await setTgWebhook(env.BOT_TOKEN_CUSTOMER, `${baseUrl}/webhook/tg/customer`),
        supplier: await setTgWebhook(env.BOT_TOKEN_SUPPLIER, `${baseUrl}/webhook/tg/supplier`),
        payment: await setTgWebhook(env.BOT_TOKEN_PAYMENT, `${baseUrl}/webhook/tg/payment`),
        delivery: await setTgWebhook(env.BOT_TOKEN_DELIVERY, `${baseUrl}/webhook/tg/delivery`),
        admin: await setTgWebhook(env.BOT_TOKEN_ADMIN, `${baseUrl}/webhook/tg/admin`),
        logs: await setTgWebhook(env.BOT_TOKEN_LOGS, `${baseUrl}/webhook/tg/logs`)
      };
      return sendJson(res, { ok: true, webhooks: results });
    }

    if (path === "/health" || path === "/api/health") {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first();
      return sendJson(res, { ok: true, orders: row ? row.n : 0, platform: "vercel+turso" });
    }

    if (path === "/cron" || path === "/api/cron") {
      const secret = env.CRON_SECRET;
      if (secret) {
        const auth = req.headers.authorization || "";
        const q = url.searchParams.get("secret") || "";
        if (auth !== `Bearer ${secret}` && q !== secret) {
          res.statusCode = 401;
          return res.end("Unauthorized");
        }
      }
      await runAutomatedEngine(env);
      return sendJson(res, { ok: true, ran: "automated_engine" });
    }

    if (path.startsWith("/webhook/tg/") && method === "POST") {
      const botType = path.split("/").filter(Boolean).pop();
      const update = await readJson(req);
      try {
        await handleTelegramUpdate(botType, update, env, baseUrl);
      } catch (e) {
        await sendLog(env, `★ TG HANDLER ERROR (${botType})\n${e.message || e}`);
      }
      res.statusCode = 200;
      return res.end("OK");
    }

    if (path === "/webhook/whatsapp" && method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === env.WA_VERIFY_TOKEN) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        return res.end(challenge || "");
      }
      res.statusCode = 403;
      return res.end("Forbidden");
    }

    if (path === "/webhook/whatsapp" && method === "POST") {
      const body = await readJson(req);
      try {
        await handleWhatsAppUpdate(body, env, baseUrl);
      } catch (e) {
        await sendLog(env, `★ WA HANDLER ERROR\n${e.message || e}`);
      }
      res.statusCode = 200;
      return res.end("OK");
    }

    const isSupplier = path.startsWith("/supplier/") || path.startsWith("/api/supplier/");
    const isCustomer = path.startsWith("/customer/") || path.startsWith("/api/customer/");
    const isPanel = path.startsWith("/panel/") || path.startsWith("/api/panel/");
    if (isSupplier || isCustomer || isPanel) {
      const fullUrl = new URL(url.toString());
      if (!fullUrl.pathname.startsWith("/api/")) {
        fullUrl.pathname = "/api" + (path.startsWith("/") ? path : "/" + path);
      }
      const adapted = await adaptToFetchRequest(req, fullUrl, method);
      let response;
      if (isSupplier) {
        response = await handleSupplierPortalAPI(adapted, fullUrl, env);
      } else if (isCustomer) {
        response = await handleCustomerPortalAPI(adapted, fullUrl, env, baseUrl);
      } else {
        response = await handlePanelAPI(adapted, fullUrl, env, baseUrl);
      }
      return pipeResponse(res, response);
    }

    res.statusCode = 404;
    return res.end("Not Found");
  } catch (err) {
    try {
      await sendLog(env, `★ CRITICAL API ERROR\nPath: ${path}\nError: ${err.message}`);
    } catch (_) {}
    return sendJson(res, { ok: false, error: err.message }, 500);
  }
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

async function adaptToFetchRequest(req, url, method) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  let body = undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(url.toString(), { method, headers, body });
}

async function pipeResponse(res, response) {
  if (!response) {
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = response.status || 200;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
