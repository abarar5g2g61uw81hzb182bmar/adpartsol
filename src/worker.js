export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Database Init Route
      if (path === "/api/init-db") {
        await initDB(env.DB);
        return jsonRes({ ok: true, msg: "Database tables initialized & verified!" });
      }

      // 2. Setup All 6 Telegram Webhooks
      if (path === "/api/setup-webhooks") {
        const base = `${url.protocol}//${url.host}`;
        const results = {
          customer: await setTgWebhook(env.BOT_TOKEN_CUSTOMER, `${base}/webhook/tg/customer`),
          supplier: await setTgWebhook(env.BOT_TOKEN_SUPPLIER, `${base}/webhook/tg/supplier`),
          payment: await setTgWebhook(env.BOT_TOKEN_PAYMENT, `${base}/webhook/tg/payment`),
          delivery: await setTgWebhook(env.BOT_TOKEN_DELIVERY, `${base}/webhook/tg/delivery`),
          admin: await setTgWebhook(env.BOT_TOKEN_ADMIN, `${base}/webhook/tg/admin`),
          logs: await setTgWebhook(env.BOT_TOKEN_LOGS, `${base}/webhook/tg/logs`)
        };
        return jsonRes({ ok: true, webhooks: results });
      }

      // 3. Telegram Webhooks
      if (path.startsWith("/webhook/tg/") && request.method === "POST") {
        const botType = path.split("/").pop();
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(botType, update, env));
        return new Response("OK", { status: 200 });
      }

      // 4. Meta WhatsApp Webhook Verification (GET)
      if (path === "/webhook/whatsapp" && request.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token === env.WA_VERIFY_TOKEN) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("WhatsApp Webhook Active (Forbidden Token)", { status: 403 });
      }

      // 5. Meta WhatsApp Webhook Events (POST)
      if (path === "/webhook/whatsapp" && request.method === "POST") {
        const body = await request.json();
        ctx.waitUntil(handleWhatsAppUpdate(body, env));
        return new Response("OK", { status: 200 });
      }

      // 6. Staff & Customer Web Panel REST APIs
      if (path.startsWith("/api/panel/")) {
        return await handlePanelAPI(request, url, env);
      }

      // 7. Serve Static Website & Staff Panels (/a, /pay, /p, /c)
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response("AD PARTSOL Engine Active", { status: 200 });
    } catch (err) {
      ctx.waitUntil(sendLog(env, `🚨 *CRITICAL WORKER ERROR*\nPath: ${path}\nError:${err.message}`));
      return jsonRes({ ok: false, error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatedEngine(env));
  }
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

async function sendLog(env, text) {
  if (!env.BOT_TOKEN_LOGS || !env.LOGS_GROUP_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN_LOGS}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.LOGS_GROUP_ID, text, parse_mode: "Markdown" })
    });
  } catch (_) {}
}

async function getSetting(DB, key, fallback = "") {
  const row = await DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : fallback;
}

// ==========================================
// COMPACT ROLLING MEMORY HELPER (MAX 6 MSGS)
// ==========================================
function parseSessionMemory(tempDataStr) {
  try {
    const parsed = JSON.parse(tempDataStr || "{}");
    if (Array.isArray(parsed)) return { items: parsed, history: [] };
    return { items: parsed.items || [], history: parsed.history || [] };
  } catch (_) {
    return { items: [], history: [] };
  }
}

// ==========================================
// OPENAI 4-MODEL ROUTER WITH CONTEXT MEMORY
// ==========================================
async function analyzeCustomerRequirement(env, textInput, imageUrl = null, lang = "hinglish", memoryObj = { items: [], history: [] }) {
  const aiEnabled = await getSetting(env.DB, "ai_enabled", "1");
  if (aiEnabled !== "1") return { valid: false, clarify_msg: "System maintenance: AI is paused by Admin." };

  const model = imageUrl ? "gpt-6-luna" : "gpt-5.6-luna";
  const prevHistory = memoryObj.history.slice(-6).map(h => `${h.r}:${h.t}`).join("\n");
  const prevDraft = JSON.stringify(memoryObj.items || []);

  const sysPrompt = `You are AD PARTSOL's B2B Mobile Spare Parts AI Assistant.
Customer preferred language: ${lang}.
Recent Chat Context (for memory):
${prevHistory || "None"}
Current Draft Items: ${prevDraft}

Rules:
1. Merge new details (like quantity, model, variant, or additional parts) with the previous context/draft.
2. If Brand, Model, and Part Name are clear, set "valid": true and list all items (default qty=1, variant="Standard" if not specified).
3. If Brand, Model, or Part Name is still missing, set "valid": false and ask a short question in ${lang} inside "clarify_msg".

Output strictly JSON:
{
  "valid": true/false,
  "items": [
    {"brand": "Vivo", "model": "Y20", "part_name": "Display Folder", "variant": "Standard", "qty": 2}
  ],
  "summary_text": "Short friendly confirmation in ${lang}",
  "clarify_msg": "Short question in ${lang} if incomplete"
}`;

  const userContent = [];
  if (textInput) userContent.push({ type: "text", text: textInput });
  if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userContent }
      ]
    })
  });

  const data = await res.json();
  if (!data.choices || !data.choices[0]) throw new Error("OpenAI error: " + JSON.stringify(data));
  return JSON.parse(data.choices[0].message.content);
}

async function analyzePaymentScreenshot(env, imageUrl, expectedAmount, expectedUpi) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-6-luna",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this UPI payment screenshot. Extract 12-digit UTR/Ref number, paid amount, and verify if genuine. Expected Amount: Rs ${expectedAmount}, Expected UPI:${expectedUpi}. Return strict JSON: {"is_valid_screenshot": true/false, "utr": "123456789012" or null, "amount": 500, "reason": "string"}`
        },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: imageUrl } }]
        }
      ]
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function transcribeVoice(env, audioBuffer, filename = "voice.ogg") {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), filename);
  form.append("model", "gpt-4o-mini-transcribe");

  let res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });

  if (!res.ok) {
    const formFallback = new FormData();
    formFallback.append("file", new Blob([audioBuffer]), filename);
    formFallback.append("model", "gpt-transcribe");
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body: formFallback
    });
  }
  const data = await res.json();
  return data.text || "";
}

