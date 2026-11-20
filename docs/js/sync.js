// Keeps search history the same on this site and in the SPS Search New Tab extension, on this device.
// The extension adds a small script to this page that can read and write its saved data. This file talks to it with
// window.postMessage. Nothing is sent over the internet: both sides are storage on this same computer.
// If the extension isn't installed, nothing happens.
import * as pf from "./profiles.js";
import { sanitizeView, mergeViews, canon } from "./sync-merge.js";
import * as be from "./backend.js";

const PREF = "sps_sync"; // "off" turns it off; anything else (or nothing) means on
export const isEnabled = () => { try { return localStorage.getItem(PREF) !== "off"; } catch { return true; } };
export function setEnabled(on) {
  try { on ? localStorage.removeItem(PREF) : localStorage.setItem(PREF, "off"); } catch { /* fine */ }
  if (on) schedule(0); else status = { state: "off", at: 0 };
}

let status = { state: "unknown", at: 0 }; // unknown | off | none (no extension) | ok | error
export const getStatus = () => (isEnabled() ? status : { state: "off", at: 0 });

// ----- talking to the extension -----
const pending = new Map();
let nextId = 1;
function call(type, payload = {}, timeout = 1500) {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeout);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    window.postMessage({ source: "sps-site", type, id, ...payload }, location.origin);
  });
}
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== "sps-ext") return;
  if (typeof m.id === "number" && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); }
  else if (m.type === "changed") schedule(300); // the extension's data changed (e.g. a search made on its new tab page)
});

// ----- syncing -----
let inflight = null, again = false, timer = 0;
export function schedule(ms = 600) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

// Only one sync runs at a time. Asking while one is running waits for that one and then runs once more.
export function syncNow() {
  if (inflight) { again = true; return inflight; }
  inflight = run().finally(() => { inflight = null; if (again) { again = false; schedule(300); } });
  return inflight;
}

// ----- the signed-in account (saves history online so other devices can see it) -----
const CPREF = "sps_cloud_sync"; // "on" = on. Off unless the person turns it on, because it sends history over the internet.
export const isCloudEnabled = () => { try { return localStorage.getItem(CPREF) === "on"; } catch { return false; } };
export function setCloudEnabled(on) {
  try { on ? localStorage.setItem(CPREF, "on") : localStorage.removeItem(CPREF); } catch { /* fine */ }
  cloud = { state: on ? "unknown" : "off", at: 0 };
  if (on) schedule(0);
}
let user = null;
export function setUser(u) { const was = user && user.uid; user = u || null; if ((user && user.uid) !== was) { cloud = { state: "unknown", at: 0 }; schedule(300); } }
let cloud = { state: "off", at: 0 }; // off | signin | ok | error | unknown
export const getCloudStatus = () => (!isCloudEnabled() ? { state: "off", at: 0 } : !user ? { state: "signin", at: 0 } : cloud);
export async function deleteCloudCopy() {
  if (!user) throw new Error("Sign in first.");
  await be.deleteHistory(user);
}
// PINs stay on the devices: they are never sent online.
const noPins = (v) => ({ ...v, list: v.list.map(({ pin, ...p }) => p) });

async function run() {
  const wantExt = isEnabled(), wantCloud = isCloudEnabled() && !!user;
  if (!wantExt) status = { state: "off", at: 0 };
  if (!wantCloud) cloud = { state: isCloudEnabled() ? "signin" : "off", at: 0 };
  if (!wantExt && !wantCloud) return status;
  try {
    let m = sanitizeView(pf.exportShared());
    if (!m) { status = { state: "error", at: Date.now() }; return status; }
    const mine = m;
    let theirs = null, extOk = false, alias = {};
    if (wantExt) {
      const reply = await call("get");
      if (!reply || !reply.ok) status = { state: reply ? "error" : "none", at: Date.now() };
      else { extOk = true; theirs = sanitizeView(reply.view); }
    }
    const join = (x, y) => { // x, y: views. Returns the merge and chains the alias maps.
      const r = mergeViews(x, y);
      for (const k of Object.keys(alias)) alias[k] = r.alias[alias[k]] || alias[k];
      for (const [k, v] of Object.entries(r.alias)) if (!(k in alias)) alias[k] = v;
      return r;
    };
    if (theirs) m = join(m, theirs);

    if (wantCloud) {
      try {
        const raw = await be.getHistory(user);
        let c = null;
        try { c = raw ? sanitizeView(JSON.parse(raw)) : null; } catch { c = null; }
        const pins = new Map(m.list.filter((p) => p.pin).map((p) => [p.id, p.pin]));
        if (c) {
          const r = join(noPins(m), c);
          for (const p of r.list) { const pin = pins.get(p.id) || [...pins].find(([id]) => (alias[id] || id) === p.id)?.[1]; if (pin) p.pin = pin; }
          m = r;
        }
        const after = canon(noPins(m));
        if (!c || canon(noPins(c)) !== after) await be.setHistory(user, JSON.stringify(noPins(m)));
        cloud = { state: "ok", at: Date.now() };
      } catch { cloud = { state: "error", at: Date.now() }; }
    }

    m = { ...m, alias };
    const hasAlias = Object.keys(alias).length > 0;
    if (canon(mine) !== canon(m) || hasAlias) {
      pf.importShared(m);
      window.dispatchEvent(new CustomEvent("sps-profiles-changed"));
    }
    if (extOk) {
      let failed = false;
      if (!theirs || canon(theirs) !== canon(m) || hasAlias) { const r = await call("set", { view: m }); failed = !(r && r.ok); }
      status = { state: failed ? "error" : "ok", at: Date.now() };
    }
    return status;
  } catch {
    status = { state: "error", at: Date.now() };
    return status;
  }
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  pf.onChange(() => schedule(800)); // after a search, a deletion, a profile change...
  addEventListener("focus", () => schedule(300));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(300); });
  schedule(0);
}
