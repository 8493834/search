import { SITE_NAME, SITE_URL, GITHUB_REPO, FIREBASE_READY, OVERVIEW_API_URL, OVERVIEW_API_URLS, OVERVIEW_API_FALLBACK_URLS, SUPABASE_READY } from "./config.js";
import { SearchEngine, buildOverview, tokenize, stem } from "./engine.js";
import { getSetting, setSetting } from "./settings.js";
import * as be from "./backend.js";
import { findPanel, factPairs, aliasesFor, linkPairs, LINK_SITES } from "./panels.js";

const $top = document.getElementById("top");
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const state = { user: null, meta: null, indexError: null, manageTab: "requests", panels: null };
let dataVersion = "";

document.title = SITE_NAME;
// Google blocks sign-in inside app windows. The desktop app signs in through your browser and gets the result back.
const DESKTOP_APP = !!window.spsApp;                                          // Windows / Mac / Linux app
const ANDROID_APP = !DESKTOP_APP && /SPSSearchApp/.test(navigator.userAgent);  // Android app
const APP_SIGNIN_URL = SITE_URL + "#/app-signin";
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------- tiny helpers ---------- */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 3500);
}
const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : "#");
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const scopeKey = (u) => {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./, "").toLowerCase();
    let p = x.pathname || "/";
    if (!p.endsWith("/")) p = p.split("/").pop().includes(".") ? p.slice(0, p.lastIndexOf("/") + 1) : p + "/";
    return p === "/" ? host : host + p.replace(/\/$/, "");
  } catch { return ""; }
};
const prettyUrl = (u) => { try { const x = new URL(u); return x.hostname + (x.pathname === "/" ? "" : x.pathname); } catch { return u; } };

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message || "Something went wrong."); } finally { btn.disabled = false; }
}

/* ---------- search engine ---------- */
const engine = new SearchEngine(async (path, fresh) => {
  // A stalled or failed download must not stick: time out, retry once, and report the problem.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(`data/${path}${path === "meta.json" ? "" : dataVersion}`, { signal: ctl.signal, cache: attempt || fresh ? "reload" : "default" });
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
      return await r.json();
    } catch (e) { lastErr = e.name === "AbortError" ? new Error(`Loading ${path} took too long`) : e; }
    finally { clearTimeout(timer); }
  }
  throw lastErr;
});
const engineReady = engine.init().then(
  (meta) => { state.meta = meta; dataVersion = `?v=${encodeURIComponent(meta.built || "0")}`; },
  (e) => { state.indexError = e; }
);

if (ANDROID_APP) {
  // The Android app passes the sign-in result in with this event (see MainActivity.java).
  window.addEventListener("sps-auth", async (e) => {
    try { await be.signInWithHandoff(e.detail || {}); toast("Signed in."); }
    catch (err) { toast("Sign-in failed: " + (err.message || err)); }
  });
}
if (DESKTOP_APP) {
  window.spsApp.onAuthToken(async (t) => {
    try { await be.signInWithHandoff(t); toast("Signed in."); }
    catch (e) { toast("Sign-in failed: " + (e.message || e)); }
  });
}

/* ---------- header ---------- */
function renderHeader() {
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    h("a", { href: "#/add" }, "Get my site on here"),
    h("a", { href: "#/settings" }, "Settings"));
  if (FIREBASE_READY) {
    if (state.user) {
      if (be.isAdmin(state.user)) nav.append(h("a", { class: "btn small primary", href: "#/manage" }, "Manage"));
      nav.append(
        h("span", { class: "who", title: state.user.email }, state.user.email),
        h("button", { class: "btn small", onclick: () => be.signOut() }, "Sign out")
      );
    } else if (DESKTOP_APP || ANDROID_APP) {
      nav.append(h("a", { class: "btn small", href: APP_SIGNIN_URL, target: "_blank", rel: "noopener" }, "Sign in with Google"));
    } else {
      nav.append(h("button", { class: "btn small", onclick: doSignIn }, "Sign in with Google"));
    }
  }
  // Admin-only: switch so that only the backup services are used, to check they work.
  if (SUPABASE_READY && (be.isAdmin(state.user) || be.isTestBackup())) {
    const on = be.isTestBackup();
    nav.prepend(h("label", { class: "testbk", title: "When on, only the backup services (Supabase and the backup AI helper) are used" },
      h("span", {}, "Test backup"),
      h("button", { class: "switch", role: "switch", "aria-checked": String(on), "aria-label": "Test backup",
        onclick: () => { if (be.setTestBackup(!on)) location.reload(); else toast("Couldn't save the switch on this device."); } }, h("span", { class: "knob" }))));
  }
  $top.replaceChildren(h("a", { class: "brand", href: "#/" }, h("img", { src: "img/favicon.png", alt: "", width: 34, height: 34 }), SITE_NAME), nav);
}
async function doSignIn() {
  try { await be.signIn(); } catch (e) { if (e.code !== "auth/popup-closed-by-user") toast(e.message); }
}

/* ---------- search box ---------- */
function searchBox(value = "", autofocus = false) {
  const input = h("input", {
    type: "search", name: "q", value, placeholder: "Search…", autocomplete: "off",
    "aria-label": "Search", autofocus, enterkeyhint: "search",
  });
  return h("form", {
    class: "searchbox", role: "search",
    onsubmit: (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    },
  }, input, h("button", { type: "submit" }, "Search"));
}

