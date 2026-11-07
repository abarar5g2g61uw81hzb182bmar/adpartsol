import { jsonRes, sendLog } from "./db.js";
import { tgCall, notifyCustomer } from "./telegram.js";
import { adminAssignSupplierToOrder, processPaymentDecision, runAutomatedEngine } from "./supplier_staff.js";

export async function handlePanelAPI(request, url, env, baseUrl) {
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
    staff = await env.DB.prepare("SELECT * FROM staff_users WHERE phone = ? AND access_token = ? AND is_active = 1").bind(phone, token).first();
  }

  if (!staff) {
    if (isLoginAttempt) {
      await sendLog(env, `× FAILED PANEL LOGIN ATTEMPT\n━━━━━━━━━━━━━━━━━\n→ User: ${phone || "Empty"}\n→ IP: ${ip} (${city}, ${region}, ${country})\n└ Device: ${ua.slice(0, 120)}`);
    }
    return jsonRes({ ok: false, error: "Invalid credentials! Check Username or ADP-Token." }, 401);
  }

  if (isLoginAttempt) {
    await sendLog(env, `★ STAFF PANEL LOGIN SUCCESS\n━━━━━━━━━━━━━━━━━\n→ User: ${staff.phone} (${staff.role.toUpperCase()})\n→ IP: ${ip} (${city}, ${region}, ${country})\n└ Device: ${ua.slice(0, 120)}`);
  }

  if (action === "dashboard") {
    const orders = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 80").all();
    const payments = await env.DB.prepare("SELECT * FROM payments ORDER BY id DESC LIMIT 50").all();
    const settings = await env.DB.prepare("SELECT * FROM settings").all();
    const suppliers = await env.DB.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
    const items = await env.DB.prepare("SELECT * FROM order_items ORDER BY id DESC LIMIT 150").all();
    const bids = await env.DB.prepare(
      `SELECT b.*, s.name as sup_name, i.brand, i.model, i.part_name, i.variant, i.req_qty
       FROM bids b LEFT JOIN suppliers s ON b.supplier_id = s.id LEFT JOIN order_items i ON b.item_id = i.id
       ORDER BY b.id DESC LIMIT 200`
    ).all();
    const customers = await env.DB.prepare("SELECT * FROM customers ORDER BY last_msg_at DESC LIMIT 60").all();
    const staffList = await env.DB.prepare("SELECT id, role, phone, access_token, is_active, created_at FROM staff_users ORDER BY id DESC").all();
    const marginRules = await env.DB.prepare("SELECT * FROM margin_rules ORDER BY min_price ASC").all();
    const inventory = await env.DB.prepare("SELECT * FROM inventory ORDER BY id ASC").all();
    const invLogs = await env.DB.prepare("SELECT * FROM inventory_logs ORDER BY id DESC LIMIT 80").all();
    const ghostQueries = await env.DB.prepare("SELECT * FROM ghost_queries ORDER BY id DESC LIMIT 30").all();

    return jsonRes({
      ok: true, role: staff.role,
      orders: orders.results || [], payments: payments.results || [], settings: settings.results || [],
      suppliers: suppliers.results || [], items: items.results || [], bids: bids.results || [],
      customers: customers.results || [], staff_list: staff.role === "admin" ? (staffList.results || []) : [],
      margin_rules: marginRules.results || [], inventory: inventory.results || [],
      inventory_logs: invLogs.results || [], ghost_queries: ghostQueries.results || []
    });
  }

  if (action === "save-settings" && request.method === "POST") {
    const body = await request.json();
    const stmts = Object.entries(body).map(([k, v]) => env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(v)));
    if (stmts.length) await env.DB.batch(stmts);
    return jsonRes({ ok: true, msg: "Settings saved to live engine" });
  }

  if (action === "add-margin-rule" && request.method === "POST") {
    const { min_price, max_price, margin_type, margin_value } = await request.json();
    const minP = Number(min_price), maxP = Number(max_price), val = Number(margin_value);
    if (isNaN(minP) || isNaN(maxP) || minP > maxP || isNaN(val)) return jsonRes({ ok: false, error: "Invalid price range" }, 400);
    const overlap = await env.DB.prepare("SELECT id, min_price, max_price FROM margin_rules WHERE NOT (max_price < ? OR min_price > ?)").bind(minP, maxP).first();
    if (overlap) return jsonRes({ ok: false, error: `Overlaps with Rs.${overlap.min_price} - Rs.${overlap.max_price}` }, 400);
    await env.DB.prepare("INSERT INTO margin_rules (min_price, max_price, margin_type, margin_value) VALUES (?, ?, ?, ?)").bind(minP, maxP, margin_type === "FLAT" ? "FLAT" : "PERCENT", val).run();
    return jsonRes({ ok: true, msg: `Margin Slab Rs.${minP}-Rs.${maxP} added!` });
  }

  if (action === "delete-margin-rule" && request.method === "POST") {
    const { id } = await request.json();
    await env.DB.prepare("DELETE FROM margin_rules WHERE id = ?").bind(Number(id)).run();
    return jsonRes({ ok: true, msg: "Margin rule removed" });
  }

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
    return jsonRes({ ok: true, msg: `Updated prices for ${count} items in ${category}!` });
  }

  if (action === "adjust-stock" && request.method === "POST") {
    const { sku, name, category, price, in_house_cost, good_delta, faulty_delta, trigger_reason } = await request.json();
    let existing = await env.DB.prepare("SELECT * FROM inventory WHERE sku = ? OR name = ?").bind(sku || "", name || "").first();
    const gDelta = parseInt(good_delta || 0, 10);
    const fDelta = parseInt(faulty_delta || 0, 10);
    if (existing) {
      const oldGood = Number(existing.good_qty || 0);
      const newGood = Math.max(0, oldGood + gDelta);
      const newFaulty = Math.max(0, Number(existing.faulty_qty || 0) + fDelta);
      await env.DB.prepare("UPDATE inventory SET good_qty = ?, faulty_qty = ?, updated_at = strftime('%s','now') WHERE id = ?").bind(newGood, newFaulty, existing.id).run();
      if (gDelta !== 0) {
        await env.DB.prepare("INSERT INTO inventory_logs (item_name, action, qty, old_stock, new_stock, triggered_by) VALUES (?, ?, ?, ?, ?, ?)").bind(existing.name, gDelta > 0 ? "ADD" : "DEDUCT", Math.abs(gDelta), oldGood, newGood, trigger_reason || `Admin (${staff.phone})`).run();
      }
    } else {
      const newSku = sku || ("SKU-" + Math.floor(100 + Math.random() * 900));
      await env.DB.prepare("INSERT INTO inventory (sku, name, category, price, in_house_cost, good_qty, faulty_qty) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newSku, name, category || "Displays", Number(price || 1000), Number(in_house_cost || 750), Math.max(0, gDelta), Math.max(0, fDelta)).run();
      await env.DB.prepare("INSERT INTO inventory_logs (item_name, action, qty, old_stock, new_stock, triggered_by) VALUES (?, 'ADD', ?, 0, ?, ?)").bind(name, Math.max(0, gDelta), Math.max(0, gDelta), trigger_reason || `Admin (${staff.phone})`).run();
    }
    return jsonRes({ ok: true, msg: "Inventory & Audit Log updated!" });
  }

  if (action === "scan-stage" && request.method === "POST") {
    const { order_id, stage, hold_reason } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(Number(order_id)).first();
    if (!order) return jsonRes({ ok: false, error: "Order #" + order_id + " not found!" }, 404);
    let nextStatus = order.status;
    if (stage === "ON_HOLD") nextStatus = "ON_HOLD";
    else if (stage === "QC_PASSED") nextStatus = "PACKING";
    else if (stage === "BUS_STAND_DROPPED") nextStatus = "SHIPPED";
    await env.DB.prepare("UPDATE orders SET dispatch_stage = ?, status = ?, hold_reason = ? WHERE id = ?").bind(stage, nextStatus, hold_reason || null, order.id).run();
    return jsonRes({ ok: true, msg: `Order #${order.id} updated to ${stage}` });
  }

  if (action === "outsource-options" && request.method === "POST") {
    const { order_id, mode, region } = await request.json();
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(Number(order_id)).first();
    if (!order) return jsonRes({ ok: false, error: "Order not found" }, 404);
    const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(order.customer_id).first();
    const items = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(order.id).all();
    if (mode === "ask_customer" && cust) {
      const found = (items.results || []).filter(i => i.fulfilled_qty > 0).map(i => `• ${i.fulfilled_qty}x ${i.brand} ${i.part_name}`).join("\n") || "None";
      const missing = (items.results || []).filter(i => i.fulfilled_qty < i.req_qty).map(i => `• ${i.req_qty - i.fulfilled_qty}x ${i.brand} ${i.part_name}`).join("\n") || "Partial items";
      const msgTxt = `★ Stock Availability Update — Order #${order.id}\n━━━━━━━━━━━━━━━━━\nSecured in Odisha:\n${found}\n\nOut of stock locally:\n${missing}\n━━━━━━━━━━━━━━━━━\nOption A: Available items only.\nOption B: Source missing outside Odisha.`;
      await notifyCustomer(env, cust, msgTxt, [[{ text: "Option A: Available", callback_data: `optA_${order.id}` }, { text: "Option B: Outsource", callback_data: `optB_${order.id}` }]]);
      return jsonRes({ ok: true, msg: "Option A / Option B sent to customer!" });
    }
    await env.DB.prepare("UPDATE orders SET outsource_region = ?, status = 'BIDDING', bidding_ends_at = ? WHERE id = ?").bind(region || "Delhi", Math.floor(Date.now() / 1000) + 1800, order.id).run();
    return jsonRes({ ok: true, msg: `Broadcasted #${order.id} to ${region} suppliers!` });
  }

  if (action === "force-followup" && request.method === "POST") {
    const { order_id } = await request.json();
    await env.DB.prepare("UPDATE orders SET force_followup = 1 WHERE id = ?").bind(Number(order_id)).run();
    return jsonRes({ ok: true, msg: `Order #${order_id} pinned to 1st Follow-Up!` });
  }

  if (action === "inject-query" && request.method === "POST") {
    const { mode, item_name, qty, note } = await request.json();
    await env.DB.prepare("INSERT INTO ghost_queries (mode, item_name, qty, note, status) VALUES (?, ?, ?, ?, ?)").bind(mode, item_name, Number(qty || 1), note || "", mode === "direct" ? "POLLED" : "PIGGYBACK_QUEUED").run();
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
    return jsonRes({ ok: true, msg: mode === "direct" ? "Direct Market Poll broadcasted!" : "Ghost Order queued!" });
  }

  if (action === "assign-supplier" && request.method === "POST") {
    const { order_id, supplier_id, unit_price } = await request.json();
    return jsonRes(await adminAssignSupplierToOrder(env, Number(order_id), Number(supplier_id), Number(unit_price || 0)));
  }

  if (action === "force-close" && request.method === "POST") {
    const { order_id } = await request.json();
    if (order_id) await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0 WHERE id = ?").bind(Number(order_id)).run();
    else await env.DB.prepare("UPDATE orders SET bidding_ends_at = 0 WHERE status = 'BIDDING'").run();
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
