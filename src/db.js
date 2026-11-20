export function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export async function sendLog(env, text) {
  if (!env.BOT_TOKEN_LOGS || !env.LOGS_GROUP_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN_LOGS}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.LOGS_GROUP_ID, text })
    });
  } catch (_) {}
}

export async function getSetting(DB, key, fallback = "") {
  const row = await DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : fallback;
}

export function parseSessionMemory(tempDataStr) {
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

export async function calculateItemSellingUnit(DB, baseUnitPrice, defaultMarginPct = 20) {
  const rules = await DB.prepare("SELECT * FROM margin_rules ORDER BY min_price ASC").all();
  for (const r of (rules.results || [])) {
    if (baseUnitPrice >= Number(r.min_price) && baseUnitPrice <= Number(r.max_price)) {
      if (r.margin_type === "FLAT") return Math.round(baseUnitPrice + Number(r.margin_value));
      return Math.round(baseUnitPrice * (1 + Number(r.margin_value) / 100));
    }
  }
  return Math.round(baseUnitPrice * (1 + Number(defaultMarginPct) / 100));
}

export function formatSummaryBox(items, askLine = "[?] Are these details correct?") {
  const lines = items.map((it, idx) =>
    `${idx + 1}. Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${it.qty}`
  ).join("\n\n");
  return `ORDER SUMMARY\n━━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━━\n${askLine}`;
}

export function formatSupplierCard(header, it, footer = "") {
  const qtyUnit = Number(it.req_qty) === 1 ? "1 Piece" : `${it.req_qty} Pieces`;
  return `${header}\n━━━━━━━━━━━━━━━━━\n→ Brand: ${it.brand} ${it.model || ""}\n└ Part: ${it.part_name}\n└ Quality: ${it.variant || "Standard"}\n└ Qty: ${qtyUnit}\n━━━━━━━━━━━━━━━━━${footer ? "\n" + footer : ""}`;
}

export const GREETING_TEMPLATES = [
  "★ Welcome to AD PARTSOL — Wholesale Mobile Spare Parts Supply.",
  "★ Namaste! AD PARTSOL B2B Spare Parts Desk par aapka swagat hai.",
  "★ AD PARTSOL Direct Supply — Order any mobile spare part in a single message."
];

export const LANG_GREETINGS = {
  english: "★ Language set to English.\n━━━━━━━━━━━━━━━━━\n☞ Tell us what mobile spare parts you need (send text, photo, voice note, or use the Order Form):",
  hindi: "★ भाषा हिंदी चुनी गई है।\n━━━━━━━━━━━━━━━━━\n☞ बताइये आपको कौन सा मोबाइल स्पेयर पार्ट चाहिए (मैसेज, फोटो या वॉइस नोट भेजें):",
  hinglish: "★ Language Hinglish set ho gayi hai.\n━━━━━━━━━━━━━━━━━\n☞ Batayein aapko kaunsa mobile spare part chahiye (text, photo ya voice note bhejein):",
  odia: "★ ଭାଷା ଓଡ଼ିଆ ଚୟନ କରାଯାଇଛି।\n━━━━━━━━━━━━━━━━━\n☞ ଆପଣଙ୍କୁ କେଉଁ ମୋବାଇଲ୍ ସ୍ପେୟାର୍ ପାର୍ଟ ଦରକାର କୁହନ୍ତୁ (ମେସେଜ୍, ଫଟୋ କିମ୍ବା ଭଏସ୍ ନୋଟ୍ ପଠାନ୍ତୁ):",
  odia_eng: "★ Language Odia + English set heigala.\n━━━━━━━━━━━━━━━━━\n☞ Apananku kou mobile spare part darkar kuhantu (text, photo kimba voice note pathantu):"
};

export async function initDB(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tg_enabled', '1'), ('wa_enabled', '1'), ('ai_enabled', '1'), ('margin_percent', '20'), ('delivery_charge', '100'), ('rounding_step', '50'), ('advance_percent', '20'), ('auto_flag_mins', '120'), ('rush_window_sec', '60'), ('allocation_logic', 'cheapest')"),
    DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('upi_id', 'constantabrar@upi')"),
    DB.prepare("CREATE TABLE IF NOT EXISTS margin_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, min_price REAL NOT NULL, max_price REAL NOT NULL, margin_type TEXT NOT NULL, margin_value REAL NOT NULL, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, platform TEXT NOT NULL, chat_id TEXT NOT NULL, lang TEXT DEFAULT NULL, full_name TEXT, phone TEXT, address TEXT, state TEXT DEFAULT 'IDLE', temp_data TEXT, fraud_strikes INTEGER DEFAULT 0, banned_until INTEGER DEFAULT 0, last_msg_at INTEGER DEFAULT 0, warned_22h INTEGER DEFAULT 0, force_followup INTEGER DEFAULT 0, deleted_at INTEGER DEFAULT 0, account_root TEXT, reset_count INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s', 'now')))"),
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
}

/** Exact phrase that wipes a customer identity and starts a fresh account. */
export const FORGET_RESET_PHRASE = "FORGET ALL AND RESET";

/** Resolve active (non-deleted) customer for a platform chat. Supports wa_x, wa_x_2, ... */
export async function resolveActiveCustomer(DB, platform, chatId) {
  const root = String(chatId);
  let row = await DB.prepare(
    "SELECT * FROM customers WHERE platform = ? AND chat_id = ? AND IFNULL(deleted_at, 0) = 0 ORDER BY reset_count DESC, created_at DESC LIMIT 1"
  ).bind(platform, root).first();
  if (row) return row;
  const baseId = platform === "whatsapp" ? `wa_${root}` : `tg_${root}`;
  row = await DB.prepare(
    "SELECT * FROM customers WHERE id = ? AND IFNULL(deleted_at, 0) = 0"
  ).bind(baseId).first();
  return row || null;
}

/** Soft-delete customer + orders, create fresh identity with _2 / _3 suffix. */
export async function forgetAndResetCustomer(env, cust) {
  const DB = env.DB;
  const now = Math.floor(Date.now() / 1000);
  const platform = cust.platform;
  const chatId = String(cust.chat_id);
  const root = cust.account_root || chatId;
  const nextCount = (Number(cust.reset_count) || 0) + 1;
  const suffix = nextCount + 1; // first reset → _2
  const newId = platform === "whatsapp" ? `wa_${chatId}_${suffix}` : `tg_${chatId}_${suffix}`;

  await DB.prepare(
    "UPDATE customers SET state = 'DELETED', deleted_at = ?, full_name = COALESCE(full_name, '') || ' [DELETED]', temp_data = NULL WHERE id = ?"
  ).bind(now, cust.id).run();

  await DB.prepare(
    "UPDATE orders SET status = 'DELETED', dispatch_stage = 'CUSTOMER_RESET', hold_reason = 'FORGET ALL AND RESET' WHERE customer_id = ? AND status != 'DELETED'"
  ).bind(cust.id).run();

  await DB.prepare(
    "INSERT INTO customers (id, platform, chat_id, phone, lang, last_msg_at, state, deleted_at, account_root, reset_count) VALUES (?, ?, ?, ?, NULL, ?, 'AWAITING_REQ', 0, ?, ?)"
  ).bind(newId, platform, chatId, platform === "whatsapp" ? chatId : (cust.phone || null), now, root, nextCount).run();

  const fresh = await DB.prepare("SELECT * FROM customers WHERE id = ?").bind(newId).first();
  await sendLog(env, `★ CUSTOMER HARD RESET\nOld: ${cust.id}\nNew: ${newId}\nRoot: ${root}\nReset #: ${nextCount}`);
  return fresh;
}

export async function migrateCustomersSchema(DB) {
  try { await DB.prepare("ALTER TABLE customers ADD COLUMN deleted_at INTEGER DEFAULT 0").run(); } catch (_) {}
  try { await DB.prepare("ALTER TABLE customers ADD COLUMN account_root TEXT").run(); } catch (_) {}
  try { await DB.prepare("ALTER TABLE customers ADD COLUMN reset_count INTEGER DEFAULT 0").run(); } catch (_) {}
}