// ==========================================
// TELEGRAM & WHATSAPP SEND HELPERS
// ==========================================
async function tgCall(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function setTgWebhook(token, url) {
  if (!token) return "Missing token";
  return await tgCall(token, "setWebhook", { url });
}

async function getTgFileUrl(token, fileId) {
  const info = await tgCall(token, "getFile", { file_id: fileId });
  if (!info.ok) return null;
  return `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
}

async function notifyCustomer(env, customer, text, buttons = null, photoUrl = null, videoFileId = null) {
  if (customer.platform === "telegram") {
    const reply_markup = buttons ? { inline_keyboard: buttons } : undefined;
    if (photoUrl) {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendPhoto", {
        chat_id: customer.chat_id, photo: photoUrl, caption: text, parse_mode: "Markdown", reply_markup
      });
    } else if (videoFileId) {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendVideo", {
        chat_id: customer.chat_id, video: videoFileId, caption: text, parse_mode: "Markdown", reply_markup
      });
    } else {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
        chat_id: customer.chat_id, text, parse_mode: "Markdown", reply_markup
      });
    }
  } else if (customer.platform === "whatsapp") {
    const now = Math.floor(Date.now() / 1000);
    if (now - customer.last_msg_at > 86000) {
      await sendLog(env, `⚠️ *24h Window Expired* for WA Customer ${customer.chat_id}. Order update queued.`);
      return;
    }
    const payload = { messaging_product: "whatsapp", to: customer.chat_id };
    if (photoUrl) {
      payload.type = "image";
      payload.image = { link: photoUrl, caption: text };
    } else if (buttons && buttons.length > 0) {
      const flatBtns = buttons.flat().slice(0, 3);
      payload.type = "interactive";
      payload.interactive = {
        type: "button",
        body: { text: text.replace(/\*/g, "") },
        action: {
          buttons: flatBtns.map(b => ({
            type: "reply",
            reply: { id: b.callback_data, title: b.text.slice(0, 20) }
          }))
        }
      };
    } else {
      payload.type = "text";
      payload.text = { body: text.replace(/\*/g, "") };
    }
    await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
}

// ==========================================
// TELEGRAM UPDATES ROUTER (6 BOTS)
// ==========================================
async function handleTelegramUpdate(botType, update, env) {
  if (botType === "customer") return await handleCustomerBot(update, env);
  if (botType === "supplier") return await handleSupplierBot(update, env);
  if (botType === "payment") return await handlePaymentBot(update, env);
  if (botType === "delivery") return await handleDeliveryBot(update, env);
  if (botType === "admin") return await handleAdminBot(update, env);
}

async function handleCustomerBot(update, env) {
  const tgEnabled = await getSetting(env.DB, "tg_enabled", "1");
  if (tgEnabled !== "1") return;

  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);
  const custId = `tg_${chatId}`;
  const now = Math.floor(Date.now() / 1000);

  let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  if (!cust) {
    await env.DB.prepare("INSERT INTO customers (id, platform, chat_id, last_msg_at) VALUES (?, 'telegram', ?, ?)").bind(custId, chatId, now).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, custId).run();
  }

  if (cust.banned_until > now) return;

  if (cb) {
    await tgCall(env.BOT_TOKEN_CUSTOMER, "answerCallbackQuery", { callback_query_id: cb.id });
    return await processCustomerAction(env, cust, cb.data);
  }

  const text = msg.text || msg.caption || "";
  if (text === "/start") {
    await env.DB.prepare("UPDATE customers SET temp_data = NULL, state = 'IDLE' WHERE id = ?").bind(custId).run();
    return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
      chat_id: chatId,
      text: "🚀 *Welcome to AD PARTSOL (B2B Mobile Spare Parts)*\n\nPlease select your preferred language / Apni bhasha chunein:",
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇬🇧 English", callback_data: "lang_english" }, { text: "🇮🇳 हिन्दी", callback_data: "lang_hindi" }],
          [{ text: "🗣️ Hinglish", callback_data: "lang_hinglish" }, { text: "🇮🇳 ଓଡ଼ିଆ (Odia)", callback_data: "lang_odia" }],
          [{ text: "🗣️ Odia + English", callback_data: "lang_odia_eng" }]
        ]
      }
    });
  }

  let mediaUrl = null;
  let finalInput = text;

  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    mediaUrl = await getTgFileUrl(env.BOT_TOKEN_CUSTOMER, fileId);
  } else if (msg.voice || msg.audio) {
    const fileId = (msg.voice || msg.audio).file_id;
    const audioUrl = await getTgFileUrl(env.BOT_TOKEN_CUSTOMER, fileId);
    const audioRes = await fetch(audioUrl);
    finalInput = await transcribeVoice(env, await audioRes.arrayBuffer());
  }

  await processCustomerInput(env, cust, finalInput, mediaUrl);
}

async function processCustomerAction(env, cust, data) {
  if (data.startsWith("lang_")) {
    const lang = data.replace("lang_", "");
    await env.DB.prepare("UPDATE customers SET lang = ?, state = 'AWAITING_REQ', temp_data = NULL WHERE id = ?").bind(lang, cust.id).run();
    cust.lang = lang;
    return await notifyCustomer(env, cust, "✅ Language saved!\n\n📝 *Apni Spare Parts Requirement bhejein:*\nAap *Text*, *Photo (Parchi/Part)*, ya *Voice Note* bhej sakte hain (Brand, Model, Part Name aur Quantity batayein).");
  }

  if (data === "req_continue") {
    if (!cust.full_name || !cust.phone || !cust.address) {
      await env.DB.prepare("UPDATE customers SET state = 'AWAITING_PROFILE' WHERE id = ?").bind(cust.id).run();
      return await notifyCustomer(env, cust, "👤 *First Time Profile Setup*\n\nOrder aage badhane se pehle apna:\n*Full Name, Phone Number, aur Complete Delivery Address* ek hi message mein likh kar bhejein:");
    }
    return await launchOrderBidding(env, cust);
  }

  if (data === "req_cancel") {
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_REQ', temp_data = NULL WHERE id = ?").bind(cust.id).run();
    return await notifyCustomer(env, cust, "🔄 Order draft clear kar diya gaya hai. Nayi requirement bhejein:");
  }

  if (data.startsWith("pay20_")) {
    const orderId = Number(data.split("_")[1]);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) return;
    const upi = await getSetting(env.DB, "upi_id", "Constabrar@upi");
    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=AD%20PARTSOL&am=${order.advance_20}&cu=INR&tn=ORD${order.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;

    await env.DB.prepare("UPDATE customers SET state = ? WHERE id = ?").bind(`AWAITING_20_SS_${order.id}`, cust.id).run();
    return await notifyCustomer(
      env, cust,
      `💳 *20% Advance Payment - Order #${order.id}*\n\n💰 Payable Now: *₹${order.advance_20}*\n🏦 UPI ID: \`${upi}\`\n\nQR scan karke payment karein aur *Payment Screenshot* yahan bhejein:`,
      null, qrUrl
    );
  }
}

