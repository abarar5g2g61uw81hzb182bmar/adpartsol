export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/init-db") {
        await initDB(env.DB);
        return jsonRes({ ok: true, msg: "Database tables & columns updated!" });
      }

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

      if (path.startsWith("/webhook/tg/") && request.method === "POST") {
        const botType = path.split("/").pop();
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(botType, update, env));
        return new Response("OK", { status: 200 });
      }

      if (path === "/webhook/whatsapp" && request.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token === env.WA_VERIFY_TOKEN) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("WhatsApp Webhook Active (Forbidden Token)", { status: 403 });
      }

      if (path === "/webhook/whatsapp" && request.method === "POST") {
        const body = await request.json();
        ctx.waitUntil(handleWhatsAppUpdate(body, env));
        return new Response("OK", { status: 200 });
      }

      if (path.startsWith("/api/panel/")) {
        return await handlePanelAPI(request, url, env);
      }

      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response("AD PARTSOL Engine Active", { status: 200 });
    } catch (err) {
      ctx.waitUntil(sendLog(env, `★ *CRITICAL WORKER ERROR*\nPath: ${path}\nError: ${err.message}`));
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

function parseSessionMemory(tempDataStr) {
  try {
    const parsed = JSON.parse(tempDataStr || "{}");
    if (Array.isArray(parsed)) return { items: parsed, history: [] };
    return { items: parsed.items || [], history: parsed.history || [] };
  } catch (_) {
    return { items: [], history: [] };
  }
}

function formatSummaryBox(items, askLine = "[?] Are these details correct?") {
  let lines = items.map((it, idx) =>
    `${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.qty}`
  ).join("\n\n");
  return `ORDER SUMMARY\n━━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━━\n${askLine}`;
}

function formatSupplierCard(header, it, footer = "") {
  const qtyUnit = Number(it.req_qty) === 1 ? "1 Piece" : `${it.req_qty} Pieces`;
  return `${header}\n━━━━━━━━━━━━━━━━━\n→ Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${qtyUnit}\n━━━━━━━━━━━━━━━━━${footer ? "\n" + footer : ""}`;
}

// ==========================================
// TELEGRAM TYPING PLACEHOLDER ANIMATION
// ==========================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function startTgTypingLoader(token, chatId) {
  const frames = ["T", "Ty", "Typ", "Typi", "Typin", "Typing", "Typing.", "Typing..", "Typing..."];
  const res = await tgCall(token, "sendMessage", { chat_id: chatId, text: frames[0] });
  if (!res.ok) return null;
  const msgId = res.result.message_id;
  // Smooth fast steps inside the same message without hitting Telegram 429
  for (const frame of ["Typ", "Typing", "Typing...", "Typing.."]) {
    await sleep(160);
    await tgCall(token, "editMessageText", { chat_id: chatId, message_id: msgId, text: frame });
  }
  return msgId;
}

// ==========================================
// OPENAI 4-MODEL ROUTER (STRICT IDENTITY & LANGUAGE)
// ==========================================
async function analyzeCustomerRequirement(env, textInput, imageUrl = null, lang = "hinglish", memoryObj = { items: [], history: [] }) {
  const aiEnabled = await getSetting(env.DB, "ai_enabled", "1");
  if (aiEnabled !== "1") return { valid: false, clarify_msg: "ⓘ System maintenance: Service will resume shortly." };

  const model = imageUrl ? "gpt-6-luna" : "gpt-5.6-luna";
  const prevHistory = memoryObj.history.slice(-6).map(h => `${h.r}: ${h.t}`).join("\n");
  const prevDraft = JSON.stringify(memoryObj.items || []);

  const sysPrompt = `You are the official sales representative of AD PARTSOL (a B2B mobile spare parts company).
STRICT SECRET RULES:
1. NEVER reveal that you are an AI, bot, OpenAI, or language model. Customer must believe AD PARTSOL directly stocks and sells all products. Never mention external suppliers or bidding.
2. Do NOT use any emojis at all. Use only symbols like ★ ■ ☞ → └ ⓘ [?].
3. Converse strictly in the customer's selected language: ${lang}.
4. If the customer writes in a completely different language than ${lang}, set "detected_other_lang" to that language name (english/hindi/hinglish/odia/odia_eng) so we can ask them to switch. Otherwise set "detected_other_lang": null.
5. Never ask the customer to type in a fixed format. Extract Brand, Model, Part Name, Quality (Original/Duplicate/Standard), and Quantity naturally from whatever they say/show.
6. Merge new items or edits with Current Draft Items: ${prevDraft} and Recent Context:
${prevHistory || "None"}
7. If any required detail (Brand/Model, Part Name, Quality, or Qty) is missing for an item, set "valid": false and ask naturally for the missing piece in ${lang} inside "clarify_msg".

Output strictly JSON:
{
  "valid": true/false,
  "detected_other_lang": null,
  "items": [
    {"brand": "Apple", "model": "iPhone 13", "part_name": "Display Folder", "variant": "Duplicate", "qty": 2}
  ],
  "summary_text": "Short professional note in ${lang} (NO EMOJIS)",
  "clarify_msg": "Natural question in ${lang} asking only what was missed (NO EMOJIS)"
}`;

  const userContent = [];
  if (textInput) userContent.push({ type: "text", text: textInput });
  if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userContent }]
    })
  });

  const data = await res.json();
  if (!data.choices || !data.choices[0]) throw new Error("AI error");
  return JSON.parse(data.choices[0].message.content);
}

async function extractCustomerProfileAI(env, textInput, lang = "hinglish") {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract customer Full Name, 10-digit Phone Number, and Delivery Address from natural text. Do not require a fixed format. No emojis. If any of the 3 is missing, set "complete": false and ask politely in ${lang} inside "ask_missing". Return JSON: {"complete": true/false, "name": "...", "phone": "...", "address": "...", "ask_missing": "..."}`
        },
        { role: "user", content: textInput }
      ]
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function analyzePaymentScreenshot(env, imageUrl, expectedAmount, expectedUpi) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-6-luna",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this UPI payment screenshot. Extract 12-digit UTR/Ref number, paid amount, and verify if genuine. Expected Amount: Rs ${expectedAmount}, Expected UPI: ${expectedUpi}. Return strict JSON: {"is_valid_screenshot": true/false, "utr": "123456789012" or null, "amount": 500, "reason": "string"}`
        },
        { role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }] }
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
// TELEGRAM & WHATSAPP HELPERS
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

async function markWhatsAppRead(env, messageId) {
  if (!messageId) return;
  try {
    await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId })
    });
  } catch (_) {}
}

