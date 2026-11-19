// Timer and stopwatch for SPS Search, like the ones in Google results. It works on its own, like calculator.js:
//  - "timer", "set a timer for 5 minutes", "10 min timer", "2:30 timer" show a timer above the results
//  - "stopwatch" shows a stopwatch
//  - #/timer and #/stopwatch open them on their own page
// The timer keeps running while you move around the site, and a small button shows the time left.
import { parseTimerQuery, formatClock, formatStopwatch, describe } from "./timer-core.js";

const app = document.getElementById("app");

// If the site asks people to agree to its terms first, wait until they have (the timer needs nothing sent anywhere).
const legal = await import("./legal.js").catch(() => null);
const agreed = () => !legal || legal.hasConsent("terms");

// ---------- styles (the site's own colours, so light and dark mode both work) ----------
const css = document.createElement("style");
css.textContent = `
.tm-card { background: var(--surface); border: 1.5px solid var(--line); border-radius: 12px; padding: 1rem 1.1rem; margin: 0 0 1.2rem; max-width: 26rem; }
.tm-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.6rem; color: var(--muted); font-size: 0.9rem; margin-bottom: 0.2rem; }
.tm-display { font: 800 3rem/1.1 var(--display); letter-spacing: -0.02em; text-align: center; padding: 0.4rem 0 0.5rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.tm-display.done { color: var(--danger); font-size: 2.2rem; }
.tm-fields { display: flex; justify-content: center; align-items: center; gap: 0.35rem; padding: 0.4rem 0 0.6rem; flex-wrap: wrap; }
.tm-fields[hidden], .tm-display[hidden] { display: none; }
.tm-fields input { width: 4.2rem; font: 800 2rem/1.2 var(--display); text-align: center; padding: 0.2rem 0.1rem; background: var(--bg); border: 1.5px solid var(--line); border-radius: 10px; font-variant-numeric: tabular-nums; }
.tm-fields label { color: var(--muted); font-size: 0.85rem; margin-right: 0.5rem; }
.tm-bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin: 0 0 0.8rem; }
.tm-fill { height: 100%; width: 0; background: var(--accent); transition: width 0.25s linear; }
.tm-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.tm-btn { flex: 1 1 auto; min-height: 2.7rem; border: 1.5px solid var(--line); border-radius: 10px; background: var(--bg); font: 600 1rem/1 var(--body); cursor: pointer; padding: 0.3rem 0.9rem; }
.tm-btn:hover:not(:disabled) { border-color: var(--accent); }
.tm-btn:disabled { opacity: 0.45; cursor: default; }
.tm-btn.main { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); flex-grow: 2; }
.tm-note { font-size: 0.9rem; margin: 0.7rem 0 0; color: var(--muted); }
.tm-link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font: inherit; }
.tm-laps { list-style: none; margin: 0.8rem 0 0; padding: 0; font-variant-numeric: tabular-nums; font-size: 0.95rem; }
.tm-laps li { display: flex; justify-content: space-between; border-top: 1px solid var(--line); padding: 0.35rem 0.1rem; }
.tm-page { padding: 1rem clamp(1rem, 4vw, 2.5rem) 4rem; max-width: 52rem; }
.tm-page h1 { font: 800 1.8rem/1.2 var(--display); margin: 0 0 0.8rem; }
.tm-pill { position: fixed; right: 1rem; bottom: 1rem; z-index: 20; border: 1.5px solid var(--accent); background: var(--accent); color: var(--accent-ink); border-radius: 999px; padding: 0.55rem 1rem; font: 700 0.95rem/1 var(--body); cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,.25); font-variant-numeric: tabular-nums; }
.tm-pill.done { background: var(--danger); border-color: var(--danger); color: #fff; }
.tm-pill[hidden] { display: none; }
.tm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;
document.head.append(css);

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

// ---------- state (saved on this device, so a reload keeps your timer) ----------
const KEY = "sps.timer";
const now = () => Date.now();
let T = { state: "idle", total: 300, endAt: 0, left: 300000, src: "" }; // state: idle | running | paused | done
let W = { state: "idle", base: 0, startAt: 0, laps: [] }; // state: idle | running | stopped

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved && saved.T) T = { ...T, ...saved.T };
  if (saved && saved.W) W = { ...W, ...saved.W };
  if (T.state === "running" && now() >= T.endAt) T.state = "done"; // it finished while the page was closed (no alarm now)
} catch { /* private window: fine */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ T, W })); } catch { /* fine */ } };

const timerLeft = () => (T.state === "running" ? Math.max(0, T.endAt - now()) : T.state === "done" ? 0 : T.left);
const swElapsed = () => W.base + (W.state === "running" ? now() - W.startAt : 0);

// ---------- alarm ----------
let audio = null, beepTimer = 0, beepUntil = 0;
function beepOnce() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audio.createOscillator(), g = audio.createGain(), at = t + i * 0.22;
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(at); o.stop(at + 0.18);
    }
  } catch { /* no sound available: the screen still shows it */ }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* fine */ }
}
function startAlarm() {
  stopAlarm();
  beepOnce();
  beepUntil = now() + 20000; // rings for 20 seconds, or until you press a button
  beepTimer = setInterval(() => { if (now() > beepUntil) stopAlarm(); else beepOnce(); }, 1500);
}
function stopAlarm() { clearInterval(beepTimer); beepTimer = 0; }

// ---------- timer actions ----------
function setTotal(seconds) { T.total = seconds; if (T.state === "idle") T.left = seconds * 1000; }
function startTimer() {
  stopAlarm();
  if (T.state === "done" || T.state === "idle") T.left = T.total * 1000;
  if (T.left <= 0) return;
  T.endAt = now() + T.left; T.state = "running"; save(); ensureTick(); refresh();
}
function pauseTimer() { T.left = timerLeft(); T.state = "paused"; save(); refresh(); }
function resetTimer() { stopAlarm(); T.state = "idle"; T.left = T.total * 1000; T.src = ""; save(); refresh(); }
function addMinute() {
  if (T.state === "done") return;
  T.total += 60;
  if (T.state === "running") T.endAt += 60000; else T.left += 60000;
  save(); refresh();
}
function finishTimer() { T.state = "done"; T.left = 0; save(); startAlarm(); refresh(); }

// ---------- stopwatch actions ----------
function startWatch() { W.startAt = now(); W.state = "running"; save(); ensureTick(); refresh(); }
function stopWatch() { W.base = swElapsed(); W.state = "stopped"; save(); refresh(); }
function lapWatch() { W.laps.unshift(swElapsed()); W.laps = W.laps.slice(0, 50); save(); refresh(); }
function resetWatch() { W = { state: "idle", base: 0, startAt: 0, laps: [] }; save(); refresh(); }

// ---------- views ----------
const views = []; // every timer or stopwatch card currently on the page
const pill = el("button", { class: "tm-pill", type: "button", hidden: "", "aria-label": "Open timer", onclick: () => { location.hash = T.state === "idle" && W.state === "running" ? "#/stopwatch" : "#/timer"; } });
document.body.append(pill);

function refresh() { for (const v of views) v.update(); updatePill(); updateTitle(); }

let tickId = 0;
function ensureTick() {
  if (tickId) return;
  tickId = setInterval(() => {
    views.splice(0, views.length, ...views.filter((v) => v.root.isConnected));
    if (T.state === "running" && now() >= T.endAt) finishTimer();
    const active = T.state === "running" || W.state === "running" || views.length || pill.hidden === false;
    if (!active) { clearInterval(tickId); tickId = 0; return; }
    refresh();
  }, 100);
}

function updatePill() {
  const hasTimerCard = views.some((v) => v.kind === "timer" && v.root.isConnected);
  const hasWatchCard = views.some((v) => v.kind === "stopwatch" && v.root.isConnected);
  let text = "", cls = "tm-pill";
  if (T.state !== "idle" && !hasTimerCard) {
    text = T.state === "done" ? "Time's up" : formatClock(timerLeft() / 1000) + (T.state === "paused" ? " (paused)" : "");
    if (T.state === "done") cls += " done";
  } else if (W.state === "running" && !hasWatchCard) text = formatStopwatch(swElapsed()).replace(/\.\d+$/, "");
  const show = !!text && agreed();
  pill.hidden = !show;
  if (show) { pill.className = cls; pill.textContent = "⏱ " + text; }
}

const TITLE_PREFIX = /^(\d{1,2}(:\d{2}){1,2}|Time's up) · /;
function updateTitle() {
  const base = document.title.replace(TITLE_PREFIX, "");
  if (T.state === "running") document.title = formatClock(timerLeft() / 1000) + " · " + base;
  else if (T.state === "done" && beepTimer) document.title = "Time's up · " + base;
  else if (base !== document.title) document.title = base;
}

function timerCard(query) {
  const hr = el("input", { type: "number", min: "0", max: "99", inputmode: "numeric", "aria-label": "Hours" });
  const mi = el("input", { type: "number", min: "0", max: "59", inputmode: "numeric", "aria-label": "Minutes" });
  const se = el("input", { type: "number", min: "0", max: "59", inputmode: "numeric", "aria-label": "Seconds" });
  const fields = el("div", { class: "tm-fields" }, hr, el("label", {}, "hr"), mi, el("label", {}, "min"), se, el("label", {}, "sec"));
  const display = el("div", { class: "tm-display", role: "timer", hidden: "" });
  const live = el("div", { class: "tm-sr", role: "status" });
  const fill = el("div", { class: "tm-fill" });
  const main = el("button", { class: "tm-btn main", type: "button" });
  const reset = el("button", { class: "tm-btn", type: "button", onclick: resetTimer }, "Reset");
  const plus = el("button", { class: "tm-btn", type: "button", onclick: addMinute }, "+1:00");
  const note = el("p", { class: "tm-note", hidden: "" });
  main.addEventListener("click", () => { if (T.state === "running") pauseTimer(); else startTimer(); });

  const readFields = () => {
    const n = (i, max) => Math.min(max, Math.max(0, Math.floor(Number(i.value) || 0)));
    const s = n(hr, 99) * 3600 + n(mi, 59) * 60 + n(se, 59);
    setTotal(s); save(); refresh();
  };
  for (const i of [hr, mi, se]) i.addEventListener("input", readFields);

  let lastAnnounce = "";
  const update = () => {
    const idle = T.state === "idle";
    fields.hidden = !idle; display.hidden = idle;
    if (idle) {
      const s = T.total;
      for (const [i, v] of [[hr, Math.floor(s / 3600)], [mi, Math.floor((s % 3600) / 60)], [se, s % 60]]) if (document.activeElement !== i) i.value = String(v);
    } else if (T.state === "done") { display.textContent = "Time's up"; display.className = "tm-display done"; }
    else { display.textContent = formatClock(timerLeft() / 1000); display.className = "tm-display"; }
    const frac = T.total > 0 ? 1 - timerLeft() / (T.total * 1000) : 0;
    fill.style.width = (idle ? 0 : T.state === "done" ? 100 : Math.min(100, Math.max(0, frac * 100))) + "%";
    main.textContent = T.state === "running" ? "Pause" : T.state === "paused" ? "Resume" : T.state === "done" ? "Restart" : "Start";
    main.disabled = idle && T.total <= 0;
    reset.disabled = idle;
    plus.hidden = T.state === "done";
    const say = T.state === "done" ? "Time's up" : T.state === "running" ? "" : "";
    if (say !== lastAnnounce) { live.textContent = say; lastAnnounce = say; }
  };

  const root = el("section", { class: "tm-card", id: "timer-card", "aria-label": "Timer" },
    el("div", { class: "tm-head" }, el("span", {}, "Timer")),
    fields, display, el("div", { class: "tm-bar" }, fill), el("div", { class: "tm-row" }, main, reset, plus), note, live);
  const view = { kind: "timer", root, update };
  views.push(view);

  // A search such as "5 minute timer" sets and starts the timer
  if (query && query.seconds) {
    const key = "q:" + query.seconds;
    const idle = T.state === "idle" || T.state === "done";
    if (idle) {
      stopAlarm(); T.state = "idle"; setTotal(query.seconds); T.src = key;
      if (navigator.userActivation?.hasBeenActive) startTimer(); else save();
    } else if (T.src !== key) {
      note.hidden = false;
      note.append("A timer is already running. ",
        el("button", { class: "tm-link", type: "button", onclick: () => { resetTimer(); setTotal(query.seconds); T.src = key; startTimer(); note.hidden = true; } },
          `Use ${describe(query.seconds)} instead`));
    }
  }
  update(); ensureTick();
  return root;
}

function stopwatchCard() {
  const display = el("div", { class: "tm-display", role: "timer" });
  const main = el("button", { class: "tm-btn main", type: "button" });
  const lap = el("button", { class: "tm-btn", type: "button", onclick: lapWatch }, "Lap");
  const reset = el("button", { class: "tm-btn", type: "button", onclick: resetWatch }, "Reset");
  const laps = el("ol", { class: "tm-laps", "aria-label": "Laps", reversed: "" });
  main.addEventListener("click", () => { if (W.state === "running") stopWatch(); else startWatch(); });
  let drawnLaps = -1;
  const update = () => {
    display.textContent = formatStopwatch(swElapsed());
    main.textContent = W.state === "running" ? "Stop" : W.state === "stopped" ? "Resume" : "Start";
    lap.disabled = W.state !== "running"; reset.disabled = W.state === "idle";
    if (drawnLaps !== W.laps.length) {
      drawnLaps = W.laps.length;
      laps.replaceChildren(...W.laps.map((total, i) => {
        const prev = W.laps[i + 1] || 0;
        return el("li", {}, el("span", {}, "Lap " + (W.laps.length - i)), el("span", {}, "+" + formatStopwatch(total - prev)), el("span", {}, formatStopwatch(total)));
      }));
    }
  };
  const root = el("section", { class: "tm-card", id: "timer-card", "aria-label": "Stopwatch" },
    el("div", { class: "tm-head" }, el("span", {}, "Stopwatch")),
    display, el("div", { class: "tm-row" }, main, lap, reset), laps);
  views.push({ kind: "stopwatch", root, update });
  update(); ensureTick();
  return root;
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
    const existing = document.getElementById("timer-card");
    if (!agreed()) { if (existing) existing.remove(); updatePill(); return; }

    if (path === "/timer" || path === "/stopwatch") {
      if (existing && existing.closest(".tm-page")) return;
      const isWatch = path === "/stopwatch";
      document.title = (isWatch ? "Stopwatch" : "Timer") + " - SPS Search";
      const secs = parseInt(params.get("s") || "", 10);
      const card = isWatch ? stopwatchCard() : timerCard(secs > 0 && secs <= 359999 ? { seconds: secs } : null);
      app.replaceChildren(el("section", { class: "tm-page" }, el("h1", {}, isWatch ? "Stopwatch" : "Timer"), card));
      return;
    }

    if (path === "/search") {
      const wrap = app.querySelector(".results-wrap");
      if (!wrap || !wrap.firstElementChild) return; // the results page isn't drawn yet; the observer will call us again
      const q = (params.get("q") || "").trim();
      const parsed = parseTimerQuery(q);
      const want = parsed ? (parsed.kind === "stopwatch" ? "stopwatch" : "timer:" + (parsed.seconds || "")) : "";
      if (existing) {
        if (existing.dataset.for === want && existing.parentElement === wrap) return;
        existing.remove();
      }
      if (!want) return;
      const card = parsed.kind === "stopwatch" ? stopwatchCard() : timerCard(parsed);
      card.dataset.for = want;
      wrap.firstElementChild.after(card); // right under the search box
      return;
    }
    if (existing && !existing.closest(".tm-page")) existing.remove();
  } finally { busy = false; updatePill(); }
}

new MutationObserver(sync).observe(app, { childList: true });
addEventListener("hashchange", () => setTimeout(sync, 0));
if (T.state === "running" || W.state === "running") ensureTick();
sync();
