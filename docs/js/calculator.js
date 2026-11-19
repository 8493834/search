// Calculator for SPS Search. It works on its own, so it does not depend on the rest of app.js:
//  - searching a sum ("15% of 80", "2+2", "sqrt(144)") shows the answer above the results
//  - searching "calculator" shows a full calculator above the results
//  - #/calculator opens the full calculator on its own page
// It watches the page for changes, so it keeps working when app.js redraws a view.
import { evaluate, format, tryQuery, wantsCalculator } from "./calculator-core.js";

const app = document.getElementById("app");
// If the site asks people to agree to its terms first, wait until they have (the calculator needs nothing saved or sent).
const legal = await import("./legal.js").catch(() => null);
const agreed = () => !legal || legal.hasConsent("terms");

// ---------- styles (use the site's colours, so light and dark mode both work) ----------
const css = document.createElement("style");
css.textContent = `
.calc-card { background: var(--surface); border: 1.5px solid var(--line); border-radius: 12px; padding: 1rem 1.1rem; margin: 0 0 1.2rem; max-width: 22rem; }
.calc-card.wide { max-width: 26rem; }
.calc-expr { color: var(--muted); font-size: 0.95rem; overflow-wrap: anywhere; }
.calc-answer { font: 800 2.2rem/1.15 var(--display); letter-spacing: -0.02em; overflow-wrap: anywhere; margin: 0.15rem 0 0.4rem; }
.calc-row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; font-size: 0.9rem; }
.calc-link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font-size: inherit; }
.calc-screen { width: 100%; font: 600 1.4rem/1.3 var(--body); padding: 0.55rem 0.7rem; background: var(--bg); border: 1.5px solid var(--line); border-radius: 10px; text-align: right; }
.calc-preview { min-height: 2.2rem; text-align: right; font: 800 1.7rem/1.3 var(--display); letter-spacing: -0.02em; overflow-wrap: anywhere; padding: 0.35rem 0.2rem 0.25rem; }
.calc-preview.err { color: var(--danger); font: 500 0.95rem/1.4 var(--body); }
.calc-preview.soft { color: var(--muted); }
.calc-bar { display: flex; gap: 0.5rem; margin: 0.25rem 0 0.6rem; }
.calc-keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.45rem; }
.calc-keys.sci { grid-template-columns: repeat(5, 1fr); margin-bottom: 0.45rem; }
.calc-keys[hidden] { display: none; }
.calc-key { min-height: 2.9rem; border: 1.5px solid var(--line); border-radius: 10px; background: var(--bg); font: 600 1.1rem/1 var(--body); cursor: pointer; padding: 0.2rem; }
.calc-key:hover { border-color: var(--accent); }
.calc-key:active { transform: translateY(1px); }
.calc-key.op { background: var(--surface); color: var(--accent); }
.calc-key.fn { font-size: 0.95rem; color: var(--muted); }
.calc-key.eq { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.calc-key.small { min-height: 2.2rem; font-size: 0.9rem; padding: 0.2rem 0.7rem; }
.calc-key[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.calc-hist { list-style: none; margin: 0.8rem 0 0; padding: 0; font-size: 0.9rem; }
.calc-hist li { border-top: 1px solid var(--line); }
.calc-hist button { all: unset; display: block; width: 100%; padding: 0.4rem 0.1rem; cursor: pointer; color: var(--muted); box-sizing: border-box; overflow-wrap: anywhere; }
.calc-hist button:hover, .calc-hist button:focus-visible { color: var(--ink); }
.calc-page { padding: 1rem clamp(1rem, 4vw, 2.5rem) 4rem; max-width: 52rem; }
.calc-page h1 { font: 800 1.8rem/1.2 var(--display); margin: 0 0 0.8rem; }
`;
document.head.append(css);

// ---------- tiny DOM helper (text only, never HTML strings) ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((x) => x != null));
  return n;
}

const store = {
  get() { try { return JSON.parse(localStorage.getItem("sps.calc") || "{}"); } catch { return {}; } },
  set(o) { try { localStorage.setItem("sps.calc", JSON.stringify(o)); } catch { /* private window: fine */ } },
};
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

