// Knowledge panels: a fact box shown beside search results for companies, countries and other well-known things.
// Built-in panels live in data/panels.json. Panels people request and the admin approves live in Firestore.

const EXTRA = new Set(["facts", "info", "information", "wiki", "about", "capital", "population", "founder", "founders", "ceo",
  "headquarters", "hq", "history", "company", "country", "corporation", "currency", "language", "flag", "size", "area"]);
const LEAD = /^(what is|what are|what's|whats|who is|who are|tell me about|about|the)\s+/;

export const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Returns the panel whose name or alias is what the person searched for, or null. */
export function findPanel(query, panels) {
  let q = norm(query);
  for (let i = 0; i < 3; i++) q = q.replace(LEAD, "");
  if (!q) return null;
  const words = q.split(" ");
  const stripped = words.length > 1 && EXTRA.has(words[words.length - 1]) ? words.slice(0, -1).join(" ") : null;
  for (const p of panels) {
    for (const a of [p.name, ...(p.aliases || [])]) {
      const n = norm(a);
      if (n && (n === q || n === stripped)) return p;
    }
  }
  return null;
}

/** "Label: value" strings to [label, value] pairs. */
export function factPairs(facts) {
  return (facts || []).map((f) => {
    const i = String(f).indexOf(":");
    return i > 0 ? [f.slice(0, i).trim(), f.slice(i + 1).trim()] : ["", String(f)];
  }).filter(([, v]) => v);
}

/** Words people typed in a request, to the aliases used for matching. */
export function aliasesFor(name) {
  const base = norm(name);
  const short = base.replace(/\s+(llc|inc|ltd|limited|corp|corporation|co|company|plc|gmbh|pty)$/, "");
  return [...new Set([base, short].filter(Boolean))];
}

/** "Label: https://..." strings to [label, url] pairs (only web addresses). */
export function linkPairs(links) {
  return (links || []).map((l) => {
    const i = String(l).indexOf(":");
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
  }).filter((x) => x && /^https?:\/\//i.test(x[1]));
}

/** The social and reference sites people can add to a panel. */
export const LINK_SITES = ["Wikipedia", "X", "Instagram", "Facebook", "YouTube", "LinkedIn", "TikTok", "GitHub"];