async function notifyCustomer(env, customer, text, buttons = null, photoUrl = null, videoFileId = null, editMsgId = null) {
  if (customer.platform === "telegram") {
    const reply_markup = buttons ? { inline_keyboard: buttons } : undefined;
    if (editMsgId && !photoUrl && !videoFileId) {
      return await tgCall(env.BOT_TOKEN_CUSTOMER, "editMessageText", {
        chat_id: customer.chat_id, message_id: editMsgId, text, reply_markup
      });
    }
    if (photoUrl) {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendPhoto", {
        chat_id: customer.chat_id, photo: photoUrl, caption: text, reply_markup
      });
    } else if (videoFileId) {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendVideo", {
        chat_id: customer.chat_id, video: videoFileId, caption: text, reply_markup
      });
    } else {
      await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
        chat_id: customer.chat_id, text, reply_markup
      });
    }
  } else if (customer.platform === "whatsapp") {
    const now = Math.floor(Date.now() / 1000);
    if (now - customer.last_msg_at > 86000) {
      await sendLog(env, `ⓘ 24h Window Expired for WA Customer ${customer.chat_id}.`);
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
// 5. TELEGRAM UPDATES ROUTER (6 BOTS)
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
    return await processCustomerAction(env, cust, cb.data, cb.message.message_id);
  }

  const text = msg.text || msg.caption || "";
  if (text === "/start") {
    await env.DB.prepare("UPDATE customers SET temp_data = NULL, state = 'IDLE' WHERE id = ?").bind(custId).run();
    return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
      chat_id: chatId,
      text: "★ Welcome to AD PARTSOL\n━━━━━━━━━━━━━━━━━\nPlease select your language / Apni bhasha chunein:",
      reply_markup: {
        inline_keyboard: [
          [{ text: "■ English", callback_data: "lang_english" }, { text: "■ Hindi", callback_data: "lang_hindi" }],
          [{ text: "■ Hinglish", callback_data: "lang_hinglish" }, { text: "■ Odia", callback_data: "lang_odia" }],
          [{ text: "■ Odia + English", callback_data: "lang_odia_eng" }]
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

const LANG_GREETINGS = {
  english: "★ Language set to English.\n━━━━━━━━━━━━━━━━━\n☞ Tell us what mobile spare parts you need (send text, photo, or voice note):",
  hindi: "★ भाषा हिंदी चुनी गई है।\n━━━━━━━━━━━━━━━━━\n☞ बताइये आपको कौन सा मोबाइल स्पेयर पार्ट चाहिए (मैसेज, फोटो या वॉइस नोट भेजें):",
  hinglish: "★ Language Hinglish set ho gayi hai.\n━━━━━━━━━━━━━━━━━\n☞ Batayein aapko kaunsa mobile spare part chahiye (text, photo ya voice note bhejein):",
  odia: "★ ଭାଷା ଓଡ଼ିଆ ଚୟନ କରାଯାଇଛି।\n━━━━━━━━━━━━━━━━━\n☞ ଆପଣଙ୍କୁ କେଉଁ ମୋବାଇଲ୍ ସ୍ପେୟାର୍ ପାର୍ଟ ଦରକାର କୁହନ୍ତୁ (ମେସେଜ୍, ଫଟୋ କିମ୍ବା ଭଏସ୍ ନୋଟ୍ ପଠାନ୍ତୁ):",
  odia_eng: "★ Language Odia + English set heigala.\n━━━━━━━━━━━━━━━━━\n☞ Apananku kou mobile spare part darkar kuhantu (text, photo kimba voice note pathantu):"
};

async function processCustomerAction(env, cust, data, msgId = null) {
  if (data.startsWith("lang_")) {
    const lang = data.replace("lang_", "");
    await env.DB.prepare("UPDATE customers SET lang = ?, state = 'AWAITING_REQ', temp_data = NULL WHERE id = ?").bind(lang, cust.id).run();
    cust.lang = lang;
    return await notifyCustomer(env, cust, LANG_GREETINGS[lang] || LANG_GREETINGS.hinglish, null, null, null, msgId);
  }

  if (data.startsWith("switchlang_")) {
    const lang = data.replace("switchlang_", "");
    await env.DB.prepare("UPDATE customers SET lang = ? WHERE id = ?").bind(lang, cust.id).run();
    cust.lang = lang;
    return await notifyCustomer(env, cust, `★ Language changed to ${lang.toUpperCase()}. Please continue:`, null, null, null, msgId);
  }

  if (data === "req_add_more") {
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_REQ' WHERE id = ?").bind(cust.id).run();
    return await notifyCustomer(env, cust, "☞ Please tell us the additional part details you want to add:", null, null, null, msgId);
  }

  if (data === "req_edit") {
    const mem = parseSessionMemory(cust.temp_data);
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_REQ' WHERE id = ?").bind(cust.id).run();
    const box = formatSummaryBox(mem.items, "ⓘ Please tell us in your own words what changes you want in this list:");
    return await notifyCustomer(env, cust, box, null, null, null, msgId);
  }

  if (data === "req_continue") {
    if (!cust.full_name || !cust.phone || !cust.address) {
      await env.DB.prepare("UPDATE customers SET state = 'AWAITING_PROFILE' WHERE id = ?").bind(cust.id).run();
      return await notifyCustomer(
        env, cust,
        "★ Delivery Details Required\n━━━━━━━━━━━━━━━━━\n☞ Please send your Name, Phone Number, and Delivery Address (you can write it normally in a single message):",
        null, null, null, msgId
      );
    }
    return await launchOrderBidding(env, cust, msgId);
  }

  if (data === "req_cancel") {
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_REQ', temp_data = NULL WHERE id = ?").bind(cust.id).run();
    return await notifyCustomer(env, cust, "× Current list cleared. Tell us what parts you need:", null, null, null, msgId);
  }

  if (data.startsWith("pay20_")) {
    const orderId = Number(data.split("_")[1]);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) return;
    const upi = await getSetting(env.DB, "upi_id", "constantabrar@upi");
    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=AD%20PARTSOL&am=${order.advance_20}&cu=INR&tn=ORD${order.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;

    await env.DB.prepare("UPDATE customers SET state = ? WHERE id = ?").bind(`AWAITING_20_SS_${order.id}`, cust.id).run();
    return await notifyCustomer(
      env, cust,
      `★ 20% Advance Payment — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n→ Payable Now: Rs.${order.advance_20}\n└ UPI ID: ${upi}\n━━━━━━━━━━━━━━━━━\n☞ Scan the QR code to pay and send the Payment Screenshot here:`,
      null, qrUrl
    );
  }
}

async function processCustomerInput(env, cust, text, mediaUrl) {
  const now = Math.floor(Date.now() / 1000);

  // Check if customer has an active BIDDING order and is asking for status
  const activeBidOrder = await env.DB.prepare(
    "SELECT * FROM orders WHERE customer_id = ? AND status = 'BIDDING' AND bidding_ends_at > ? ORDER BY id DESC LIMIT 1"
  ).bind(cust.id, now).first();

  if (activeBidOrder && cust.state === "IDLE" && !mediaUrl) {
    const remMins = Math.max(1, Math.ceil((activeBidOrder.bidding_ends_at - now) / 60));
    return await notifyCustomer(
      env, cust,
      `ⓘ Order #${activeBidOrder.id} is in progress.\n━━━━━━━━━━━━━━━━━\n☞ Kripya aur ${remMins} minutes wait kijiye. Usse pehle aapko availability aur final price check karke bata diya jayega.`
    );
  }

  // 1. Natural AI Profile Extraction
  if (cust.state === "AWAITING_PROFILE") {
    let loaderMsgId = null;
    if (cust.platform === "telegram") loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);

    const prof = await extractCustomerProfileAI(env, text, cust.lang);
    if (!prof.complete) {
      return await notifyCustomer(env, cust, `ⓘ ${prof.ask_missing}`, null, null, null, loaderMsgId);
    }

    await env.DB.prepare("UPDATE customers SET full_name = ?, phone = ?, address = ? WHERE id = ?")
      .bind(prof.name, prof.phone, prof.address, cust.id).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cust.id).first();
    return await launchOrderBidding(env, cust, loaderMsgId);
  }

  // 2. Payment Screenshot Verification
  if (cust.state.startsWith("AWAITING_20_SS_") || cust.state.startsWith("AWAITING_80_SS_")) {
    const is20 = cust.state.startsWith("AWAITING_20_SS_");
    const orderId = Number(cust.state.split("_").pop());
    if (!mediaUrl) {
      return await notifyCustomer(env, cust, "ⓘ Please send a clear photo/screenshot of your payment.");
    }

    let loaderMsgId = null;
    if (cust.platform === "telegram") loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    const expectedAmt = is20 ? order.advance_20 : order.balance_80;
    const upi = await getSetting(env.DB, "upi_id", "constantabrar@upi");

    const check = await analyzePaymentScreenshot(env, mediaUrl, expectedAmt, upi);

    if (check.utr) {
      const dup = await env.DB.prepare("SELECT id FROM payments WHERE extracted_utr = ? AND status != 'REJECTED'").bind(check.utr).first();
      if (dup) return await applyFraudStrike(env, cust, `Duplicate UTR (${check.utr}) uploaded.`, loaderMsgId);
    }

    if (!check.is_valid_screenshot) {
      return await applyFraudStrike(env, cust, check.reason || "Unclear payment screenshot.", loaderMsgId);
    }

    const payType = is20 ? "ADVANCE_20" : "BALANCE_80";
    const payRes = await env.DB.prepare(
      "INSERT INTO payments (order_id, customer_id, type, expected_amount, extracted_utr, extracted_amount, file_id_or_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(orderId, cust.id, payType, expectedAmt, check.utr || `MANUAL_${Date.now()}`, check.amount || expectedAmt, mediaUrl).run();

    const payId = payRes.meta.last_row_id;
    await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?")
      .bind(is20 ? "AWAITING_20_APPROVAL" : "AWAITING_80_APPROVAL", orderId).run();
    await env.DB.prepare("UPDATE customers SET state = 'IDLE' WHERE id = ?").bind(cust.id).run();

    const caption = `★ Payment Verification Request (${is20 ? "20% Advance" : "80% Balance"})\n━━━━━━━━━━━━━━━━━\n→ Order ID: #${orderId}\n└ Customer: ${cust.full_name} (${cust.phone})\n└ Expected: Rs.${expectedAmt}\n└ Detected: Rs.${check.amount || "?"} | UTR: ${check.utr || "Manual"}`;
    const grpMsg = await tgCall(env.BOT_TOKEN_PAYMENT, "sendPhoto", {
      chat_id: env.PAYMENT_GROUP_ID,
      photo: mediaUrl,
      caption,
      reply_markup: {
        inline_keyboard: [[
          { text: "[+] Approve", callback_data: `payapp_${payId}` },
          { text: "[×] Reject", callback_data: `payrej_${payId}` }
        ]]
      }
    });

    if (grpMsg.ok) {
      await env.DB.prepare("UPDATE payments SET tg_group_msg_id = ? WHERE id = ?").bind(grpMsg.result.message_id, payId).run();
    }
    return await notifyCustomer(env, cust, "★ Payment screenshot received. Our team is verifying it now.", null, null, null, loaderMsgId);
  }

  // 3. AI Requirement Gathering with Typing Animation (Telegram)
  let loaderMsgId = null;
  if (cust.platform === "telegram") {
    loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);
  }

  const mem = parseSessionMemory(cust.temp_data);
  if (text) mem.history.push({ r: "Customer", t: text.slice(0, 140) });

  const parsed = await analyzeCustomerRequirement(env, text, mediaUrl, cust.lang, mem);

  // Language Switch Prompt if customer spoke another language
  let langSwitchButtons = [];
  if (parsed.detected_other_lang && parsed.detected_other_lang !== cust.lang) {
    langSwitchButtons.push([{ text: `[?] Change language to ${parsed.detected_other_lang.toUpperCase()}?`, callback_data: `switchlang_${parsed.detected_other_lang}` }]);
  }

  if (!parsed.valid || !parsed.items || parsed.items.length === 0) {
    const botReply = parsed.clarify_msg || "☞ Please share the Brand, Model, Part Name, Quality, and Quantity.";
    mem.history.push({ r: "AD_PARTSOL", t: botReply.slice(0, 140) });
    mem.history = mem.history.slice(-6);
    await env.DB.prepare("UPDATE customers SET temp_data = ? WHERE id = ?").bind(JSON.stringify(mem), cust.id).run();
    return await notifyCustomer(env, cust, `ⓘ ${botReply}`, langSwitchButtons.length ? langSwitchButtons : null, null, null, loaderMsgId);
  }

  mem.items = parsed.items;
  mem.history.push({ r: "AD_PARTSOL", t: "Order Summary Displayed" });
  mem.history = mem.history.slice(-6);

  await env.DB.prepare("UPDATE customers SET state = 'CONFIRM_REQ', temp_data = ? WHERE id = ?")
    .bind(JSON.stringify(mem), cust.id).run();

  const summaryBox = formatSummaryBox(parsed.items, "[?] Are these details correct?");
  const actionButtons = [
    [{ text: "[+] Confirm & Continue", callback_data: "req_continue" }],
    [{ text: "[+] Add More Products", callback_data: "req_add_more" }, { text: "[✎] Edit", callback_data: "req_edit" }],
    [{ text: "[×] Cancel", callback_data: "req_cancel" }],
    ...langSwitchButtons
  ];

  await notifyCustomer(env, cust, summaryBox, actionButtons, null, null, loaderMsgId);
}

async function applyFraudStrike(env, cust, reason, editMsgId = null) {
  const strikes = (cust.fraud_strikes || 0) + 1;
  const now = Math.floor(Date.now() / 1000);
  if (strikes >= 3) {
    const banUntil = now + 12 * 3600;
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ?, banned_until = ?, state = 'IDLE' WHERE id = ?")
      .bind(strikes, banUntil, cust.id).run();
    await sendLog(env, `★ SHADOW BAN (12h)\nCustomer: ${cust.id} (${cust.phone})\nReason: 3 Invalid Screenshots (${reason})`);
    return await notifyCustomer(env, cust, "× Multiple invalid payment screenshots detected. Account paused for 12 hours.", null, null, null, editMsgId);
  } else {
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ? WHERE id = ?").bind(strikes, cust.id).run();
    return await notifyCustomer(env, cust, `ⓘ Invalid Screenshot (${strikes}/3): ${reason}\nPlease upload a valid screenshot.`, null, null, null, editMsgId);
  }
}

// ==========================================
// 6. LAUNCH ORDER REQUEST & SUPPLIER CARDS
// ==========================================
async function launchOrderBidding(env, cust, editMsgId = null) {
  const mem = parseSessionMemory(cust.temp_data);
  const items = mem.items || [];
  if (!items.length) return await notifyCustomer(env, cust, "ⓘ No items in list. Please tell us what parts you need.", null, null, null, editMsgId);

  const endsAt = Math.floor(Date.now() / 1000) + 1800; // 30 Minutes
  const margin = Number(await getSetting(env.DB, "margin_percent", "20"));
  const delivery = Number(await getSetting(env.DB, "delivery_charge", "100"));
  const orderId = Math.floor(100000000 + Math.random() * 900000000);

  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, status, margin_percent, delivery_charge, bidding_ends_at) VALUES (?, ?, 'BIDDING', ?, ?, ?)"
  ).bind(orderId, cust.id, margin, delivery, endsAt).run();

  const suppliers = await env.DB.prepare("SELECT * FROM suppliers WHERE is_verified = 1 AND is_active = 1").all();

  for (const it of items) {
    const reqQty = Number(it.qty) || 1;
    const itemRes = await env.DB.prepare(
      "INSERT INTO order_items (order_id, brand, model, part_name, variant, req_qty) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(orderId, it.brand, it.model || "", it.part_name, it.variant || "Standard", reqQty).run();
    const itemId = itemRes.meta.last_row_id;

    const cardText = formatSupplierCard("★ New Product Request", {
      brand: it.brand, model: it.model, part_name: it.part_name, variant: it.variant, req_qty: reqQty
    });

    for (const sup of (suppliers.results || [])) {
      // If supplier is currently busy in another item prompt, send without buttons temporarily
      const kb = sup.current_bid_item_id ? [] : getSupplierCardKeyboard(orderId, itemId);
      const msgRes = await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: sup.tg_chat_id,
        text: cardText,
        reply_markup: { inline_keyboard: kb }
      });

      if (msgRes.ok) {
        await env.DB.prepare(
          "INSERT INTO bids (order_id, item_id, supplier_id, tg_msg_id, status) VALUES (?, ?, ?, ?, 'PENDING')"
        ).bind(orderId, itemId, sup.id, msgRes.result.message_id).run();
      }
    }
  }

  await env.DB.prepare("UPDATE customers SET state = 'IDLE', temp_data = NULL WHERE id = ?").bind(cust.id).run();

  const waPromo = cust.platform === "whatsapp"
    ? "\n\n★ Tip: Order on our Telegram (@AdPartsol_Bot) to get 25% OFF on handling charges!"
    : "";
  const confirmBox = formatSummaryBox(
    items,
    `★ Order Request Successful (ID: #${orderId})\n☞ We are verifying stock and final price. Please wait up to 30 minutes.${waPromo}`
  );
  await notifyCustomer(env, cust, confirmBox, null, null, null, editMsgId);
  await sendLog(env, `★ Order Request #${orderId} created (${items.length} items). Sent to ${(suppliers.results || []).length} suppliers.`);
}

