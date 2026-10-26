// Second backup overview helper. Runs free on Vercel (vercel.com) as an Edge Function, using OpenRouter's free models.
// Different host AND different AI provider from the other two, so one outage or block can't take out all three.
// It lives in the vercel-helper folder of the main repo. In Vercel, import the main repo and set Root Directory to vercel-helper.
// Add the environment variable OPENROUTER_API_KEY (free key from openrouter.ai). The address is https://YOUR-APP.vercel.app/api/overview
export const config = { runtime: "edge" };

const ALLOWED_ORIGIN = "https://8493834.github.io";
// Free models come and go, so several are tried in order.
const MODELS = ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-2-9b-it:free", "mistralai/mistral-7b-instruct:free"];

export default async function handler(request) {
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (request.headers.get("Origin") !== ALLOWED_ORIGIN) return reply({ error: "Not allowed" }, 403);

  let body;
  try { body = await request.json(); } catch { return reply({ error: "Bad JSON" }, 400); }
  const q = String(body.q || "").trim().slice(0, 200);
  const passages = Array.isArray(body.passages) ? body.passages.slice(0, 5).map((p) => String(p).slice(0, 800)) : [];
  if (!q || !passages.length) return reply({ error: "Missing question or passages" }, 400);
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return reply({ error: "Model unavailable", detail: "OPENROUTER_API_KEY is not set" }, 503);

  const context = passages.map((p, i) => `[${i + 1}] ${p}`).join("\n");
  const messages = [
    { role: "system", content:
      "You write a short overview for a search engine, like a brief answer box. Use ONLY the numbered sources. " +
      "Write 2 to 4 plain sentences (under 90 words), no headings, no lists. Cite sources inline like [1] or [2]. " +
      "If the sources do not contain an answer, say so in one sentence. Never add facts that are not in the sources." },
    { role: "user", content: `Sources:\n${context}\n\nSearch: ${q}` },
  ];
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.2 }),
      });
      const j = await r.json();
      const text = String(j?.choices?.[0]?.message?.content || "").trim();
      if (text) return reply({ text });
      lastErr = String(j?.error?.message || r.status).slice(0, 300);
    } catch (e) { lastErr = String((e && e.message) || e).slice(0, 300); }
  }
  return reply({ error: "Model unavailable", detail: lastErr }, 503);
}
