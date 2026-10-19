// Optional in-browser language model. Only used when "AI-written overview" is on.
// The model downloads from Hugging Face once and is cached by the browser; nothing you search is sent anywhere.
// 8 GB or more: the 360M model (about 250 MB download). 4 GB or unknown: a "lite" 135M model (about 100 MB), less capable but light.
export function modelChoice() {
  const big = !navigator.deviceMemory || navigator.deviceMemory >= 8;
  return big && navigator.deviceMemory ? "HuggingFaceTB/SmolLM2-360M-Instruct" : "HuggingFaceTB/SmolLM2-135M-Instruct";
}
let worker = null, seq = 0;

/** Returns "" if this device can reasonably run the model, otherwise a short reason. */
export function aiUnsupportedReason() {
  const ua = (navigator.userAgent || "") + " " + (navigator.platform || "");
  if (/(i[3-6]86|armv[5-7]|armhf|x86_32|win32)/i.test(ua) && !/win64|x64|wow64/i.test(ua)) return "This looks like a 32-bit device, which can't hold the model in memory.";
  if (typeof WebAssembly !== "object" || typeof Worker === "undefined") return "This browser can't run the model.";
  // Chrome-style browsers report memory rounded down to 0.25/0.5/1/2/4/8 GB, so a 4 GB computer shows as 4 and only 8 GB or more shows as 8.
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return "This device has under 4 GB of memory, which isn't enough to run the model.";
  return "";
}

function getWorker() {
  if (!worker) worker = new Worker("js/llm-worker.js", { type: "module" });
  return worker;
}

/** Writes a short answer from the given source passages. onText gets the text so far. */
export function writeOverview(query, passages, onText, onProgress) {
  const context = passages.map((p, i) => `[${i + 1}] ${p}`).join("\n");
  const messages = [
    { role: "system", content: "You summarise search results. Use ONLY the numbered sources. Write 2 to 4 plain sentences and cite sources like [1]. If the sources do not answer the question, say so briefly. Never invent facts." },
    { role: "user", content: `Sources:\n${context}\n\nQuestion: ${query}` },
  ];
  const id = ++seq, w = getWorker();
  return new Promise((resolve, reject) => {
    const cleanup = () => { w.removeEventListener("message", on); w.removeEventListener("error", fail); };
    const fail = (e) => { cleanup(); worker = null; try { w.terminate(); } catch {} reject(new Error((e && e.message) || "The AI model stopped.")); };
    const on = (e) => {
      const m = e.data;
      if (m.type === "progress" && onProgress) onProgress(m.pct);
      else if (m.id !== id) return;
      else if (m.type === "ready" && onProgress) onProgress(null);
      else if (m.type === "text") onText(m.text);
      else if (m.type === "done") { cleanup(); resolve(m.text); }
      else if (m.type === "error") { cleanup(); reject(new Error(m.message)); }
    };
    w.addEventListener("message", on);
    w.addEventListener("error", fail);
    w.postMessage({ id, messages, model: modelChoice() });
  });
}
