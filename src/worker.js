import { initDB, jsonRes, sendLog, migrateCustomersSchema } from "./db.js";
import { setTgWebhook, handleTelegramUpdate } from "./telegram.js";
import { handleWhatsAppUpdate } from "./whatsapp.js";
import { handleSupplierPortalAPI, handleCustomerPortalAPI, runAutomatedEngine } from "./supplier_staff.js";
import { handlePanelAPI } from "./panel_api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const baseUrl = `${url.protocol}//${url.host}`;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-staff-phone, x-staff-token, x-login-attempt, x-supplier-code"
        }
      });
    }

    try {
      if (path === "/api/init-db") {
        await initDB(env.DB);
        await migrateCustomersSchema(env.DB);
        return jsonRes({ ok: true, msg: "Database initialized & verified" });
      }

      if (path === "/api/setup-webhooks") {
        const results = {
          customer: await setTgWebhook(env.BOT_TOKEN_CUSTOMER, `${baseUrl}/webhook/tg/customer`),
          supplier: await setTgWebhook(env.BOT_TOKEN_SUPPLIER, `${baseUrl}/webhook/tg/supplier`),
          payment: await setTgWebhook(env.BOT_TOKEN_PAYMENT, `${baseUrl}/webhook/tg/payment`),
          delivery: await setTgWebhook(env.BOT_TOKEN_DELIVERY, `${baseUrl}/webhook/tg/delivery`),
          admin: await setTgWebhook(env.BOT_TOKEN_ADMIN, `${baseUrl}/webhook/tg/admin`),
          logs: await setTgWebhook(env.BOT_TOKEN_LOGS, `${baseUrl}/webhook/tg/logs`)
        };
        return jsonRes({ ok: true, webhooks: results });
      }

      if (path.startsWith("/webhook/tg/") && request.method === "POST") {
        const botType = path.split("/").pop();
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(botType, update, env, baseUrl));
        return new Response("OK", { status: 200 });
      }

      if (path === "/webhook/whatsapp" && request.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token === env.WA_VERIFY_TOKEN) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      }

      if (path === "/webhook/whatsapp" && request.method === "POST") {
        const body = await request.json();
        ctx.waitUntil(handleWhatsAppUpdate(body, env, baseUrl));
        return new Response("OK", { status: 200 });
      }

      if (path === "/api/health") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first();
        return jsonRes({ ok: true, orders: row ? row.n : 0 });
      }

      if (path.startsWith("/api/supplier/")) return await handleSupplierPortalAPI(request, url, env);
      if (path.startsWith("/api/customer/")) return await handleCustomerPortalAPI(request, url, env, baseUrl);
      if (path.startsWith("/api/panel/")) return await handlePanelAPI(request, url, env, baseUrl);

      if (env.ASSETS) return await env.ASSETS.fetch(request);
      return new Response("AD PARTSOL Engine Active", { status: 200 });
    } catch (err) {
      ctx.waitUntil(sendLog(env, `★ CRITICAL WORKER ERROR\nPath: ${path}\nError: ${err.message}`));
      return jsonRes({ ok: false, error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatedEngine(env));
  }
};
