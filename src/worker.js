export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

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
      // 1. One-Click Database & New Tables Initializer
      if (path === "/api/init-db") {
        await initDB(env.DB);
        return jsonRes({ ok: true, msg: "All 12 Database tables, margin_rules, inventory & columns initialized!" });
      }

      // 2. One-Click 6 Telegram Bots Webhook Setup
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

      // 3. Telegram Webhooks Router
      if (path.startsWith("/webhook/tg/") && request.method === "POST") {
        const botType = path.split("/").pop();
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(botType, update, env, `${url.protocol}//${url.host}`));
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
        ctx.waitUntil(handleWhatsAppUpdate(body, env, `${url.protocol}//${url.host}`));
        return new Response("OK", { status: 200 });
      }

      // 6. Supplier Portal API (/s)
      if (path.startsWith("/api/supplier/")) {
        return await handleSupplierPortalAPI(request, url, env);
      }

      // 7. Customer Forms & Tracker Portal API (/c)
      if (path.startsWith("/api/customer/")) {
        return await handleCustomerPortalAPI(request, url, env, `${url.protocol}//${url.host}`);
      }

      // 8. Admin & Dedicated Staff Panels REST API (/a, /pay, /p, /desk, /inv, /chat, /fin)
      if (path.startsWith("/api/panel/")) {
        return await handlePanelAPI(request, url, env, `${url.protocol}//${url.host}`);
      }

      // 9. Static Assets (Main Website + Staff Panels)
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return new Response("AD PARTSOL Ultimate Engine Active", { status: 200 });
    } catch (err) {
      ctx.waitUntil(sendLog(env, `★ CRITICAL WORKER ERROR\nPath: ${path}\nError: ${err.message}`));
      return jsonRes({ ok: false, error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatedEngine(env));
  }
};

// ==========================================
// CORE HELPERS & LOGGING
// ==========================================
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function sendLog(env, text) {
  if (!env.BOT_TOKEN_LOGS || !env.LOGS_GROUP_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN_LOGS}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.LOGS_GROUP_ID, text })
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
    if (Array.isArray(parsed)) return { items: parsed, history: [], draft_profile: {} };
    return {
      items: parsed.items || [],
      history: parsed.history || [],
      draft_profile: parsed.draft_profile || {}
    };
  } catch (_) {
    return { items: [], history: [], draft_profile: {} };
  }
}

// ==========================================
// DYNAMIC SLAB MARGIN CALCULATOR (UNLIMITED RULES)
// ==========================================
async function calculateItemSellingUnit(DB, baseUnitPrice, defaultMarginPct = 20) {
  const rules = await DB.prepare("SELECT * FROM margin_rules ORDER BY min_price ASC").all();
  for (const r of (rules.results || [])) {
    if (baseUnitPrice >= Number(r.min_price) && baseUnitPrice <= Number(r.max_price)) {
      if (r.margin_type === "FLAT") {
        return Math.round(baseUnitPrice + Number(r.margin_value));
      } else {
        return Math.round(baseUnitPrice * (1 + Number(r.margin_value) / 100));
      }
    }
  }
  return Math.round(baseUnitPrice * (1 + Number(defaultMarginPct) / 100));
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function startTgTypingLoader(token, chatId) {
  const res = await tgCall(token, "sendMessage", { chat_id: chatId, text: "T" });
  if (!res.ok) return null;
  const msgId = res.result.message_id;
  for (const frame of ["Typ", "Typing", "Typing...", "Typing.."]) {
    await sleep(150);
    await tgCall(token, "editMessageText", { chat_id: chatId, message_id: msgId, text: frame });
  }
  return msgId;
}

// ==========================================
// OPENAI 4-MODEL ROUTER (PROGRESSIVE MEMORY)
// ==========================================
async function analyzeCustomerRequirement(env, textInput, imageUrl = null, lang = "hinglish", memoryObj = { items: [], history: [] }) {
  const aiEnabled = await getSetting(env.DB, "ai_enabled", "1");
  if (aiEnabled !== "1") return { valid: false, clarify_msg: "ⓘ System maintenance: Service will resume shortly." };

  const model = imageUrl ? "gpt-6-luna" : "gpt-5.6-luna";
  const prevHistory = memoryObj.history.slice(-8).map(h => `${h.r}: ${h.t}`).join("\n");
  const prevDraft = JSON.stringify(memoryObj.items || []);

  const sysPrompt = `You are the official sales representative of AD PARTSOL (B2B mobile spare parts supply).
STRICT RULES:
1. NEVER reveal you are an AI, bot, or language model. Act as AD PARTSOL's direct sales desk. Never mention external suppliers or bidding.
2. NEVER use emojis. Use only symbols like ★ ■ ☞ → └ ⓘ [?].
3. Converse strictly in customer's selected language: ${lang}.
4. If the customer writes in a completely different language than ${lang}, set "detected_other_lang" to that language (english/hindi/hinglish/odia/odia_eng), else null.
5. Never ask the customer to use a fixed format. Extract Brand, Model, Part Name, Quality (Original/Duplicate/Standard), and Quantity naturally across multiple messages.
6. Merge new details with Current Draft Items: ${prevDraft} and Recent Chat History:
${prevHistory || "None"}
7. If any detail (Brand, Model, Part Name, Quality, or Qty) is still missing, set "valid": false and ask only for the missing piece in ${lang} inside "clarify_msg".

Output strictly JSON:
{
  "valid": true/false,
  "detected_other_lang": null,
  "items": [
    {"brand": "Apple", "model": "iPhone 15 Plus", "part_name": "Tempered Glass", "variant": "Original", "qty": 2}
  ],
  "summary_text": "Short note in ${lang} (NO EMOJIS)",
  "clarify_msg": "Natural question in ${lang} asking only what is missing (NO EMOJIS)"
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

// Progressive Multi-Message Profile Extractor (Never forgets previous message!)
async function extractCustomerProfileAI(env, textInput, lang = "hinglish", prevProfile = {}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You extract and merge customer delivery details across multiple messages.
Previously collected details: ${JSON.stringify(prevProfile)}
New customer message: "${textInput}"

Rules:
1. Merge the new message with previously collected details (Full Name, 10-digit Phone Number, Delivery Address).
2. Clean up formatting (e.g. if name and address were stuck together like "Abrar KhanHaladia Thakurpatna", separate them cleanly into Name: "Abrar Khan" and Address: "Haladia Thakurpatna").
3. If all 3 (name, phone, address) are now present, set "complete": true.
4. If any of the 3 is still missing, set "complete": false, keep the already found fields in "name", "phone", "address", and ask ONLY for the missing field(s) in ${lang} inside "ask_missing" (NO EMOJIS).

Output strictly JSON:
{"complete": true/false, "name": "...", "phone": "...", "address": "...", "ask_missing": "..."}`
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
          content: `Analyze this payment screenshot. Extract 12-digit UTR/Ref number, paid amount, and verify if genuine. Expected Amount: Rs ${expectedAmount}, Expected UPI: ${expectedUpi}. Return strict JSON: {"is_valid_screenshot": true/false, "utr": "123456789012" or null, "amount": 500, "reason": "string"}`
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
// TELEGRAM & WHATSAPP SENDERS
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

async function sendWhatsAppNativeFlow(env, toPhone, bodyText, buttonText, flowId, screenId, flowToken) {
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

async function notifyCustomer(env, customer, text, buttons = null, photoUrl = null, videoFileId = null, editMsgId = null) {
  if (!customer) return;
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
      const flatBtns = buttons.flat().filter(b => b.callback_data).slice(0, 3);
      if (flatBtns.length > 0) {
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
async function handleTelegramUpdate(botType, update, env, baseUrl) {
  if (botType === "customer") return await handleCustomerBot(update, env, baseUrl);
  if (botType === "supplier") return await handleSupplierBot(update, env, baseUrl);
  if (botType === "payment") return await handlePaymentBot(update, env);
  if (botType === "delivery") return await handleDeliveryBot(update, env);
  if (botType === "admin") return await handleAdminBot(update, env, baseUrl);
}

const GREETING_TEMPLATES = [
  "★ Welcome to AD PARTSOL — Wholesale Mobile Spare Parts Supply.",
  "★ Namaste! AD PARTSOL B2B Spare Parts Desk par aapka swagat hai.",
  "★ AD PARTSOL Direct Supply — Order any mobile spare part in a single message."
];

async function handleCustomerBot(update, env, baseUrl) {
  const tgEnabled = await getSetting(env.DB, "tg_enabled", "1");
  if (tgEnabled !== "1") return;

  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);
  const custId = `tg_${chatId}`;
  const now = Math.floor(Date.now() / 1000);

  let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  const isNew = !cust;
  if (isNew) {
    await env.DB.prepare("INSERT INTO customers (id, platform, chat_id, last_msg_at, state) VALUES (?, 'telegram', ?, ?, 'AWAITING_REQ')").bind(custId, chatId, now).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, custId).run();
  }

  if (cust.banned_until > now) return;

  if (cb) {
    await tgCall(env.BOT_TOKEN_CUSTOMER, "answerCallbackQuery", { callback_query_id: cb.id });
    return await processCustomerAction(env, cust, cb.data, cb.message.message_id, baseUrl);
  }

  const text = msg.text || msg.caption || "";
  if (text === "/start" || (isNew && !cust.full_name)) {
    const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
    const setupFormUrl = `${baseUrl}/c?mode=setup&cid=${encodeURIComponent(custId)}`;
    const orderFormUrl = `${baseUrl}/c?mode=order&cid=${encodeURIComponent(custId)}`;

    if (!cust.full_name || !cust.phone || !cust.address) {
      return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
        chat_id: chatId,
        text: `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Tap the button below to complete your 10-second Shop Setup (or simply type your requirement directly in chat):`,
        reply_markup: {
          inline_keyboard: [[{ text: "☞ Fill Shop Setup Form", url: setupFormUrl }]]
        }
      });
    } else {
      return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
        chat_id: chatId,
        text: `${greet}\n━━━━━━━━━━━━━━━━━\nWelcome back, ${cust.full_name}!\n☞ Tap below to open the Product Order Form, or send a Voice Note / Photo / Text right here:`,
        reply_markup: {
          inline_keyboard: [[{ text: "☞ Open Product Order Form", url: orderFormUrl }]]
        }
      });
    }
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

  await processCustomerInput(env, cust, finalInput, mediaUrl, baseUrl);
}