// ---------- the answer card (for searches like "15% of 80") ----------
function answerCard(hit) {
  const note = el("span", { role: "status" });
  const copy = el("button", { class: "calc-link", type: "button", onclick: async () => {
    note.textContent = (await copyText(hit.plain)) ? "Copied" : "Couldn't copy";
    setTimeout(() => (note.textContent = ""), 1500);
  } }, "Copy");
  return el("section", { class: "calc-card", id: "calc-card", "aria-label": "Calculator answer" },
    el("div", { class: "calc-expr" }, hit.expr + " ="),
    el("div", { class: "calc-answer" }, hit.text),
    el("div", { class: "calc-row" }, copy, el("a", { href: "#/calculator?e=" + encodeURIComponent(hit.expr) }, "Open calculator"), note));
}

// ---------- the full calculator ----------
function fullCalculator(start = "") {
  const saved = store.get();
  let deg = !!saved.deg;
  let sci = !!saved.sci;
  let history = Array.isArray(saved.history) ? saved.history.slice(0, 10) : [];
  let fresh = false; // true right after "=", so typing a number starts a new sum

  const input = el("input", { class: "calc-screen", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Sum", placeholder: "0" });
  if (matchMedia("(pointer: coarse)").matches) input.setAttribute("inputmode", "none"); // phones: use the keypad, not the keyboard
  input.value = start;
  const preview = el("div", { class: "calc-preview", "aria-live": "polite" });
  const histList = el("ul", { class: "calc-hist", "aria-label": "Earlier sums" });

  const persist = () => store.set({ deg, sci, history });

  function refresh() {
    preview.className = "calc-preview";
    const v = input.value.trim();
    if (!v) { preview.textContent = ""; return; }
    try {
      const r = evaluate(v, { deg });
      preview.textContent = r.operation ? "= " + format(r.value) : "";
      preview.classList.add("soft");
    } catch (e) {
      // Stay quiet while the sum is still being typed; only complain about real problems
      const quiet = /unfinished|isn't closed|Type a sum/.test(e.message);
      preview.textContent = quiet ? "" : e.message;
      if (!quiet) preview.classList.add("err");
    }
  }
  function drawHistory() {
    histList.replaceChildren(...history.map((h) => el("li", {}, el("button", { type: "button", onclick: () => { input.value = h.plain; fresh = true; refresh(); input.focus(); } }, `${h.expr} = ${h.text}`))));
  }
  function equals() {
    const v = input.value.trim();
    if (!v) return;
    try {
      const r = evaluate(v, { deg });
      history = [{ expr: v, text: format(r.value), plain: r.plain }, ...history.filter((h) => h.expr !== v)].slice(0, 10);
      persist(); drawHistory();
      input.value = r.plain;
      fresh = true;
      preview.className = "calc-preview";
      preview.textContent = "";
    } catch (e) {
      preview.className = "calc-preview err";
      preview.textContent = e.message;
    }
  }
  function put(text, { isValue = false } = {}) {
    if (fresh && isValue) input.value = ""; // typing a number after "=" starts again; an operator carries on
    fresh = false;
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, a, b, "end");
    input.focus({ preventScroll: true });
    refresh();
  }
  function backspace() {
    fresh = false;
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
    if (a !== b) input.setRangeText("", a, b, "end");
    else if (a > 0) input.setRangeText("", a - 1, a, "end");
    input.focus({ preventScroll: true });
    refresh();
  }
  function clear() { input.value = ""; fresh = false; preview.textContent = ""; input.focus({ preventScroll: true }); }

  // key = [label, what it types or does, extra class, accessible name]
  const K = (label, act, cls = "", name = label) => {
    const run = typeof act === "function" ? act : () => put(act, { isValue: /^[\d.(]|^[a-z√π]/i.test(act) && act !== "mod" });
    return el("button", { class: "calc-key " + cls, type: "button", "aria-label": name, onclick: run }, label);
  };
  const sciKeys = el("div", { class: "calc-keys sci", hidden: sci ? null : "" },
    K("sin", "sin(", "fn"), K("cos", "cos(", "fn"), K("tan", "tan(", "fn"), K("ln", "ln(", "fn"), K("log", "log(", "fn"),
    K("√", "sqrt(", "fn", "square root"), K("π", "pi", "fn", "pi"), K("e", "e", "fn", "e"), K("x²", "^2", "fn", "squared"), K("xʸ", "^", "fn", "power"),
    K("!", "!", "fn", "factorial"), K("mod", " mod ", "fn"), K("%", "%", "fn", "percent"), K("|x|", "abs(", "fn", "absolute value"), K(",", ",", "fn", "comma"));
  const keys = el("div", { class: "calc-keys" },
    K("C", clear, "op", "clear"), K("⌫", backspace, "op", "backspace"), K("(", "(", "op", "open bracket"), K(")", ")", "op", "close bracket"),
    K("7", "7"), K("8", "8"), K("9", "9"), K("÷", "/", "op", "divide"),
    K("4", "4"), K("5", "5"), K("6", "6"), K("×", "*", "op", "multiply"),
    K("1", "1"), K("2", "2"), K("3", "3"), K("−", "-", "op", "minus"),
    K("0", "0"), K(".", ".", "", "point"), K("=", equals, "eq", "equals"), K("+", "+", "op", "plus"));

  const degBtn = el("button", { class: "calc-key small", type: "button", "aria-pressed": String(deg), title: "Degrees or radians for sin, cos and tan", onclick: () => {
    deg = !deg; degBtn.setAttribute("aria-pressed", String(deg)); degBtn.textContent = deg ? "Degrees" : "Radians"; persist(); refresh();
  } }, deg ? "Degrees" : "Radians");
  const sciBtn = el("button", { class: "calc-key small", type: "button", "aria-pressed": String(sci), onclick: () => {
    sci = !sci; sciBtn.setAttribute("aria-pressed", String(sci)); sciKeys.hidden = !sci; persist();
  } }, "More");
  const copyBtn = el("button", { class: "calc-key small", type: "button", onclick: async () => {
    const t = input.value.trim(); if (!t) return;
    let out = t; try { out = evaluate(t, { deg }).plain; } catch { /* copy what is there */ }
    copyBtn.textContent = (await copyText(out)) ? "Copied" : "Couldn't copy";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  } }, "Copy");

  input.addEventListener("input", () => { fresh = false; refresh(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); equals(); }
    else if (e.key === "Escape") { e.preventDefault(); clear(); }
  });

  drawHistory(); refresh();
  return el("section", { class: "calc-card wide", id: "calc-card", "aria-label": "Calculator" },
    input, preview,
    el("div", { class: "calc-bar" }, degBtn, sciBtn, copyBtn),
    sciKeys, keys, histList);
}

// ---------- put the right thing on the page ----------
function currentRoute() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs = ""] = raw.split("?");
  return { path, params: new URLSearchParams(qs) };
}