function getSupplierCardKeyboard(orderId, itemId) {
  return [[
    { text: "I've, Enter Price", callback_data: `suphave_${orderId}_${itemId}` },
    { text: "Not Available", callback_data: `supno_${orderId}_${itemId}` }
  ]];
}

// ==========================================
// 7. SUPPLIER BOT (ISOLATION, 1-PC vs MULTI-PC & 60s TIMEOUT)
// ==========================================
async function handleSupplierBot(update, env) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);
  const now = Math.floor(Date.now() / 1000);

  if (cb) {
    await tgCall(env.BOT_TOKEN_SUPPLIER, "answerCallbackQuery", { callback_query_id: cb.id });
    const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE tg_chat_id = ? AND is_verified = 1").bind(chatId).first();
    if (!sup) return;

    // 1. Not Available / Cancel
    if (cb.data.startsWith("supno_") || cb.data.startsWith("supcancel_")) {
      const [_, orderId, itemId] = cb.data.split("_").map(Number);
      await env.DB.prepare("UPDATE bids SET status = 'PASS' WHERE item_id = ? AND supplier_id = ?").bind(itemId, sup.id).run();
      await env.DB.prepare("UPDATE suppliers SET current_bid_item_id = NULL, bid_step = NULL, bid_started_at = 0 WHERE id = ?").bind(sup.id).run();
      await tgCall(env.BOT_TOKEN_SUPPLIER, "deleteMessage", { chat_id: chatId, message_id: cb.message.message_id });
      await restoreSupplierOtherButtons(env, sup);
      return;
    }

    // 2. "I've, Enter Price" or "CONTINUE"
    if (cb.data.startsWith("suphave_") || cb.data.startsWith("supcont_")) {
      const [_, orderId, itemId] = cb.data.split("_").map(Number);
      const ord = await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(orderId).first();
      const item = await env.DB.prepare("SELECT * FROM order_items WHERE id = ?").bind(itemId).first();

      if (!ord || ord.status !== "BIDDING" || !item) {
        const expText = formatSupplierCard("★ Product Request", item || { brand: "-", part_name: "-", req_qty: 1 }, "ⓘ Contact Admin for Continue this Request");
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
          chat_id: chatId, message_id: cb.message.message_id, text: expText, reply_markup: { inline_keyboard: [] }
        });
        return;
      }

      // Temporarily hide buttons on all OTHER pending requests for this supplier
      await hideSupplierOtherButtons(env, sup, itemId);

      // Check 1 Piece vs Multiple Pieces
      const step = Number(item.req_qty) === 1 ? "AWAIT_PRICE_SINGLE" : "AWAIT_QTY";
      const footerPrompt = step === "AWAIT_PRICE_SINGLE"
        ? "ⓘ Please Enter the Price for Each..."
        : `ⓘ Please Enter Available Quantity (Max ${item.req_qty} Pieces)...`;

      await env.DB.prepare(
        "UPDATE suppliers SET current_bid_item_id = ?, bid_step = ?, bid_started_at = ? WHERE id = ?"
      ).bind(itemId, step, now, sup.id).run();

      const procText = formatSupplierCard("Order Processing...", item, footerPrompt);
      await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: procText,
        reply_markup: { inline_keyboard: [] }
      });
      return;
    }
    return;
  }

  const text = (msg?.text || "").trim();
  if (text === "/start") {
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
      chat_id: chatId,
      text: "★ AD PARTSOL — Partner Terminal\n━━━━━━━━━━━━━━━━━\nTo link account: /verify <CODE>\nCommands:\n/active — Receive requests\n/sleep — Pause requests"
    });
  }

  if (text.startsWith("/verify ")) {
    const code = text.split(" ")[1]?.trim();
    const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE verify_code = ?").bind(code).first();
    if (!sup) return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "× Invalid verification code." });
    await env.DB.prepare("UPDATE suppliers SET tg_chat_id = ?, is_verified = 1, is_active = 1 WHERE id = ?").bind(chatId, sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: `★ Verified: ${sup.name}. You will now receive product requests from AD PARTSOL.` });
  }

  const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE tg_chat_id = ? AND is_verified = 1").bind(chatId).first();
  if (!sup) return;

  if (text === "/sleep") {
    await env.DB.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").bind(sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "ⓘ Sleep Mode ON. Use /active to resume." });
  }
  if (text === "/active") {
    await env.DB.prepare("UPDATE suppliers SET is_active = 1 WHERE id = ?").bind(sup.id).run();
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "★ Active Mode ON." });
  }

  // Handle Active Bid Input (1-Piece Price OR Multi-Piece Qty -> Price)
  if (sup.current_bid_item_id) {
    // Check 60s timeout before accepting input
    if (sup.bid_started_at && now - sup.bid_started_at > 60) {
      await triggerSupplier60sTimeout(env, sup);
      return;
    }

    const item = await env.DB.prepare("SELECT * FROM order_items WHERE id = ?").bind(sup.current_bid_item_id).first();
    const bid = await env.DB.prepare("SELECT * FROM bids WHERE item_id = ? AND supplier_id = ?").bind(sup.current_bid_item_id, sup.id).first();
    if (!item || !bid) return;

    const numVal = parseFloat(text);
    if (isNaN(numVal) || numVal <= 0) {
      return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: chatId, text: "ⓘ Please enter a valid number only." });
    }

    if (sup.bid_step === "AWAIT_QTY") {
      const availQty = Math.min(item.req_qty, Math.floor(numVal));
      await env.DB.prepare("UPDATE bids SET available_qty = ? WHERE id = ?").bind(availQty, bid.id).run();
      await env.DB.prepare("UPDATE suppliers SET bid_step = 'AWAIT_PRICE_MULTI', bid_started_at = ? WHERE id = ?").bind(now, sup.id).run();

      const askPriceCard = formatSupplierCard(
        "Order Processing...",
        item,
        `→ Available Qty Entered: ${availQty} Pieces\nⓘ Please Enter the Price for Each...`
      );
      if (bid.tg_msg_id) {
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
          chat_id: chatId, message_id: bid.tg_msg_id, text: askPriceCard
        });
      }
      return;
    }

    // Final Price Step (Single or Multi)
    const finalQty = sup.bid_step === "AWAIT_PRICE_SINGLE" ? 1 : (bid.available_qty || item.req_qty);
    const unitPrice = numVal;

    await env.DB.prepare("UPDATE bids SET price_per_unit = ?, available_qty = ?, status = 'SUBMITTED' WHERE id = ?")
      .bind(unitPrice, finalQty, bid.id).run();
    await env.DB.prepare("UPDATE suppliers SET current_bid_item_id = NULL, bid_step = NULL, bid_started_at = 0 WHERE id = ?")
      .bind(sup.id).run();

    const doneCard = formatSupplierCard(
      "★ Rate Submitted to AD PARTSOL",
      item,
      `→ Your Rate: Rs.${unitPrice}/pc (${finalQty} pcs)`
    );
    if (bid.tg_msg_id) {
      await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
        chat_id: chatId, message_id: bid.tg_msg_id, text: doneCard, reply_markup: { inline_keyboard: [] }
      });
    }

    // Restore buttons on other pending requests for this supplier
    await restoreSupplierOtherButtons(env, sup);
  }
}