const LANG_GREETINGS = {
  english: "★ Language set to English.\n━━━━━━━━━━━━━━━━━\n☞ Tell us what mobile spare parts you need (send text, photo, voice note, or use the Order Form):",
  hindi: "★ भाषा हिंदी चुनी गई है।\n━━━━━━━━━━━━━━━━━\n☞ बताइये आपको कौन सा मोबाइल स्पेयर पार्ट चाहिए (मैसेज, फोटो या वॉइस नोट भेजें):",
  hinglish: "★ Language Hinglish set ho gayi hai.\n━━━━━━━━━━━━━━━━━\n☞ Batayein aapko kaunsa mobile spare part chahiye (text, photo ya voice note bhejein):",
  odia: "★ ଭାଷା ଓଡ଼ିଆ ଚୟନ କରାଯାଇଛି।\n━━━━━━━━━━━━━━━━━\n☞ ଆପଣଙ୍କୁ କେଉଁ ମୋବାଇଲ୍ ସ୍ପେୟାର୍ ପାର୍ଟ ଦରକାର କୁହନ୍ତୁ (ମେସେଜ୍, ଫଟୋ କିମ୍ବା ଭଏସ୍ ନୋଟ୍ ପଠାନ୍ତୁ):",
  odia_eng: "★ Language Odia + English set heigala.\n━━━━━━━━━━━━━━━━━\n☞ Apananku kou mobile spare part darkar kuhantu (text, photo kimba voice note pathantu):"
};

async function processCustomerAction(env, cust, data, msgId = null, baseUrl = "https://adpartsol.storzen.io") {
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

  // File 6: Customer Replies to Option A (Proceed with Available Only) or Option B (Outsource Missing)
  if (data.startsWith("optA_")) {
    const ordId = Number(data.split("_")[1]);
    await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0, status = 'BIDDING' WHERE id = ?").bind(ordId).run();
    await runAutomatedEngine(env);
    return await notifyCustomer(env, cust, `★ Option A Confirmed for Order #${ordId}. Proceeding with available stock only.`, null, null, null, msgId);
  }

  if (data.startsWith("optB_")) {
    const ordId = Number(data.split("_")[1]);
    await env.DB.prepare("UPDATE orders SET outsource_region = 'External_National', status = 'OUTSOURCE_REVIEW' WHERE id = ?").bind(ordId).run();
    await sendLog(env, `★ Customer chose Option B (External State Sourcing) for Order #${ordId}`);
    return await notifyCustomer(env, cust, `★ Option B Confirmed for Order #${ordId}. Our national sourcing desk is checking rates from Delhi/Mumbai/Kolkata hubs.`, null, null, null, msgId);
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
      const mem = parseSessionMemory(cust.temp_data);
      mem.draft_profile = { name: cust.full_name || "", phone: cust.phone || "", address: cust.address || "" };
      await env.DB.prepare("UPDATE customers SET state = 'AWAITING_PROFILE', temp_data = ? WHERE id = ?")
        .bind(JSON.stringify(mem), cust.id).run();

      if (cust.platform === "telegram") {
        const setupFormUrl = `${baseUrl}/c?mode=setup&cid=${encodeURIComponent(cust.id)}`;
        return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
          chat_id: cust.chat_id,
          text: "★ Delivery Details Required\n━━━━━━━━━━━━━━━━━\n☞ Tap the button below to fill your Shop Setup Form, or send your Name, Phone Number, and Address right here in chat:",
          reply_markup: { inline_keyboard: [[{ text: "☞ Fill Shop Setup Form", url: setupFormUrl }]] }
        });
      } else {
        const setupFlowId = await getSetting(env.DB, "wa_flow_id_setup", "");
        if (setupFlowId) {
          return await sendWhatsAppNativeFlow(
            env, cust.chat_id,
            "★ Delivery Details Required\n━━━━━━━━━━━━━━━━━\n☞ Tap below to complete your 10-second Shop Registration Form, or reply with your Name, Phone Number, and Address:",
            "Shop Setup Form", setupFlowId, "SHOP_SETUP", `setup_${cust.id}`
          );
        }
        return await notifyCustomer(env, cust, "★ Delivery Details Required\n━━━━━━━━━━━━━━━━━\n☞ Please send your Name, Phone Number, and Delivery Address:");
      }
    }
    return await showCombinedFinalConfirmation(env, cust, msgId, baseUrl);
  }

  if (data === "final_launch") {
    return await launchOrderBidding(env, cust, msgId, baseUrl);
  }

  if (data === "edit_profile") {
    const mem = parseSessionMemory(cust.temp_data);
    mem.draft_profile = {};
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_PROFILE', full_name = NULL, phone = NULL, address = NULL, temp_data = ? WHERE id = ?")
      .bind(JSON.stringify(mem), cust.id).run();
    return await notifyCustomer(env, cust, "☞ Please send your updated Full Name, Phone Number, and Delivery Address:", null, null, null, msgId);
  }

  if (data === "req_cancel") {
    await env.DB.prepare("UPDATE customers SET state = 'AWAITING_REQ', temp_data = NULL WHERE id = ?").bind(cust.id).run();
    return await notifyCustomer(env, cust, "× Current list cleared. Tell us what parts you need:", null, null, null, msgId);
  }

  // 4 Payment Options Selector
  if (data.startsWith("pay20_") || data.startsWith("paymode_")) {
    const parts = data.split("_");
    const orderId = Number(parts[1]);
    const mode = parts[2] || "QR";
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) return;

    const upi = await getSetting(env.DB, "upi_id", "constantabrar@upi");
    const payPhone = await getSetting(env.DB, "pay_phone", "7992809027");
    const bankDetails = await getSetting(env.DB, "bank_details", "AD ELECTROTECH | A/C: Contact Desk | IFSC: Contact Desk");

    await env.DB.prepare("UPDATE customers SET state = ? WHERE id = ?").bind(`AWAITING_20_SS_${order.id}`, cust.id).run();

    const modeButtons = [
      [{ text: "■ Dynamic QR", callback_data: `paymode_${order.id}_QR` }, { text: "■ UPI ID", callback_data: `paymode_${order.id}_UPI` }],
      [{ text: "■ Number Transfer", callback_data: `paymode_${order.id}_NUM` }, { text: "■ Bank NEFT/IMPS", callback_data: `paymode_${order.id}_BANK` }]
    ];

    if (mode === "UPI") {
      return await notifyCustomer(env, cust, `★ Pay via UPI ID — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n→ Payable 20% Advance: Rs.${order.advance_20}\n→ Official UPI ID: ${upi}\n━━━━━━━━━━━━━━━━━\n☞ Copy the UPI ID above, complete payment, and upload the Screenshot here:`, modeButtons, null, null, msgId);
    }
    if (mode === "NUM") {
      return await notifyCustomer(env, cust, `★ Direct Number Transfer — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n→ Payable 20% Advance: Rs.${order.advance_20}\n→ PhonePe / GPay / Paytm Number: ${payPhone}\n━━━━━━━━━━━━━━━━━\n☞ Send payment to the number above and upload the Screenshot here:`, modeButtons, null, null, msgId);
    }
    if (mode === "BANK") {
      return await notifyCustomer(env, cust, `★ Bank Transfer (IMPS/NEFT) — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n→ Payable 20% Advance: Rs.${order.advance_20}\n→ Bank Details:\n${bankDetails}\n━━━━━━━━━━━━━━━━━\n☞ Transfer the amount and upload the Screenshot here:`, modeButtons, null, null, msgId);
    }

    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=AD%20PARTSOL&am=${order.advance_20}&cu=INR&tn=ORD${order.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;

    return await notifyCustomer(
      env, cust,
      `★ 20% Advance Payment — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n→ Payable Now: Rs.${order.advance_20}\n└ UPI ID: ${upi}\n└ Number Transfer: ${payPhone}\n━━━━━━━━━━━━━━━━━\n☞ Scan QR or choose another payment method below, then send Payment Screenshot here:`,
      modeButtons, qrUrl
    );
  }
}

async function showCombinedFinalConfirmation(env, cust, editMsgId = null, baseUrl = "") {
  const mem = parseSessionMemory(cust.temp_data);
  const items = mem.items || [];
  if (!items.length) return await launchOrderBidding(env, cust, editMsgId, baseUrl);

  let lines = items.map((it, idx) =>
    `${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.qty}`
  ).join("\n\n");

  const report = `★ FINAL ORDER & DELIVERY CONFIRMATION\n━━━━━━━━━━━━━━━━━\n→ Name: ${cust.full_name}\n→ Phone: ${cust.phone}\n└ Address: ${cust.address}\n━━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━━\n[?] Confirm all details to submit order request?`;
  const btns = [
    [{ text: "[+] Submit Order Request", callback_data: "final_launch" }],
    [{ text: "[✎] Edit Products", callback_data: "req_edit" }, { text: "[✎] Edit Address", callback_data: "edit_profile" }]
  ];
  return await notifyCustomer(env, cust, report, btns, null, null, editMsgId);
}

