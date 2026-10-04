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
