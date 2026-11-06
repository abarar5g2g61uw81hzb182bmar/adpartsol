import { getSetting } from "./db.js";

export async function analyzeCustomerRequirement(env, textInput, imageUrl = null, lang = "hinglish", memoryObj = { items: [], history: [] }) {
  const aiEnabled = await getSetting(env.DB, "ai_enabled", "1");
  if (aiEnabled !== "1") return { valid: false, clarify_msg: "ⓘ System maintenance: Service will resume shortly." };

  const activeLang = lang || "hinglish";
  const model = imageUrl ? "gpt-6-luna" : "gpt-5.6-luna";
  const prevHistory = memoryObj.history.slice(-8).map(h => `${h.r}: ${h.t}`).join("\n");
  const prevDraft = JSON.stringify(memoryObj.items || []);

  const sysPrompt = `You are the official sales representative of AD PARTSOL (B2B mobile spare parts supply).
STRICT RULES:
1. NEVER reveal you are an AI, bot, or language model. Act as AD PARTSOL's direct sales desk. Never mention external suppliers or bidding.
2. NEVER use emojis. Use only symbols like ★ ■ ☞ → └ ⓘ [?].
3. Converse strictly in customer's selected language: ${activeLang}.
4. Do NOT set "detected_other_lang" for short greetings, brand names, or model names (like "Hello", "Vivo Y20", "iPhone 13"). Only set "detected_other_lang" if the customer writes a full sentence in a completely different regional language than ${activeLang}. Otherwise set "detected_other_lang": null.
5. Never ask the customer to use a fixed format. Extract Brand, Model, Part Name, Quality (Original/Duplicate/Standard), and Quantity naturally across multiple messages.
6. Merge new details with Current Draft Items: ${prevDraft} and Recent Chat History:
${prevHistory || "None"}
7. If any detail (Brand, Model, Part Name, Quality, or Qty) is still missing, set "valid": false and ask only for the missing piece in ${activeLang} inside "clarify_msg".

Output strictly JSON:
{
  "valid": true/false,
  "detected_other_lang": null,
  "items": [
    {"brand": "Apple", "model": "iPhone 15 Plus", "part_name": "Tempered Glass", "variant": "Original", "qty": 2}
  ],
  "summary_text": "Short note in ${activeLang} (NO EMOJIS)",
  "clarify_msg": "Natural question in ${activeLang} asking only what is missing (NO EMOJIS)"
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

export async function extractCustomerProfileAI(env, textInput, lang = "hinglish", prevProfile = {}) {
  const activeLang = lang || "hinglish";
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
2. Clean up formatting (e.g. separate stuck words cleanly).
3. If all 3 (name, phone, address) are now present, set "complete": true.
4. If any of the 3 is still missing, set "complete": false, keep the already found fields in "name", "phone", "address", and ask ONLY for the missing field(s) in ${activeLang} inside "ask_missing" (NO EMOJIS).

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

export async function analyzePaymentScreenshot(env, imageUrl, expectedAmount, expectedUpi) {
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