async function processCustomerInput(env, cust, text, mediaUrl) {
  if (cust.state === "AWAITING_PROFILE") {
    if (!text || text.length < 10) {
      return await notifyCustomer(env, cust, "⚠️ Kripya apna Full Name, 10-digit Phone Number aur pura Pin Code sahit Address likhein.");
    }
    const phoneMatch = text.match(/\b\d{10}\b/);
    const phone = phoneMatch ? phoneMatch[0] : "Provided in text";
    await env.DB.prepare("UPDATE customers SET full_name = ?, phone = ?, address = ? WHERE id = ?")
      .bind(text.split("\n")[0].slice(0, 40), phone, text, cust.id).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cust.id).first();
    return await launchOrderBidding(env, cust);
  }

  if (cust.state.startsWith("AWAITING_20_SS_") || cust.state.startsWith("AWAITING_80_SS_")) {
    const is20 = cust.state.startsWith("AWAITING_20_SS_");
    const orderId = Number(cust.state.split("_").pop());
    if (!mediaUrl) {
      return await notifyCustomer(env, cust, "📸 Kripya payment ka *Screenshot (Photo)* upload karein!");
    }
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    const expectedAmt = is20 ? order.advance_20 : order.balance_80;
    const upi = await getSetting(env.DB, "upi_id", "Constabrar@upi");

    await notifyCustomer(env, cust, "🔍 AI aapka payment screenshot verify kar raha hai...");
    const check = await analyzePaymentScreenshot(env, mediaUrl, expectedAmt, upi);

    if (check.utr) {
      const dup = await env.DB.prepare("SELECT id FROM payments WHERE extracted_utr = ? AND status != 'REJECTED'").bind(check.utr).first();
      if (dup) {
        return await applyFraudStrike(env, cust, `Duplicate UTR (${check.utr}) uploaded!`);
      }
    }

    if (!check.is_valid_screenshot) {
      return await applyFraudStrike(env, cust, check.reason || "Invalid payment screenshot.");
    }

    const payType = is20 ? "ADVANCE_20" : "BALANCE_80";
    const payRes = await env.DB.prepare(
      "INSERT INTO payments (order_id, customer_id, type, expected_amount, extracted_utr, extracted_amount, file_id_or_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(orderId, cust.id, payType, expectedAmt, check.utr || `MANUAL_${Date.now()}`, check.amount || expectedAmt, mediaUrl).run();

    const payId = payRes.meta.last_row_id;
    await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?")
      .bind(is20 ? "AWAITING_20_APPROVAL" : "AWAITING_80_APPROVAL", orderId).run();
    await env.DB.prepare("UPDATE customers SET state = 'IDLE' WHERE id = ?").bind(cust.id).run();

    const caption = `💸 *New ${is20 ? "20% Advance" : "80% Balance"} Payment*\n\n📦 Order: *#${orderId}*\n👤 Customer: ${cust.full_name} (${cust.phone})\n💰 Expected: *₹${expectedAmt}*\n🤖 AI Detected: *₹${check.amount || "?"}* | UTR: \`${check.utr || "Check Image"}\``;
    const grpMsg = await tgCall(env.BOT_TOKEN_PAYMENT, "sendPhoto", {
      chat_id: env.PAYMENT_GROUP_ID,
      photo: mediaUrl,
      caption,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `payapp_${payId}` },
          { text: "❌ Reject (Fake)", callback_data: `payrej_${payId}` }
        ]]
      }
    });

    if (grpMsg.ok) {
      await env.DB.prepare("UPDATE payments SET tg_group_msg_id = ? WHERE id = ?").bind(grpMsg.result.message_id, payId).run();
    }
    return await notifyCustomer(env, cust, "✅ Screenshot receive ho gaya hai! Payment Team verify kar rahi hai.");
  }

  // Requirement Gathering with Rolling 6-Message Memory
  const mem = parseSessionMemory(cust.temp_data);
  if (text) mem.history.push({ r: "User", t: text.slice(0, 120) });

  await notifyCustomer(env, cust, "🧠 AI aapki requirement analyze kar raha hai...");
  const parsed = await analyzeCustomerRequirement(env, text, mediaUrl, cust.lang, mem);

  if (!parsed.valid || !parsed.items || parsed.items.length === 0) {
    const botReply = parsed.clarify_msg || "Kripya Brand, Model, Part Name aur Quantity saaf likhein.";
    mem.history.push({ r: "AI", t: botReply.slice(0, 120) });
    mem.history = mem.history.slice(-6); // Keep only last 6 turns to save tokens!
    await env.DB.prepare("UPDATE customers SET temp_data = ? WHERE id = ?").bind(JSON.stringify(mem), cust.id).run();
    return await notifyCustomer(env, cust, `🤔 *Clarification Needed:*\n${botReply}`);
  }

  mem.items = parsed.items;
  mem.history.push({ r: "AI", t: (parsed.summary_text || "Summary ready").slice(0, 120) });
  mem.history = mem.history.slice(-6);

  await env.DB.prepare("UPDATE customers SET state = 'CONFIRM_REQ', temp_data = ? WHERE id = ?")
    .bind(JSON.stringify(mem), cust.id).run();

  let itemLines = parsed.items.map((it, idx) => `${idx + 1}. *${it.brand} ${it.model}* -${it.part_name} (${it.variant \vert{}\vert{} "Std"}) × *${it.qty} pcs*`).join("\n");
  await notifyCustomer(
    env, cust,
    `📋 *Order Summary:*\n\n${itemLines}\n\n${parsed.summary_text || ""}\n\nKya hum iska best wholesale rate nikaalein? *(Ya kuch aur add/change karna hai toh seedha likh kar bhejein)*`,
    [[{ text: "➕ Continue", callback_data: "req_continue" }, { text: "❌ Clear All", callback_data: "req_cancel" }]]
  );
}