async function processCustomerInput(env, cust, text, mediaUrl, baseUrl = "https://adpartsol.storzen.io") {
  const now = Math.floor(Date.now() / 1000);

  const activeBidOrder = await env.DB.prepare(
    "SELECT * FROM orders WHERE customer_id = ? AND status = 'BIDDING' AND bidding_ends_at > ? ORDER BY id DESC LIMIT 1"
  ).bind(cust.id, now).first();

  if (activeBidOrder && cust.state === "IDLE" && !mediaUrl) {
    const remMins = Math.max(1, Math.ceil((activeBidOrder.bidding_ends_at - now) / 60));
    return await notifyCustomer(
      env, cust,
      `ⓘ Order #${activeBidOrder.id} is in progress.\n━━━━━━━━━━━━━━━━━\n☞ Please wait ${remMins} more minutes. Before that, we will verify stock availability and send your quotation.`
    );
  }

  // 1. Progressive Multi-Message AI Profile Extraction
  if (cust.state === "AWAITING_PROFILE") {
    let loaderMsgId = null;
    if (cust.platform === "telegram") loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);

    const mem = parseSessionMemory(cust.temp_data);
    const prevProf = mem.draft_profile || {
      name: cust.full_name || "",
      phone: cust.phone || "",
      address: cust.address || ""
    };

    const prof = await extractCustomerProfileAI(env, text, cust.lang, prevProf);
    mem.draft_profile = {
      name: prof.name || prevProf.name || "",
      phone: prof.phone || prevProf.phone || "",
      address: prof.address || prevProf.address || ""
    };

    await env.DB.prepare("UPDATE customers SET temp_data = ? WHERE id = ?").bind(JSON.stringify(mem), cust.id).run();

    if (!prof.complete || !mem.draft_profile.name || !mem.draft_profile.phone || !mem.draft_profile.address) {
      return await notifyCustomer(env, cust, `ⓘ ${prof.ask_missing || "Please provide the remaining delivery details."}`, null, null, null, loaderMsgId);
    }

    await env.DB.prepare("UPDATE customers SET full_name = ?, phone = ?, address = ?, state = 'CONFIRM_REQ' WHERE id = ?")
      .bind(mem.draft_profile.name, mem.draft_profile.phone, mem.draft_profile.address, cust.id).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cust.id).first();
    return await showCombinedFinalConfirmation(env, cust, loaderMsgId, baseUrl);
  }

  // 2. Payment Screenshot Verification
  if (cust.state.startsWith("AWAITING_20_SS_") || cust.state.startsWith("AWAITING_80_SS_")) {
    const is20 = cust.state.startsWith("AWAITING_20_SS_");
    const orderId = Number(cust.state.split("_").pop());
    if (!mediaUrl) {
      return await notifyCustomer(env, cust, "ⓘ Please upload a clear screenshot/photo of your payment.");
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
    return await notifyCustomer(env, cust, "★ Payment screenshot received. Our verification desk is checking it now.", null, null, null, loaderMsgId);
  }

  // 3. AI Requirement Gathering with Rolling Memory
  let loaderMsgId = null;
  if (cust.platform === "telegram") {
    loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);
  }

  const mem = parseSessionMemory(cust.temp_data);
  if (text) mem.history.push({ r: "Customer", t: text.slice(0, 160) });

  const parsed = await analyzeCustomerRequirement(env, text, mediaUrl, cust.lang, mem);

  let langSwitchButtons = [];
  if (parsed.detected_other_lang && parsed.detected_other_lang !== cust.lang) {
    langSwitchButtons.push([{ text: `[?] Change language to ${parsed.detected_other_lang.toUpperCase()}?`, callback_data: `switchlang_${parsed.detected_other_lang}` }]);
  }

  if (parsed.items && parsed.items.length > 0) {
    mem.items = parsed.items;
  }

  if (!parsed.valid || !mem.items || mem.items.length === 0) {
    const botReply = parsed.clarify_msg || "☞ Please share the Brand, Model, Part Name, Quality, and Quantity.";
    mem.history.push({ r: "AD_PARTSOL", t: botReply.slice(0, 160) });
    mem.history = mem.history.slice(-8);
    await env.DB.prepare("UPDATE customers SET temp_data = ? WHERE id = ?").bind(JSON.stringify(mem), cust.id).run();
    return await notifyCustomer(env, cust, `ⓘ ${botReply}`, langSwitchButtons.length ? langSwitchButtons : null, null, null, loaderMsgId);
  }

  mem.history.push({ r: "AD_PARTSOL", t: "Order Summary Displayed" });
  mem.history = mem.history.slice(-8);

  await env.DB.prepare("UPDATE customers SET state = 'CONFIRM_REQ', temp_data = ? WHERE id = ?")
    .bind(JSON.stringify(mem), cust.id).run();

  const summaryBox = formatSummaryBox(mem.items, "[?] Are these details correct?");
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
  const maxStrikes = Number(await getSetting(env.DB, "max_fraud_strikes", "3"));
  const now = Math.floor(Date.now() / 1000);
  if (strikes >= maxStrikes) {
    const banUntil = now + 12 * 3600;
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ?, banned_until = ?, state = 'IDLE' WHERE id = ?")
      .bind(strikes, banUntil, cust.id).run();
    await sendLog(env, `★ SHADOW BAN (12h)\nCustomer: ${cust.id} (${cust.phone})\nReason: ${strikes} Invalid Screenshots (${reason})`);
    return await notifyCustomer(env, cust, "× Multiple invalid payment screenshots detected. Account paused for 12 hours.", null, null, null, editMsgId);
  } else {
    await env.DB.prepare("UPDATE customers SET fraud_strikes = ? WHERE id = ?").bind(strikes, cust.id).run();
    return await notifyCustomer(env, cust, `ⓘ Invalid Screenshot (${strikes}/${maxStrikes}): ${reason}\nPlease upload a valid screenshot.`, null, null, null, editMsgId);
  }
}

// ==========================================
// 6. LAUNCH ORDER & PIGGYBACK GHOST QUERIES
// ==========================================
async function launchOrderBidding(env, cust, editMsgId = null, baseUrl = "https://adpartsol.storzen.io") {
  const mem = parseSessionMemory(cust.temp_data);
  const items = mem.items || [];
  if (!items.length) return await notifyCustomer(env, cust, "ⓘ No items in list. Please tell us what parts you need.", null, null, null, editMsgId);

  const windowMins = Number(await getSetting(env.DB, "bidding_window_mins", "30"));
  const endsAt = Math.floor(Date.now() / 1000) + (windowMins * 60);
  const margin = Number(await getSetting(env.DB, "margin_percent", "20"));
  const delivery = Number(await getSetting(env.DB, "delivery_charge", "100"));
  const orderId = Math.floor(100000000 + Math.random() * 900000000);
  const masterId = "MO-" + Math.floor(10000 + Math.random() * 90000);

  await env.DB.prepare(
    "INSERT INTO orders (id, customer_id, master_id, status, dispatch_stage, margin_percent, delivery_charge, bidding_ends_at) VALUES (?, ?, ?, 'BIDDING', 'COLLECTING_PRICES', ?, ?, ?)"
  ).bind(orderId, cust.id, masterId, margin, delivery, endsAt).run();

  const suppliers = await env.DB.prepare("SELECT * FROM suppliers WHERE is_verified = 1 AND is_active = 1").all();

  // Check if Admin has any queued Ghost Orders (File 13 Mode 2) to piggyback transparently!
  const ghostList = await env.DB.prepare("SELECT * FROM ghost_queries WHERE status = 'PIGGYBACK_QUEUED'").all();
  const broadcastItems = [...items];
  for (const g of (ghostList.results || [])) {
    broadcastItems.push({
      brand: g.item_name,
      model: "",
      part_name: g.note || "Market Check",
      variant: "Original",
      qty: g.qty || 1,
      is_ghost: true,
      ghost_id: g.id
    });
    await env.DB.prepare("UPDATE ghost_queries SET status = 'BROADCASTED_WITH_" + orderId + "' WHERE id = ?").bind(g.id).run();
  }

  for (const it of broadcastItems) {
    const reqQty = Number(it.qty) || 1;
    let itemId = 0;

    if (!it.is_ghost) {
      const itemRes = await env.DB.prepare(
        "INSERT INTO order_items (order_id, brand, model, part_name, variant, req_qty) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(orderId, it.brand, it.model || "", it.part_name, it.variant || "Standard", reqQty).run();
      itemId = itemRes.meta.last_row_id;
    } else {
      const ghostRes = await env.DB.prepare(
        "INSERT INTO order_items (order_id, brand, model, part_name, variant, req_qty, qc_status) VALUES (0, ?, '', ?, 'Ghost', ?, 'GHOST')"
      ).bind(it.brand, it.part_name, reqQty).run();
      itemId = ghostRes.meta.last_row_id;
    }

    const cardText = formatSupplierCard(`★ New Product Request (#${orderId})`, {
      brand: it.brand, model: it.model, part_name: it.part_name, variant: it.variant, req_qty: reqQty
    });

    for (const sup of (suppliers.results || [])) {
      if (sup.last_panel_msg_id) {
        await tgCall(env.BOT_TOKEN_SUPPLIER, "editMessageReplyMarkup", {
          chat_id: sup.tg_chat_id,
          message_id: sup.last_panel_msg_id,
          reply_markup: { inline_keyboard: [] }
        });
      }

      const panelLink = `${baseUrl}/s?code=${encodeURIComponent(sup.verify_code)}`;
      const msgRes = await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: sup.tg_chat_id,
        text: cardText,
        reply_markup: {
          inline_keyboard: [[{ text: "☞ Continue to Panel", url: panelLink }]]
        }
      });

      if (msgRes.ok) {
        const newMsgId = msgRes.result.message_id;
        await env.DB.prepare(
          "INSERT INTO bids (order_id, item_id, supplier_id, tg_msg_id, status) VALUES (?, ?, ?, ?, 'PENDING')"
        ).bind(it.is_ghost ? 0 : orderId, itemId, sup.id, newMsgId).run();
        await env.DB.prepare("UPDATE suppliers SET last_panel_msg_id = ? WHERE id = ?").bind(newMsgId, sup.id).run();
        sup.last_panel_msg_id = newMsgId;
      }
    }
  }

  await env.DB.prepare("UPDATE customers SET state = 'IDLE', temp_data = NULL WHERE id = ?").bind(cust.id).run();

  const tgDisc = await getSetting(env.DB, "tg_promo_percent", "25");
  const waPromo = cust.platform === "whatsapp"
    ? `\n\n★ Tip: Order on our Telegram (@AdPartsol_Bot) to get ${tgDisc}% OFF on handling charges!`
    : "";
  const confirmBox = formatSummaryBox(
    items,
    `★ Order Request Successful (ID: #${orderId})\n☞ We are verifying stock and final price. Please wait up to ${windowMins} minutes.${waPromo}`
  );
  await notifyCustomer(env, cust, confirmBox, null, null, null, editMsgId);
  await sendLog(env, `★ Order Request #${orderId} (${masterId}) launched (${items.length} items). Broadcasted to ${(suppliers.results || []).length} suppliers.`);
}

