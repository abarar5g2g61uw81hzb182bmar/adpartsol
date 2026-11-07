import { jsonRes, sendLog, getSetting, parseSessionMemory, calculateItemSellingUnit, formatSummaryBox, formatSupplierCard } from "./db.js";
import { tgCall, notifyCustomer, applyFraudStrike, showCombinedFinalConfirmation } from "./telegram.js";
import { sendWhatsAppNativeFlow } from "./whatsapp.js";

export async function launchOrderBidding(env, cust, editMsgId = null, baseUrl = "https://adpartsol.storzen.io") {
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

  const ghostList = await env.DB.prepare("SELECT * FROM ghost_queries WHERE status = 'PIGGYBACK_QUEUED'").all();
  const broadcastItems = [...items];
  for (const g of (ghostList.results || [])) {
    broadcastItems.push({
      brand: g.item_name, model: "", part_name: g.note || "Market Check", variant: "Original", qty: g.qty || 1, is_ghost: true, ghost_id: g.id
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
          chat_id: sup.tg_chat_id, message_id: sup.last_panel_msg_id, reply_markup: { inline_keyboard: [] }
        });
      }

      const panelLink = `${baseUrl}/s?code=${encodeURIComponent(sup.verify_code)}`;
      const msgRes = await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", {
        chat_id: sup.tg_chat_id,
        text: cardText,
        reply_markup: { inline_keyboard: [[{ text: "☞ Continue to Panel", url: panelLink }]] }
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
  await sendLog(env, `★ Order Request #${orderId} (${masterId}) launched (${items.length} items).`);
}

export async function handleSupplierBot(update, env, baseUrl) {
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

export async function handleSupplierPortalAPI(request, url, env) {
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

  return jsonRes({ ok: false, error: "Unknown action" }, 404);
}

export async function handleCustomerPortalAPI(request, url, env, baseUrl) {
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
          reply_markup: { inline_keyboard: [[{ text: "☞ Open Product Order Form", url: orderFormUrl }]] }
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
      [{ text: "[+] Confirm", callback_data: "req_continue" }, { text: "[+] Add More", callback_data: "req_add_more" }],
      [{ text: "[✎] Edit", callback_data: "req_edit" }, { text: "[×] Cancel", callback_data: "req_cancel" }]
    ];
    await notifyCustomer(env, cust, summaryBox, actionButtons);
    return jsonRes({ ok: true });
  }

  return jsonRes({ ok: false, error: "Unknown customer endpoint" }, 404);
}

export async function handlePaymentBot(update, env) {
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

export async function processPaymentDecision(env, payId, decision, source = "Web Panel") {
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
      reply_markup: { inline_keyboard: [[{ text: "■ View Items & Collect", callback_data: `packview_${order.id}` }]] }
    });
  } else if (pay.type === "BALANCE_80") {
    await env.DB.prepare("UPDATE orders SET status = 'READY_TO_SHIP', dispatch_stage = 'OUT_FOR_BUS_STAND' WHERE id = ?").bind(order.id).run();
    await notifyCustomer(env, cust, `★ 80% Balance Verified — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Your parcel is being handed over to the courier / Bus Stand dispatch. Tracking ID will be shared shortly.`);

    await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", {
      chat_id: env.PACKING_GROUP_ID,
      text: `★ 80% Balance Cleared — Order #${order.id}\n━━━━━━━━━━━━━━━━━\n☞ Dispatch the parcel and enter Tracking ID:`,
      reply_markup: { inline_keyboard: [[{ text: "[+] Ship Now (Enter Tracking ID)", callback_data: `shipnow_${order.id}` }]] }
    });
  }
  await sendLog(env, `★ Payment #${payId} (${pay.type}) for Order #${order.id} ${decision} via ${source}`);
  return { ok: true };
}

