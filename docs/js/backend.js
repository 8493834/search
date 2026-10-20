// Everything that talks to Firebase (Google sign-in + the site list).
import { FIREBASE_CONFIG, FIREBASE_READY, ADMIN_EMAIL } from "./config.js";

const V = "10.12.2";
let fb = null; // lazily loaded so search works even if Firebase isn't configured

async function load() {
  if (!FIREBASE_READY) throw new Error("Firebase is not configured yet. See README.md, step 2.");
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(FIREBASE_CONFIG);
  fb = { auth, store, authInst: auth.getAuth(a), db: store.getFirestore(a) };
  return fb;
}

export const isAdmin = (user) =>
  !!user && user.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

export async function onUser(cb) {
  if (!FIREBASE_READY) return cb(null);
  const { auth, authInst } = await load();
  auth.onAuthStateChanged(authInst, cb);
}

export async function signIn() {
  const { auth, authInst } = await load();
  await auth.signInWithPopup(authInst, new auth.GoogleAuthProvider());
}

export async function signOut() {
  const { auth, authInst } = await load();
  await auth.signOut(authInst);
}

export function cleanUrl(input) {
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error("Enter a full address that starts with http:// or https://");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http:// and https:// addresses can be added.");
  u.hash = "";
  return u.toString();
}

const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "").toLowerCase();

export async function submitRequest(user, rawUrl, description) {
  const { store, db } = await load();
  const url = cleanUrl(rawUrl);
  const host = hostOf(url);
  const sites = await listSites();
  if (sites.some((s) => hostOf(s.url) === host)) throw new Error(`${host} is already in the index.`);
  const mine = await listMyRequests(user);
  if (mine.some((r) => r.status === "pending" && hostOf(r.url) === host))
    throw new Error(`You already have a pending request for ${host}.`);
  await store.addDoc(store.collection(db, "requests"), {
    url,
    description: description.trim().slice(0, 300),
    uid: user.uid,
    email: user.email,
    status: "pending",
    createdAt: store.serverTimestamp(),
  });
}

const toRow = (d) => {
  const x = d.data();
  return { id: d.id, ...x, ts: x.createdAt?.toMillis?.() ?? x.addedAt?.toMillis?.() ?? 0 };
};
const newestFirst = (a, b) => b.ts - a.ts;

export async function listSites() {
  const { store, db } = await load();
  const snap = await store.getDocs(store.collection(db, "sites"));
  return snap.docs.map(toRow).sort(newestFirst);
}

export async function listMyRequests(user) {
  const { store, db } = await load();
  const q = store.query(store.collection(db, "requests"), store.where("uid", "==", user.uid));
  return (await store.getDocs(q)).docs.map(toRow).sort(newestFirst);
}

export async function listPending() {
  const { store, db } = await load();
  const q = store.query(store.collection(db, "requests"), store.where("status", "==", "pending"));
  return (await store.getDocs(q)).docs.map(toRow).sort(newestFirst);
}

export async function acceptRequest(req) {
  const { store, db } = await load();
  const batch = store.writeBatch(db);
  batch.set(store.doc(db, "sites", req.id), {
    url: req.url,
    description: req.description || "",
    requestedBy: req.email || "",
    addedAt: store.serverTimestamp(),
  });
  batch.update(store.doc(db, "requests", req.id), { status: "approved" });
  await batch.commit();
}

export async function denyRequest(req) {
  const { store, db } = await load();
  await store.updateDoc(store.doc(db, "requests", req.id), { status: "denied" });
}

export async function deleteSite(site) {
  const { store, db } = await load();
  await store.deleteDoc(store.doc(db, "sites", site.id));
}

export async function addSiteDirectly(user, rawUrl, description = "") {
  const { store, db } = await load();
  await store.addDoc(store.collection(db, "sites"), {
    url: cleanUrl(rawUrl),
    description: description.trim().slice(0, 300),
    requestedBy: user.email,
    addedAt: store.serverTimestamp(),
  });
}

