// Per-device settings, kept in localStorage. Everything is off unless listed here as on.
const KEY = "sps_settings";
const DEFAULTS = { overview: false, aionline: false };

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
export function getSetting(name) { return getSettings()[name]; }
export function setSetting(name, value) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), [name]: value })); return true; }
  catch { return false; }
}