/* ---------- knowledge panels ---------- */
let panelsLoad = null;
function loadPanels() {
  if (!panelsLoad) {
    panelsLoad = (async () => {
      const builtIn = await fetch("data/panels.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      let community = [];
      if (FIREBASE_READY) {
        // Approved panels people requested. Never let a slow or offline Firebase hold up search.
        community = await Promise.race([be.listPanels().catch(() => []), new Promise((res) => setTimeout(() => res([]), 3000))]);
      }
      const byId = new Map(); // an approved panel with a built-in's id replaces it
      for (const p of [...builtIn, ...community]) byId.set(p.id, p);
      return [...byId.values()];
    })();
  }
  return panelsLoad;
}
function panelCard(p) {
  const rows = factPairs(p.facts);
  const wikiUrl = p.wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.wiki).replace(/%28/g, "(").replace(/%29/g, ")")}` : "";
  const pairs = [];
  if (p.website) pairs.push(["Official site", p.website]);
  if (wikiUrl) pairs.push(["Wikipedia", wikiUrl]);
  for (const [l, u] of linkPairs(p.links)) if (!(l === "Wikipedia" && wikiUrl)) pairs.push([l, u]);
  const links = pairs.map(([l, u]) => h("a", { class: "kp-chip", href: safeHref(u), rel: "noopener noreferrer" }, l));
  return h("aside", { class: "kp", "aria-label": `About ${p.name}` },
    h("p", { class: "kp-type" }, p.type),
    h("h2", {}, p.name),
    h("p", { class: "kp-sum" }, p.summary),
    rows.length ? h("dl", {}, rows.flatMap(([k, v]) => [k ? h("dt", {}, k) : null, h("dd", {}, v)])) : null,
    links.length ? h("div", { class: "kp-links" }, links) : null,
    h("p", { class: "kp-fine" }, p.requestedBy ? "Added by request and reviewed by the site admin. " : "Compiled by SPS Search from public information. ",
      "It may be out of date. ", h("a", { href: "#/panel-request" }, "Request or improve a panel")));
}

/* ---------- views ---------- */
async function viewHome() {
  await engineReady;
  const m = state.meta;
  const stats = m && m.numDocs
    ? `${m.numDocs.toLocaleString()} ${m.numDocs === 1 ? "page" : "pages"} from ${m.numSites.toLocaleString()} ${m.numSites === 1 ? "site" : "sites"}. Last updated ${fmtDate(Date.parse(m.built))}.`
    : state.indexError ? "The index could not be loaded." : "The index is empty. Run the crawler to fill it (see README).";
  $app.replaceChildren(
    h("section", { class: "home" },
      h("h1", { class: "wordmark" }, h("img", { src: "img/logo.png", alt: SITE_NAME, width: 512, height: 512 })),
      h("p", { class: "lede" }, "Search the sites people have added. Every page was found by this site's own crawler and ranked by its own code."),
      searchBox("", true),
      h("p", { class: "stats" }, stats),
      h("a", { class: "btn addlink", href: "#/add" }, "Get my site on here"),
      h("p", { class: "stats" }, h("a", { href: "#/panel-request" }, "Request a knowledge panel"))
    )
  );
}

async function viewSearch(q) {
  document.title = `${q} - ${SITE_NAME}`;
  const list = h("div", { "aria-live": "polite" });
  const meta = h("p", { class: "meta-line" }, "Searching…");
  const more = h("button", { class: "btn", style: "display:none" }, "Show more results");
  $app.replaceChildren(h("section", { class: "results-wrap" }, searchBox(q), meta, list, more));

  await engineReady;
  if (state.indexError || !state.meta?.numDocs) {
    meta.textContent = "";
    list.append(h("div", { class: "empty" }, h("h2", {}, "Nothing to search yet"),
      h("p", {}, "The index is empty. Run the crawler (README, step 4) and reload.")));
    return;
  }

  const PAGE = 10;
  const COMMON = new Set(("this that these those with from have has had been being were was are is not but also than then them they their there here what when where which while who whom whose why how will would could should can may might must shall into onto over under about above below after before again between through during each other another such some many much more most less least only just very both either neither same own too its itself your yours our ours his her hers him she you any all few several one two three four first second new used use uses using like make makes made provide provides provided include includes including based allow allows offers offer help helps said says say according however because since while although though per via").split(" "));
  let offset = 0;
  // Optional: ask the free online helper (see SETUP-OVERVIEW.md) to write the overview from the top results.
  async function runAI(el, res, ov, quotes) {
    try {
      const passages = res.results.slice(0, 5).map((r) => {
        const own = ov.sentences.filter((x) => x.url === r.url).map((x) => x.text).join(" ");
        return `${r.title || r.url}. ${own || r.description || (r.text || "").slice(0, 500)}`.slice(0, 800);
      });
      // Try each helper in turn; move on if one is blocked, down or times out.
      let text = "", lastErr = null; const errs = [];
      const urls = be.isTestBackup() ? OVERVIEW_API_FALLBACK_URLS.filter(Boolean) : OVERVIEW_API_URLS;
      if (!urls.length) throw new Error("no backup helper is set up");
      const src = new Set(tokenize(passages.join(" ") + " " + q).map(stem));
      // Keep an answer only if it sticks to the sources.
      let why = "";
      const grounded = (t) => {
        // Everyday linking words (which, their, about...) aren't facts, so they don't count either way.
        const words = tokenize(t.replace(/\[\d+\]/g, "")).filter((w) => w.length > 3 && !COMMON.has(w)).map(stem);
        if (words.length < 5) { why = `only ${words.length} usable words`; return false; }
        const pct = Math.round((100 * words.filter((w) => src.has(w)).length) / words.length);
        why = `${pct}% of its words were in the sources`;
        return pct >= 50;
      };
      // Try each helper in turn; move on if one is blocked, down, times out or wanders off the sources.
      for (const url of urls) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 12000);
        try {
          const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ q, passages }) });
          if (!resp.ok) {
            let d = "";
            try { const j = await resp.json(); d = j.detail || j.error || ""; } catch {}
            lastErr = new Error(`AI helper error ${resp.status}${d ? ": " + d : ""}`);
            errs.push(`${new URL(url).hostname}: ${lastErr.message}`);
            continue;
          }
          const t = String((await resp.json()).text || "").trim();
          if (grounded(t)) { text = t; break; }
          lastErr = new Error(`the AI's answer didn't stick to the sources (${why})`);
          errs.push(`${new URL(url).hostname}: ${lastErr.message}`);
        } catch (e) { lastErr = e; errs.push(`${new URL(url).hostname}: ${e.name === "AbortError" ? "timed out" : e.message}`); }
        finally { clearTimeout(timer); }
      }
      if (!text) throw errs.length > 1 ? new Error(errs.join(" | ")) : lastErr || new Error("no AI helper reachable");
      el.replaceChildren(...text.split(/(\[\d+\])/).map((part) => {
        const m = part.match(/^\[(\d+)\]$/), r2 = m && res.results[Number(m[1]) - 1];
        return r2 ? h("sup", {}, h("a", { href: safeHref(r2.url), rel: "noopener noreferrer", "aria-label": `Source ${m[1]}` }, part)) : part;
      }), h("span", { class: "ov-badge" }, " AI-written, can be wrong. Check the sources."));
    } catch (e) {
      // Fall back to the quoted sentences, and say briefly why the AI part didn't show.
      el.className = "ov-fine";
      el.textContent = e.name === "AbortError" ? "AI overview timed out, showing quotes instead." : `AI overview unavailable (${e.message}). Showing quotes instead.`;
      quotes.open = true;
    }
  }
  function overviewPanel(res) {
    const ov = buildOverview(res);
    if (!ov) return null;
    const body = h("p", { class: "ov-text" });
    ov.sentences.forEach((s, i) => {
      if (i) body.append(" ");
      body.append(...s.segments.map((x) => (x.hit ? h("mark", {}, x.text) : x.text)),
        h("sup", {}, h("a", { href: safeHref(s.url), rel: "noopener noreferrer", "aria-label": `Source ${s.n}` }, `[${s.n}]`)));
    });
    const useAI = !!OVERVIEW_API_URL && getSetting("aionline");
    const ai = useAI ? h("p", { class: "ov-ai", "aria-live": "polite" }, "Writing…") : null;
    const quotes = useAI ? h("details", { class: "ov-quotes" }, h("summary", {}, "Quoted from the results"), body) : null;
    if (useAI) runAI(ai, res, ov, quotes);
    return h("aside", { class: "overview", "aria-label": "Overview" },
      h("h2", {}, "Overview"), ai, quotes || body,
      h("p", { class: "ov-src" }, "Sources: ", ov.sources.map((x, i) => [i ? " · " : "", h("a", { href: safeHref(x.url), rel: "noopener noreferrer" }, `[${x.n}] ${x.title}`)]).flat()),
      h("p", { class: "ov-fine" }, "Quoted automatically from the top results unless the AI option is on. It can miss context. Turn it off in Settings."));
  }
  async function loadMore() {
    let res;
    try { res = await engine.search(q, { limit: PAGE, offset }); }
    catch (e) {
      meta.textContent = "";
      list.replaceChildren(h("div", { class: "empty" }, h("h2", {}, "Couldn't load results"),
        h("p", {}, (e.message || "Something went wrong.") + " Check your connection and try again."),
        h("button", { class: "btn", onclick: () => route() }, "Try again")));
      return;
    }
    if (offset === 0) {
      loadPanels().then((all) => {
        const p = findPanel(q, all);
        if (p && !document.querySelector(".kp")) meta.after(panelCard(p));
      }).catch(() => {});
    }
    if (offset === 0) {
      if (!res.total) {
        meta.textContent = "";
        list.append(h("div", { class: "empty" }, h("h2", {}, `No pages match “${q}”`),
          h("p", {}, "Try fewer or different words. Only sites that have been added and crawled are searched."),
          h("p", {}, h("a", { href: "#/add" }, "Add your site"), " to get it in here.")));
        return;
      }
      meta.textContent = `${res.total.toLocaleString()} result${res.total === 1 ? "" : "s"} in ${res.ms} ms`;
      if (getSetting("overview")) { const p = overviewPanel(res); if (p) list.before(p); }
    }
    for (const r of res.results) {
      const titleLink = h("a", { href: safeHref(r.url), rel: "noopener noreferrer" }, r.title || r.url);
      const snippet = h("p", { class: "snippet" },
        r.snippet.map((s) => (s.hit ? h("mark", {}, s.text) : s.text)));
      list.append(h("article", { class: "result" },
        h("p", { class: "url" }, prettyUrl(r.url)), h("h3", {}, titleLink), snippet));
    }
    offset += res.results.length;
    more.style.display = offset < res.total ? "" : "none";
  }
  more.onclick = () => withBusy(more, loadMore);
  await loadMore();
}

function viewSettings() {
  document.title = `Settings - ${SITE_NAME}`;
  const on = getSetting("overview");
  const sw = h("button", { class: "switch", role: "switch", "aria-checked": String(on), id: "ov-switch", "aria-labelledby": "ov-label" }, h("span", { class: "knob" }));
  const note = h("p", { class: "hint" }, "Saved on this device.");
  sw.onclick = () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    const ok = setSetting("overview", next);
    sw.setAttribute("aria-checked", String(next));
    note.textContent = ok ? "Saved on this device." : "Couldn't save. It will reset when you leave this page.";
  };
  const mkSwitch = (key, labelId) => {
    const b = h("button", { class: "switch", role: "switch", "aria-checked": String(!!getSetting(key)), "aria-labelledby": labelId }, h("span", { class: "knob" }));
    b.onclick = () => {
      const next = b.getAttribute("aria-checked") !== "true";
      const ok = setSetting(key, next);
      b.setAttribute("aria-checked", String(next));
      note.textContent = ok ? "Saved on this device." : "Couldn't save. It will reset when you leave this page.";
    };
    return b;
  };
  const ready = !!OVERVIEW_API_URL;
  const aiSw = mkSwitch("aionline", "ai-label");
  if (!ready) { aiSw.disabled = true; aiSw.setAttribute("aria-checked", "false"); }
  const aiRow = h("div", { class: "card setting" },
    h("div", { class: "info" }, h("strong", { id: "ai-label" }, "AI-written overview (online)"),
      h("p", { class: "sub" }, "Needs Overview above to be on. Asks a free AI service to write the summary. Nothing is downloaded to your device. Your search words and the top result snippets are sent to Cloudflare to do this. It can be wrong and has a daily limit; if it fails you get the quoted version. Off by default."),
      ready ? null : h("p", { class: "hint" }, "Not set up yet. The site owner needs to follow SETUP-OVERVIEW.md.")),
    aiSw);
  $app.replaceChildren(h("section", { class: "page" }, h("h1", {}, "Settings"),
    h("div", { class: "card setting" },
      h("div", { class: "info" }, h("strong", { id: "ov-label" }, "Overview"),
        h("p", { class: "sub" }, "Show a short summary above search results, built from sentences in the top results with links to where each came from. It is not written by an AI language model. Off by default.")),
      sw),
    aiRow,
    note));
}

async function viewAdd() {
  document.title = `Get my site on here - ${SITE_NAME}`;
  const page = h("section", { class: "page" },
    h("h1", {}, "Get my site on here"),
    h("p", { class: "intro" },
      "Send in your site's address. If it's approved, the crawler picks it up on its next run and its pages become searchable. The crawler follows links within your site only and obeys your robots.txt."));
  $app.replaceChildren(page);

  if (!FIREBASE_READY) {
    page.append(h("div", { class: "notice warn" }, "Sign-in isn't set up yet. The site owner needs to finish the Firebase setup in the README."));
    return;
  }
  if (!state.user) {
    page.append(h("div", { class: "card" },
      h("p", { style: "margin-top:0" }, DESKTOP_APP || ANDROID_APP
        ? "Google doesn't allow sign-in inside apps, so your browser opens for the sign-in and then sends you back here."
        : "Sign in with Google to send a request. We only see your email address."),
      DESKTOP_APP || ANDROID_APP
        ? h("a", { class: "btn primary", href: APP_SIGNIN_URL, target: "_blank", rel: "noopener" }, "Sign in with Google")
        : h("button", { class: "btn primary", onclick: doSignIn }, "Sign in with Google")));
    return;
  }

  const url = h("input", { id: "url", type: "url", required: true, placeholder: "https://example.com", autocomplete: "url" });
  const desc = h("textarea", { id: "desc", rows: 3, maxlength: 300, placeholder: "What is on your site?" });
  const err = h("p", { class: "err", role: "alert" });
  const submit = h("button", { class: "btn primary", type: "submit" }, "Send request");
  const mine = h("div", { class: "card" });
  page.append(
    h("form", {
      class: "card",
      onsubmit: (e) => {
        e.preventDefault();
        err.textContent = "";
        withBusy(submit, async () => {
          try {
            await be.submitRequest(state.user, url.value, desc.value);
          } catch (ex) {
            err.textContent = ex.code === "permission-denied" ? "Your request was rejected. Check the address and try again." : ex.message;
            return;
          }
          url.value = ""; desc.value = "";
          toast("Request sent. It's waiting for review.");
          refreshMine();
        });
      },
    },
      h("div", { class: "field" }, h("label", { for: "url" }, "Site address"), url,
        h("p", { class: "hint" }, "Include https://. The whole site is crawled, up to a page limit.")),
      h("div", { class: "field" }, h("label", { for: "desc" }, "Short description (optional)"), desc),
      submit, err),
    h("h2", {}, "Your requests"), mine);

  async function refreshMine() {
    try {
      const rows = await be.listMyRequests(state.user);
      mine.replaceChildren(...(rows.length ? rows.map((r) =>
        h("div", { class: "row" },
          h("div", { class: "info" }, h("strong", {}, prettyUrl(r.url)), h("p", { class: "sub" }, fmtDate(r.ts))),
          h("span", { class: `badge ${r.status}` }, r.status)))
        : [h("p", { class: "sub", style: "margin:0" }, "You haven't sent any requests yet.")]));
    } catch (e) { mine.textContent = "Couldn't load your requests."; }
  }
  refreshMine();
}

async function viewPanelRequest() {
  document.title = `Request a knowledge panel - ${SITE_NAME}`;
  const page = h("section", { class: "page" },
    h("h1", {}, "Request a knowledge panel"),
    h("p", { class: "intro" },
      "A knowledge panel is the fact box that appears beside search results for a company, organisation, place or other well-known thing. Tell us about yours. The site admin reviews every request, so only include facts you can stand behind."));
  $app.replaceChildren(page);

  if (!FIREBASE_READY) { page.append(h("div", { class: "notice warn" }, "Sign-in isn't set up yet.")); return; }
  if (!state.user) {
    page.append(h("div", { class: "card" },
      h("p", { style: "margin-top:0" }, DESKTOP_APP || ANDROID_APP ? "Your browser opens for the Google sign-in and then sends you back here."
        : "Sign in with Google to send a request. We only see your email address."),
      DESKTOP_APP || ANDROID_APP ? h("a", { class: "btn primary", href: APP_SIGNIN_URL, target: "_blank", rel: "noopener" }, "Sign in with Google")
        : h("button", { class: "btn primary", onclick: doSignIn }, "Sign in with Google")));
    return;
  }

  const name = h("input", { id: "pn", type: "text", required: true, maxlength: 80, placeholder: "Example Pty Ltd" });
  const type = h("select", { id: "pt" }, be.PANEL_TYPES.map((t) => h("option", { value: t }, t)));
  const site = h("input", { id: "pw", type: "url", placeholder: "https://example.com (optional)" });
  const sum = h("textarea", { id: "ps", rows: 3, maxlength: 400, required: true, placeholder: "One or two sentences about what it is." });
  const facts = h("textarea", { id: "pf", rows: 5, placeholder: "Founded: 2015\nHeadquarters: Melbourne, Australia\nFounder: Jane Smith" });
  const linkInputs = Object.fromEntries(LINK_SITES.map((n) => [n, h("input", { id: "pl-" + n, type: "url", placeholder: `${n} address (optional)` })]));
  const err = h("p", { class: "err", role: "alert" });
  const submit = h("button", { class: "btn primary", type: "submit" }, "Send request");
  const mine = h("div", { class: "card" });
  page.append(
    h("form", { class: "card", onsubmit: (e) => {
      e.preventDefault(); err.textContent = "";
      withBusy(submit, async () => {
        try { await be.submitPanelRequest(state.user, { name: name.value, type: type.value, website: site.value, summary: sum.value, facts: facts.value, links: Object.fromEntries(LINK_SITES.map((n) => [n, linkInputs[n].value])) }); }
        catch (ex) { err.textContent = ex.code === "permission-denied" ? "Your request was rejected. Check the fields and try again." : ex.message; return; }
        name.value = ""; site.value = ""; sum.value = ""; facts.value = ""; LINK_SITES.forEach((n) => { linkInputs[n].value = ""; });
        toast("Request sent. It's waiting for review."); refreshMine();
      });
    } },
      h("div", { class: "field" }, h("label", { for: "pn" }, "Name"), name),
      h("div", { class: "field" }, h("label", { for: "pt" }, "Type"), type),
      h("div", { class: "field" }, h("label", { for: "pw" }, "Website"), site),
      h("div", { class: "field" }, h("label", { for: "ps" }, "Short description"), sum),
      h("div", { class: "field" }, h("label", { for: "pf" }, "Facts (one per line, like \"Founded: 2015\", up to 8)"), facts),
      h("div", { class: "field" }, h("label", {}, "Links (optional)"), h("div", { class: "link-grid" }, LINK_SITES.map((n) => h("div", {}, h("label", { class: "sub", for: "pl-" + n }, n), linkInputs[n])))),
      submit, err),
    h("h2", {}, "Your panel requests"), mine);

  async function refreshMine() {
    try {
      const rows = await be.listMyPanelRequests(state.user);
      mine.replaceChildren(...(rows.length ? rows.map((r) => h("div", { class: "row" },
        h("div", { class: "info" }, h("strong", {}, r.name), h("p", { class: "sub" }, `${r.type}. ${fmtDate(r.ts)}`)),
        h("span", { class: `badge ${r.status}` }, r.status)))
        : [h("p", { class: "sub", style: "margin:0" }, "You haven't sent any requests yet.")]));
    } catch (e) { mine.textContent = "Couldn't load your requests."; }
  }
  refreshMine();
}

function adminOnly(title) {
  document.title = `${title} - ${SITE_NAME}`;
  if (!be.isAdmin(state.user)) {
    $app.replaceChildren(h("section", { class: "page" }, h("h1", {}, title),
      h("div", { class: "notice warn" }, "Only the site admin can open this page.")));
    return false;
  }
  return true;
}

async function viewEditSite(id) {
  if (!adminOnly("Edit site")) return;
  const page = h("section", { class: "page" }, h("h1", {}, "Edit site"));
  $app.replaceChildren(page);
  let site;
  try { site = (await be.listSites()).find((s) => s.id === id); } catch (e) { page.append(h("div", { class: "notice warn" }, `Couldn't load: ${e.message}`)); return; }
  if (!site) { page.append(h("div", { class: "notice warn" }, "That site no longer exists."), h("a", { class: "btn", href: "#/manage" }, "Back to Manage")); return; }
  const url = h("input", { id: "es-url", type: "url", required: true, value: site.url });
  const desc = h("textarea", { id: "es-desc", rows: 3, maxlength: 300 }, site.description || "");
  const err = h("p", { class: "err", role: "alert" });
  const save = h("button", { class: "btn primary", type: "submit" }, "Save");
  page.append(h("form", { class: "card", onsubmit: (e) => {
    e.preventDefault(); err.textContent = "";
    withBusy(save, async () => {
      try { await be.updateSite(site.id, url.value, desc.value); } catch (ex) { err.textContent = ex.message; return; }
      toast("Saved. Search results change after the next crawl.");
      state.manageTab = "sites"; location.hash = "#/manage";
    });
  } },
    h("div", { class: "field" }, h("label", { for: "es-url" }, "Site address"), url,
      h("p", { class: "hint" }, "Changing the address means the crawler indexes the new address next time. Pages from the old one leave search after that crawl.")),
    h("div", { class: "field" }, h("label", { for: "es-desc" }, "Description"), desc),
    h("div", { class: "acts" }, save, h("a", { class: "btn", href: "#/manage" }, "Cancel")), err));
}

