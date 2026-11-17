// Profiles and search history. Everything is kept in this browser (localStorage) and nothing is sent anywhere.
// Each profile has its own name, settings and search history, so people sharing a device don't share them.
const KEY = "sps_profiles";
const OLD_SETTINGS_KEY = "sps_settings"; // settings from before profiles existed move into the first profile
const MAX_HISTORY = 100;
export const COLORS = ["#2436e8", "#0f9d6b", "#d9480f", "#a21caf", "#b8860b", "#0e7490"];

const uid = () => Math.random().toString(36).slice(2, 10);
const make = (name, i, extra = {}) => ({ id: uid(), name, color: COLORS[i % COLORS.length], historyOn: true, history: [], settings: {}, ...extra });

let mem = null; // used only if localStorage is blocked, so the page still works until it is closed

function load() {
  if (mem) return mem;
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.list) && d.list.length) return d;
  } catch {}
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(OLD_SETTINGS_KEY) || "{}") || {}; } catch {}
  const first = make("Me", 0, { settings });
  return { active: first.id, list: [first] };
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); mem = null; return true; }
  catch { mem = d; return false; }
}
// Create the first profile straight away so it is remembered.
export function init() { const d = load(); save(d); return d; }

const withActive = (d) => d.list.find((p) => p.id === d.active) || d.list[0];

export const listProfiles = () => load().list.map((p) => ({ id: p.id, name: p.name, color: p.color, count: p.history.length, pin: !!p.pin }));
export const activeProfile = () => { const p = withActive(load()); return { id: p.id, name: p.name, color: p.color, historyOn: p.historyOn, pin: !!p.pin }; };

export function switchTo(id) {
  const d = load();
  if (!d.list.some((p) => p.id === id)) return false;
  d.active = id; return save(d);
}
export function addProfile(name) {
  const d = load();
  name = String(name || "").trim().slice(0, 24);
  if (!name || d.list.length >= 8) return null;
  const p = make(name, d.list.length); d.list.push(p); d.active = p.id; save(d); return p.id;
}
export function renameProfile(id, name) {
  const d = load(); const p = d.list.find((x) => x.id === id);
  name = String(name || "").trim().slice(0, 24);
  if (!p || !name) return false;
  p.name = name; return save(d);
}
/** Deletes the profile with its history and settings. The last profile can't be deleted. */
export function deleteProfile(id) {
  const d = load();
  if (d.list.length < 2) return false;
  d.list = d.list.filter((p) => p.id !== id);
  if (d.active === id) d.active = d.list[0].id;
  return save(d);
}

/* ---------- optional PIN ----------
   A courtesy lock for people who share a device: switching to a locked profile (or opening the site in a new
   browser tab or session) asks for its PIN. The PIN is stored only as a salted hash. It keeps casual snooping out,
   but it does not encrypt anything: the data is still in this browser's storage. */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function derive(pin, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(salt), iterations: 150000, hash: "SHA-256" }, key, 256));
}
export const PIN_RE = /^\d{4,8}$/;
const unlockedIds = () => { try { return JSON.parse(sessionStorage.getItem("sps_unlocked") || "[]"); } catch { return []; } };
const markUnlocked = (id) => { try { sessionStorage.setItem("sps_unlocked", JSON.stringify([...new Set([...unlockedIds(), id])])); } catch {} };
const findP = (d, id) => d.list.find((p) => p.id === id);
export const hasPin = (id) => !!findP(load(), id)?.pin;
export const isUnlocked = (id) => !hasPin(id) || unlockedIds().includes(id);
export const activeLocked = () => !isUnlocked(withActive(load()).id);
export async function verifyPin(id, pin) {
  const p = findP(load(), id);
  if (!p || !p.pin) return true;
  if ((await derive(String(pin), p.pin.salt)) !== p.pin.hash) return false;
  markUnlocked(id); return true;
}
export async function setPin(id, pin) {
  if (!PIN_RE.test(String(pin))) return false;
  const d = load(); const p = findP(d, id); if (!p) return false;
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  p.pin = { salt, hash: await derive(String(pin), salt) };
  save(d); markUnlocked(id); return true;
}
export function removePin(id) { // the caller checks the current PIN first
  const d = load(); const p = findP(d, id); if (!p) return false; delete p.pin; return save(d);
}
/** "Forgot PIN": erases the profile (history, settings, PIN). The last profile is wiped but kept. */
export function resetProfile(id) {
  const d = load();
  if (d.list.length > 1) return deleteProfile(id);
  const p = findP(d, id); if (!p) return false;
  p.history = []; p.settings = {}; delete p.pin; p.historyOn = true; return save(d);
}

/* ---------- per-profile settings ---------- */
export function getProfileSettings() { return activeLocked() ? {} : { ...withActive(load()).settings }; }
export function setProfileSetting(name, value) {
  const d = load(); const p = withActive(d);
  p.settings = { ...p.settings, [name]: value }; return save(d);
}

/* ---------- search history ---------- */
export const getHistory = () => (activeLocked() ? [] : withActive(load()).history.slice());
export const isHistoryOn = () => !activeLocked() && withActive(load()).historyOn;
export function setHistoryOn(on) {
  const d = load(); const p = withActive(d); p.historyOn = !!on; return save(d); // turning it off keeps what is saved until you delete it
}
export function addSearch(q) {
  q = String(q || "").trim().slice(0, 200);
  const d = load(); const p = withActive(d);
  if (!q || !p.historyOn || activeLocked()) return;
  p.history = [{ q, t: Date.now() }, ...p.history.filter((x) => x.q.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY);
  save(d);
}
export function deleteSearch(q) {
  const d = load(); const p = withActive(d);
  p.history = p.history.filter((x) => x.q !== q); return save(d);
}
export function clearHistory() {
  const d = load(); const p = withActive(d); p.history = []; return save(d);
}
/** Recent searches that start with or contain the typed text (newest first). */
export function suggest(text, limit = 6) {
  const t = String(text || "").trim().toLowerCase();
  const h = getHistory();
  const starts = h.filter((x) => x.q.toLowerCase().startsWith(t));
  const rest = t ? h.filter((x) => !x.q.toLowerCase().startsWith(t) && x.q.toLowerCase().includes(t)) : [];
  return [...starts, ...rest].slice(0, limit);
}