// ==========================================
// 7. SUPPLIER BOT & SUPPLIER WEB PORTAL API (/s)
// ==========================================
async function handleSupplierBot(update, env, baseUrl) {
  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();

  if (text === "/start") {
    const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE tg_chat_id = ? AND is_verified = 1").bind(chatId).first();
    if (sup) {
      const panelLink = `${baseUrl}/s?code=${encodeURIComponent(sup.verify_code)}`;
      return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: chatId,
        text: `★ AD PARTSOL — Partner Terminal (${sup.name})\n━━━━━━━━━━━━━━━━━\nCommands:\n/active — Receive requests\n/sleep — Pause requests`,
        reply_markup: { inline_keyboard: [[{ text: "☞ Continue to Panel", url: panelLink }]] }
      });
    }
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
    const panelLink = `${baseUrl}/s?code=${encodeURIComponent(sup.verify_code)}`;
    return await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
      chat_id: chatId,
      text: `★ Verified: ${sup.name}.\n━━━━━━━━━━━━━━━━━\nAll product requests will appear here. Tap below to open your live Supplier Panel:`,
      reply_markup: { inline_keyboard: [[{ text: "☞ Continue to Panel", url: panelLink }]] }
    });
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
}

async function handleSupplierPortalAPI(request, url, env) {
  const action = url.pathname.replace("/api/supplier/", "");
  const code = (url.searchParams.get("code") || request.headers.get("x-supplier-code") || "").trim();
  const sup = await env.DB.prepare("SELECT * FROM suppliers WHERE verify_code = ?").bind(code).first();
  if (!sup) return jsonRes({ ok: false, error: "Invalid Supplier Code" }, 401);

  if (action === "feed") {
    const bids = await env.DB.prepare(
      `SELECT b.id as bid_id, b.order_id, b.item_id, b.price_per_unit, b.available_qty, b.response_sec, b.status as bid_status, b.created_at,
              i.brand, i.model, i.part_name, i.variant, i.req_qty, i.fulfilled_qty, i.allocated_json,
              COALESCE(o.status, 'BIDDING') as order_status, COALESCE(o.bidding_ends_at, 9999999999) as bidding_ends_at
       FROM bids b
       JOIN order_items i ON b.item_id = i.id
       LEFT JOIN orders o ON b.order_id = o.id
       WHERE b.supplier_id = ?
       ORDER BY b.id DESC LIMIT 100`
    ).bind(sup.id).all();

    return jsonRes({ ok: true, supplier: { id: sup.id, name: sup.name, is_active: sup.is_active }, requests: bids.results || [] });
  }

  if (action === "respond" && request.method === "POST") {
    const { bid_id, decision, price, qty } = await request.json();
    const bid = await env.DB.prepare("SELECT * FROM bids WHERE id = ? AND supplier_id = ?").bind(Number(bid_id), sup.id).first();
    if (!bid) return jsonRes({ ok: false, error: "Request not found" }, 404);

    if (decision === "DECLINE") {
      await env.DB.prepare("UPDATE bids SET status = 'DECLINED' WHERE id = ?").bind(bid.id).run();
      return jsonRes({ ok: true, status: "DECLINED" });
    }

    if (decision === "RESTORE") {
      await env.DB.prepare("UPDATE bids SET status = 'PENDING' WHERE id = ?").bind(bid.id).run();
      return jsonRes({ ok: true, status: "PENDING" });
    }

    const unitPrice = parseFloat(price);
    const availQty = parseInt(qty, 10);
    if (isNaN(unitPrice) || unitPrice <= 0 || isNaN(availQty) || availQty <= 0) {
      return jsonRes({ ok: false, error: "Enter valid price and quantity" }, 400);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const respSec = Math.max(5, nowSec - Number(bid.created_at || nowSec));

    await env.DB.prepare(
      "UPDATE bids SET price_per_unit = ?, available_qty = ?, response_sec = ?, status = 'SUBMITTED' WHERE id = ?"
    ).bind(unitPrice, availQty, respSec, bid.id).run();

    await env.DB.prepare(
      "UPDATE suppliers SET avg_resp_sec = CAST((COALESCE(avg_resp_sec, 45) + ?) / 2 AS INTEGER), orders_freq = COALESCE(orders_freq, 1) + 1 WHERE id = ?"
    ).bind(respSec, sup.id).run();

    await sendLog(env, `★ Bid Room Update: ${sup.name} accepted Item #${bid.item_id} (Order #${bid.order_id}) — Rs.${unitPrice}/pc × ${availQty} pcs in ${respSec}s`);
    return jsonRes({ ok: true, status: "SUBMITTED", response_sec: respSec });
  }

  if (action === "toggle-active" && request.method === "POST") {
    const next = sup.is_active ? 0 : 1;
    await env.DB.prepare("UPDATE suppliers SET is_active = ? WHERE id = ?").bind(next, sup.id).run();
    return jsonRes({ ok: true, is_active: next });
  }

  return jsonRes({ ok: false, error: "Unknown action" }, 404);
}

// ==========================================
// 8. CUSTOMER WEB FORMS API (/c — STANDALONE FORM 1 & FORM 2)
// ==========================================
async function handleCustomerPortalAPI(request, url, env, baseUrl) {
  const action = url.pathname.replace("/api/customer/", "");

  if (action === "profile" && request.method === "GET") {
    const cid = url.searchParams.get("cid") || "";
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cid).first();
    return jsonRes({ ok: !!cust, customer: cust });
  }

  if (action === "register" && request.method === "POST") {
    const { cid, full_name, phone, address, lang, email } = await request.json();
    let custId = cid || `wa_91${String(phone).replace(/\D/g, "").slice(-10)}`;
    const now = Math.floor(Date.now() / 1000);

    let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
    const cleanAddr = `${address}${email ? " | Email: " + email : ""}`;

    if (!cust) {
      const plat = custId.startsWith("tg_") ? "telegram" : "whatsapp";
      const chatId = custId.replace(/^(tg_|wa_)/, "");
      await env.DB.prepare(
        "INSERT INTO customers (id, platform, chat_id, full_name, phone, address, lang, last_msg_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_REQ')"
      ).bind(custId, plat, chatId, full_name, phone, cleanAddr, lang || "hinglish", now).run();
      cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
    } else {
      await env.DB.prepare(
        "UPDATE customers SET full_name = ?, phone = ?, address = ?, lang = ?, state = 'AWAITING_REQ' WHERE id = ?"
      ).bind(full_name, phone, cleanAddr, lang || "hinglish", custId).run();
      cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
    }

    const mem = parseSessionMemory(cust.temp_data);
    if (mem.items && mem.items.length > 0) {
      await showCombinedFinalConfirmation(env, cust, null, baseUrl);
    } else {
      const partnerCode = "ADP-" + String(phone).slice(-4);
      const orderFormUrl = `${baseUrl}/c?mode=order&cid=${encodeURIComponent(custId)}`;
      const bridgeText = `★ Shop Profile Verified — ${full_name}\n━━━━━━━━━━━━━━━━━\n→ Partner ID: #${partnerCode}\n→ Delivery Hub: ${address}\n└ Language: ${(lang || "hinglish").toUpperCase()}\n━━━━━━━━━━━━━━━━━\n☞ Now tell us what parts you need! Tap the Product Order Form button below, or simply send a Voice Note, Photo, or Text here:`;

      if (cust.platform === "telegram") {
        await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
          chat_id: cust.chat_id,
          text: bridgeText,
          reply_markup: {
            inline_keyboard: [[{ text: "☞ Open Product Order Form", url: orderFormUrl }]]
          }
        });
      } else {
        const orderFlowId = await getSetting(env.DB, "wa_flow_id_order", "");
        if (orderFlowId) {
          await sendWhatsAppNativeFlow(env, cust.chat_id, bridgeText, "Order Spare Parts", orderFlowId, "PRODUCT_ORDER", `ord_${cust.id}`);
        } else {
          await notifyCustomer(env, cust, bridgeText);
        }
      }
    }
    return jsonRes({ ok: true, cid: custId });
  }

  if (action === "submit-order" && request.method === "POST") {
    const { cid, items } = await request.json();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(cid).first();
    if (!cust) return jsonRes({ ok: false, error: "Customer not found" }, 400);

    const mem = parseSessionMemory(cust.temp_data);
    mem.items = (mem.items || []).concat(items);
    await env.DB.prepare("UPDATE customers SET state = 'CONFIRM_REQ', temp_data = ? WHERE id = ?")
      .bind(JSON.stringify(mem), cust.id).run();

    const summaryBox = formatSummaryBox(mem.items, "[?] Are these details correct?");
    const actionButtons = [
      [{ text: "[+] Confirm & Continue", callback_data: "req_continue" }],
      [{ text: "[+] Add More Products", callback_data: "req_add_more" }, { text: "[✎] Edit", callback_data: "req_edit" }],
      [{ text: "[×] Cancel", callback_data: "req_cancel" }]
    ];
    await notifyCustomer(env, cust, summaryBox, actionButtons);
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: "Unknown customer endpoint" }, 404);
}

// ==========================================
// 9. PAYMENT & DELIVERY BOTS
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
    await env.DB.prepare("UPDATE orders SET status = 'COLLECTING', dispatch_stage = 'WE_ARE_COLLECTING' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `★ 20% Advance Verified — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Your order is now being collected and packed at our warehouse.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `★ Order #${order.id} Ready for Collection\n━━━━━━━━━━━━━━━━━\n→ Customer: ${cust.full_name}\n└ Address: ${cust.address}`,
      reply_markup: {
        inline_keyboard: [[{ text: "■ View Items & Collect", callback_data: `packview_${order.id}` }]]
      }
    });
  } else if (pay.type === "BALANCE_80") {
    await env.DB.prepare("UPDATE orders SET status = 'READY_TO_SHIP', dispatch_stage = 'OUT_FOR_BUS_STAND' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `★ 80% Balance Verified — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Your parcel is being handed over to the courier / Bus Stand dispatch. Tracking ID will be shared shortly.`);

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
      await env.DB.prepare("UPDATE orders SET status = 'PACKING', dispatch_stage = 'CHECKING_HUB' WHERE id = ?").bind(orderId).run();
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

    await env.DB.prepare("UPDATE orders SET status = 'AWAITING_80_PAYMENT', dispatch_stage = 'PACKAGED_AND_LABELLED', packing_video_file_id = ?, vault_msg_id = ? WHERE id = ?")
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

    await env.DB.prepare("UPDATE orders SET status = 'SHIPPED', dispatch_stage = 'OUT_FOR_DELIVERY', tracking_id = ? WHERE id = ?").bind(trackingId, shipOrdId).run();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'active_ship_order'").run();

    await notifyCustomer(env, cust, `★ Order #${shipOrdId} Dispatched\n━━━━━━━━━━━━━━━━━\n→ Tracking ID: ${trackingId}\nThank you for ordering with AD PARTSOL.`);
    await sendLog(env, `★ Order #${shipOrdId} SHIPPED. Tracking: ${trackingId}`);
    return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: msg.chat.id, text: `★ Order #${shipOrdId} marked SHIPPED.`
    });
  }
}