async function applyFraudStrike(env, cust, reason) {
  const strikes = (cust.fraud_strikes || 0) + 1;
  const now = Math.floor(Date.now() / 1000);
  if (strikes >= 3) {
    const banUntil = now + 12 * 3600;
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ?, banned_until = ?, state = 'IDLE' WHERE id = ?")
      .bind(strikes, banUntil, cust.id).run();
    await sendLog(env, `🚫 *SHADOW BAN (12h)*\nCustomer: ${cust.id} (${cust.phone})\nReason: 3 Fake Payment Screenshots (${reason})`);
    return await notifyCustomer(env, cust, "🚫 Multiple invalid payment screenshots detected. Your account is temporarily restricted for 12 hours.");
  } else {
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ? WHERE id = ?").bind(strikes, cust.id).run();
    return await notifyCustomer(env, cust, `⚠️ *Invalid Screenshot (${strikes}/3 warning):*${reason}\nKripya sahi payment screenshot upload karein.`);
  }
}

async function launchOrderBidding(env, cust) {
  const mem = parseSessionMemory(cust.temp_data);
  const items = mem.items || [];
  if (!items.length) return await notifyCustomer(env, cust, "⚠️ Koi active requirement nahi mili. Dobara bhejein.");

  const endsAt = Math.floor(Date.now() / 1000) + 1800; // 30 Minutes
  const margin = Number(await getSetting(env.DB, "margin_percent", "20"));
  const delivery = Number(await getSetting(env.DB, "delivery_charge", "100"));

  // Generate 9-Digit Order ID (Matches website promise!)
  const orderId = Math.floor(100000000 + Math.random() * 900000000);

  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, status, margin_percent, delivery_charge, bidding_ends_at) VALUES (?, ?, 'BIDDING', ?, ?, ?)"
  ).bind(orderId, cust.id, margin, delivery, endsAt).run();

  const suppliers = await env.DB.prepare("SELECT * FROM suppliers WHERE is_verified = 1 AND is_active = 1").all();

  for (const it of items) {
    const itemRes = await env.DB.prepare(
      "INSERT INTO order_items (order_id, brand, model, part_name, variant, req_qty) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(orderId, it.brand, it.model, it.part_name, it.variant || "Standard", Number(it.qty) || 1).run();
    const itemId = itemRes.meta.last_row_id;

    for (const sup of (suppliers.results || [])) {
      const msgRes = await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: sup.tg_chat_id,
        text: `🔔 *New Spare Part Inquiry (Order #${orderId})*\n\n📱 Model: *${it.brand}${it.model}*\n🔧 Part: *${it.part_name}* (${it.variant || "Standard"})\n📦 Required Qty: *${it.qty} pcs*\n⏱️ Window: *30 Minutes*`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "➕ Yes, I have this", callback_data: `have_${orderId}_${itemId}` }]]
        }
      });

      if (msgRes.ok) {
        await env.DB.prepare(
          "INSERT INTO bids (order_id, item_id, supplier_id, tg_msg_id, status) VALUES (?, ?, ?, ?, 'PENDING')"
        ).bind(orderId, itemId, sup.id, msgRes.result.message_id).run();
      }
    }
  }

  await env.DB.prepare("UPDATE customers SET state = 'IDLE', temp_data = NULL WHERE id = ?").bind(cust.id).run();
  await notifyCustomer(env, cust, `✅ *Order #${orderId} Confirmed!*\n\nHumare verified suppliers se best wholesale rate mangwaya ja raha hai. *30 minutes* ke andar aapko final quotation mil jayega!`);
  await sendLog(env, `🛒 *New Order #${orderId}* launched (${items.length} items). Broadcasted to ${(suppliers.results || []).length} active suppliers.`);
}