// ---- Desktop app sign-in ----
// Google blocks sign-in inside app windows, so the desktop app sends you to your normal browser.
// The browser signs in, then hands the result back to the app through the spssearch:// link.
export async function signInForApp() {
  const { auth, authInst } = await load();
  const result = await auth.signInWithPopup(authInst, new auth.GoogleAuthProvider());
  const cred = auth.GoogleAuthProvider.credentialFromResult(result);
  return { idToken: cred?.idToken || "", accessToken: cred?.accessToken || "" };
}

export async function signInWithHandoff({ idToken, accessToken }) {
  const { auth, authInst } = await load();
  await auth.signInWithCredential(authInst, auth.GoogleAuthProvider.credential(idToken || null, accessToken || null));
}

// ---- Knowledge panels ----
export const PANEL_TYPES = ["Company", "Organisation", "Country", "Place", "Person", "Product", "Other"];
const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => x.slice(0, 120));

export const LINK_LABELS = ["Wikipedia", "X", "Instagram", "Facebook", "YouTube", "LinkedIn", "TikTok", "GitHub"];

/** Checks and cleans what was typed in a panel form. */
export function panelFields(f) {
  const name = String(f.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Enter the name.");
  const summary = String(f.summary || "").trim().slice(0, 400);
  if (summary.length < 20) throw new Error("Write a short description (at least a sentence).");
  const website = f.website && f.website.trim() ? cleanUrl(f.website) : "";
  if (!PANEL_TYPES.includes(f.type)) throw new Error("Choose a type.");
  const links = [];
  for (const [label, raw] of Object.entries(f.links || {})) {
    if (!raw || !String(raw).trim() || !LINK_LABELS.includes(label)) continue;
    links.push(`${label}: ${cleanUrl(raw)}`);
  }
  return { name, type: f.type, website, summary, facts: lines(f.facts), links };
}

export async function submitPanelRequest(user, f) {
  const { store, db } = await load();
  await store.addDoc(store.collection(db, "panelRequests"), {
    ...panelFields(f),
    uid: user.uid, email: user.email, status: "pending", createdAt: store.serverTimestamp(),
  });
}

// Admin: create or change an approved panel. Using a built-in panel's id replaces that built-in panel.
export async function savePanel(user, id, f, aliases) {
  const { store, db } = await load();
  const data = { ...panelFields(f), aliases: aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 12),
    requestedBy: user.email, addedAt: store.serverTimestamp() };
  if (id) await store.setDoc(store.doc(db, "panels", id), data);
  else await store.addDoc(store.collection(db, "panels"), data);
}

// Admin: change a site's address or description.
export async function updateSite(id, rawUrl, description) {
  const { store, db } = await load();
  await store.updateDoc(store.doc(db, "sites", id), { url: cleanUrl(rawUrl), description: String(description || "").trim().slice(0, 300) });
}

export async function listMyPanelRequests(user) {
  const { store, db } = await load();
  const q = store.query(store.collection(db, "panelRequests"), store.where("uid", "==", user.uid));
  return (await store.getDocs(q)).docs.map(toRow).sort(newestFirst);
}

export async function listPendingPanelRequests() {
  const { store, db } = await load();
  const q = store.query(store.collection(db, "panelRequests"), store.where("status", "==", "pending"));
  return (await store.getDocs(q)).docs.map(toRow).sort(newestFirst);
}

export async function listPanels() {
  const { store, db } = await load();
  const snap = await store.getDocs(store.collection(db, "panels"));
  return snap.docs.map(toRow).sort(newestFirst);
}

export async function acceptPanelRequest(req, aliases) {
  const { store, db } = await load();
  const batch = store.writeBatch(db);
  batch.set(store.doc(db, "panels", req.id), {
    name: req.name, type: req.type, website: req.website || "", summary: req.summary,
    facts: req.facts || [], links: req.links || [], aliases, requestedBy: req.email || "", addedAt: store.serverTimestamp(),
  });
  batch.update(store.doc(db, "panelRequests", req.id), { status: "approved" });
  await batch.commit();
}

export async function denyPanelRequest(req) {
  const { store, db } = await load();
  await store.updateDoc(store.doc(db, "panelRequests", req.id), { status: "denied" });
}

export async function deletePanel(panel) {
  const { store, db } = await load();
  await store.deleteDoc(store.doc(db, "panels", panel.id));
}