// ==========================================
// 10. ADMIN BOT
// ==========================================
async function handleAdminBot(update, env, baseUrl) {
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
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "★ All active bidding windows closed & item-wise invoices dispatched." });
  }

  if (text.startsWith("/setflow ")) {
    const [_, type, flowId] = text.split(/\s+/);
    if (!type || !flowId) {
      return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage:\n/setflow setup <FLOW_ID>\n/setflow order <FLOW_ID>" });
    }
    const key = type.toLowerCase() === "setup" ? "wa_flow_id_setup" : "wa_flow_id_order";
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, flowId.trim()).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: `★ Saved ${key} = ${flowId.trim()}` });
  }

  if (text.startsWith("/assign ")) {
    const [_, ordIdStr, supIdStr, priceStr] = text.split(/\s+/);
    const res = await adminAssignSupplierToOrder(env, Number(ordIdStr), Number(supIdStr), Number(priceStr || 0));
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: res.msg });
  }

  if (text.startsWith("/newsupplier")) {
    const name = text.replace("/newsupplier", "").trim() || "Partner";
    const code = "SUP" + Math.random().toString(36).substring(2, 7).toUpperCase();
    await env.DB.prepare("INSERT INTO suppliers (name, verify_code) VALUES (?, ?)").bind(name, code).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `★ New Supplier Created\n→ Name: ${name}\n→ Telegram Command: /verify ${code}\n└ Direct Web Panel: ${baseUrl}/s?code=${code}`
    });
  }

  if (text.startsWith("/addstaff ")) {
    const [_, role, phone] = text.split(/\s+/);
    if (!role || !phone) {
      return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage: /addstaff <admin|order_desk|payment|packing|inventory|support|finance|collection|hub|dispatch|delivery> <phone>" });
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
  let itemsSellSubtotal = 0;
  let invoiceLines = [];

  for (let idx = 0; idx < (items.results || []).length; idx++) {
    const it = items.results[idx];
    const unitP = manualUnitPrice > 0 ? manualUnitPrice : 500;
    const sellUnit = await calculateItemSellingUnit(env.DB, unitP, order.margin_percent);
    const lineTotal = sellUnit * it.req_qty;

    const alloc = [{ supplier_id: sup.id, name: sup.name, qty: it.req_qty, price: unitP, sell_unit: sellUnit }];
    baseTotal += it.req_qty * unitP;
    itemsSellSubtotal += lineTotal;

    await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, sup_qty = ?, allocated_json = ? WHERE id = ?")
      .bind(it.req_qty, it.req_qty, JSON.stringify(alloc), it.id).run();

    invoiceLines.push(
      `${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.req_qty} × Rs.${sellUnit} = Rs.${lineTotal}`
    );

    if (sup.tg_chat_id) {
      const notice = formatSupplierCard(
        `★ Direct Order Assigned by AD PARTSOL (#${orderId})`,
        it,
        `→ Agreed Rate: Rs.${unitP}/pc\nⓘ Keep items ready for AD PARTSOL pickup.`
      );
      await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: sup.tg_chat_id, text: notice });
    }
  }

  const allBids = await env.DB.prepare(
    "SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.order_id = ?"
  ).bind(orderId).all();
  for (const b of (allBids.results || [])) {
    if (b.tg_msg_id && b.tg_chat_id && b.supplier_id !== sup.id) {
      await tgCall(env.BOT_TOKEN_SUPPLIER, "deleteMessage", { chat_id: b.tg_chat_id, message_id: b.tg_msg_id });
    }
  }

  const rawTotal = itemsSellSubtotal + Number(order.delivery_charge || 0);
  const roundStep = Number(await getSetting(env.DB, "rounding_step", "50")) || 1;
  const finalTotal = roundStep > 1 ? Math.ceil(rawTotal / roundStep) * roundStep : Math.round(rawTotal);
  const advPct = Number(await getSetting(env.DB, "advance_percent", "20")) || 20;
  const adv20 = Math.round(finalTotal * (advPct / 100));
  const bal80 = finalTotal - adv20;

  await env.DB.prepare(
    "UPDATE orders SET status = 'QUOTED', dispatch_stage = 'CONFIRMATION_PENDING', supplier_base_total = ?, final_total = ?, advance_20 = ?, balance_80 = ? WHERE id = ?"
  ).bind(baseTotal, finalTotal, adv20, bal80, orderId).run();

  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
  if (cust) {
    const invoiceTxt = `ORDER SUMMARY & INVOICE (#${orderId})\n━━━━━━━━━━━━━━━━━\n${invoiceLines.join("\n\n")}\n━━━━━━━━━━━━━━━━━\n→ Products Subtotal: Rs.${itemsSellSubtotal}\n→ Delivery Charges: Rs.${order.delivery_charge}\n★ Total Price: Rs.${finalTotal} (Delivery Included)\n→ ${advPct}% Advance: Rs.${adv20}\n└ ${100 - advPct}% After Packing Video: Rs.${bal80}`;
    await notifyCustomer(
      env, cust, invoiceTxt,
      [[{ text: `[+] Accept & Pay ${advPct}% (Rs.${adv20})`, callback_data: `pay20_${orderId}` }]]
    );
  }
  return { ok: true, msg: `★ Order #${orderId} assigned to ${sup.name} & itemized invoice sent.` };
}

async function sendAdminPanel(env, chatId, editMsgId = null) {
  const tg = await getSetting(env.DB, "tg_enabled", "1");
  const wa = await getSetting(env.DB, "wa_enabled", "1");
  const ai = await getSetting(env.DB, "ai_enabled", "1");
  const margin = await getSetting(env.DB, "margin_percent", "20");
  const deliv = await getSetting(env.DB, "delivery_charge", "100");
  const fSetup = await getSetting(env.DB, "wa_flow_id_setup", "Not Set");
  const fOrder = await getSetting(env.DB, "wa_flow_id_order", "Not Set");

  const text = `★ AD PARTSOL — Master Control\n━━━━━━━━━━━━━━━━━\n→ Default Margin: ${margin}% | Delivery: Rs.${deliv}\n→ WA Setup Flow ID: ${fSetup}\n→ WA Order Flow ID: ${fOrder}\n\nCommands:\n/setflow setup <FLOW_ID>\n/setflow order <FLOW_ID>\n/newsupplier Name\n/addstaff payment 9876543210\n/assign <OrderID> <SupplierID> <Price>\n/forceclose`;
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
// 11. WHATSAPP CLOUD API HANDLER (NATIVE v7.3 FLOWS + AI)
// ==========================================
async function handleWhatsAppUpdate(body, env, baseUrl) {
  const waEnabled = await getSetting(env.DB, "wa_enabled", "1");
  if (waEnabled !== "1") return;

  const entry = body.entry?.[0]?.changes?.[0]?.value;
  if (!entry || !entry.messages || !entry.messages[0]) return;

  const msg = entry.messages[0];
  const from = msg.from;
  const custId = `wa_${from}`;
  const now = Math.floor(Date.now() / 1000);

  await markWhatsAppRead(env, msg.id);

  let cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  const isNew = !cust;
  if (isNew) {
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
      return await notifyCustomer(env, cust, "★ Session active for 24 hours. You will receive your order update here.");
    }
    if (btnId) return await processCustomerAction(env, cust, btnId, null, baseUrl);

    if (msg.interactive?.type === "nfm_reply") {
      const rawJson = msg.interactive.nfm_reply?.response_json || "{}";
      const formData = JSON.parse(rawJson);

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
    const isGreeting = ["hi", "hello", "/start", "hey", "start"].includes(t.toLowerCase());

    if (isNew || isGreeting) {
      const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
      const setupFlowId = await getSetting(env.DB, "wa_flow_id_setup", "");
      const orderFlowId = await getSetting(env.DB, "wa_flow_id_order", "");

      if (!cust.full_name && setupFlowId) {
        return await sendWhatsAppNativeFlow(
          env, from,
          `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Tap below to fill your 10-second Shop Registration Form (or type your spare part requirement directly in chat):`,
          "Shop Setup Form",
          setupFlowId,
          "SHOP_SETUP",
          `setup_${cust.id}`
        );
      } else if (cust.full_name && orderFlowId) {
        return await sendWhatsAppNativeFlow(
          env, from,
          `${greet}\n━━━━━━━━━━━━━━━━━\nWelcome back, ${cust.full_name}!\n☞ Tap below to open the Product Order Form, or send a Voice Note, Photo, or Text:`,
          "Order Spare Parts",
          orderFlowId,
          "PRODUCT_ORDER",
          `ord_${cust.id}`
        );
      } else if (isGreeting) {
        return await notifyCustomer(
          env, cust,
          `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Select your language below or tell us what mobile spare parts you need:`,
          [[{ text: "English", callback_data: "lang_english" }, { text: "Hindi", callback_data: "lang_hindi" }, { text: "Hinglish", callback_data: "lang_hinglish" }]]
        );
      }
    }
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
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const dataUri = `data:${metaJson.mime_type || "image/jpeg"};base64,${b64}`;
      return await processCustomerInput(env, cust, msg.image.caption || "", dataUri, baseUrl);
    } else {
      const text = await transcribeVoice(env, await mediaBin.arrayBuffer(), "wa_voice.ogg");
      return await processCustomerInput(env, cust, text, null, baseUrl);
    }
  }
}