async function handleSupplierBot(update, env) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);

  if (cb) {
    await tgCall(env.BOT_TOKEN_SUPPLIER, "answerCallbackQuery", { callback_query_id: cb.id });
    if (cb.data.startsWith("have_")) {
      const [_, orderId, itemId] = cb.data.split("_").map(Number);
      const ord = await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(orderId).first();
      if (!ord || ord.status !== "BIDDING") {
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
        return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "⏱️ Is order ka bidding time khatam ho chuka hai." });
      }
      await env.DB.prepare("UPDATE suppliers SET current_bid_item_id = ? WHERE tg_chat_id = ?").bind(itemId, chatId).run();
      return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: chatId,
        text: "💰 *Rate aur Available Quantity bhejein*\nFormat: `Price Qty` (Example: `1500 2` matlab ₹1500 per piece, 2 pieces available):",
        parse_mode: "Markdown"
      });
    }
    return;
  }

  const text = (msg?.text || "").trim();
  if (text === "/start") {
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
      chat_id: chatId,
      text: "🏭 *AD PARTSOL - Supplier Terminal*\n\nJudne ke liye Admin se mila code daalein:\n`/verify <CODE>`\n\nCommands:\n`/active` - Orders chalu karein\n`/sleep` - Orders band karein",
      parse_mode: "Markdown"
    });
  }

  if (text.startsWith("/verify ")) {
    const code = text.split(" ")[1]?.trim();
    const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE verify_code = ?").bind(code).first();
    if (!sup) return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "❌ Invalid verification code!" });
    await env.DB.prepare("UPDATE suppliers SET tg_chat_id = ?, is_verified = 1, is_active = 1 WHERE id = ?").bind(chatId, sup.id).run();
    await sendLog(env, `🏭 Supplier Verified: *${sup.name}* (${chatId})`);
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: `✅ Welcome *${sup.name}*! Aapka supplier account active ho gaya hai.`, parse_mode: "Markdown" });
  }

  const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE tg_chat_id = ? AND is_verified = 1").bind(chatId).first();
  if (!sup) return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "🔒 Please verify first using `/verify <CODE>`" });

  if (text === "/sleep") {
    await env.DB.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").bind(sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "😴 *Sleep Mode ON:* Ab aapko naye order requests nahi aayenge. Wapas chalu karne ke liye `/active` dabayein.", parse_mode: "Markdown" });
  }

  if (text === "/active") {
    await env.DB.prepare("UPDATE suppliers SET is_active = 1 WHERE id = ?").bind(sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "🟢 *Active Mode ON:* Ab aapko naye order alerts milenge!", parse_mode: "Markdown" });
  }

  if (sup.current_bid_item_id) {
    const parts = text.split(/\s+/);
    const price = parseFloat(parts[0]);
    const qty = parseInt(parts[1] || "1", 10);
    if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) {
      return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "⚠️ Sahi format mein likhein: `Price Qty` (e.g., `1500 2`)", parse_mode: "Markdown" });
    }

    const bid = await env.DB.prepare("SELECT * FROM bids WHERE item_id = ? AND supplier_id = ?").bind(sup.current_bid_item_id, sup.id).first();
    if (bid) {
      await env.DB.prepare("UPDATE bids SET price_per_unit = ?, available_qty = ?, status = 'SUBMITTED' WHERE id = ?")
        .bind(price, qty, bid.id).run();
      if (bid.tg_msg_id) {
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", {
          chat_id: chatId, message_id: bid.tg_msg_id, reply_markup: { inline_keyboard: [] }
        });
      }
    }
    await env.DB.prepare("UPDATE suppliers SET current_bid_item_id = NULL WHERE id = ?").bind(sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
      chat_id: chatId, text: `✅ Bid Recorded: *₹${price}/pc* for *${qty} pcs*. Buttons auto-cleaned!`, parse_mode: "Markdown"
    });
  }
}

async function handlePaymentBot(update, env) {
  const cb = update.callback_query;
  if (!cb) return;
  await tgCall(env.BOT_TOKEN_PAYMENT, "answerCallbackQuery", { callback_query_id: cb.id });

  const [action, payIdStr] = cb.data.split("_");
  const payId = Number(payIdStr);
  const res = await processPaymentDecision(env, payId, action === "payapp" ? "APPROVED" : "REJECTED", "Telegram Group");

  if (res.ok) {
    await tgCall(env.BOT_TOKEN_PAYMENT, "editMessageCaption", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      caption: `${cb.message.caption}\n\n${action === "payapp" ? "✅ *APPROVED*" : "❌ *REJECTED*"}`,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [] }
    });
  }
}

async function processPaymentDecision(env, payId, decision, source = "Web Panel") {
  const pay = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(payId).first();
  if (!pay || pay.status !== "PENDING") return { ok: false, msg: "Already processed" };

  await env.DB.prepare("UPDATE payments SET status = ? WHERE id = ?").bind(decision, payId).run();
  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(pay.customer_id).first();
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(pay.order_id).first();

  if (decision === "REJECTED") {
    await applyFraudStrike(env, cust, "Rejected by Payment Verification Team");
    return { ok: true };
  }

  if (pay.type === "ADVANCE_20") {
    await env.DB.prepare("UPDATE orders SET status = 'COLLECTING' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `🎉 *20% Advance Approved!*\n🆔 *9-Digit Order ID:* \`${order.id}\`\nHumari team suppliers se items collect karke packing shuru kar rahi hai.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `📦 *Order #${order.id} Ready for Collection!*\n20% Advance Verified.\nCustomer: *${cust.full_name}*\nAddress:${cust.address}`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "📦 View Items & Collect", callback_data: `packview_${order.id}` }]]
      }
    });
  } else if (pay.type === "BALANCE_80") {
    await env.DB.prepare("UPDATE orders SET status = 'READY_TO_SHIP' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `✅ *80% Balance Approved (Order #${order.id})!*\nAapka parcel dispatch kiya ja raha hai, bas kuch hi der mein Tracking ID mil jayegi.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `🚚 *80% Final Payment Cleared - Order #${order.id}*\nParcel dispatch karein aur Tracking ID daalein:`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "➕ Ship Now (Enter Tracking ID)", callback_data: `shipnow_${order.id}` }]]
      }
    });
  }
  await sendLog(env, `💳 Payment #${payId} (${pay.type}) for Order #${order.id} *${decision}* via${source}`);
  return { ok: true };
}

