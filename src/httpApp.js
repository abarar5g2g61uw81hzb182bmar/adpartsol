/**
 * Shared request router used by all Vercel API entry files.
 */
import { initDB, sendLog, migrateCustomersSchema } from "./db.js";
import { setTgWebhook, handleTelegramUpdate } from "./telegram.js";
import { handleWhatsAppUpdate } from "./whatsapp.js";
import {
  handleSupplierPortalAPI,
  handleCustomerPortalAPI,
  runAutomatedEngine
} from "./supplier_staff.js";
import { handlePanelAPI } from "./panel_api.js";
import { buildEnv } from "./turso.js";

export function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

export async function readJson(req) {
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

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-staff-phone, x-staff-token, x-login-attempt, x-supplier-code"
  );
}

export function baseUrlFrom(req) {
  const host = req.headers.host || "localhost";
  return `https://${host}`;
}

export async function handleHealth(req, res) {
  const env = buildEnv();
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first();
    return sendJson(res, {
      ok: true,
      orders: row ? row.n : 0,
      platform: "vercel+turso"
    });
  } catch (e) {
    return sendJson(res, { ok: false, error: e.message }, 500);
  }
}

export async function handleInitDb(req, res) {
  const env = buildEnv();
  try {
    await initDB(env.DB);
    await migrateCustomersSchema(env.DB);
    return sendJson(res, { ok: true, msg: "Database initialized & verified" });
  } catch (e) {
    return sendJson(res, { ok: false, error: e.message }, 500);
  }
}

export async function handleSetupWebhooks(req, res) {
  const env = buildEnv();
  const baseUrl = baseUrlFrom(req);
  try {
    const results = {
      customer: await setTgWebhook(
        env.BOT_TOKEN_CUSTOMER,
        `${baseUrl}/api/tg/customer`
      ),
      supplier: await setTgWebhook(
        env.BOT_TOKEN_SUPPLIER,
        `${baseUrl}/api/tg/supplier`
      ),
      payment: await setTgWebhook(
        env.BOT_TOKEN_PAYMENT,
        `${baseUrl}/api/tg/payment`
      ),
      delivery: await setTgWebhook(
        env.BOT_TOKEN_DELIVERY,
        `${baseUrl}/api/tg/delivery`
      ),
      admin: await setTgWebhook(env.BOT_TOKEN_ADMIN, `${baseUrl}/api/tg/admin`),
      logs: await setTgWebhook(env.BOT_TOKEN_LOGS, `${baseUrl}/api/tg/logs`)
    };
    return sendJson(res, { ok: true, webhooks: results });
  } catch (e) {
    return sendJson(res, { ok: false, error: e.message }, 500);
  }
}

export async function handleCron(req, res) {
  const env = buildEnv();
  const url = new URL(req.url, `https://${req.headers.host}`);
  const secret = env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    const q = url.searchParams.get("secret") || "";
    if (auth !== `Bearer ${secret}` && q !== secret) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }
  }
  try {
    await runAutomatedEngine(env);
    return sendJson(res, { ok: true, ran: "automated_engine" });
  } catch (e) {
    return sendJson(res, { ok: false, error: e.message }, 500);
  }
}

export async function handleWhatsApp(req, res) {
  const env = buildEnv();
  const baseUrl = baseUrlFrom(req);
  const method = req.method || "GET";
  const url = new URL(req.url, `https://${req.headers.host}`);
  cors(res);

  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (method === "GET") {
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

  if (method === "POST") {
    try {
      const body = await readJson(req);
      await handleWhatsAppUpdate(body, env, baseUrl);
    } catch (e) {
      try {
        await sendLog(env, `★ WA HANDLER ERROR\n${e.message || e}`);
      } catch (_) {}
    }
    res.statusCode = 200;
    return res.end("OK");
  }

  res.statusCode = 405;
  return res.end("Method Not Allowed");
}

export async function handleTelegram(req, res, botType) {
  const env = buildEnv();
  const baseUrl = baseUrlFrom(req);
  const method = req.method || "POST";
  cors(res);

  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  try {
    const update = await readJson(req);
    await handleTelegramUpdate(botType, update, env, baseUrl);
  } catch (e) {
    try {
      await sendLog(env, `★ TG HANDLER ERROR (${botType})\n${e.message || e}`);
    } catch (_) {}
  }
  res.statusCode = 200;
  return res.end("OK");
}
