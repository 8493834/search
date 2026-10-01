import { SITE_NAME, GITHUB_REPO, FIREBASE_READY } from "./config.js";
import { SearchEngine } from "./engine.js";
import * as be from "./backend.js";

const $top = document.getElementById("top");
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const state = { user: null, meta: null, indexError: null, manageTab: "requests" };
let dataVersion = "";

document.title = SITE_NAME;

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
const engine = new SearchEngine(async (path) => {
  const r = await fetch(`data/${path}${path === "meta.json" ? "" : dataVersion}`);
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  return r.json();
});
const engineReady = engine.init().then(
  (meta) => { state.meta = meta; dataVersion = `?v=${encodeURIComponent(meta.built || "0")}`; },
  (e) => { state.indexError = e; }
);

/* ---------- header ---------- */
function renderHeader() {
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    h("a", { href: "#/add" }, "Get my site on here"));
  if (FIREBASE_READY) {
    if (state.user) {
      if (be.isAdmin(state.user)) nav.append(h("a", { class: "btn small primary", href: "#/manage" }, "Manage"));
      nav.append(
        h("span", { class: "who", title: state.user.email }, state.user.email),
        h("button", { class: "btn small", onclick: () => be.signOut() }, "Sign out")
      );
    } else {
      nav.append(h("button", { class: "btn small", onclick: doSignIn }, "Sign in with Google"));
    }
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
      h("a", { class: "btn addlink", href: "#/add" }, "Get my site on here")
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
  let offset = 0;
  async function loadMore() {
    const res = await engine.search(q, { limit: PAGE, offset });
    if (offset === 0) {
      if (!res.total) {
        meta.textContent = "";
        list.append(h("div", { class: "empty" }, h("h2", {}, `No pages match “${q}”`),
          h("p", {}, "Try fewer or different words. Only sites that have been added and crawled are searched."),
          h("p", {}, h("a", { href: "#/add" }, "Add your site"), " to get it in here.")));
        return;
      }
      meta.textContent = `${res.total.toLocaleString()} result${res.total === 1 ? "" : "s"} in ${res.ms} ms`;
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
      h("p", { style: "margin-top:0" }, "Sign in with Google to send a request. We only see your email address."),
      h("button", { class: "btn primary", onclick: doSignIn }, "Sign in with Google")));
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

  let pending = [], sites = [];
  async function reload() {
    [pending, sites] = await Promise.all([be.listPending(), be.listSites()]);
    draw();
  }
  function draw() {
    tabs.replaceChildren(
      ...[["requests", `Requests (${pending.length})`], ["sites", `Current sites (${sites.length})`]].map(([id, label]) =>
        h("button", { class: "tab", role: "tab", "aria-selected": String(state.manageTab === id),
          onclick: () => { state.manageTab = id; draw(); } }, label)));
    body.replaceChildren(state.manageTab === "requests" ? drawRequests() : drawSites());
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
      return h("div", { class: "row" },
        h("div", { class: "info" },
          h("a", { href: safeHref(s.url), target: "_blank", rel: "noopener noreferrer" }, s.url),
          h("p", { class: "sub" }, n ? `${n} pages indexed` : "Not indexed yet",
            s.requestedBy ? `. Added by ${s.requestedBy}` : "")),
        h("div", { class: "acts" }, del));
    }) : [h("p", { class: "sub" }, "No sites yet.")];
    return h("div", {}, h("div", { class: "card" }, form), rows);
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
  if (path === "/manage") return viewManage();
  return viewHome();
}
window.addEventListener("hashchange", route);

renderHeader();
be.onUser((user) => {
  state.user = user;
  renderHeader();
  route(); // re-render so signed-in / admin views update
});