async function handleDeliveryBot(update, env) {
  const msg = update.message;
  const cb = update.callback_query;

  if (cb) {
    await tgCall(env.BOT_TOKEN_DELIVERY, "answerCallbackQuery", { callback_query_id: cb.id });
    const [act, ordIdStr] = cb.data.split("_");
    const orderId = Number(ordIdStr);

    if (act === "packview") {
      const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(orderId).all();
      let listTxt = `📋 *Collection Checklist - Order #${orderId}*\n\n`;
      for (const it of (items.results || [])) {
        const alloc = JSON.parse(it.allocated_json || "[]");
        const supStr = alloc.map(a => `${a.name} (${a.qty} pcs @ ₹${a.price})`).join(", ");
        listTxt += `• *${it.brand}${it.model} - ${it.part_name}* (${it.fulfilled_qty} pcs)\n  👉 Collect from: ${supStr}\n\n`;
      }
      await env.DB.prepare("UPDATE orders SET status = 'PACKING' WHERE id = ?").bind(orderId).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: listTxt,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "📹 Upload Packing Video", callback_data: `packvid_${orderId}` }]]
        }
      });
    }

    if (act === "packvid") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_video_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: `📹 *Order #${orderId} ka Packing Video* abhi is group mein send karein:`,
        parse_mode: "Markdown"
      });
    }

    if (act === "shipnow") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_ship_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: `🚚 *Order #${orderId} ka Final Tracking ID / AWB Number* type karke bhejein:`,
        parse_mode: "Markdown"
      });
    }
    return;
  }

  if (msg && msg.video) {
    const activeOrdId = Number(await getSetting(env.DB, "active_video_order", "0"));
    if (!activeOrdId) return;

    const videoFileId = msg.video.file_id;
    const vaultMsg = await tgCall(env.BOT_TOKEN_DELIVERY, "sendVideo", {
      chat_id: env.VAULT_GROUP_ID,
      video: videoFileId,
      caption: `🔒 *VAULT BACKUP - Order #${activeOrdId}*\nTimestamp:${new Date().toISOString()}`,
      parse_mode: "Markdown"
    });

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(activeOrdId).first();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    const upi = await getSetting(env.DB, "upi_id", "Constabrar@upi");
    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=AD%20PARTSOL&am=${order.balance_80}&cu=INR&tn=BAL${order.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;

    await env.DB.prepare("UPDATE orders SET status = 'AWAITING_80_PAYMENT', packing_video_file_id = ?, vault_msg_id = ? WHERE id = ?")
      .bind(videoFileId, String(vaultMsg.result?.message_id || ""), activeOrdId).run();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'active_video_order'").run();
    await env.DB.prepare("UPDATE customers SET state = ? WHERE id = ?").bind(`AWAITING_80_SS_${activeOrdId}`, cust.id).run();

    await notifyCustomer(env, cust, `📹 *Order #${activeOrdId} Packed & Verified!*\nAapke parts pack ho chuke hain.`, null, null, videoFileId);
    await notifyCustomer(env, cust, `💳 *80% Balance Payment: ₹${order.balance_80}*\nQR scan karke balance pay karein aur *Screenshot* bhejein taaki turant Tracking ID generate ho sake:`, null, qrUrl);

    return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: msg.chat.id,
      text: `✅ Order #${activeOrdId} video Vault mein backup ho gaya aur customer ko 80% QR bhej diya gaya!`
    });
  }

  if (msg && msg.text && !msg.text.startsWith("/")) {
    const shipOrdId = Number(await getSetting(env.DB, "active_ship_order", "0"));
    if (!shipOrdId) return;

    const trackingId = msg.text.trim();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(shipOrdId).first();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();

    await env.DB.prepare("UPDATE orders SET status = 'SHIPPED', tracking_id = ? WHERE id = ?").bind(trackingId, shipOrdId).run();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'active_ship_order'").run();

    await notifyCustomer(env, cust, `🚚 *Order #${shipOrdId} Dispatched!*\n\n📦 *Tracking ID:* \`${trackingId}\`\nThank you for doing business with *AD PARTSOL*!`);
    await sendLog(env, `✅ Order #${shipOrdId} SHIPPED! Tracking: \`${trackingId}\``);
    return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: msg.chat.id, text: `🎉 Order #${shipOrdId} marked SHIPPED & Tracking sent to customer!`
    });
  }
}

async function handleAdminBot(update, env) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);
  const userId = String(msg ? msg.from.id : cb.from.id);

  if (userId !== String(env.ADMIN_TG_ID)) return;

  if (cb) {
    await tgCall(env.BOT_TOKEN_ADMIN, "answerCallbackQuery", { callback_query_id: cb.id });
    if (cb.data.startsWith("toggle_")) {
      const key = cb.data.replace("toggle_", "");
      const cur = await getSetting(env.DB, key, "1");
      const next = cur === "1" ? "0" : "1";
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, next).run();
      return await sendAdminPanel(env, chatId, cb.message.message_id);
    }
    return;
  }

  const text = (msg?.text || "").trim();
  if (text === "/start" || text === "/panel") {
    return await sendAdminPanel(env, chatId);
  }

  if (text.startsWith("/margin ")) {
    const val = parseFloat(text.split(" ")[1]);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('margin_percent', ?)").bind(String(val)).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: `✅ Admin Margin updated to *${val}%*`, parse_mode: "Markdown" });
  }

  if (text.startsWith("/delivery ")) {
    const val = parseFloat(text.split(" ")[1]);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('delivery_charge', ?)").bind(String(val)).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: `✅ Delivery Charge updated to *₹${val}*`, parse_mode: "Markdown" });
  }

  if (text.startsWith("/newsupplier")) {
    const name = text.replace("/newsupplier", "").trim() || "Supplier";
    const code = "SUP" + Math.random().toString(36).substring(2, 7).toUpperCase();
    await env.DB.prepare("INSERT INTO suppliers (name, verify_code) VALUES (?, ?)").bind(name, code).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `🏭 *New Supplier Code Generated*\nName: *${name}*\nCommand for Supplier:\n\`/verify ${code}\``,
      parse_mode: "Markdown"
    });
  }

  if (text.startsWith("/addstaff ")) {
    const [_, role, phone] = text.split(/\s+/);
    if (!role || !phone) {
      return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage: `/addstaff <admin|payment|packing|supplier> <phone>`", parse_mode: "Markdown" });
    }
    const token = "ADP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await env.DB.prepare("INSERT INTO staff_users (role, phone, access_token) VALUES (?, ?, ?)").bind(role.toLowerCase(), phone, token).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `🔐 *Web Panel Credentials Created*\nRole: *${role.toUpperCase()}*\nPhone: \`${phone}\`\nAccess Token: \`${token}\``,
      parse_mode: "Markdown"
    });
  }
}