async function hideSupplierOtherButtons(env, sup, activeItemId) {
  const others = await env.DB.prepare(
    "SELECT * FROM bids WHERE supplier_id = ? AND status = 'PENDING' AND item_id != ?"
  ).bind(sup.id, activeItemId).all();

  for (const b of (others.results || [])) {
    if (b.tg_msg_id) {
      await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", {
        chat_id: sup.tg_chat_id, message_id: b.tg_msg_id, reply_markup: { inline_keyboard: [] }
      });
    }
  }
}

async function restoreSupplierOtherButtons(env, sup) {
  const others = await env.DB.prepare(
    "SELECT b.* FROM bids b JOIN orders o ON b.order_id = o.id WHERE b.supplier_id = ? AND b.status = 'PENDING' AND o.status = 'BIDDING'"
  ).bind(sup.id).all();

  for (const b of (others.results || [])) {
    if (b.tg_msg_id) {
      await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", {
        chat_id: sup.tg_chat_id,
        message_id: b.tg_msg_id,
        reply_markup: { inline_keyboard: getSupplierCardKeyboard(b.order_id, b.item_id) }
      });
    }
  }
}

async function triggerSupplier60sTimeout(env, sup) {
  const itemId = sup.current_bid_item_id;
  await env.DB.prepare("UPDATE suppliers SET current_bid_item_id = NULL, bid_step = NULL, bid_started_at = 0 WHERE id = ?").bind(sup.id).run();

  const bid = await env.DB.prepare("SELECT * FROM bids WHERE item_id = ? AND supplier_id = ?").bind(itemId, sup.id).first();
  const item = await env.DB.prepare("SELECT * FROM order_items WHERE id = ?").bind(itemId).first();

  if (bid && item && bid.tg_msg_id) {
    const timeoutCard = formatSupplierCard("ⓘ Session Timed Out (60s)", item, "Tap CONTINUE to enter rate or CANCEL:");
    await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
      chat_id: sup.tg_chat_id,
      message_id: bid.tg_msg_id,
      text: timeoutCard,
      reply_markup: {
        inline_keyboard: [[
          { text: "CONTINUE", callback_data: `supcont_${bid.order_id}_${item.id}` },
          { text: "CANCEL", callback_data: `supcancel_${bid.order_id}_${item.id}` }
        ]]
      }
    });
  }
  await restoreSupplierOtherButtons(env, sup);
}

