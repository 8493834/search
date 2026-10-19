// Runs the language model off the main thread so the page stays alive if the model struggles.
import { pipeline, TextStreamer, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;   // GitHub Pages can't use extra threads, and one thread uses the least memory
let pipe = null, loaded = "";

async function load(model) {
  if (!pipe || loaded !== model) {
    pipe = null;
    pipe = await pipeline("text-generation", model, {
      dtype: "q4",
      device: "wasm",                     // CPU mode: slower than a GPU, but far less likely to crash a tab
      progress_callback: (p) => { if (p.status === "progress") postMessage({ type: "progress", pct: Math.round(p.progress || 0) }); },
    });
    loaded = model;
  }
  return pipe;
}

self.onmessage = async (e) => {
  const { id, messages, model } = e.data;
  try {
    const p = await load(model);
    postMessage({ type: "ready", id });
    let text = "";
    const streamer = new TextStreamer(p.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: (t) => { text += t; postMessage({ type: "text", id, text }); },
    });
    await p(messages, { max_new_tokens: 160, do_sample: false, streamer });
    postMessage({ type: "done", id, text: text.trim() });
  } catch (err) {
    pipe = null;
    postMessage({ type: "error", id, message: String((err && err.message) || err) });
  }
};