async function sendAdminPanel(env, chatId, editMsgId = null) {
  const tg = await getSetting(env.DB, "tg_enabled", "1");
  const wa = await getSetting(env.DB, "wa_enabled", "1");
  const ai = await getSetting(env.DB, "ai_enabled", "1");
  const margin = await getSetting(env.DB, "margin_percent", "20");
  const deliv = await getSetting(env.DB, "delivery_charge", "100");

  const text = `🎛️ *AD PARTSOL - Master Control Panel*\n\n📊 Margin: *${margin}\%* \vert{} 🚚 Delivery: *₹${deliv}*\n\nCommands:\n\`/margin 25\`\n\`/delivery 120\`\n\`/newsupplier Raju Electronics\`\n\`/addstaff payment 9876543210\``;
  const reply_markup = {
    inline_keyboard: [
      [{ text: `Telegram: ${tg === "1" ? "🟢 ON" : "🔴 OFF"}`, callback_data: "toggle_tg_enabled" }],
      [{ text: `WhatsApp: ${wa === "1" ? "🟢 ON" : "🔴 OFF"}`, callback_data: "toggle_wa_enabled" }],
      [{ text: `OpenAI Brain: ${ai === "1" ? "🟢 ON" : "🔴 OFF"}`, callback_data: "toggle_ai_enabled" }]
    ]
  };

  if (editMsgId) {
    return await tgCall(env.BOT_TOKEN_ADMIN, "editMessageText", { chat_id: chatId, message_id: editMsgId, text, parse_mode: "Markdown", reply_markup });
  }
  return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", reply_markup });
}

async function handleWhatsAppUpdate(body, env) {
  const waEnabled = await getSetting(env.DB, "wa_enabled", "1");
  if (waEnabled !== "1") return;

  const entry = body.entry?.[0]?.changes?.[0]?.value;
  if (!entry || !entry.messages || !entry.messages[0]) return;

  const msg = entry.messages[0];
  const from = msg.from;
  const custId = `wa_${from}`;
  const now = Math.floor(Date.now() / 1000);

  let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  if (!cust) {
    await env.DB.prepare("INSERT INTO customers (id, platform, chat_id, phone, last_msg_at, state) VALUES (?, 'whatsapp', ?, ?, ?, 'AWAITING_REQ')")
      .bind(custId, from, from, now).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, custId).run();
  }

  if (cust.banned_until > now) return;

  if (msg.type === "interactive") {
    const btnId = msg.interactive?.button_reply?.id;
    if (btnId === "keep_alive_24h") {
      return await notifyCustomer(env, cust, "✅ Session refreshed for 24 hours! Aapka order update aate hi yahan milega.");
    }
    if (btnId) return await processCustomerAction(env, cust, btnId);
  }

  if (msg.type === "text") {
    return await processCustomerInput(env, cust, msg.text.body, null);
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
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const dataUri = `data:${metaJson.mime_type \vert{}\vert{} "image/jpeg"};base64,${b64}`;
      return await processCustomerInput(env, cust, msg.image.caption || "", dataUri);
    } else {
      const text = await transcribeVoice(env, await mediaBin.arrayBuffer(), "wa_voice.ogg");
      return await processCustomerInput(env, cust, text, null);
    }
  }
}

async function runAutomatedEngine(env) {
  const now = Math.floor(Date.now() / 1000);

  const dueOrders = await env.DB.prepare("SELECT * FROM orders WHERE status = 'BIDDING' AND bidding_ends_at <= ?").bind(now).all();

  for (const order of (dueOrders.results || [])) {
    const pendingBids = await env.DB.prepare(
      "SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.order_id = ? AND b.status = 'PENDING'"
    ).bind(order.id).all();

    for (const pb of (pendingBids.results || [])) {
      if (pb.tg_msg_id && pb.tg_chat_id) {
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", {
          chat_id: pb.tg_chat_id, message_id: pb.tg_msg_id, reply_markup: { inline_keyboard: [] }
        });
      }
    }

    const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(order.id).all();
    let baseTotal = 0;
    let anyFulfilled = false;
    let quoteLines = [];

    for (const item of (items.results || [])) {
      const validBids = await env.DB.prepare(
        "SELECT b.*, s.name as sup_name FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.item_id = ? AND b.status = 'SUBMITTED' ORDER BY b.price_per_unit ASC"
      ).bind(item.id).all();

      let needed = item.req_qty;
      let fulfilled = 0;
      let allocations = [];

      for (const vb of (validBids.results || [])) {
        if (needed <= 0) break;
        const take = Math.min(needed, vb.available_qty);
        if (take > 0) {
          allocations.push({ supplier_id: vb.supplier_id, name: vb.sup_name, qty: take, price: vb.price_per_unit });
          baseTotal += take * vb.price_per_unit;
          needed -= take;
          fulfilled += take;
        }
      }

      if (fulfilled > 0) {
        anyFulfilled = true;
        await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, allocated_json = ? WHERE id = ?")
          .bind(fulfilled, JSON.stringify(allocations), item.id).run();
        quoteLines.push(`• *${item.brand} ${item.model} (${item.part_name})*: ${fulfilled}/${item.req_qty} pcs ready`);
      } else {
        quoteLines.push(`• *${item.brand} ${item.model} (${item.part_name})*: Out of Stock`);
      }
    }

    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();

    if (!anyFulfilled) {
      await env.DB.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").bind(order.id).run();
      await notifyCustomer(env, cust, `😔 Sorry! Order #${order.id} ke parts abhi kisi bhi supplier ke paas ready stock mein nahi hain.`);
      continue;
    }

    const withMargin = baseTotal * (1 + (order.margin_percent / 100));
    const rawTotal = withMargin + order.delivery_charge;
    const finalTotal = Math.ceil(rawTotal / 50) * 50;
    const adv20 = Math.round(finalTotal * 0.20);
    const bal80 = finalTotal - adv20;

    await env.DB.prepare(
      "UPDATE orders SET status = 'QUOTED', supplier_base_total = ?, final_total = ?, advance_20 = ?, balance_80 = ? WHERE id = ?"
    ).bind(baseTotal, finalTotal, adv20, bal80, order.id).run();

    await notifyCustomer(
      env, cust,
      `🎉 *Quotation Ready - Order #${order.id}*\n\n${quoteLines.join("\n")}\n\n💰 *Total Price:* ₹${finalTotal} (Delivery Included)\n⚡ *20\% Advance to Confirm:* ₹${adv20}\n📦 *80% After Packing Video:* ₹${bal80}`,
      [[{ text: `➕ Accept & Pay 20% (₹${adv20})`, callback_data: `pay20_${order.id}` }]]
    );
  }

  const waWindowAlert = now - (22 * 3600);
  const waCusts = await env.DB.prepare(
    "SELECT c.* FROM customers c JOIN orders o ON c.id = o.customer_id WHERE c.platform = 'whatsapp' AND c.warned_22h = 0 AND c.last_msg_at <= ? AND c.last_msg_at > ? AND o.status NOT IN ('SHIPPED', 'CANCELLED')"
  ).bind(waWindowAlert, now - (23.8 * 3600)).all();

  for (const wc of (waCusts.results || [])) {
    await env.DB.prepare("UPDATE customers SET warned_22h = 1 WHERE id = ?").bind(wc.id).run();
    await notifyCustomer(
      env, wc,
      "🔔 *AD PARTSOL Alert:* Aapka order process ho raha hai! WhatsApp par free updates aur Packing Video paane ke liye niche button dabayein:",
      [[{ text: "👍 Keep Active", callback_data: "keep_alive_24h" }]]
    );
  }
}