export async function handleDeliveryBot(update, env) {
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
        reply_markup: { inline_keyboard: [[{ text: "[+] Upload Packing Video", callback_data: `packvid_${orderId}` }]] }
      });
    }

    if (act === "packvid") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_video_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", { chat_id: cb.message.chat.id, text: `☞ Send the Packing Video for Order #${orderId} in this group now:` });
    }

    if (act === "shipnow") {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_ship_order', ?)").bind(String(orderId)).run();
      return await tgCall(env.BOT_TOKEN_DELIVERY, "sendMessage", { chat_id: cb.message.chat.id, text: `☞ Enter the Final Tracking ID for Order #${orderId}:` });
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
      chat_id: msg.chat.id, text: `★ Order #${activeOrdId} video backed up to Vault and 80% QR sent to customer.`
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

export async function handleAdminBot(update, env, baseUrl) {
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
    if (!type || !flowId) return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage:\n/setflow setup <FLOW_ID>\n/setflow order <FLOW_ID>" });
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
    if (!role || !phone) return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text: "Usage: /addstaff <admin|payment|packing|collection|hub|dispatch|delivery> <phone>" });
    const token = "ADP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await env.DB.prepare("INSERT INTO staff_users (role, phone, access_token) VALUES (?, ?, ?)").bind(role.toLowerCase(), phone, token).run();
    return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", {
      chat_id: chatId,
      text: `★ Staff Web Panel Credentials\n→ Role: ${role.toUpperCase()}\n└ Phone: ${phone}\n└ Token: ${token}`
    });
  }
}

export async function adminAssignSupplierToOrder(env, orderId, supplierId, manualUnitPrice = 0) {
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

    invoiceLines.push(`${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.req_qty} × Rs.${sellUnit} = Rs.${lineTotal}`);

    if (sup.tg_chat_id) {
      const notice = formatSupplierCard(`★ Direct Order Assigned by AD PARTSOL (#${orderId})`, it, `→ Agreed Rate: Rs.${unitP}/pc\nⓘ Keep items ready for AD PARTSOL pickup.`);
      await tgCall(env.BOT_TOKEN_SUPPLIER, "sendMessage", { chat_id: sup.tg_chat_id, text: notice });
    }
  }

  const allBids = await env.DB.prepare("SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.order_id = ?").bind(orderId).all();
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
    await notifyCustomer(env, cust, invoiceTxt, [[{ text: `[+] Accept & Pay ${advPct}% (Rs.${adv20})`, callback_data: `pay20_${orderId}` }]]);
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

  if (editMsgId) return await tgCall(env.BOT_TOKEN_ADMIN, "editMessageText", { chat_id: chatId, message_id: editMsgId, text, reply_markup });
  return await tgCall(env.BOT_TOKEN_ADMIN, "sendMessage", { chat_id: chatId, text, reply_markup });
}

export async function runAutomatedEngine(env) {
  const now = Math.floor(Date.now() / 1000);
  const allocLogic = await getSetting(env.DB, "allocation_logic", "cheapest");

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

      const allItemBids = await env.DB.prepare("SELECT b.*, s.tg_chat_id FROM bids b JOIN suppliers s ON b.supplier_id = s.id WHERE b.item_id = ?").bind(item.id).all();

      if (fulfilled > 0) {
        anyFulfilled = true;
        item.fulfilled_qty = fulfilled;

        const avgBaseUnit = itemBaseCost / fulfilled;
        const sellUnit = await calculateItemSellingUnit(env.DB, avgBaseUnit, order.margin_percent);
        const itemSellTotal = sellUnit * fulfilled;
        itemsSellSubtotal += itemSellTotal;

        await env.DB.prepare("UPDATE order_items SET fulfilled_qty = ?, sup_qty = ?, allocated_json = ? WHERE id = ?")
          .bind(fulfilled, fulfilled, JSON.stringify(allocations), item.id).run();

        invoiceLines.push(`${idx + 1}. Brand: ${item.brand} ${item.model || ""}\n└ Part: ${item.part_name}\n└ Quality: ${item.variant || "Standard"}\n└ Qty: ${fulfilled} × Rs.${sellUnit} = Rs.${itemSellTotal}`);

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
              chat_id: b.tg_chat_id, message_id: b.tg_msg_id, text: expiredCard, reply_markup: { inline_keyboard: [] }
            });
          }
        }
      }
    }

    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();

    if (!anyFulfilled) {
      await env.DB.prepare("UPDATE orders SET status = 'NO_BIDS', dispatch_stage = 'NEEDS_SOURCING_REVIEW' WHERE id = ?").bind(order.id).run();
      await sendLog(env, `ⓘ Order #${order.id} received NO BIDS.`);
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

    await notifyCustomer(env, cust, invoiceBox, [[{ text: `[+] Accept & Pay ${advPct}% (Rs.${adv20})`, callback_data: `pay20_${order.id}` }]]);
  }
}