let busy = false;
function sync() {
  if (busy) return;
  busy = true;
  try {
    const { path, params } = currentRoute();
    const existing = document.getElementById("calc-card");
    if (!agreed()) { if (existing) existing.remove(); return; }

    if (path === "/calculator") {
      if (existing && existing.closest(".calc-page")) return;
      document.title = "Calculator - SPS Search";
      const start = (params.get("e") || "").slice(0, 200);
      app.replaceChildren(el("section", { class: "calc-page" }, el("h1", {}, "Calculator"), fullCalculator(start)));
      return;
    }

    if (path === "/search") {
      const q = (params.get("q") || "").trim();
      const wrap = app.querySelector(".results-wrap");
      if (!wrap || !wrap.firstElementChild) return; // the results page isn't drawn yet; the observer will call us again
      const want = wantsCalculator(q) ? "full" : tryQuery(q) ? "answer:" + q : "";
      if (existing) {
        if (existing.dataset.for === want && existing.parentElement === wrap) return;
        existing.remove();
      }
      if (!want) return;
      const card = want === "full" ? fullCalculator() : answerCard(tryQuery(q));
      card.dataset.for = want;
      wrap.firstElementChild.after(card); // right under the search box
      return;
    }
    if (existing && !existing.closest(".calc-page")) existing.remove();
  } finally { busy = false; }
}

new MutationObserver(sync).observe(app, { childList: true });
addEventListener("hashchange", () => setTimeout(sync, 0));
sync();