async function viewEditPanel(id) {
  if (!adminOnly(id ? "Edit panel" : "Add panel")) return;
  const page = h("section", { class: "page" }, h("h1", {}, id ? "Edit knowledge panel" : "Add knowledge panel"));
  $app.replaceChildren(page);
  let init = {};
  if (id) {
    try {
      const [live, builtIn] = await Promise.all([be.listPanels(), fetch("data/panels.json").then((r) => (r.ok ? r.json() : [])).catch(() => [])]);
      init = live.find((p) => p.id === id) || builtIn.find((p) => p.id === id);
    } catch (e) { page.append(h("div", { class: "notice warn" }, `Couldn't load: ${e.message}`)); return; }
    if (!init) { page.append(h("div", { class: "notice warn" }, "That panel doesn't exist."), h("a", { class: "btn", href: "#/manage" }, "Back to Manage")); return; }
  }
  const have = Object.fromEntries(linkPairs(init.links));
  if (init.wiki && !have.Wikipedia) have.Wikipedia = `https://en.wikipedia.org/wiki/${init.wiki}`;
  const name = h("input", { id: "ep-n", type: "text", required: true, maxlength: 80, value: init.name || "" });
  const type = h("select", { id: "ep-t" }, be.PANEL_TYPES.map((t) => h("option", { value: t, selected: t === init.type }, t)));
  const site = h("input", { id: "ep-w", type: "url", value: init.website || "", placeholder: "https://example.com" });
  const sum = h("textarea", { id: "ep-s", rows: 4, maxlength: 400, required: true }, init.summary || "");
  const facts = h("textarea", { id: "ep-f", rows: 7 }, (init.facts || []).join("\n"));
  const aliases = h("input", { id: "ep-a", type: "text", value: (init.aliases || []).join(", "), placeholder: "google, google llc" });
  const links = Object.fromEntries(LINK_SITES.map((n) => [n, h("input", { id: "epl-" + n, type: "url", value: have[n] || "", placeholder: `${n} address` })]));
  const err = h("p", { class: "err", role: "alert" });
  const save = h("button", { class: "btn primary", type: "submit" }, "Save");
  if (id) page.append(h("p", { class: "intro" }, "Saving replaces what people see for this panel. Built-in panels can be changed here too; deleting your version later brings the built-in one back."));
  page.append(
    h("form", { class: "card", onsubmit: (e) => {
      e.preventDefault(); err.textContent = "";
      withBusy(save, async () => {
        try {
          const al = aliases.value.split(",").map((x) => x.trim()).filter(Boolean);
          await be.savePanel(state.user, id, { name: name.value, type: type.value, website: site.value, summary: sum.value, facts: facts.value,
            links: Object.fromEntries(LINK_SITES.map((n) => [n, links[n].value])) }, al.length ? al : aliasesFor(name.value));
        } catch (ex) { err.textContent = ex.message; return; }
        panelsLoad = null; toast("Saved.");
        state.manageTab = "panels"; location.hash = "#/manage";
      });
    } },
      h("div", { class: "field" }, h("label", { for: "ep-n" }, "Name"), name),
      h("div", { class: "field" }, h("label", { for: "ep-t" }, "Type"), type),
      h("div", { class: "field" }, h("label", { for: "ep-a" }, "Found when someone searches (comma separated)"), aliases,
        h("p", { class: "hint" }, "Leave empty to use the name. A search must match one of these exactly, like \"google\" or \"north korea\".")),
      h("div", { class: "field" }, h("label", { for: "ep-w" }, "Website"), site),
      h("div", { class: "field" }, h("label", { for: "ep-s" }, "Short description"), sum),
      h("div", { class: "field" }, h("label", { for: "ep-f" }, "Facts (one per line, like \"Founded: 2015\", up to 8)"), facts),
      h("div", { class: "field" }, h("label", {}, "Links"), h("div", { class: "link-grid" }, LINK_SITES.map((n) => h("div", {}, h("label", { class: "sub", for: "epl-" + n }, n), links[n])))),
      h("div", { class: "acts" }, save, h("a", { class: "btn", href: "#/manage" }, "Cancel")), err));
}