async function handlePanelAPI(request, url, env) {
  const action = url.pathname.replace("/api/panel/", "");

  if (action === "track") {
    const id = Number(url.searchParams.get("order_id"));
    const order = await env.DB.prepare("SELECT id, status, final_total, advance_20, balance_80, tracking_id, created_at FROM orders WHERE id = ?").bind(id).first();
    const items = await env.DB.prepare("SELECT brand, model, part_name, req_qty, fulfilled_qty FROM order_items WHERE order_id = ?").bind(id).all();
    return jsonRes({ ok: !!order, order, items: items.results || [] });
  }

  const phone = request.headers.get("x-staff-phone") || "";
  const token = request.headers.get("x-staff-token") || "";
  const staff = await env.DB.prepare("SELECT * FROM staff_users WHERE phone = ? AND access_token = ? AND is_active = 1").bind(phone, token).first();
  if (!staff) return jsonRes({ ok: false, error: "Unauthorized! Ask Admin for Token in Telegram." }, 401);

  if (action === "login") return jsonRes({ ok: true, role: staff.role });

  if (action === "dashboard") {
    const orders = await env.DB.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 50").all();
    const payments = await env.DB.prepare("SELECT * FROM payments WHERE status = 'PENDING' ORDER BY id DESC").all();
    const settings = await env.DB.prepare("SELECT * FROM settings").all();
    const suppliers = await env.DB.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
    const items = await env.DB.prepare("SELECT * FROM order_items ORDER BY id DESC LIMIT 100").all();
    return jsonRes({
      ok: true,
      role: staff.role,
      orders: orders.results || [],
      payments: payments.results || [],
      settings: settings.results || [],
      suppliers: suppliers.results || [],
      items: items.results || []
    });
  }

  if (action === "payment-action" && request.method === "POST") {
    const { payment_id, decision } = await request.json();
    return jsonRes(await processPaymentDecision(env, Number(payment_id), decision, "Web Panel"));
  }

  if (action === "ship-order" && request.method === "POST") {
    const { order_id, tracking_id } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(order_id).first();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    await env.DB.prepare("UPDATE orders SET status = 'SHIPPED', tracking_id = ? WHERE id = ?").bind(tracking_id, order_id).run();
    await notifyCustomer(env, cust, `🚚 *Order #${order_id} Dispatched!*\nTracking ID: \`${tracking_id}\``);
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: "Unknown endpoint" }, 404);
}

async function initDB(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tg_enabled', '1'), ('wa_enabled', '1'), ('ai_enabled', '1'), ('margin_percent', '20'), ('delivery_charge', '100'), ('upi_id', 'Constabrar@upi')"),
    DB.prepare("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, platform TEXT NOT NULL, chat_id TEXT NOT NULL, lang TEXT DEFAULT 'hinglish', full_name TEXT, phone TEXT, address TEXT, state TEXT DEFAULT 'IDLE', temp_data TEXT, fraud_strikes INTEGER DEFAULT 0, banned_until INTEGER DEFAULT 0, last_msg_at INTEGER DEFAULT 0, warned_22h INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_chat_id TEXT UNIQUE, name TEXT, phone TEXT, verify_code TEXT UNIQUE, is_verified INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, current_bid_item_id INTEGER, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS staff_users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, phone TEXT NOT NULL, access_token TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, status TEXT DEFAULT 'BIDDING', supplier_base_total REAL DEFAULT 0, margin_percent REAL DEFAULT 20, delivery_charge REAL DEFAULT 100, final_total REAL DEFAULT 0, advance_20 REAL DEFAULT 0, balance_80 REAL DEFAULT 0, packing_video_file_id TEXT, vault_msg_id TEXT, tracking_id TEXT, bidding_ends_at INTEGER NOT NULL, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, brand TEXT, model TEXT, part_name TEXT, variant TEXT DEFAULT 'Standard', req_qty INTEGER NOT NULL, fulfilled_qty INTEGER DEFAULT 0, allocated_json TEXT)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, price_per_unit REAL, available_qty INTEGER, tg_msg_id INTEGER, status TEXT DEFAULT 'PENDING', created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, customer_id TEXT NOT NULL, type TEXT NOT NULL, expected_amount REAL NOT NULL, extracted_utr TEXT UNIQUE, extracted_amount REAL, file_id_or_url TEXT, status TEXT DEFAULT 'PENDING', tg_group_msg_id INTEGER, created_at INTEGER DEFAULT (strftime('%s', 'now')))")
  ]);
}