// ==========================================
// 8. PAYMENT & DELIVERY BOTS
// ==========================================
async function handlePaymentBot(update, env) {
  const cb = update.callback_query;
  if (!cb) return;
  await tgCall(env.BOT_TOKEN_PAYMENT, "answerCallbackQuery", { callback_query_id: cb.id });

  const [action, payIdStr] = cb.data.split("_");
  const payId = Number(payIdStr);
  const res = await processPaymentDecision(env, payId, action === "payapp" ? "APPROVED" : "REJECTED", "Telegram");

  if (res.ok) {
    await tgCall(env.BOT_TOKEN_PAYMENT, "editMessageCaption", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      caption: `${cb.message.caption}\n━━━━━━━━━━━━━━━━━\nStatus: ${action === "payapp" ? "[+] APPROVED" : "[×] REJECTED"}`,
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
    await notifyCustomer(env, cust, `★ 20% Advance Verified — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Your order is now being packed at our warehouse.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `★ Order #${order.id} Ready for Collection\n━━━━━━━━━━━━━━━━━\n→ Customer: ${cust.full_name}\n└ Address: ${cust.address}`,
      reply_markup: {
        inline_keyboard: [[{ text: "■ View Items & Collect", callback_data: `packview_${order.id}` }]]
      }
    });
  } else if (pay.type === "BALANCE_80") {
    await env.DB.prepare("UPDATE orders SET status = 'READY_TO_SHIP' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `★ 80% Balance Verified — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Your parcel is being handed over to the courier. Tracking ID will be shared shortly.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `★ 80% Balance Cleared — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Dispatch the parcel and enter Tracking ID:`,
      reply_markup: {
        inline_keyboard: [[{ text: "[+] Ship Now (Enter Tracking ID)", callback_data: `shipnow_${order.id}` }]]
      }
    });
  }
  await sendLog(env, `★ Payment #${payId} (${pay.type}) for Order #${order.id} ${decision} via ${source}`);
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
      let listTxt = `★ Collection Checklist — Order #${orderId}\n━━━━━━━━━━━━━━━━━\n`;
      for (const it of (items.results || [])) {
        const alloc = JSON.parse(it.allocated_json || "[]");
        const supStr = alloc.map(a => `${a.name} (${a.qty} pcs)`).join(", ");
        listTxt += `→ ${it.brand} ${it.model} - ${it.part_name} (${it.fulfilled_qty} pcs)\n└ Collect from: ${supStr}\n\n`;
      }
      await env.DB.prepare("UPDATE orders SET status = 'PACKING' WHERE id = ?").bind(orderId).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: listTxt,
        reply_markup: {
          inline_keyboard: [[{ text: "[+] Upload Packing Video", callback_data: `packvid_${orderId}` }]]
        }
      });
    }

    if (act === "packvid") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_video_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: `☞ Send the Packing Video for Order #${orderId} in this group now:`
      });
    }

    if (act === "shipnow") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_ship_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: `☞ Enter the Final Tracking ID for Order #${orderId}:`
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
      caption: `★ VAULT BACKUP — Order #${activeOrdId}\nTimestamp: ${new Date().toISOString()}`
    });

    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(activeOrdId).first();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    const upi = await getSetting(env.DB, "upi_id", "constantabrar@upi");
    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=AD%20PARTSOL&am=${order.balance_80}&cu=INR&tn=BAL${order.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;

    await env.DB.prepare("UPDATE orders SET status = 'AWAITING_80_PAYMENT', packing_video_file_id = ?, vault_msg_id = ? WHERE id = ?")
      .bind(videoFileId, String(vaultMsg.result?.message_id || ""), activeOrdId).run();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'active_video_order'").run();
    await env.DB.prepare("UPDATE customers SET state = ? WHERE id = ?").bind(`AWAITING_80_SS_${activeOrdId}`, cust.id).run();

    await notifyCustomer(env, cust, `★ Order #${activeOrdId} Packing Proof Video`, null, null, videoFileId);
    await notifyCustomer(
      env, cust,
      `★ 80% Balance Payment — Rs.${order.balance_80}\n└ UPI ID: ${upi}\n━━━━━━━━━━━━━━━━━\n☞ Scan QR to pay balance and upload Screenshot to receive Tracking ID:`,
      null, qrUrl
    );

    return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: msg.chat.id,
      text: `★ Order #${activeOrdId} video backed up to Vault and 80% QR sent to customer.`
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

    await notifyCustomer(env, cust, `★ Order #${shipOrdId} Dispatched\n━━━━━━━━━━━━━━━━━\n→ Tracking ID: ${trackingId}\nThank you for ordering with AD PARTSOL.`);
    await sendLog(env, `★ Order #${shipOrdId} SHIPPED. Tracking: ${trackingId}`);
    return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: msg.chat.id, text: `★ Order #${shipOrdId} marked SHIPPED.`
    });
  }
}