async function viewAppSignin() {
  document.title = `Sign in - ${SITE_NAME}`;
  const msg = h("p", { class: "intro" }, "Sign in with Google here, then you'll be sent back to the SPS Search app.");
  const btn = h("button", { class: "btn primary" }, "Continue with Google");
  const back = h("div");
  btn.onclick = () => withBusy(btn, async () => {
    const t = await be.signInForApp();
    const link = "spssearch://auth?" + new URLSearchParams({ id_token: t.idToken, access_token: t.accessToken });
    msg.textContent = "Signed in. Your browser may ask to open SPS Search. Choose Open.";
    back.replaceChildren(h("a", { class: "btn primary", href: link }, "Open the SPS Search app"));
    location.href = link;
  });
  if (state.user) {
    msg.textContent = "You're signed in as " + (state.user.email || "your account") + ".";
    back.replaceChildren(h("a", { class: "btn primary", href: "#/" }, "Go to SPS Search"));
  }
  $app.replaceChildren(h("section", { class: "page" }, h("h1", {}, "Sign in"), msg,
    FIREBASE_READY ? h("div", { class: "card" }, state.user ? back : btn, state.user ? "" : back)
      : h("div", { class: "notice warn" }, "Sign-in isn't set up yet."),
    h("p", { class: "hint" }, "Don't have the app? You can just use this website directly.")));
}

