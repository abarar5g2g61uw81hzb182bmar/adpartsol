import { getSetting, parseSessionMemory, formatSummaryBox, GREETING_TEMPLATES, FORGET_RESET_PHRASE, resolveActiveCustomer, forgetAndResetCustomer, migrateCustomersSchema } from "./db.js";
import { transcribeVoice } from "./ai.js";
import { notifyCustomer, processCustomerAction, processCustomerInput, showCombinedFinalConfirmation } from "./telegram.js";

export async function markWhatsAppRead(env, messageId) {
  if (!messageId) return;
  try {
    await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId })
    });
  } catch (_) {}
}

export async function sendWhatsAppNativeFlow(env, toPhone, bodyText, buttonText, flowId, screenId, flowToken) {
  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: "★ AD PARTSOL" },
      body: { text: bodyText },
      footer: { text: "AD PARTSOL — B2B Supply" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: String(flowId),
          flow_cta: buttonText.slice(0, 20),
          flow_action: "navigate",
          flow_action_payload: { screen: screenId }
        }
      }
    }
  };

  await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function handleWhatsAppUpdate(body, env, baseUrl) {
  try {
    return await handleWhatsAppUpdateInner(body, env, baseUrl);
  } catch (err) {
    try {
      const { sendLog } = await import("./db.js");
      await sendLog(env, `★ WA HANDLER ERROR\n${err.message || err}\n${err.stack || ""}`);
    } catch (_) {}
  }
}