// ==========================================
// 9. ADMIN BOT (WITH DIRECT SUPPLIER ASSIGN & FORCE CLOSE)
// ==========================================
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
  if (text === "/start" || text === "/panel") return await sendAdminPanel(env, chatId);

  if (text === "/forceclose") {
    await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0 WHERE status = 'BIDDING'").run();
    await runAutomatedEngine(env);
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "★ All active bidding windows closed & quotations dispatched." });
  }

  // Manual Admin Supplier Assign: /assign <OrderID> <SupplierID> <BasePrice>
  if (text.startsWith("/assign ")) {
    const [_, ordIdStr, supIdStr, priceStr] = text.split(/\s+/);
    const res = await adminAssignSupplierToOrder(env, Number(ordIdStr), Number(supIdStr), Number(priceStr || 0));
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: res.msg });
  }

  if (text.startsWith("/margin ")) {
    const val = parseFloat(text.split(" ")[1]);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('margin_percent', ?)").bind(String(val)).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: `★ Margin updated to ${val}%` });
  }

  if (text.startsWith("/delivery ")) {
    const val = parseFloat(text.split(" ")[1]);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('delivery_charge', ?)").bind(String(val)).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: `★ Delivery Charge updated to Rs.${val}` });
  }

  if (text.startsWith("/newsupplier")) {
    const name = text.replace("/newsupplier", "").trim() || "Partner";
    const code = "SUP" + Math.random().toString(36).substring(2, 7).toUpperCase();
    await env.DB.prepare("INSERT INTO suppliers (name, verify_code) VALUES (?, ?)").bind(name, code).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `★ New Supplier Code\n→ Name: ${name}\n└ Command: /verify ${code}`
    });
  }

  if (text.startsWith("/addstaff ")) {
    const [_, role, phone] = text.split(/\s+/);
    if (!role || !phone) {
      return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage: /addstaff <admin|payment|packing|inventory|support|finance> <phone>" });
    }
    const token = "ADP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await env.DB.prepare("INSERT INTO staff_users (role, phone, access_token) VALUES (?, ?, ?)").bind(role.toLowerCase(), phone, token).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `★ Staff Web Panel Credentials\n→ Role: ${role.toUpperCase()}\n└ Phone: ${phone}\n└ Token: ${token}`
    });
  }
}

async function adminAssignSupplierToOrder(env, orderId, supplierId, manualUnitPrice = 0) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!order || !sup) return { ok: false, msg: "× Order or Supplier not found." };

  const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(orderId).all();
  let baseTotal = 0;

  for (const it of (items.results || [])) {
    const unitP = manualUnitPrice > 0 ? manualUnitPrice : 500;
    const alloc = [{ supplier_id: sup.id, name: sup.name, qty: it.req_qty, price: unitP }];
    baseTotal += it.req_qty * unitP;
    await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, allocated_json = ? WHERE id = ?")
      .bind(it.req_qty, JSON.stringify(alloc), it.id).run();

    if (sup.tg_chat_id) {
      const notice = formatSupplierCard(
        `★ Direct Order Assigned by AD PARTSOL (#${orderId})`,
        it,
        `→ Agreed Rate: Rs.${unitP}/pc\nⓘ Keep items ready for AD PARTSOL pickup.`
      );
      await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: sup.tg_chat_id, text: notice });
    }
  }

  // Delete or clean other suppliers' messages for this order
  const allBids = await env.DB.prepare(
    "SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.order_id = ?"
  ).bind(orderId).all();
  for (const b of (allBids.results || [])) {
    if (b.tg_msg_id && b.tg_chat_id && b.supplier_id !== sup.id) {
      await tgCall(env.BOT_TOKEN_SUPPLIER, "deleteMessage", { chat_id: b.tg_chat_id, message_id: b.tg_msg_id });
    }
  }

  const withMargin = baseTotal * (1 + (order.margin_percent / 100));
  const finalTotal = Math.ceil((withMargin + order.delivery_charge) / 50) * 50;
  const adv20 = Math.round(finalTotal * 0.20);
  const bal80 = finalTotal - adv20;

  await env.DB.prepare(
    "UPDATE orders SET status = 'QUOTED', supplier_base_total = ?, final_total = ?, advance_20 = ?, balance_80 = ? WHERE id = ?"
  ).bind(baseTotal, finalTotal, adv20, bal80, orderId).run();

  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
  if (cust) {
    await notifyCustomer(
      env, cust,
      `★ Quotation Ready — Order #${orderId}\n━━━━━━━━━━━━━━━━━\n→ Total Price: Rs.${finalTotal} (Delivery Included)\n└ 20% Advance: Rs.${adv20}\n└ 80% After Packing Video: Rs.${bal80}`,
      [[{ text: `[+] Accept & Pay 20% (Rs.${adv20})`, callback_data: `pay20_${orderId}` }]]
    );
  }
  return { ok: true, msg: `★ Order #${orderId} assigned to ${sup.name}. Supplier notified & quote sent to customer.` };
}