async function viewManage() {
  document.title = `Manage - ${SITE_NAME}`;
  if (!be.isAdmin(state.user)) {
    $app.replaceChildren(h("section", { class: "page" }, h("h1", {}, "Manage"),
      h("div", { class: "notice warn" }, "Only the site admin can open this page.")));
    return;
  }
  await engineReady;
  const counts = state.meta?.siteCounts || {};
  const body = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const built = state.meta?.built ? `Search index built ${fmtDate(Date.parse(state.meta.built))}, ${state.meta.numDocs.toLocaleString()} pages.` : "No index built yet.";
  const runUrl = `https://github.com/${GITHUB_REPO}/actions/workflows/crawl.yml`;
  $app.replaceChildren(h("section", { class: "page" },
    h("h1", {}, "Manage"),
    h("p", { class: "intro" }, `Accepting or deleting a site takes effect in the site list immediately. Search results change after the next crawl. ${built}`),
    h("a", { class: "btn", href: runUrl, target: "_blank", rel: "noopener noreferrer" }, "Run crawl now (opens GitHub)"),
    tabs, body));

  let pending = [], sites = [], panelReqs = [], livePanels = [], builtInPanels = [], admins = [];
  async function reload() {
    [pending, sites, panelReqs, livePanels] = await Promise.all([be.listPending(), be.listSites(), be.listPendingPanelRequests(), be.listPanels()]);
    if (be.isOwner(state.user)) admins = await be.listAdmins().catch(() => []);
    builtInPanels = await fetch("data/panels.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    panelsLoad = null; // so the next search sees the change
    draw();
    be.backupStatus().then((b) => { backup = b; draw(); }).catch(() => {});
  }
  let backup = null; // how the two services compare, once checked
  // Warning + "Back up now" for sites or panels that exist on only one of Firebase / Supabase.
  function backupBanner(kind) { // kind: "sites" | "panels"
    if (!backup) return null;
    const out = [];
    for (const target of ["firebase", "supabase"]) {
      const src = target === "firebase" ? "supabase" : "firebase";
      const tn = backup.names[target], sn = backup.names[src];
      if (!backup.have[target].ok || !backup.have[src].ok) {
        const bad = backup.have[target].ok ? src : target;
        if (target === "firebase") out.push(h("div", { class: "notice warn" }, `Couldn't check ${backup.names[bad]} (${backup.have[bad].error}), so backups aren't compared right now.`));
        continue;
      }
      const items = backup.missing[target][kind];
      if (!items.length) continue;
      const word = kind === "sites" ? (items.length === 1 ? "site is" : "sites are") : (items.length === 1 ? "panel is" : "panels are");
      const btn = h("button", { class: "btn small primary" }, "Back up now");
      btn.onclick = () => withBusy(btn, async () => {
        try {
          const n = await be.backupTo(target, { [kind]: items });
          toast(`Backed up ${n} to ${tn}.`);
          await reload();
        } catch (e) {
          if (e.code !== "NEEDS_SIGNIN") throw e;
          toast(`Signing you in to ${tn}. Then press Back up now again.`);
          await be.signInTo(target);
        }
      });
      out.push(h("div", { class: "notice warn" }, h("p", { style: "margin:0 0 8px" }, `Warning: ${items.length} ${word} only on ${sn}, not backed up to ${tn}. Would you like to back up now?`), btn));
    }
    return out.length ? h("div", {}, out) : null;
  }
  const notBacked = (kind, item) => {
    if (!backup) return null;
    const to = [];
    for (const target of ["firebase", "supabase"]) {
      const list = backup.missing[target][kind];
      if (list.some((x) => x.id === item.id)) to.push(backup.names[target]);
    }
    return to.length ? h("p", { class: "sub" }, `Not backed up to ${to.join(" or ")}`) : null;
  };
  function draw() {
    tabs.replaceChildren(
      ...[["requests", `Requests (${pending.length})`], ["sites", `Current sites (${sites.length})`], ["panelreq", `Panel requests (${panelReqs.length})`], ["panels", `Panels (${livePanels.length})`], ...(be.isOwner(state.user) ? [["admins", `Admins (${admins.length + 1})`]] : [])].map(([id, label]) =>
        h("button", { class: "tab", role: "tab", "aria-selected": String(state.manageTab === id),
          onclick: () => { state.manageTab = id; draw(); } }, label)));
    body.replaceChildren(state.manageTab === "requests" ? drawRequests() : state.manageTab === "sites" ? drawSites() : state.manageTab === "panelreq" ? drawPanelReqs() : state.manageTab === "admins" && be.isOwner(state.user) ? drawAdmins() : drawPanels());
  }
  function drawRequests() {
    if (!pending.length) return h("p", { class: "sub" }, "No requests waiting.");
    return h("div", {}, pending.map((r) => {
      const acc = h("button", { class: "btn small primary" }, "Accept");
      const den = h("button", { class: "btn small danger" }, "Deny");
      acc.onclick = () => withBusy(acc, async () => { await be.acceptRequest(r); toast("Accepted."); await reload(); });
      den.onclick = () => withBusy(den, async () => { await be.denyRequest(r); toast("Denied."); await reload(); });
      return h("div", { class: "row" },
        h("div", { class: "info" },
          h("a", { href: safeHref(r.url), target: "_blank", rel: "noopener noreferrer" }, r.url),
          r.description ? h("p", { class: "sub" }, r.description) : null,
          h("p", { class: "sub" }, `From ${r.email}, ${fmtDate(r.ts)}`)),
        h("div", { class: "acts" }, acc, den));
    }));
  }
  function drawAdmins() {
    const email = h("input", { type: "email", required: true, placeholder: "their-google-email@gmail.com", "aria-label": "Admin email" });
    const add = h("button", { class: "btn primary", type: "submit" }, "Add admin");
    const form = h("form", { class: "inline-form", onsubmit: (e) => {
      e.preventDefault();
      withBusy(add, async () => { await be.addAdmin(state.user, email.value); toast("Admin added."); await reload(); });
    } }, email, add);
    const rows = admins.map((a) => {
      const del = h("button", { class: "btn small danger" }, "Remove");
      del.onclick = () => { if (!confirm(`Remove ${a.email} as an admin?`)) return; withBusy(del, async () => { await be.removeAdmin(a.email); toast("Removed."); await reload(); }); };
      return h("div", { class: "row" }, h("div", { class: "info" }, h("strong", {}, a.email), h("p", { class: "sub" }, a.addedBy ? `Added by ${a.addedBy}` : "Admin")), h("div", { class: "acts" }, del));
    });
    return h("div", {},
      h("p", { class: "sub" }, "Admins can accept and deny requests and edit sites and panels. Only you, the owner, can add or remove admins. They must sign in with that exact Google account."),
      h("div", { class: "card" }, form),
      h("div", { class: "row" }, h("div", { class: "info" }, h("strong", {}, state.user.email), h("p", { class: "sub" }, "Owner (can't be removed)"))),
      rows.length ? rows : h("p", { class: "sub" }, "No other admins yet."));
  }
  function drawPanelReqs() {
    if (!panelReqs.length) return h("p", { class: "sub" }, "No panel requests waiting.");
    return h("div", {}, panelReqs.map((r) => {
      const acc = h("button", { class: "btn small primary" }, "Accept");
      const den = h("button", { class: "btn small danger" }, "Deny");
      acc.onclick = () => withBusy(acc, async () => { await be.acceptPanelRequest(r, aliasesFor(r.name)); toast("Panel added."); await reload(); });
      den.onclick = () => withBusy(den, async () => { await be.denyPanelRequest(r); toast("Denied."); await reload(); });
      return h("div", { class: "row" },
        h("div", { class: "info" },
          h("strong", {}, `${r.name} (${r.type})`),
          h("p", { class: "sub" }, r.summary),
          r.facts?.length ? h("p", { class: "sub" }, r.facts.join(" | ")) : null,
          r.website ? h("a", { href: safeHref(r.website), target: "_blank", rel: "noopener noreferrer" }, r.website) : null,
          ...linkPairs(r.links).map(([l, u]) => h("p", { class: "sub" }, `${l}: `, h("a", { href: safeHref(u), target: "_blank", rel: "noopener noreferrer" }, u))),
          h("p", { class: "sub" }, `From ${r.email}, ${fmtDate(r.ts)}`)),
        h("div", { class: "acts" }, acc, den));
    }));
  }
  function drawPanels() {
    const ids = new Set(livePanels.map((p) => p.id));
    const rowFor = (p, builtIn) => {
      const edit = h("a", { class: "btn small", href: `#/edit-panel?id=${encodeURIComponent(p.id)}` }, "Edit");
      const acts = h("div", { class: "acts" }, edit);
      if (!builtIn) {
        const isOverride = builtInPanels.some((b) => b.id === p.id);
        const del = h("button", { class: "btn small danger" }, isOverride ? "Revert" : "Delete");
        del.onclick = () => { if (!confirm(isOverride ? `Go back to the built-in panel for ${p.name}?` : `Delete the panel for ${p.name}?`)) return; withBusy(del, async () => { await be.deletePanel(p); panelsLoad = null; toast(isOverride ? "Reverted." : "Deleted."); await reload(); }); };
        acts.append(del);
      }
      return h("div", { class: "row" },
        h("div", { class: "info" }, h("strong", {}, `${p.name} (${p.type})`), h("p", { class: "sub" }, p.summary),
          h("p", { class: "sub" }, builtIn ? "Built-in" : builtInPanels.some((b) => b.id === p.id) ? "Your changed version of a built-in panel" : `Added by ${p.requestedBy || "admin"}`),
          builtIn ? null : notBacked("panels", p)),
        acts);
    };
    return h("div", {},
      backupBanner("panels"),
      h("a", { class: "btn primary", href: "#/edit-panel" }, "Add a panel"),
      h("h3", {}, `Approved and changed panels (${livePanels.length})`),
      livePanels.length ? livePanels.map((p) => rowFor(p, false)) : h("p", { class: "sub" }, "None yet."),
      h("h3", {}, `Built-in panels (${builtInPanels.filter((p) => !ids.has(p.id)).length})`),
      builtInPanels.filter((p) => !ids.has(p.id)).map((p) => rowFor(p, true)));
  }
  function drawSites() {
    const url = h("input", { type: "url", required: true, placeholder: "https://add-a-site-yourself.com", "aria-label": "Site address" });
    const note = h("input", { type: "text", maxlength: 300, placeholder: "Short description (shown in search if the site can't be crawled)", "aria-label": "Description" });
    const add = h("button", { class: "btn primary", type: "submit" }, "Add site");
    const form = h("form", { class: "inline-form", onsubmit: (e) => {
      e.preventDefault();
      withBusy(add, async () => { await be.addSiteDirectly(state.user, url.value, note.value); toast("Site added."); await reload(); });
    } }, url, note, add);
    const rows = sites.length ? sites.map((s) => {
      const del = h("button", { class: "btn small danger" }, "Delete");
      del.onclick = () => {
        if (!confirm(`Delete ${s.url}? Its pages leave search after the next crawl.`)) return;
        withBusy(del, async () => { await be.deleteSite(s); toast("Deleted."); await reload(); });
      };
      const n = counts[scopeKey(s.url)];
      const edit = h("a", { class: "btn small", href: `#/edit-site?id=${encodeURIComponent(s.id)}` }, "Edit");
      return h("div", { class: "row" },
        h("div", { class: "info" },
          h("a", { href: safeHref(s.url), target: "_blank", rel: "noopener noreferrer" }, s.url),
          h("p", { class: "sub" }, n ? `${n} pages indexed` : "Not indexed yet",
            s.requestedBy ? `. Added by ${s.requestedBy}` : ""),
          notBacked("sites", s)),
        h("div", { class: "acts" }, edit, del));
    }) : [h("p", { class: "sub" }, "No sites yet.")];
    return h("div", {}, backupBanner("sites"), h("div", { class: "card" }, form), rows);
  }
  try { await reload(); } catch (e) { body.replaceChildren(h("div", { class: "notice warn" }, `Couldn't load data: ${e.message}`)); }
}

/* ---------- router ---------- */
function route() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs = ""] = raw.split("?");
  const params = new URLSearchParams(qs);
  window.scrollTo(0, 0);
  document.title = SITE_NAME;
  if (path === "/search" && params.get("q")?.trim()) return viewSearch(params.get("q").trim());
  if (path === "/add") return viewAdd();
  if (path === "/edit-site") return viewEditSite(params.get("id"));
  if (path === "/edit-panel") return viewEditPanel(params.get("id") || null);
  if (path === "/panel-request") return viewPanelRequest();
  if (path === "/settings") return viewSettings();
  if (path === "/manage") return viewManage();
  if (path === "/app-signin") return viewAppSignin();
  return viewHome();
}
window.addEventListener("hashchange", route);

renderHeader();
route(); // draw the page right away; never wait for Firebase (it may be slow, blocked or offline)
be.onUser((user) => {
  state.user = user;
  renderHeader();
  route(); // re-render so signed-in / admin views update
}).catch(() => {});
