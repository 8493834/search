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