async function sendAdminPanel(env, chatId, editMsgId = null) {
  const tg = await getSetting(env.DB, "tg_enabled", "1");
  const wa = await getSetting(env.DB, "wa_enabled", "1");
  const ai = await getSetting(env.DB, "ai_enabled", "1");
  const margin = await getSetting(env.DB, "margin_percent", "20");
  const deliv = await getSetting(env.DB, "delivery_charge", "100");

  const text = `★ AD PARTSOL — Master Control\n━━━━━━━━━━━━━━━━━\n→ Margin: ${margin}% | Delivery: Rs.${deliv}\n\nCommands:\n/margin 25\n/delivery 120\n/newsupplier Name\n/addstaff payment 9876543210\n/assign <OrderID> <SupplierID> <Price>\n/forceclose`;
  const reply_markup = {
    inline_keyboard: [
      [{ text: `Telegram: ${tg === "1" ? "[ON]" : "[OFF]"}`, callback_data: "toggle_tg_enabled" }],
      [{ text: `WhatsApp: ${wa === "1" ? "[ON]" : "[OFF]"}`, callback_data: "toggle_wa_enabled" }],
      [{ text: `AI Brain: ${ai === "1" ? "[ON]" : "[OFF]"}`, callback_data: "toggle_ai_enabled" }]
    ]
  };

  if (editMsgId) {
    return await tgCall(env.BOT_TOKEN_ADMIN, "editMessageText", { chat_id: chatId, message_id: editMsgId, text, reply_markup });
  }
  return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text, reply_markup });
}

// ==========================================
// 10. WHATSAPP CLOUD API HANDLER (WITH BLUE TICK)
// ==========================================
async function handleWhatsAppUpdate(body, env) {
  const waEnabled = await getSetting(env.DB, "wa_enabled", "1");
  if (waEnabled !== "1") return;

  const entry = body.entry?.[0]?.changes?.[0]?.value;
  if (!entry || !entry.messages || !entry.messages[0]) return;

  const msg = entry.messages[0];
  const from = msg.from;
  const custId = `wa_${from}`;
  const now = Math.floor(Date.now() / 1000);

  // Send Instant Blue Read-Receipt (Free!)
  await markWhatsAppRead(env, msg.id);

  let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  const isNew = !cust;
  if (isNew) {
    await env.DB.prepare("INSERT INTO customers (id, platform, chat_id, phone, last_msg_at, state) VALUES (?, 'whatsapp', ?, ?, ?, 'IDLE')")
      .bind(custId, from, from, now).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, custId).run();
  }

  if (cust.banned_until > now) return;

  if (msg.type === "interactive") {
    const btnId = msg.interactive?.button_reply?.id;
    if (btnId === "keep_alive_24h") {
      return await notifyCustomer(env, cust, "★ Session active for 24 hours. You will receive your order update here.");
    }
    if (btnId) return await processCustomerAction(env, cust, btnId);
  }

  if (msg.type === "text") {
    const t = (msg.text.body || "").trim();
    if (isNew || t.toLowerCase() === "/start" || t.toLowerCase() === "hi" || t.toLowerCase() === "hello") {
      return await notifyCustomer(
        env, cust,
        "★ Welcome to AD PARTSOL (B2B Mobile Spare Parts)\n━━━━━━━━━━━━━━━━━\n☞ Select your language (or order on Telegram @AdPartsol_Bot for 25% OFF on handling):",
        [
          [{ text: "English", callback_data: "lang_english" }, { text: "Hindi", callback_data: "lang_hindi" }, { text: "Hinglish", callback_data: "lang_hinglish" }]
        ]
      );
    }
    return await processCustomerInput(env, cust, t, null);
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
      const dataUri = `data:${metaJson.mime_type || "image/jpeg"};base64,${b64}`;
      return await processCustomerInput(env, cust, msg.image.caption || "", dataUri);
    } else {
      const text = await transcribeVoice(env, await mediaBin.arrayBuffer(), "wa_voice.ogg");
      return await processCustomerInput(env, cust, text, null);
    }
  }
}

// ==========================================
// 11. CRON ENGINE: 60s SUPPLIER TIMEOUT + 30m BIDDING + DELETE FROM OTHERS
// ==========================================
async function runAutomatedEngine(env) {
  const now = Math.floor(Date.now() / 1000);

  // A. Check 60-Second Supplier Bid Input Timeout
  const stuckSuppliers = await env.DB.prepare(
    "SELECT * FROM suppliers WHERE current_bid_item_id IS NOT NULL AND bid_started_at > 0 AND bid_started_at <= ?"
  ).bind(now - 60).all();

  for (const sup of (stuckSuppliers.results || [])) {
    await triggerSupplier60sTimeout(env, sup);
  }

  // B. Check Expired 30-Min Bidding Windows
  const dueOrders = await env.DB.prepare("SELECT * FROM orders WHERE status = 'BIDDING' AND bidding_ends_at <= ?").bind(now).all();

  for (const order of (dueOrders.results || [])) {
    const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(order.id).all();
    let baseTotal = 0;
    let anyFulfilled = false;

    for (const item of (items.results || [])) {
      const validBids = await env.DB.prepare(
        "SELECT b.*, s.name as sup_name, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.item_id = ? AND b.status = 'SUBMITTED' ORDER BY b.price_per_unit ASC"
      ).bind(item.id).all();

      let needed = item.req_qty;
      let fulfilled = 0;
      let allocations = [];
      let winningSupplierIds = new Set();

      for (const vb of (validBids.results || [])) {
        if (needed <= 0) break;
        const take = Math.min(needed, vb.available_qty);
        if (take > 0) {
          allocations.push({ supplier_id: vb.supplier_id, name: vb.sup_name, qty: take, price: vb.price_per_unit });
          winningSupplierIds.add(vb.supplier_id);
          baseTotal += take * vb.price_per_unit;
          needed -= take;
          fulfilled += take;
        }
      }

      const allItemBids = await env.DB.prepare(
        "SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.item_id = ?"
      ).bind(item.id).all();

      if (fulfilled > 0) {
        anyFulfilled = true;
        await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, allocated_json = ? WHERE id = ?")
          .bind(fulfilled, JSON.stringify(allocations), item.id).run();

        // Delete request message from all non-winning suppliers ("delete from everyone")
        for (const b of (allItemBids.results || [])) {
          if (b.tg_msg_id && b.tg_chat_id && !winningSupplierIds.has(b.supplier_id)) {
            await tgCall(env.BOT_TOKEN_SUPPLIER, "deleteMessage", { chat_id: b.tg_chat_id, message_id: b.tg_msg_id });
          }
        }
      } else {
        // Nobody bid -> Remove buttons, keep product details + "ⓘ Contact Admin for Continue this Request"
        const expiredCard = formatSupplierCard("★ Product Request", item, "ⓘ Contact Admin for Continue this Request");
        for (const b of (allItemBids.results || [])) {
          if (b.tg_msg_id && b.tg_chat_id) {
            await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageText", {
              chat_id: b.tg_chat_id,
              message_id: b.tg_msg_id,
              text: expiredCard,
              reply_markup: { inline_keyboard: [] }
            });
          }
        }
      }
    }

    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();

    if (!anyFulfilled) {
      await env.DB.prepare("UPDATE orders SET status = 'NO_BIDS' WHERE id = ?").bind(order.id).run();
      await sendLog(env, `ⓘ Order #${order.id} received NO BIDS. Admin can manually assign a supplier in Panel.`);
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

    const summaryItems = (items.results || []).map(i => ({
      brand: i.brand, model: i.model, part_name: i.part_name, variant: i.variant, qty: i.fulfilled_qty
    }));
    const quoteBox = formatSummaryBox(
      summaryItems,
      `★ Total Price: Rs.${finalTotal} (Delivery Included)\n→ 20% Advance: Rs.${adv20}\n└ 80% After Packing Video: Rs.${bal80}`
    );

    await notifyCustomer(
      env, cust, quoteBox,
      [[{ text: `[+] Accept & Pay 20% (Rs.${adv20})`, callback_data: `pay20_${order.id}` }]]
    );
  }
}