// ==========================================
// 12. CRON ENGINE: SLAB MARGIN, CHEAPEST vs FREQUENCY ALLOCATION & QTY FIX
// ==========================================
async function runAutomatedEngine(env) {
  const now = Math.floor(Date.now() / 1000);
  const allocLogic = await getSetting(env.DB, "allocation_logic", "cheapest"); // 'cheapest' or 'frequency'

  const dueOrders = await env.DB.prepare("SELECT * FROM orders WHERE status = 'BIDDING' AND bidding_ends_at <= ?").bind(now).all();

  for (const order of (dueOrders.results || [])) {
    const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(order.id).all();
    let baseTotal = 0;
    let itemsSellSubtotal = 0;
    let anyFulfilled = false;
    let invoiceLines = [];

    for (let idx = 0; idx < (items.results || []).length; idx++) {
      const item = items.results[idx];
      const orderBySql = allocLogic === "frequency"
        ? "ORDER BY s.orders_freq DESC, b.price_per_unit ASC"
        : "ORDER BY b.price_per_unit ASC, b.response_sec ASC";

      const validBids = await env.DB.prepare(
        `SELECT b.*, s.name as sup_name, s.tg_chat_id, s.orders_freq
         FROM bids b JOIN suppliers s ON b.supplier_id = s.id
         WHERE b.item_id = ? AND b.status = 'SUBMITTED' ${orderBySql}`
      ).bind(item.id).all();

      let needed = Number(item.req_qty) || 1;
      let fulfilled = 0;
      let itemBaseCost = 0;
      let allocations = [];
      let winningSupplierIds = new Set();

      for (const vb of (validBids.results || [])) {
        if (needed <= 0) break;
        const avail = Number(vb.available_qty) || 0;
        const take = Math.min(needed, avail);
        if (take > 0) {
          allocations.push({ supplier_id: vb.supplier_id, name: vb.sup_name, qty: take, price: Number(vb.price_per_unit) });
          winningSupplierIds.add(vb.supplier_id);
          itemBaseCost += take * Number(vb.price_per_unit);
          baseTotal += take * Number(vb.price_per_unit);
          needed -= take;
          fulfilled += take;
        }
      }

      const allItemBids = await env.DB.prepare(
        "SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.item_id = ?"
      ).bind(item.id).all();

      if (fulfilled > 0) {
        anyFulfilled = true;
        item.fulfilled_qty = fulfilled;

        const avgBaseUnit = itemBaseCost / fulfilled;
        const sellUnit = await calculateItemSellingUnit(env.DB, avgBaseUnit, order.margin_percent);
        const itemSellTotal = sellUnit * fulfilled;
        itemsSellSubtotal += itemSellTotal;

        await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, sup_qty = ?, allocated_json = ? WHERE id = ?")
          .bind(fulfilled, fulfilled, JSON.stringify(allocations), item.id).run();

        invoiceLines.push(
          `${idx + 1}. Brand: ${item.brand} ${item.model || ""}\n└ Part: ${item.part_name}\n└ Quality: ${item.variant || "Standard"}\n└ Qty: ${fulfilled} × Rs.${sellUnit} = Rs.${itemSellTotal}`
        );

        for (const b of (allItemBids.results || [])) {
          if (b.tg_msg_id && b.tg_chat_id && !winningSupplierIds.has(b.supplier_id)) {
            await tgCall(env.BOT_TOKEN_SUPPLIER, "deleteMessage", { chat_id: b.tg_chat_id, message_id: b.tg_msg_id });
          }
        }
      } else {
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
      await env.DB.prepare("UPDATE orders SET status = 'NO_BIDS', dispatch_stage = 'NEEDS_SOURCING_REVIEW' WHERE id = ?").bind(order.id).run();
      await sendLog(env, `ⓘ Order #${order.id} received NO BIDS. Ready for Out-of-Odisha Sourcing.`);
      continue;
    }

    const rawTotal = itemsSellSubtotal + Number(order.delivery_charge || 0);
    const roundStep = Number(await getSetting(env.DB, "rounding_step", "50")) || 1;
    const finalTotal = roundStep > 1 ? Math.ceil(rawTotal / roundStep) * roundStep : Math.round(rawTotal);
    const advPct = Number(await getSetting(env.DB, "advance_percent", "20")) || 20;
    const adv20 = Math.round(finalTotal * (advPct / 100));
    const bal80 = finalTotal - adv20;

    await env.DB.prepare(
      "UPDATE orders SET status = 'QUOTED', dispatch_stage = 'CONFIRMATION_PENDING', supplier_base_total = ?, final_total = ?, advance_20 = ?, balance_80 = ? WHERE id = ?"
    ).bind(baseTotal, finalTotal, adv20, bal80, order.id).run();

    const invoiceBox = `ORDER SUMMARY & INVOICE (#${order.id})\n━━━━━━━━━━━━━━━━━\n${invoiceLines.join("\n\n")}\n━━━━━━━━━━━━━━━━━\n→ Products Subtotal: Rs.${itemsSellSubtotal}\n→ Delivery Charges: Rs.${order.delivery_charge}\n★ Total Price: Rs.${finalTotal} (Delivery Included)\n→ ${advPct}% Advance: Rs.${adv20}\n└ ${100 - advPct}% After Packing Video: Rs.${bal80}`;

    await notifyCustomer(
      env, cust, invoiceBox,
      [[{ text: `[+] Accept & Pay ${advPct}% (Rs.${adv20})`, callback_data: `pay20_${order.id}` }]]
    );
  }
}

// ==========================================
// 13. ADMIN & DEDICATED STAFF PANELS REST API (ALL 14 CLIENT FILES SUPPORTED)
// ==========================================
async function handlePanelAPI(request, url, env, baseUrl) {
  const action = url.pathname.replace("/api/panel/", "");

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "Unknown IP";
  const ua = request.headers.get("user-agent") || "Unknown Device";
  const city = request.cf?.city || "Unknown City";
  const region = request.cf?.region || "";
  const country = request.cf?.country || "IN";

  if (action === "client-error" && request.method === "POST") {
    try {
      const errBody = await request.json();
      await sendLog(env, `★ FRONTEND UI ERROR\n━━━━━━━━━━━━━━━━━\n→ Page: ${errBody.page || "/a"}\n→ Error: ${errBody.message}\n→ Line: ${errBody.line || "?"}\n→ IP: ${ip}\n└ Device: ${ua.slice(0, 100)}`);
    } catch (_) {}
    return jsonRes({ ok: true });
  }

  // Public Order & 5-Stage Bus-Stand Timeline Tracker (/c)
  if (action === "track") {
    const id = Number(url.searchParams.get("order_id"));
    const order = await env.DB.prepare("SELECT id, master_id, status, dispatch_stage, hold_reason, final_total, advance_20, balance_80, tracking_id, created_at FROM orders WHERE id = ?").bind(id).first();
    const items = await env.DB.prepare("SELECT brand, model, part_name, variant, req_qty, fulfilled_qty FROM order_items WHERE order_id = ?").bind(id).all();
    return jsonRes({ ok: !!order, order, items: items.results || [] });
  }

  const phone = (request.headers.get("x-staff-phone") || "").trim();
  const token = (request.headers.get("x-staff-token") || "").trim();
  const isLoginAttempt = request.headers.get("x-login-attempt") === "1";

  let staff = null;
  const masterUser = String(env.ADMIN_USERNAME || "").trim();
  const masterPass = String(env.ADMIN_PASSWORD || "").trim();

  if (masterUser && masterPass && phone === masterUser && token === masterPass) {
    staff = { role: "admin", phone: masterUser, is_master: true };
  }
  if (!staff && phone && token) {
    staff = await env.DB.prepare(
      "SELECT * FROM staff_users WHERE phone = ? AND access_token = ? AND is_active = 1"
    ).bind(phone, token).first();
  }

  if (!staff) {
    if (isLoginAttempt) {
      await sendLog(
        env,
        `× FAILED PANEL LOGIN ATTEMPT\n━━━━━━━━━━━━━━━━━\n→ Entered User: ${phone || "Empty"}\n→ Entered Token: ${token ? token.slice(0, 4) + "***" : "Empty"}\n→ IP: ${ip} (${city}, ${region}, ${country})\n└ Device: ${ua.slice(0, 120)}`
      );
    }
    return jsonRes({ ok: false, error: "Invalid credentials! Check Username or ADP-Token." }, 401);
  }

  if (isLoginAttempt) {
    await sendLog(
      env,
      `★ STAFF PANEL LOGIN SUCCESS\n━━━━━━━━━━━━━━━━━\n→ User: ${staff.phone} (${staff.role.toUpperCase()})\n→ IP: ${ip} (${city}, ${region}, ${country})\n└ Device: ${ua.slice(0, 120)}`
    );
  }

  if (action === "dashboard") {
    const orders = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 80").all();
    const payments = await env.DB.prepare("SELECT * FROM payments ORDER BY id DESC LIMIT 50").all();
    const settings = await env.DB.prepare("SELECT * FROM settings").all();
    const suppliers = await env.DB.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
    const items = await env.DB.prepare("SELECT * FROM order_items ORDER BY id DESC LIMIT 150").all();
    const bids = await env.DB.prepare(
      `SELECT b.*, s.name as sup_name, i.brand, i.model, i.part_name, i.variant, i.req_qty
       FROM bids b
       LEFT JOIN suppliers s ON b.supplier_id = s.id
       LEFT JOIN order_items i ON b.item_id = i.id
       ORDER BY b.id DESC LIMIT 200`
    ).all();
    const customers = await env.DB.prepare("SELECT * FROM customers ORDER BY last_msg_at DESC LIMIT 60").all();
    const staffList = await env.DB.prepare("SELECT id, role, phone, access_token, is_active, created_at FROM staff_users ORDER BY id DESC").all();
    const marginRules = await env.DB.prepare("SELECT * FROM margin_rules ORDER BY min_price ASC").all();
    const inventory = await env.DB.prepare("SELECT * FROM inventory ORDER BY id ASC").all();
    const invLogs = await env.DB.prepare("SELECT * FROM inventory_logs ORDER BY id DESC LIMIT 80").all();
    const ghostQueries = await env.DB.prepare("SELECT * FROM ghost_queries ORDER BY id DESC LIMIT 30").all();

    return jsonRes({
      ok: true,
      role: staff.role,
      orders: orders.results || [],
      payments: payments.results || [],
      settings: settings.results || [],
      suppliers: suppliers.results || [],
      items: items.results || [],
      bids: bids.results || [],
      customers: customers.results || [],
      staff_list: staff.role === "admin" ? (staffList.results || []) : [],
      margin_rules: marginRules.results || [],
      inventory: inventory.results || [],
      inventory_logs: invLogs.results || [],
      ghost_queries: ghostQueries.results || []
    });
  }

  if (action === "save-settings" && request.method === "POST") {
    const body = await request.json();
    const stmts = Object.entries(body).map(([k, v]) =>
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(v))
    );
    if (stmts.length) await env.DB.batch(stmts);
    await sendLog(env, `★ Settings Updated by ${staff.phone} (${ip}):\n${JSON.stringify(body).slice(0, 300)}`);
    return jsonRes({ ok: true, msg: "Settings saved to live engine" });
  }

  if (action === "add-margin-rule" && request.method === "POST") {
    const { min_price, max_price, margin_type, margin_value } = await request.json();
    const minP = Number(min_price), maxP = Number(max_price), val = Number(margin_value);
    if (isNaN(minP) || isNaN(maxP) || minP > maxP || isNaN(val)) {
      return jsonRes({ ok: false, error: "Invalid price range or value" }, 400);
    }
    const overlap = await env.DB.prepare(
      "SELECT id, min_price, max_price FROM margin_rules WHERE NOT (max_price < ? OR min_price > ?)"
    ).bind(minP, maxP).first();
    if (overlap) {
      return jsonRes({ ok: false, error: `Overlaps with existing slab Rs.${overlap.min_price} - Rs.${overlap.max_price}` }, 400);
    }
    await env.DB.prepare(
      "INSERT INTO margin_rules (min_price, max_price, margin_type, margin_value) VALUES (?, ?, ?, ?)"
    ).bind(minP, maxP, margin_type === "FLAT" ? "FLAT" : "PERCENT", val).run();
    return jsonRes({ ok: true, msg: `Margin Slab Rs.${minP}-Rs.${maxP} added!` });
  }

  if (action === "delete-margin-rule" && request.method === "POST") {
    const { id } = await request.json();
    await env.DB.prepare("DELETE FROM margin_rules WHERE id = ?").bind(Number(id)).run();
    return jsonRes({ ok: true, msg: "Margin rule removed" });
  }

  // FILE 3: Category-Wise Bulk Price Multiplier
  if (action === "bulk-price-update" && request.method === "POST") {
    const { category, mode, value } = await request.json();
    const val = parseFloat(value);
    if (isNaN(val) || val === 0) return jsonRes({ ok: false, error: "Invalid multiplier value" }, 400);

    const allInv = await env.DB.prepare("SELECT * FROM inventory").all();
    const stmts = [];
    let count = 0;

    for (const it of (allInv.results || [])) {
      if (category === "All Categories" || it.category === category) {
        count++;
        const nextPrice = mode === "percentage" ? Math.round(it.price * (1 + val / 100)) : Math.round(it.price + val);
        stmts.push(env.DB.prepare("UPDATE inventory SET price = ? WHERE id = ?").bind(nextPrice, it.id));
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
    await sendLog(env, `★ Bulk Price Multiplier: Updated ${count} items in "${category}" (${mode}: +${val})`);
    return jsonRes({ ok: true, msg: `Updated prices for ${count} items in ${category}!` });
  }

  // FILE 10 & 12: Add/Deduct Stock or Commit DOA Receiving with Audit Log
  if (action === "adjust-stock" && request.method === "POST") {
    const { sku, name, category, price, in_house_cost, good_delta, faulty_delta, trigger_reason } = await request.json();
    let existing = await env.DB.prepare("SELECT * FROM inventory WHERE sku = ? OR name = ?").bind(sku || "", name || "").first();
    const gDelta = parseInt(good_delta || 0, 10);
    const fDelta = parseInt(faulty_delta || 0, 10);

    if (existing) {
      const oldGood = Number(existing.good_qty || 0);
      const newGood = Math.max(0, oldGood + gDelta);
      const newFaulty = Math.max(0, Number(existing.faulty_qty || 0) + fDelta);
      await env.DB.prepare("UPDATE inventory SET good_qty = ?, faulty_qty = ?, updated_at = strftime('%s','now') WHERE id = ?")
        .bind(newGood, newFaulty, existing.id).run();
      if (gDelta !== 0) {
        await env.DB.prepare(
          "INSERT INTO inventory_logs (item_name, action, qty, old_stock, new_stock, triggered_by) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(existing.name, gDelta > 0 ? "ADD" : "DEDUCT", Math.abs(gDelta), oldGood, newGood, trigger_reason || `Admin (${staff.phone})`).run();
      }
    } else {
      const newSku = sku || ("SKU-" + Math.floor(100 + Math.random() * 900));
      await env.DB.prepare(
        "INSERT INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(newSku, name, category || "Displays", Number(price || 1000), Number(in_house_cost || 750), Math.max(0, gDelta), Math.max(0, fDelta)).run();
      await env.DB.prepare(
        "INSERT INTO inventory_logs (item_name, action, qty, old_stock, new_stock, triggered_by) VALUES (?, 'ADD', ?, 0, ?, ?)"
      ).bind(name, Math.max(0, gDelta), Math.max(0, gDelta), trigger_reason || `Admin (${staff.phone})`).run();
    }
    return jsonRes({ ok: true, msg: "Inventory & Audit Log updated!" });
  }

  // FILE 1, 4 & 5: Barcode Scan & 4-Stage Physical Hub / Bus-Stand Update + QC Pass/Hold
  if (action === "scan-stage" && request.method === "POST") {
    const { order_id, stage, hold_reason } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(Number(order_id)).first();
    if (!order) return jsonRes({ ok: false, error: "Order #" + order_id + " not found!" }, 404);

    let nextStatus = order.status;
    if (stage === "ON_HOLD") nextStatus = "ON_HOLD";
    else if (stage === "QC_PASSED") nextStatus = "PACKING";
    else if (stage === "BUS_STAND_DROPPED") nextStatus = "SHIPPED";

    await env.DB.prepare("UPDATE orders SET dispatch_stage = ?, status = ?, hold_reason = ? WHERE id = ?")
      .bind(stage, nextStatus, hold_reason || null, order.id).run();

    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    if (cust) {
      const stageLabels = {
        COLLECTION_DONE: "★ Collection Complete: Items picked up and arrived at Checking Hub.",
        QC_PASSED: "★ 100% Quality Check Passed: Your order is now at the Packing Station.",
        ON_HOLD: `ⓘ QC Hold Alert: ${hold_reason || "Replacement item being re-collected for quality assurance."}`,
        DISPATCH_HANDOVER: "★ Handed to Dispatch Team: Parcel is on the way to the Bus Stand / Courier Hub.",
        BUS_STAND_DROPPED: "★ Parcel Dropped at Bus Stand / Courier Hub! Final transit started."
      };
      if (stageLabels[stage]) {
        await notifyCustomer(env, cust, `Order #${order.id} Update\n━━━━━━━━━━━━━━━━━\n${stageLabels[stage]}`);
      }
    }
    return jsonRes({ ok: true, msg: `Order #${order.id} updated to ${stage}` });
  }

  // FILE 6: Missing Odisha Stock -> Option A (Available Only) vs Option B (Outsource Delhi/Mumbai/Kolkata/Raigarh)
  if (action === "outsource-options" && request.method === "POST") {
    const { order_id, mode, region } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(Number(order_id)).first();
    if (!order) return jsonRes({ ok: false, error: "Order not found" }, 404);
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(order.id).all();

    if (mode === "ask_customer" && cust) {
      const found = (items.results || []).filter(i => i.fulfilled_qty > 0).map(i => `• ${i.fulfilled_qty}x ${i.brand} ${i.part_name}`).join("\n") || "None";
      const missing = (items.results || []).filter(i => i.fulfilled_qty < i.req_qty).map(i => `• ${i.req_qty - i.fulfilled_qty}x ${i.brand} ${i.part_name}`).join("\n") || "Partial items";

      const msgTxt = `★ Stock Availability Update — Order #${order.id}\n━━━━━━━━━━━━━━━━━\nWe have secured in Odisha:\n${found}\n\nCurrently out of stock locally:\n${missing}\n━━━━━━━━━━━━━━━━━\n[?] How would you like to proceed?\nOption A: Proceed with available items only.\nOption B: Source missing items from outside Odisha (Delhi / Mumbai / Kolkata / Raigarh).`;
      await notifyCustomer(env, cust, msgTxt, [
        [{ text: "Option A: Available Only", callback_data: `optA_${order.id}` }],
        [{ text: "Option B: Outsource Missing", callback_data: `optB_${order.id}` }]
      ]);
      return jsonRes({ ok: true, msg: "Option A / Option B sent to customer on " + cust.platform.toUpperCase() });
    }

    if (mode === "broadcast_region") {
      await env.DB.prepare("UPDATE orders SET outsource_region = ?, status = 'BIDDING', bidding_ends_at = ? WHERE id = ?")
        .bind(region || "Delhi", Math.floor(Date.now() / 1000) + 1800, order.id).run();
      await sendLog(env, `★ Order #${order.id} outsourced to ${region} suppliers.`);
      return jsonRes({ ok: true, msg: `Broadcasted missing items for #${order.id} to ${region} suppliers!` });
    }
  }

  // FILE 8: Manual Force Follow-Up Pin (7-Day Column Override)
  if (action === "force-followup" && request.method === "POST") {
    const { order_id } = await request.json();
    await env.DB.prepare("UPDATE orders SET force_followup = 1 WHERE id = ?").bind(Number(order_id)).run();
    return jsonRes({ ok: true, msg: `Order #${order_id} pinned to 1st Follow-Up (7 Days)!` });
  }

  // FILE 13: Dual-Mode Demo / Ghost Query Injector
  if (action === "inject-query" && request.method === "POST") {
    const { mode, item_name, qty, note } = await request.json();
    await env.DB.prepare("INSERT INTO ghost_queries (mode, item_name, qty, note, status) VALUES (?, ?, ?, ?, ?)")
      .bind(mode, item_name, Number(qty || 1), note || "", mode === "direct" ? "POLLED" : "PIGGYBACK_QUEUED").run();

    if (mode === "direct") {
      const sups = await env.DB.prepare("SELECT * FROM suppliers WHERE is_verified = 1 AND is_active = 1").all();
      for (const s of (sups.results || [])) {
        if (s.tg_chat_id) {
          await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
            chat_id: s.tg_chat_id,
            text: `★ Market Rate Check\n━━━━━━━━━━━━━━━━━\n→ Item: ${item_name}\n└ Spec: ${note || "Standard"}\n└ Qty: ${qty} Pieces\n━━━━━━━━━━━━━━━━━`,
            reply_markup: { inline_keyboard: [[{ text: "☞ Continue to Panel", url: `${baseUrl}/s?code=${s.verify_code}` }]] }
          });
        }
      }
    }
    return jsonRes({ ok: true, msg: mode === "direct" ? "Direct Market Poll broadcasted to suppliers!" : "Ghost Order queued to piggyback on next live customer request!" });
  }

  if (action === "assign-supplier" && request.method === "POST") {
    const { order_id, supplier_id, unit_price } = await request.json();
    return jsonRes(await adminAssignSupplierToOrder(env, Number(order_id), Number(supplier_id), Number(unit_price || 0)));
  }

  if (action === "force-close" && request.method === "POST") {
    const { order_id } = await request.json();
    if (order_id) {
      await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0 WHERE id = ?").bind(Number(order_id)).run();
    } else {
      await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0 WHERE status = 'BIDDING'").run();
    }
    await runAutomatedEngine(env);
    return jsonRes({ ok: true, msg: "Bidding closed & itemized invoice dispatched!" });
  }

  if (action === "extend-window" && request.method === "POST") {
    const { order_id, mins } = await request.json();
    const addSec = (Number(mins) || 10) * 60;
    await env.DB.prepare("UPDATE orders SET bidding_ends_at = bidding_ends_at + ? WHERE id = ?").bind(addSec, Number(order_id)).run();
    return jsonRes({ ok: true, msg: `Window extended by ${mins || 10}m` });
  }

  if (action === "payment-action" && request.method === "POST") {
    const { payment_id, decision } = await request.json();
    return jsonRes(await processPaymentDecision(env, Number(payment_id), decision, "Dashboard"));
  }

  if (action === "ship-order" && request.method === "POST") {
    const { order_id, tracking_id } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(order_id).first();
    if (!order) return jsonRes({ ok: false, error: "Order not found" });
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    await env.DB.prepare("UPDATE orders SET status = 'SHIPPED', dispatch_stage = 'OUT_FOR_DELIVERY', tracking_id = ? WHERE id = ?").bind(tracking_id, order_id).run();
    if (cust) await notifyCustomer(env, cust, `★ Order #${order_id} Dispatched\n━━━━━━━━━━━━━━━━━\n→ Tracking ID: ${tracking_id}`);
    return jsonRes({ ok: true, msg: `Order #${order_id} shipped!` });
  }

  if (action === "add-supplier" && request.method === "POST") {
    const { name, phone, region } = await request.json();
    const code = "SUP" + Math.random().toString(36).substring(2, 7).toUpperCase();
    await env.DB.prepare("INSERT INTO suppliers (name, phone, region, verify_code) VALUES (?, ?, ?, ?)").bind(name || "Supplier", phone || "", region || "Odisha", code).run();
    return jsonRes({ ok: true, code, msg: `Supplier added! Link: ${baseUrl}/s?code=${code}` });
  }

  if (action === "add-staff" && request.method === "POST") {
    const { role, phone } = await request.json();
    const tok = "ADP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await env.DB.prepare("INSERT INTO staff_users (role, phone, access_token) VALUES (?, ?, ?)").bind(role, phone, tok).run();
    return jsonRes({ ok: true, token: tok, msg: `Staff added! Token: ${tok}` });
  }

  if (action === "delete-staff" && request.method === "POST") {
    const { id } = await request.json();
    await env.DB.prepare("DELETE FROM staff_users WHERE id = ?").bind(Number(id)).run();
    return jsonRes({ ok: true, msg: "Staff user deleted" });
  }

  if (action === "send-chat" && request.method === "POST") {
    const { customer_id, text } = await request.json();
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customer_id).first();
    if (!cust) return jsonRes({ ok: false, error: "Customer not found" });
    await notifyCustomer(env, cust, `★ AD PARTSOL Support\n━━━━━━━━━━━━━━━━━\n${text}`);
    return jsonRes({ ok: true, msg: "Message sent to customer!" });
  }

  return jsonRes({ ok: false, error: "Unknown endpoint" }, 404);
}

// ==========================================
// 14. DATABASE INITIALIZER & SCHEMA MIGRATIONS
// ==========================================
async function initDB(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tg_enabled', '1'), ('wa_enabled', '1'), ('ai_enabled', '1'), ('margin_percent', '20'), ('delivery_charge', '100'), ('rounding_step', '50'), ('advance_percent', '20'), ('auto_flag_mins', '120'), ('rush_window_sec', '60'), ('allocation_logic', 'cheapest')"),
    DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('upi_id', 'constantabrar@upi')"),
    DB.prepare("CREATE TABLE IF NOT EXISTS margin_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, min_price REAL NOT NULL, max_price REAL NOT NULL, margin_type TEXT NOT NULL, margin_value REAL NOT NULL, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, platform TEXT NOT NULL, chat_id TEXT NOT NULL, lang TEXT DEFAULT 'hinglish', full_name TEXT, phone TEXT, address TEXT, state TEXT DEFAULT 'IDLE', temp_data TEXT, fraud_strikes INTEGER DEFAULT 0, banned_until INTEGER DEFAULT 0, last_msg_at INTEGER DEFAULT 0, warned_22h INTEGER DEFAULT 0, force_followup INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_chat_id TEXT UNIQUE, name TEXT, phone TEXT, region TEXT DEFAULT 'Odisha', verify_code TEXT UNIQUE, is_verified INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, avg_resp_sec INTEGER DEFAULT 45, orders_freq INTEGER DEFAULT 1, current_bid_item_id INTEGER, bid_step TEXT, bid_started_at INTEGER DEFAULT 0, last_panel_msg_id INTEGER, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS staff_users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, phone TEXT NOT NULL, access_token TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, master_id TEXT, status TEXT DEFAULT 'BIDDING', dispatch_stage TEXT DEFAULT 'ORDER_RECEIVED', hold_reason TEXT, outsource_region TEXT, supplier_base_total REAL DEFAULT 0, margin_percent REAL DEFAULT 20, delivery_charge REAL DEFAULT 100, final_total REAL DEFAULT 0, advance_20 REAL DEFAULT 0, balance_80 REAL DEFAULT 0, packing_video_file_id TEXT, vault_msg_id TEXT, tracking_id TEXT, force_followup INTEGER DEFAULT 0, bidding_ends_at INTEGER NOT NULL, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, brand TEXT, model TEXT, part_name TEXT, variant TEXT DEFAULT 'Standard', req_qty INTEGER NOT NULL, fulfilled_qty INTEGER DEFAULT 0, inv_qty INTEGER DEFAULT 0, sup_qty INTEGER DEFAULT 0, qc_status TEXT DEFAULT 'PENDING', allocated_json TEXT)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, price_per_unit REAL, available_qty INTEGER, response_sec INTEGER DEFAULT 35, tg_msg_id INTEGER, status TEXT DEFAULT 'PENDING', created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, customer_id TEXT NOT NULL, type TEXT NOT NULL, expected_amount REAL NOT NULL, extracted_utr TEXT UNIQUE, extracted_amount REAL, file_id_or_url TEXT, status TEXT DEFAULT 'PENDING', tg_group_msg_id INTEGER, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT NOT NULL, category TEXT DEFAULT 'Displays', price REAL DEFAULT 0, in_house_cost REAL DEFAULT 0, good_qty INTEGER DEFAULT 0, faulty_qty INTEGER DEFAULT 0, daily_freq REAL DEFAULT 1.5, days_unsold INTEGER DEFAULT 5, updated_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS inventory_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL, action TEXT NOT NULL, qty INTEGER NOT NULL, old_stock INTEGER NOT NULL, new_stock INTEGER NOT NULL, triggered_by TEXT NOT NULL, raw_date TEXT DEFAULT (date('now')), created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS ghost_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, item_name TEXT NOT NULL, qty INTEGER DEFAULT 1, note TEXT, status TEXT DEFAULT 'WAITING', min_quote REAL DEFAULT 0, max_quote REAL DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))")
  ]);

  const invCount = await DB.prepare("SELECT COUNT(*) as c FROM inventory").first();
  if (!invCount || invCount.c === 0) {
    await DB.batch([
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-A13-D', 'iPhone 13 OLED Display (Original)', 'Displays', 4200, 3600, 12, 1, 4.2, 8)"),
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-S22-B', 'Samsung S22 Ultra Battery OEM', 'Batteries', 1150, 820, 18, 0, 3.1, 14)"),
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-OP9-C', 'OnePlus 9 Pro Charging Board', 'Charging Ports', 450, 240, 30, 2, 2.5, 6)"),
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-I6S-B', 'iPhone 6s Battery Replacement', 'Batteries', 400, 280, 45, 0, 0.1, 210)"),
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-RN4-D', 'Redmi Note 4 Display Combo', 'Displays', 800, 550, 14, 1, 0.2, 145)"),
      DB.prepare("INSERT OR IGNORE INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty, daily_freq, days_unsold) VALUES ('SKU-T7000', 'Mechanic T7000 OCA Glue (50g)', 'Tools & Glue', 150, 85, 60, 0, 5.0, 3)"),
      DB.prepare("INSERT OR IGNORE INTO inventory_logs (item_name, action, qty, old_stock, new_stock, triggered_by) VALUES ('iPhone 13 OLED Display (Original)', 'ADD', 12, 0, 12, 'Admin (Initial Stock Seed)')")
    ]);
  }

  // Safe migrations for existing D1 tables
  const migrations = [
    "ALTER TABLE suppliers ADD COLUMN last_panel_msg_id INTEGER",
    "ALTER TABLE suppliers ADD COLUMN region TEXT DEFAULT 'Odisha'",
    "ALTER TABLE suppliers ADD COLUMN avg_resp_sec INTEGER DEFAULT 45",
    "ALTER TABLE suppliers ADD COLUMN orders_freq INTEGER DEFAULT 1",
    "ALTER TABLE orders ADD COLUMN master_id TEXT",
    "ALTER TABLE orders ADD COLUMN dispatch_stage TEXT DEFAULT 'ORDER_RECEIVED'",
    "ALTER TABLE orders ADD COLUMN hold_reason TEXT",
    "ALTER TABLE orders ADD COLUMN outsource_region TEXT",
    "ALTER TABLE orders ADD COLUMN force_followup INTEGER DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN inv_qty INTEGER DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN sup_qty INTEGER DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN qc_status TEXT DEFAULT 'PENDING'",
    "ALTER TABLE bids ADD COLUMN response_sec INTEGER DEFAULT 35"
  ];
  for (const m of migrations) {
    try { await DB.prepare(m).run(); } catch (_) {}
  }
}