async function handleWhatsAppUpdateInner(body, env, baseUrl) {
  const waEnabled = await getSetting(env.DB, "wa_enabled", "1");
  if (waEnabled !== "1") return;

  const entry = body.entry?.[0]?.changes?.[0]?.value;
  if (!entry || !entry.messages || !entry.messages[0]) return;

  const msg = entry.messages[0];
  const from = msg.from;
  const now = Math.floor(Date.now() / 1000);
  await migrateCustomersSchema(env.DB);

  await markWhatsAppRead(env, msg.id);

  let cust = await resolveActiveCustomer(env.DB, "whatsapp", from);
  const isNew = !cust;
  if (isNew) {
    const custId = `wa_${from}`;
    await env.DB.prepare(
      "INSERT INTO customers (id, platform, chat_id, phone, lang, last_msg_at, state, account_root, reset_count, deleted_at) VALUES (?, 'whatsapp', ?, ?, NULL, ?, 'AWAITING_REQ', ?, 0, 0)"
    ).bind(custId, from, from, now, from).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, cust.id).run();
    cust.last_msg_at = now;
  }

  if (cust.banned_until > now) return;

  if (msg.type === "text") {
    const rawText = (msg.text?.body || "").trim();
    if (rawText === FORGET_RESET_PHRASE) {
      const fresh = await forgetAndResetCustomer(env, cust);
      const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
      return await notifyCustomer(
        env, fresh,
        `★ Account reset complete.\n━━━━━━━━━━━━━━━━━\n→ Old ID archived as DELETED\n→ New Partner ID: ${fresh.id}\n━━━━━━━━━━━━━━━━━\n${greet}\n☞ Select language or complete Shop Setup to begin again:`,
        [[
          { text: "English", callback_data: "lang_english" },
          { text: "Hindi", callback_data: "lang_hindi" },
          { text: "Hinglish", callback_data: "lang_hinglish" }
        ]]
      );
    }
  }

  if (msg.type === "interactive") {
    const btnId = msg.interactive?.button_reply?.id;
    if (btnId === "keep_alive_24h") {
      return await notifyCustomer(env, cust, "★ Session active for 24 hours. You will receive your order update here.");
    }
    if (btnId) return await processCustomerAction(env, cust, btnId, null, baseUrl);

    if (msg.interactive?.type === "nfm_reply") {
      const rawJson = msg.interactive.nfm_reply?.response_json || "{}";
      let formData = {};
      try { formData = JSON.parse(rawJson); } catch (_) { formData = {}; }

      if (formData.form_type === "setup" || formData.shop_name) {
        const fullName = `${formData.full_name || "Partner"} (${formData.shop_name || "Shop"})`;
        const phone = formData.phone || from;
        const addr = `${formData.address || ""}${formData.email ? " | Email: " + formData.email : ""}`;
        const lang = formData.lang || "hinglish";

        await env.DB.prepare(
          "UPDATE customers SET full_name = ?, phone = ?, address = ?, lang = ?, state = 'AWAITING_REQ' WHERE id = ?"
        ).bind(fullName, phone, addr, lang, cust.id).run();
        cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cust.id).first();

        const mem = parseSessionMemory(cust.temp_data);
        if (mem.items && mem.items.length > 0) {
          return await showCombinedFinalConfirmation(env, cust, null, baseUrl);
        }

        const partnerCode = "ADP-" + String(phone).slice(-4);
        const bridgeMsg = `★ Welcome to AD PARTSOL, ${fullName}!\n━━━━━━━━━━━━━━━━━\n→ Partner ID: #${partnerCode}\n→ Delivery Hub: ${formData.address}\n└ Language: ${lang.toUpperCase()}\n━━━━━━━━━━━━━━━━━\n☞ Tap below to open the Spare Parts Order Form, or simply send a Voice Note, Photo, or Text right here:`;

        const orderFlowId = await getSetting(env.DB, "wa_flow_id_order", "");
        if (orderFlowId) {
          return await sendWhatsAppNativeFlow(env, from, bridgeMsg, "Order Spare Parts", orderFlowId, "PRODUCT_ORDER", `ord_${cust.id}`);
        }
        return await notifyCustomer(env, cust, bridgeMsg);
      }

      if (formData.form_type === "order" || formData.brand) {
        const mem = parseSessionMemory(cust.temp_data);
        mem.items = mem.items || [];
        mem.items.push({
          brand: formData.brand,
          model: "",
          part_name: formData.part_name,
          variant: formData.variant || "Standard",
          qty: Number(formData.qty) || 1
        });
        await env.DB.prepare("UPDATE customers SET state = 'CONFIRM_REQ', temp_data = ? WHERE id = ?")
          .bind(JSON.stringify(mem), cust.id).run();

        if (formData.more_items && formData.more_items.trim()) {
          return await processCustomerInput(env, cust, formData.more_items.trim(), null, baseUrl);
        }

        const summaryBox = formatSummaryBox(mem.items, "[?] Are these details correct?");
        return await notifyCustomer(env, cust, summaryBox, [
          [{ text: "[+] Confirm", callback_data: "req_continue" }, { text: "[✎] Edit", callback_data: "req_edit" }, { text: "[×] Cancel", callback_data: "req_cancel" }]
        ]);
      }
    }
  }

  if (msg.type === "text") {
    const t = (msg.text.body || "").trim();
    const cleanWord = t.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const isGreeting = ["hi", "hello", "start", "hey", "namaste", "hii", "hola", "yo"].includes(cleanWord);

    // Only force language / setup on: brand new account, no language yet, or pure greeting.
    // Once lang is set, real order text must reach processCustomerInput even without full_name
    // (profile is collected later at confirm time).
    if (isNew || !cust.lang || isGreeting) {
      const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
      const setupFlowId = await getSetting(env.DB, "wa_flow_id_setup", "");
      const orderFlowId = await getSetting(env.DB, "wa_flow_id_order", "");

      // No language yet → language buttons first
      if (!cust.lang) {
        return await notifyCustomer(
          env, cust,
          `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Please select your preferred language to begin:`,
          [[
            { text: "English", callback_data: "lang_english" },
            { text: "Hindi", callback_data: "lang_hindi" },
            { text: "Hinglish", callback_data: "lang_hinglish" }
          ]]
        );
      }

      // Greeting + incomplete profile → offer Shop Setup (optional, not blocking)
      if (!cust.full_name && setupFlowId) {
        return await sendWhatsAppNativeFlow(
          env, from,
          `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Tap below to complete your 10-second Shop Registration, or just type the spare part you need:`,
          "Shop Setup Form",
          setupFlowId,
          "SHOP_SETUP",
          `setup_${cust.id}`
        );
      }

      // Greeting + has profile → order form
      if (cust.full_name && orderFlowId) {
        return await sendWhatsAppNativeFlow(
          env, from,
          `${greet}\n━━━━━━━━━━━━━━━━━\nWelcome back, ${cust.full_name}!\n☞ Tap below to open the Product Order Form, or send a Voice Note, Photo, or Text:`,
          "Order Spare Parts",
          orderFlowId,
          "PRODUCT_ORDER",
          `ord_${cust.id}`
        );
      }

      // Greeting fallback
      return await notifyCustomer(
        env, cust,
        `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Tell us what mobile spare parts you need (text, photo, or voice note):`
      );
    }

    // Real order / any non-greeting text → AI parsing
    return await processCustomerInput(env, cust, t, null, baseUrl);
  }

  if (msg.type === "image" || msg.type === "audio" || msg.type === "voice") {
    const mediaId = (msg.image || msg.audio || msg.voice).id;
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}` }
    });
    const metaJson = await metaRes.json();
    if (!metaJson.url) return;

    const mediaBin = await fetch(metaJson.url, {
      headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}` }
    });

    if (msg.type === "image") {
      const buf = await mediaBin.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(binary);
      const dataUri = `data:${metaJson.mime_type || "image/jpeg"};base64,${b64}`;
      return await processCustomerInput(env, cust, msg.image.caption || "", dataUri, baseUrl);
    } else {
      const text = await transcribeVoice(env, await mediaBin.arrayBuffer(), "wa_voice.ogg");
      return await processCustomerInput(env, cust, text, null, baseUrl);
    }
  }
}
