// Merging search history between the site and the SPS Search New Tab extension. Pure functions, no page code.
//
// A "view" is the part of the profiles that is shared:
//   { list: [{ id, name, historyOn, history: [{q, t}], del: { "lower case search": deletedAtMs }, clearedAt, updatedAt, pin? }],
//     gone: { profileId: deletedAtMs } }
// Not shared: which profile is active, profile colours, and each side's own settings (the extension's shortcuts and
// counter, the site's Overview switches).
//
// Deleting is remembered ("del", "clearedAt", "gone"), so something deleted on one side is not brought back by the other.
// A search done again after it was deleted is newer than the deletion, so it stays.

export const MAX_HISTORY = 100;
export const MAX_PROFILES = 8;
const MAX_DEL = 200;
const KEEP_DELETIONS_MS = 90 * 24 * 3600 * 1000;

const isNum = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const str = (s, max) => (typeof s === "string" ? s.slice(0, max) : "");

/** Takes anything and returns a clean view (or null if it isn't one). Never trusts the shape of what it is given. */
export function sanitizeView(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
  const list = [];
  for (const p of v.list.slice(0, MAX_PROFILES)) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) continue;
    const name = str(p.name, 24).trim();
    if (!name) continue;
    const history = [];
    if (Array.isArray(p.history)) {
      for (const h of p.history.slice(0, MAX_HISTORY * 2)) {
        if (h && typeof h.q === "string" && h.q.trim() && isNum(h.t)) history.push({ q: h.q.trim().slice(0, 200), t: h.t });
      }
    }
    const del = {};
    if (p.del && typeof p.del === "object") {
      for (const [k, t] of Object.entries(p.del).slice(0, MAX_DEL * 2)) if (isNum(t)) del[str(k, 200).toLowerCase()] = t;
    }
    const out = { id: p.id, name, historyOn: p.historyOn !== false, history, del, clearedAt: isNum(p.clearedAt) ? p.clearedAt : 0, updatedAt: isNum(p.updatedAt) ? p.updatedAt : 0 };
    if (p.pin && typeof p.pin === "object" && typeof p.pin.salt === "string" && typeof p.pin.hash === "string" && p.pin.salt.length <= 64 && p.pin.hash.length <= 128) {
      out.pin = { salt: p.pin.salt, hash: p.pin.hash };
    }
    list.push(out);
  }
  const gone = {};
  if (v.gone && typeof v.gone === "object") {
    for (const [id, t] of Object.entries(v.gone).slice(0, 100)) if (/^[A-Za-z0-9_-]{1,40}$/.test(id) && isNum(t)) gone[id] = t;
  }
  return list.length ? { list, gone } : null;
}

const lower = (q) => q.toLowerCase();

function prune(p, now) {
  // keep at most MAX_DEL remembered deletions, dropping the oldest and anything older than 90 days
  const entries = Object.entries(p.del).filter(([, t]) => now - t < KEEP_DELETIONS_MS).sort((a, b) => b[1] - a[1]).slice(0, MAX_DEL);
  p.del = Object.fromEntries(entries);
  return p;
}

function mergeHistory(a, b, del, clearedAt) {
  const best = new Map();
  for (const h of [...a, ...b]) {
    const k = lower(h.q);
    const cur = best.get(k);
    if (!cur || h.t > cur.t) best.set(k, h);
  }
  return [...best.values()]
    .filter((h) => h.t > clearedAt && !(lower(h.q) in del && del[lower(h.q)] >= h.t))
    .sort((x, y) => y.t - x.t || (x.q < y.q ? -1 : 1))
    .slice(0, MAX_HISTORY);
}

const isPristine = (p) => p.name === "Me" && !p.history.length && !p.updatedAt && !p.pin && !p.clearedAt && !Object.keys(p.del).length;

