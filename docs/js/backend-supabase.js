// Backup for Firebase: Supabase (Google sign-in + the same lists). Only used when Firebase can't be reached.
import { SUPABASE_CONFIG, SUPABASE_READY, SITE_URL } from "./config.js";
import { cleanUrl, panelFields } from "./backend-firebase.js";

let sb = null;
async function load() {
  if (!SUPABASE_READY) throw new Error("The backup service isn't set up yet. See SETUP-BACKUPS.md.");
  if (sb) return sb;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  sb = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  return sb;
}
const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "").toLowerCase();
const newestFirst = (a, b) => b.ts - a.ts;
const asUser = (u) => u && { uid: u.id, email: u.email, emailVerified: true, displayName: u.user_metadata?.full_name || "" };

export async function onUser(cb) {
  const c = await load();
  c.auth.onAuthStateChange((_e, session) => cb(asUser(session?.user)));
  cb(asUser((await c.auth.getSession()).data.session?.user));
}
export async function signIn() {
  const c = await load();
  ok(await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: SITE_URL } }));
}
export async function signOut() { const c = await load(); await c.auth.signOut(); }
export async function signInForApp() { throw new Error("App sign-in isn't available on the backup service. Try again when Firebase is reachable."); }
export const signInWithHandoff = signInForApp;

const site = (r) => ({ id: r.id, url: r.url, description: r.description || "", requestedBy: r.requested_by || "", ts: Date.parse(r.added_at) || 0 });
const req = (r) => ({ id: r.id, url: r.url, description: r.description || "", uid: r.uid, email: r.email, status: r.status, ts: Date.parse(r.created_at) || 0 });
const panel = (r) => ({ id: r.id, name: r.name, type: r.type, website: r.website || "", summary: r.summary, facts: r.facts || [], links: r.links || [],
  aliases: r.aliases || [], requestedBy: r.requested_by || "", uid: r.uid, email: r.email, status: r.status, ts: Date.parse(r.added_at || r.created_at) || 0 });

export async function listSites() { const c = await load(); return ok(await c.from("sites").select("*")).map(site).sort(newestFirst); }
export async function listMyRequests(user) { const c = await load(); return ok(await c.from("requests").select("*").eq("uid", user.uid)).map(req).sort(newestFirst); }
export async function listPending() { const c = await load(); return ok(await c.from("requests").select("*").eq("status", "pending")).map(req).sort(newestFirst); }

export async function submitRequest(user, rawUrl, description) {
  const c = await load();
  const url = cleanUrl(rawUrl), host = hostOf(url);
  if ((await listSites()).some((s) => hostOf(s.url) === host)) throw new Error(`${host} is already in the index.`);
  if ((await listMyRequests(user)).some((r) => r.status === "pending" && hostOf(r.url) === host)) throw new Error(`You already have a pending request for ${host}.`);
  ok(await c.from("requests").insert({ url, description: description.trim().slice(0, 300), uid: user.uid, email: user.email, status: "pending" }));
}
export async function acceptRequest(r) {
  const c = await load();
  ok(await c.from("sites").insert({ id: r.id, url: r.url, description: r.description || "", requested_by: r.email || "" }));
  ok(await c.from("requests").update({ status: "approved" }).eq("id", r.id));
}
export async function denyRequest(r) { const c = await load(); ok(await c.from("requests").update({ status: "denied" }).eq("id", r.id)); }
export async function deleteSite(s) { const c = await load(); ok(await c.from("sites").delete().eq("id", s.id)); }
export async function addSiteDirectly(user, rawUrl, description = "") {
  const c = await load();
  ok(await c.from("sites").insert({ url: cleanUrl(rawUrl), description: description.trim().slice(0, 300), requested_by: user.email }));
}
export async function updateSite(id, rawUrl, description) {
  const c = await load();
  ok(await c.from("sites").update({ url: cleanUrl(rawUrl), description: String(description || "").trim().slice(0, 300) }).eq("id", id));
}

export async function submitPanelRequest(user, f) {
  const c = await load();
  ok(await c.from("panel_requests").insert({ ...panelFields(f), uid: user.uid, email: user.email, status: "pending" }));
}
export async function savePanel(user, id, f, aliases) {
  const c = await load();
  const row = { ...panelFields(f), aliases: aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 12), requested_by: user.email };
  ok(id ? await c.from("panels").upsert({ id, ...row }) : await c.from("panels").insert(row));
}
export async function listMyPanelRequests(user) { const c = await load(); return ok(await c.from("panel_requests").select("*").eq("uid", user.uid)).map(panel).sort(newestFirst); }
export async function listPendingPanelRequests() { const c = await load(); return ok(await c.from("panel_requests").select("*").eq("status", "pending")).map(panel).sort(newestFirst); }
export async function listPanels() { const c = await load(); return ok(await c.from("panels").select("*")).map(panel).sort(newestFirst); }
export async function acceptPanelRequest(r, aliases) {
  const c = await load();
  ok(await c.from("panels").upsert({ id: r.id, name: r.name, type: r.type, website: r.website || "", summary: r.summary, facts: r.facts || [], links: r.links || [], aliases, requested_by: r.email || "" }));
  ok(await c.from("panel_requests").update({ status: "approved" }).eq("id", r.id));
}
export async function denyPanelRequest(r) { const c = await load(); ok(await c.from("panel_requests").update({ status: "denied" }).eq("id", r.id)); }
export async function deletePanel(p) { const c = await load(); ok(await c.from("panels").delete().eq("id", p.id)); }
