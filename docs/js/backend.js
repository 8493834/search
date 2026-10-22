// Picks which service to use: Firebase normally, Supabase if Firebase can't be reached.
import * as fb from "./backend-firebase.js";
import { FIREBASE_CONFIG, FIREBASE_READY, SUPABASE_READY } from "./config.js";

export const { PANEL_TYPES, LINK_LABELS, isAdmin, cleanUrl, panelFields } = fb;

async function canReach(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try { await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctl.signal }); return true; }
  catch { return false; } finally { clearTimeout(timer); }
}

// "Test backup" mode: only the backup services are used (admin switch in the top bar).
export const isTestBackup = () => { try { return localStorage.getItem("backend") === "supabase"; } catch { return false; } };
export function setTestBackup(on) { try { on ? localStorage.setItem("backend", "supabase") : localStorage.removeItem("backend"); return true; } catch { return false; } }

let chosen = null;
function pick() {
  if (!chosen) chosen = (async () => {
    if (!SUPABASE_READY) return fb;
    if (!FIREBASE_READY) return import("./backend-supabase.js");
    try { if (localStorage.getItem("backend") === "supabase") return import("./backend-supabase.js"); } catch {}
    const ok = (await Promise.all([
      canReach(`https://${FIREBASE_CONFIG.authDomain}/__/firebase/init.json`),
      canReach("https://firestore.googleapis.com/"),
    ])).every(Boolean);
    return ok ? fb : import("./backend-supabase.js");
  })();
  return chosen;
}
const call = (name) => async (...a) => (await pick())[name](...a);

export const onUser = call("onUser");
export const signIn = call("signIn");
export const signOut = call("signOut");
export const signInForApp = call("signInForApp");
export const signInWithHandoff = call("signInWithHandoff");
export const submitRequest = call("submitRequest");
export const listSites = call("listSites");
export const listMyRequests = call("listMyRequests");
export const listPending = call("listPending");
export const acceptRequest = call("acceptRequest");
export const denyRequest = call("denyRequest");
export const deleteSite = call("deleteSite");
export const addSiteDirectly = call("addSiteDirectly");
export const submitPanelRequest = call("submitPanelRequest");
export const savePanel = call("savePanel");
export const updateSite = call("updateSite");
export const listMyPanelRequests = call("listMyPanelRequests");
export const listPendingPanelRequests = call("listPendingPanelRequests");
export const listPanels = call("listPanels");
export const acceptPanelRequest = call("acceptPanelRequest");
export const denyPanelRequest = call("denyPanelRequest");
export const deletePanel = call("deletePanel");

// ---- Backup check: is everything saved on both services? ----
const PROVIDERS = {
  firebase: { name: "Firebase", ready: FIREBASE_READY, load: async () => fb },
  supabase: { name: "Supabase", ready: SUPABASE_READY, load: () => import("./backend-supabase.js") },
};
const siteKey = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "").toLowerCase() + x.pathname.replace(/\/$/, "") + x.search; } catch { return String(u); } };

/** Compares both services. Returns null if only one is set up. */
export async function backupStatus() {
  if (!PROVIDERS.firebase.ready || !PROVIDERS.supabase.ready) return null;
  const read = async (id) => {
    try {
      const m = await PROVIDERS[id].load();
      const [sites, panels] = await Promise.all([m.listSites(), m.listPanels()]);
      return { ok: true, sites, panels };
    } catch (e) { return { ok: false, error: e.message || String(e), sites: [], panels: [] }; }
  };
  const [firebase, supabase] = await Promise.all([read("firebase"), read("supabase")]);
  const have = { firebase, supabase };
  const missing = { firebase: { sites: [], panels: [] }, supabase: { sites: [], panels: [] } };
  for (const [from, to] of [["firebase", "supabase"], ["supabase", "firebase"]]) {
    if (!have[from].ok || !have[to].ok) continue; // can't compare if one side wasn't readable
    const sk = new Set(have[to].sites.map((x) => siteKey(x.url)));
    const pk = new Set(have[to].panels.map((x) => x.id));
    missing[to].sites = have[from].sites.filter((x) => !sk.has(siteKey(x.url)));
    missing[to].panels = have[from].panels.filter((x) => !pk.has(x.id));
  }
  return { have, missing, names: { firebase: "Firebase", supabase: "Supabase" } };
}

/** Copies the given sites and panels into one service ("firebase" or "supabase"). Needs the admin signed in there. */
export async function backupTo(target, { sites = [], panels = [] }) {
  const m = await PROVIDERS[target].load();
  const user = await m.whoami();
  if (!user || !isAdmin(user)) { const e = new Error(`Sign in to ${PROVIDERS[target].name} as the admin first.`); e.code = "NEEDS_SIGNIN"; throw e; }
  for (const s of sites) await m.addSiteDirectly(user, s.url, s.description || "");
  for (const p of panels) {
    const links = {};
    for (const l of p.links || []) { const i = String(l).indexOf(": "); if (i > 0) links[l.slice(0, i)] = l.slice(i + 2); }
    await m.savePanel(user, p.id, { name: p.name, type: p.type, website: p.website || "", summary: p.summary,
      facts: (p.facts || []).join("\n"), links }, p.aliases || []);
  }
  return sites.length + panels.length;
}
export async function signInTo(target) { return (await PROVIDERS[target].load()).signIn(); }
