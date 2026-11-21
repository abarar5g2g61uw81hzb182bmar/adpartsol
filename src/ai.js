import { getSetting } from "./db.js";

function safeJsonParse(text, fallback = {}) {
  try {
    if (!text || typeof text !== "string") return fallback;
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch (_) {
    return fallback;
  }
}

export async function analyzeCustomerRequirement(env, textInput, imageUrl = null, lang = "hinglish", memoryObj = { items: [], history: [] }) {
  const aiEnabled = await getSetting(env.DB, "ai_enabled", "1");
  if (aiEnabled !== "1") return { valid: false, clarify_msg: "ⓘ System maintenance: Service will resume shortly." };

  const activeLang = lang || "hinglish";
  const model = imageUrl ? "gpt-4o" : "gpt-4o-mini";
  const prevHistory = (memoryObj.history || []).slice(-8).map(h => `${h.r}: ${h.t}`).join("\n");
  const prevDraft = JSON.stringify(memoryObj.items || []);

  const sysPrompt = `You are the official sales representative of AD PARTSOL (B2B mobile spare parts supply).
STRICT RULES:
1. NEVER reveal you are an AI, bot, or language model. Act as AD PARTSOL's direct sales desk. Never mention external suppliers or bidding.
2. NEVER use emojis. Use only symbols like ★ ■ ☞ → └ ⓘ [?].
3. Converse strictly in customer's selected language: ${activeLang}.
4. Do NOT set "detected_other_lang" for short greetings, brand names, or model names. Only set it if the customer writes a full sentence in a completely different language than ${activeLang}. Otherwise null.
5. Never ask for a fixed format. Extract Brand, Model, Part Name, Quality (Original/Duplicate/Standard), and Quantity naturally.
6. Merge with Current Draft Items: ${prevDraft} and Recent Chat History:\n${prevHistory || "None"}
7. If any detail is missing, set valid false and ask only for the missing piece in ${activeLang}.

Output strictly JSON:
{
  "valid": true/false,
  "detected_other_lang": null,
  "items": [{"brand": "Apple", "model": "iPhone 15 Plus", "part_name": "Tempered Glass", "variant": "Original", "qty": 2}],
  "summary_text": "Short note in ${activeLang}",
  "clarify_msg": "Natural question in ${activeLang}"
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
  if (!data.choices || !data.choices[0]) {
    const errDetail = data?.error?.message || data?.error?.code || `HTTP ${res.status}`;
    try {
      const { sendLog } = await import("./db.js");
      await sendLog(env, `★ OPENAI ERROR (analyze)\n${errDetail}`);
    } catch (_) {}
    return { valid: false, clarify_msg: "ⓘ Could not process right now. Please send again." };
  }
  return safeJsonParse(data.choices[0].message?.content, {
    valid: false,
    clarify_msg: "Could not parse response. Please rephrase."
  });
}

export async function extractCustomerProfileAI(env, textInput, lang = "hinglish", prevProfile = {}) {
  const activeLang = lang || "hinglish";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You extract and merge customer delivery details across multiple messages.
Previously collected: ${JSON.stringify(prevProfile)}
New message: "${textInput}"
Rules:
1. Merge Full Name, 10-digit Phone, Delivery Address.
2. Clean formatting.
3. complete true only when all 3 present.
4. If missing, ask only for missing fields in ${activeLang} (no emojis).
JSON: {"complete": true/false, "name": "...", "phone": "...", "address": "...", "ask_missing": "..."}`
        },
        { role: "user", content: textInput }
      ]
    })
  });
  const data = await res.json();
  return safeJsonParse(data?.choices?.[0]?.message?.content, {
    complete: false, name: prevProfile.name || "", phone: prevProfile.phone || "",
    address: prevProfile.address || "", ask_missing: "Please share name, phone and address."
  });
}

export async function analyzePaymentScreenshot(env, imageUrl, expectedAmount, expectedUpi) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this payment screenshot. Extract 12-digit UTR/Ref, paid amount, verify genuine. Expected Amount: Rs ${expectedAmount}, Expected UPI: ${expectedUpi}. JSON: {"is_valid_screenshot": true/false, "utr": "123456789012" or null, "amount": 500, "reason": "string"}`
        },
        { role: "user", content: [{ type: "image_url", image_url: { url: imageUrl } }] }
      ]
    })
  });
  const data = await res.json();
  return safeJsonParse(data?.choices?.[0]?.message?.content, {
    is_valid_screenshot: false, utr: null, amount: 0, reason: "Could not read screenshot"
  });
}

export async function transcribeVoice(env, audioBuffer, filename = "voice.ogg") {
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
    formFallback.append("model", "whisper-1");
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body: formFallback
    });
  }
  const data = await res.json();
  return data.text || "";
}