/** Merges two clean views into one. The result is the same whichever way round they are given (apart from ties). */
export function mergeViews(a, b, now = Date.now()) {
  // Profiles that exist on one side only but have the same name are the same person's profile (each side made its own "Me"
  // before they were ever synced). They are joined under one id; "alias" says which old id became which, so each side can
  // keep what is only its own (the extension's shortcuts, the site's settings) when its profile gets the new id.
  const alias = {};
  {
    const aIds = new Set(a.list.map((p) => p.id)), bIds = new Set(b.list.map((p) => p.id));
    const onlyB = b.list.filter((p) => !aIds.has(p.id));
    const used = new Set();
    for (const pa of a.list.filter((p) => !bIds.has(p.id))) {
      const pb = onlyB.find((p) => !used.has(p.id) && lower(p.name) === lower(pa.name));
      if (!pb) continue;
      used.add(pb.id);
      if (pa.id < pb.id) alias[pb.id] = pa.id; else alias[pa.id] = pb.id;
    }
    const remap = (v) => ({ ...v, list: v.list.map((p) => (alias[p.id] ? { ...p, id: alias[p.id] } : p)) });
    if (Object.keys(alias).length) { a = remap(a); b = remap(b); }
  }
  const gone = { ...a.gone };
  for (const [id, t] of Object.entries(b.gone)) gone[id] = Math.max(gone[id] || 0, t);
  for (const id of Object.keys(gone)) if (now - gone[id] > KEEP_DELETIONS_MS) delete gone[id];

  const byId = new Map();
  for (const p of a.list) byId.set(p.id, { a: p });
  for (const p of b.list) byId.set(p.id, { ...(byId.get(p.id) || {}), b: p });

  let list = [];
  for (const [id, { a: pa, b: pb }] of byId) {
    const newest = Math.max(pa ? pa.updatedAt : 0, pb ? pb.updatedAt : 0);
    if (gone[id] && gone[id] >= newest) continue; // deleted on one side, and not changed since
    if (pa && pb) {
      const win = pb.updatedAt > pa.updatedAt ? pb : pa; // the more recently changed side decides name, history on/off and PIN
      const del = { ...pa.del };
      for (const [k, t] of Object.entries(pb.del)) del[k] = Math.max(del[k] || 0, t);
      const clearedAt = Math.max(pa.clearedAt, pb.clearedAt);
      const m = { id, name: win.name, historyOn: win.historyOn, history: [], del, clearedAt, updatedAt: newest };
      if (win.pin) m.pin = win.pin;
      m.history = mergeHistory(pa.history, pb.history, del, clearedAt);
      list.push(prune(m, now));
    } else {
      const p = pa || pb;
      list.push(prune({ ...p, history: mergeHistory(p.history, [], p.del, p.clearedAt) }, now));
    }
  }

  // Each side makes a plain "Me" profile on first run, with different ids. Once either side has real data, drop the empty ones.
  const real = list.filter((p) => !isPristine(p));
  if (real.length) list = real;
  else if (list.length > 1) list = [list.slice().sort((x, y) => (x.id < y.id ? -1 : 1))[0]];

  list.sort((x, y) => (x.id < y.id ? -1 : 1));
  return { list: list.slice(0, MAX_PROFILES), gone, alias };
}

/** One stable string for a view, so two views can be compared for "has anything changed?". */
export function canon(v) {
  const p = v.list.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).map((x) => ({
    id: x.id, name: x.name, historyOn: x.historyOn, clearedAt: x.clearedAt, updatedAt: x.updatedAt, pin: x.pin ? [x.pin.salt, x.pin.hash] : null,
    del: Object.entries(x.del).sort((m, n) => (m[0] < n[0] ? -1 : 1)),
    history: x.history.slice().sort((m, n) => n.t - m.t || (m.q < n.q ? -1 : 1)).map((h) => [h.q, h.t]),
  }));
  return JSON.stringify([p, Object.entries(v.gone).sort((m, n) => (m[0] < n[0] ? -1 : 1))]);
}
