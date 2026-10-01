// The search engine that runs in the visitor's browser.
// tokenize / stem / shardOf are ports of crawler/textproc.py - keep them identical.

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const VOWEL_RE = /[aeiouy]/;

export function tokenize(text) {
  return (text.toLowerCase().match(TOKEN_RE) || []).filter((t) => t.length <= 40);
}

function undouble(w) {
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !"lsz".includes(w[w.length - 1])) {
    return w.slice(0, -1);
  }
  return w;
}

export function stem(w) {
  const n = w.length;
  if (n > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (n > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (n > 5 && w.endsWith("ing") && VOWEL_RE.test(w.slice(0, -3))) w = undouble(w.slice(0, -3));
  else if (n > 4 && w.endsWith("ed") && VOWEL_RE.test(w.slice(0, -2))) w = undouble(w.slice(0, -2));
  else if (n > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function shardOf(term, nShards) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(term)) {
    h = Math.imul(h ^ b, 16777619) >>> 0;
  }
  return h % nShards;
}

export class SearchEngine {
  /** @param {(path:string)=>Promise<any>} getJson loads a file from the data folder */
  constructor(getJson) {
    this.getJson = getJson;
    this.meta = null;
    this.shardCache = new Map();
    this.chunkCache = new Map();
  }

  async init() {
    this.meta = await this.getJson("meta.json");
    this.stop = new Set(this.meta.stopwords);
    return this.meta;
  }

  queryTerms(query) {
    const words = tokenize(query);
    let terms = words.filter((w) => !this.stop.has(w)).map(stem);
    if (!terms.length) terms = words.map(stem); // query was only stop words
    return [...new Set(terms)];
  }

  async loadShard(i) {
    if (!this.shardCache.has(i)) this.shardCache.set(i, this.getJson(`s${i}.json`));
    return this.shardCache.get(i);
  }

  async loadChunk(c) {
    if (!this.chunkCache.has(c)) this.chunkCache.set(c, this.getJson(`d${c}.json`));
    return this.chunkCache.get(c);
  }

  async search(query, { limit = 10, offset = 0 } = {}) {
    const t0 = performance.now();
    const m = this.meta;
    const terms = this.queryTerms(query);
    if (!terms.length || !m.numDocs) return { terms, total: 0, results: [], ms: 0 };

    const shardIds = [...new Set(terms.map((t) => shardOf(t, m.shards)))];
    const shards = new Map();
    await Promise.all(shardIds.map(async (i) => shards.set(i, await this.loadShard(i))));

    const scores = new Map(); // docId -> { score, hits }
    for (const term of terms) {
      const post = shards.get(shardOf(term, m.shards))[term];
      if (!post) continue;
      const df = post.length / 2;
      const idf = Math.log(1 + (m.numDocs - df + 0.5) / (df + 0.5));
      for (let k = 0; k < post.length; k += 2) {
        const id = post[k];
        const tf = post[k + 1];
        const norm = tf + m.k1 * (1 - m.b + (m.b * m.dl[id]) / m.avgdl);
        const s = (idf * tf * (m.k1 + 1)) / norm;
        const cur = scores.get(id);
        if (cur) {
          cur.score += s;
          cur.hits++;
        } else scores.set(id, { score: s, hits: 1 });
      }
    }

    const ranked = [];
    for (const [id, { score, hits }] of scores) {
      const coverage = hits / terms.length;
      // pages containing every word rank far above partial matches
      ranked.push([id, score * coverage * coverage * (1 + 0.3 * Math.sqrt(m.pr[id]))]);
    }
    ranked.sort((a, b) => b[1] - a[1]);

    const page = ranked.slice(offset, offset + limit);
    const stems = new Set(terms);
    const results = await Promise.all(
      page.map(async ([id, score]) => {
        const chunk = await this.loadChunk(Math.floor(id / m.chunk));
        const [url, title, description, text] = chunk[id % m.chunk];
        return { id, score, url, title, description, snippet: makeSnippet(text || description, stems) };
      })
    );
    return { terms, total: ranked.length, results, ms: Math.round(performance.now() - t0) };
  }
}

/** Returns [{text, hit}] segments for the best ~200 char window of `text`. */
export function makeSnippet(text, stems, size = 200) {
  if (!text) return [];
  const hits = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (stems.has(stem(m[0].toLowerCase()))) hits.push([m.index, m.index + m[0].length]);
  }
  if (!hits.length) {
    return [{ text: text.slice(0, size) + (text.length > size ? "…" : ""), hit: false }];
  }
  let best = 0;
  let bestCount = 0;
  for (let i = 0; i < hits.length; i++) {
    let j = i;
    while (j < hits.length && hits[j][1] - hits[i][0] <= size) j++;
    if (j - i > bestCount) {
      bestCount = j - i;
      best = i;
    }
  }
  let start = Math.max(0, hits[best][0] - 40);
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < hits[best][0]) start = sp + 1;
  }
  const end = Math.min(text.length, start + size);
  const segs = [];
  let pos = start;
  if (start > 0) segs.push({ text: "…", hit: false });
  for (const [a, b] of hits) {
    if (b <= start || a >= end) continue;
    if (a > pos) segs.push({ text: text.slice(pos, a), hit: false });
    segs.push({ text: text.slice(Math.max(a, pos), Math.min(b, end)), hit: true });
    pos = Math.min(b, end);
  }
  if (pos < end) segs.push({ text: text.slice(pos, end), hit: false });
  if (end < text.length) segs.push({ text: "…", hit: false });
  return segs;
}
