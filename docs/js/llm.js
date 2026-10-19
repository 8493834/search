// Optional in-browser language model. Only loaded when the person turns on "AI-written overview".
// The model downloads from Hugging Face once and is cached by the browser; nothing you search is sent anywhere.
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
let gen = null;

export const MODEL_SIZE = "about 400 MB";

export async function loadModel(onProgress) {
  if (gen) return gen;
  gen = (async () => {
    const { pipeline, TextStreamer } = await import(LIB);
    const device = navigator.gpu ? "webgpu" : "wasm";
    const pipe = await pipeline("text-generation", MODEL, {
      dtype: device === "webgpu" ? "q4f16" : "q4",
      device,
      progress_callback: (p) => { if (p.status === "progress" && onProgress) onProgress(Math.round(p.progress || 0)); },
    });
    return { pipe, TextStreamer };
  })();
  gen.catch(() => { gen = null; });
  return gen;
}

/** Writes a short answer from the given source passages. onText gets the text so far. */
export async function writeOverview(query, passages, onText, onProgress) {
  const { pipe, TextStreamer } = await loadModel(onProgress);
  const context = passages.map((p, i) => `[${i + 1}] ${p}`).join("\n");
  const messages = [
    { role: "system", content: "You summarise search results. Use ONLY the numbered sources. Write 2 to 4 plain sentences and cite sources like [1]. If the sources do not answer the question, say so briefly. Never invent facts." },
    { role: "user", content: `Sources:\n${context}\n\nQuestion: ${query}` },
  ];
  let text = "";
  const streamer = new TextStreamer(pipe.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (t) => { text += t; onText(text); } });
  await pipe(messages, { max_new_tokens: 200, do_sample: false, streamer });
  return text.trim();
}