// ==========================================
// 12. ROLE-BASED STAFF WEB PANELS API
// ==========================================
async function handlePanelAPI(request, url, env) {
  const action = url.pathname.replace("/api/panel/", "");

  if (action === "track") {
    const id = Number(url.searchParams.get("order_id"));
    const order = await env.DB.prepare("SELECT id, status, final_total, advance_20, balance_80, tracking_id, created_at FROM orders WHERE id = ?").bind(id).first();
    const items = await env.DB.prepare("SELECT brand, model, part_name, variant, req_qty, fulfilled_qty FROM order_items WHERE order_id = ?").bind(id).all();
    return jsonRes({ ok: !!order, order, items: items.results || [] });
  }

  const phone = request.headers.get("x-staff-phone") || "";
  const token = request.headers.get("x-staff-token") || "";
  const staff = await env.DB.prepare("SELECT * FROM staff_users WHERE phone = ? AND access_token = ? AND is_active = 1").bind(phone, token).first();
  if (!staff) return jsonRes({ ok: false, error: "Unauthorized. Request token via Admin Bot." }, 401);

  if (action === "dashboard") {
    const orders = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 60").all();
    const payments = await env.DB.prepare("SELECT * FROM payments ORDER BY id DESC LIMIT 40").all();
    const settings = await env.DB.prepare("SELECT * FROM settings").all();
    const suppliers = await env.DB.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
    const items = await env.DB.prepare("SELECT * FROM order_items ORDER BY id DESC LIMIT 120").all();
    const bids = await env.DB.prepare("SELECT * FROM bids ORDER BY id DESC LIMIT 120").all();

    // Server-side Role Privacy Filter (Matches Staff Dashboards Blueprint!)
    const role = staff.role;
    const safeOrders = (orders.results || []).map(o => {
      if (role === "payment") return { ...o, supplier_base_total: undefined, margin_percent: undefined };
      if (role === "packing") return { ...o, supplier_base_total: undefined, margin_percent: undefined, final_total: undefined };
      return o;
    });

    return jsonRes({
      ok: true,
      role,
      orders: safeOrders,
      payments: payments.results || [],
      settings: settings.results || [],
      suppliers: role === "payment" ? [] : (suppliers.results || []),
      items: items.results || [],
      bids: (role === "admin" || role === "order_desk") ? (bids.results || []) : []
    });
  }

  if (action === "assign-supplier" && request.method === "POST") {
    const { order_id, supplier_id, unit_price } = await request.json();
    return jsonRes(await adminAssignSupplierToOrder(env, Number(order_id), Number(supplier_id), Number(unit_price || 0)));
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
    await notifyCustomer(env, cust, `★ Order #${order_id} Dispatched\n→ Tracking ID: ${tracking_id}`);
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: "Unknown endpoint" }, 404);
}

async function initDB(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tg_enabled', '1'), ('wa_enabled', '1'), ('ai_enabled', '1'), ('margin_percent', '20'), ('delivery_charge', '100')"),
    DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('upi_id', 'constantabrar@upi')"),
    DB.prepare("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, platform TEXT NOT NULL, chat_id TEXT NOT NULL, lang TEXT DEFAULT 'hinglish', full_name TEXT, phone TEXT, address TEXT, state TEXT DEFAULT 'IDLE', temp_data TEXT, fraud_strikes INTEGER DEFAULT 0, banned_until INTEGER DEFAULT 0, last_msg_at INTEGER DEFAULT 0, warned_22h INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_chat_id TEXT UNIQUE, name TEXT, phone TEXT, verify_code TEXT UNIQUE, is_verified INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, current_bid_item_id INTEGER, bid_step TEXT, bid_started_at INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS staff_users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, phone TEXT NOT NULL, access_token TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, status TEXT DEFAULT 'BIDDING', supplier_base_total REAL DEFAULT 0, margin_percent REAL DEFAULT 20, delivery_charge REAL DEFAULT 100, final_total REAL DEFAULT 0, advance_20 REAL DEFAULT 0, balance_80 REAL DEFAULT 0, packing_video_file_id TEXT, vault_msg_id TEXT, tracking_id TEXT, bidding_ends_at INTEGER NOT NULL, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, brand TEXT, model TEXT, part_name TEXT, variant TEXT DEFAULT 'Standard', req_qty INTEGER NOT NULL, fulfilled_qty INTEGER DEFAULT 0, allocated_json TEXT)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, price_per_unit REAL, available_qty INTEGER, tg_msg_id INTEGER, status TEXT DEFAULT 'PENDING', created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, customer_id TEXT NOT NULL, type TEXT NOT NULL, expected_amount REAL NOT NULL, extracted_utr TEXT UNIQUE, extracted_amount REAL, file_id_or_url TEXT, status TEXT DEFAULT 'PENDING', tg_group_msg_id INTEGER, created_at INTEGER DEFAULT (strftime('%s', 'now')))")
  ]);
  try { await DB.prepare("ALTER TABLE suppliers ADD COLUMN bid_step TEXT").run(); } catch (_) {}
  try { await DB.prepare("ALTER TABLE suppliers ADD COLUMN bid_started_at INTEGER DEFAULT 0").run(); } catch (_) {}
}
