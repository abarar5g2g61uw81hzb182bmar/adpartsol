import { getSetting, sendLog, parseSessionMemory, formatSummaryBox, GREETING_TEMPLATES, LANG_GREETINGS, FORGET_RESET_PHRASE, resolveActiveCustomer, forgetAndResetCustomer, migrateCustomersSchema } from "./db.js";
import { analyzeCustomerRequirement, extractCustomerProfileAI, analyzePaymentScreenshot, transcribeVoice } from "./ai.js";
import { sendWhatsAppNativeFlow } from "./whatsapp.js";
import { handleSupplierBot, handlePaymentBot, handleDeliveryBot, handleAdminBot, launchOrderBidding, runAutomatedEngine } from "./supplier_staff.js";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function tgCall(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export async function setTgWebhook(token, url) {
  if (!token) return "Missing token";
  return await tgCall(token, "setWebhook", { url });
}

export async function getTgFileUrl(token, fileId) {
  const info = await tgCall(token, "getFile", { file_id: fileId });
  if (!info.ok) return null;
  return `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
}

export async function startTgTypingLoader(token, chatId) {
  const res = await tgCall(token, "sendMessage", { chat_id: chatId, text: "T" });
  if (!res.ok) return null;
  const msgId = res.result.message_id;
  for (const frame of ["Typ", "Typing", "Typing...", "Typing.."]) {
    await sleep(150);
    await tgCall(token, "editMessageText", { chat_id: chatId, message_id: msgId, text: frame });
  }
  return msgId;
}

export async function notifyCustomer(env, customer, text, buttons = null, photoUrl = null, videoFileId = null, editMsgId = null) {
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

export async function handleTelegramUpdate(botType, update, env, baseUrl) {
  try {
    if (botType === "customer") return await handleCustomerBot(update, env, baseUrl);
    if (botType === "supplier") return await handleSupplierBot(update, env, baseUrl);
    if (botType === "payment") return await handlePaymentBot(update, env);
    if (botType === "delivery") return await handleDeliveryBot(update, env);
    if (botType === "admin") return await handleAdminBot(update, env, baseUrl);
  } catch (err) {
    await sendLog(env, `★ TG HANDLER ERROR [${botType}]\n${err.message || err}`);
  }
}

export async function handleCustomerBot(update, env, baseUrl) {
  const tgEnabled = await getSetting(env.DB, "tg_enabled", "1");
  if (tgEnabled !== "1") return;

  const msg = update.message;
  const cb = update.callback_query;
  const chatId = String(msg ? msg.chat.id : cb.message.chat.id);
  const now = Math.floor(Date.now() / 1000);
  await migrateCustomersSchema(env.DB);

  let cust = await resolveActiveCustomer(env.DB, "telegram", chatId);
  const isNew = !cust;
  if (isNew) {
    const custId = `tg_${chatId}`;
    await env.DB.prepare(
      "INSERT INTO customers (id, platform, chat_id, lang, last_msg_at, state, account_root, reset_count, deleted_at) VALUES (?, 'telegram', ?, NULL, ?, 'AWAITING_REQ', ?, 0, 0)"
    ).bind(custId, chatId, now, chatId).run();
    cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(custId).first();
  } else {
    await env.DB.prepare("UPDATE customers SET last_msg_at = ?, warned_22h = 0 WHERE id = ?").bind(now, cust.id).run();
  }

  if (cust.banned_until > now) return;

  if (cb) {
    await tgCall(env.BOT_TOKEN_CUSTOMER, "answerCallbackQuery", { callback_query_id: cb.id });
    return await processCustomerAction(env, cust, cb.data, cb.message.message_id, baseUrl);
  }

  const text = (msg.text || msg.caption || "").trim();

  if (text === FORGET_RESET_PHRASE) {
    const fresh = await forgetAndResetCustomer(env, cust);
    const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
    return await notifyCustomer(
      env, fresh,
      `★ Account reset complete.\n━━━━━━━━━━━━━━━━━\n→ Old ID archived as DELETED\n→ New Partner ID: ${fresh.id}\n━━━━━━━━━━━━━━━━━\n${greet}\n☞ Select language or fill Shop Setup to begin again:`,
      [[
        { text: "■ English", callback_data: "lang_english" },
        { text: "■ Hindi", callback_data: "lang_hindi" },
        { text: "■ Hinglish", callback_data: "lang_hinglish" }
      ]]
    );
  }

  const cleanWord = text.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const isGreeting = ["start", "hi", "hello", "hey"].includes(cleanWord);

  if (text === "/start" || isGreeting || !cust.lang) {
    const greet = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
    const setupFormUrl = `${baseUrl}/c?mode=setup&cid=${encodeURIComponent(cust.id)}`;
    const orderFormUrl = `${baseUrl}/c?mode=order&cid=${encodeURIComponent(cust.id)}`;

    if (!cust.full_name || !cust.phone || !cust.address) {
      return await tgCall(env.BOT_TOKEN_CUSTOMER, "sendMessage", {
        chat_id: chatId,
        text: `${greet}\n━━━━━━━━━━━━━━━━━\n☞ Tap the button below to complete your 10-second Shop Setup, or select your language:`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "☞ Fill Shop Setup Form", url: setupFormUrl }],
            [{ text: "■ English", callback_data: "lang_english" }, { text: "■ Hindi", callback_data: "lang_hindi" }],
            [{ text: "■ Hinglish", callback_data: "lang_hinglish" }, { text: "■ Odia", callback_data: "lang_odia" }],
            [{ text: "■ Odia + English", callback_data: "lang_odia_eng" }]
          ]
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

export async function processCustomerAction(env, cust, data, msgId = null, baseUrl = "https://adpartsol.storzen.io") {
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

  if (data === "final_launch") return await launchOrderBidding(env, cust, msgId, baseUrl);

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

export async function showCombinedFinalConfirmation(env, cust, editMsgId = null, baseUrl = "") {
  const mem = parseSessionMemory(cust.temp_data);
  const items = mem.items || [];
  if (!items.length) return await launchOrderBidding(env, cust, editMsgId, baseUrl);

  const lines = items.map((it, idx) =>
    `${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.qty}`
  ).join("\n\n");

  const report = `★ FINAL ORDER & DELIVERY CONFIRMATION\n━━━━━━━━━━━━━━━━━\n→ Name: ${cust.full_name}\n→ Phone: ${cust.phone}\n└ Address: ${cust.address}\n━━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━━\n[?] Confirm all details to submit order request?`;
  const btns = [
    [{ text: "[+] Submit Order Request", callback_data: "final_launch" }],
    [{ text: "[✎] Edit Products", callback_data: "req_edit" }, { text: "[✎] Edit Address", callback_data: "edit_profile" }]
  ];
  return await notifyCustomer(env, cust, report, btns, null, null, editMsgId);
}

export async function processCustomerInput(env, cust, text, mediaUrl, baseUrl = "https://adpartsol.storzen.io") {
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

  if (cust.state === "AWAITING_PROFILE") {
    let loaderMsgId = null;
    if (cust.platform === "telegram") loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);

    const mem = parseSessionMemory(cust.temp_data);
    const prevProf = mem.draft_profile || { name: cust.full_name || "", phone: cust.phone || "", address: cust.address || "" };

    const prof = await extractCustomerProfileAI(env, text, cust.lang || "hinglish", prevProf);
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

  if (cust.state.startsWith("AWAITING_20_SS_") || cust.state.startsWith("AWAITING_80_SS_")) {
    const is20 = cust.state.startsWith("AWAITING_20_SS_");
    const orderId = Number(cust.state.split("_").pop());
    if (!mediaUrl) return await notifyCustomer(env, cust, "ⓘ Please upload a clear screenshot/photo of your payment.");

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

  let loaderMsgId = null;
  if (cust.platform === "telegram") loaderMsgId = await startTgTypingLoader(env.BOT_TOKEN_CUSTOMER, cust.chat_id);

  const mem = parseSessionMemory(cust.temp_data);
  if (text) mem.history.push({ r: "Customer", t: text.slice(0, 160) });

  const parsed = await analyzeCustomerRequirement(env, text, mediaUrl, cust.lang || "hinglish", mem);

  let langSwitchButtons = [];
  if (cust.lang && parsed.detected_other_lang && parsed.detected_other_lang !== cust.lang) {
    const shortLang = parsed.detected_other_lang.toUpperCase().slice(0, 8);
    langSwitchButtons.push([{ text: `Switch to ${shortLang}`, callback_data: `switchlang_${parsed.detected_other_lang}` }]);
  }

  if (parsed.items && parsed.items.length > 0) mem.items = parsed.items;

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
    [{ text: "[+] Confirm", callback_data: "req_continue" }, { text: "[+] Add More", callback_data: "req_add_more" }],
    [{ text: "[✎] Edit", callback_data: "req_edit" }, { text: "[×] Cancel", callback_data: "req_cancel" }],
    ...langSwitchButtons
  ];

  await notifyCustomer(env, cust, summaryBox, actionButtons, null, null, loaderMsgId);
}

export async function applyFraudStrike(env, cust, reason, editMsgId = null) {
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
