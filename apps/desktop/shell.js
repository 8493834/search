const $ = (id) => document.getElementById(id);
const url = $("url"), tabsEl = $("tabs");
let st = { tabs: [], active: null };

function render() {
  tabsEl.replaceChildren();
  for (const t of st.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.loading ? " loading" : "");
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(t.id === st.active));
    el.title = t.title || t.url;
    let icon;
    if (t.favicon && !t.loading) { icon = document.createElement("img"); icon.src = t.favicon; icon.alt = ""; icon.onerror = () => { icon.replaceWith(Object.assign(document.createElement("span"), { className: "dot" })); }; }
    else icon = Object.assign(document.createElement("span"), { className: "dot" });
    const title = Object.assign(document.createElement("span"), { className: "title", textContent: t.title || "New tab" });
    const x = Object.assign(document.createElement("button"), { className: "x", textContent: "×", title: "Close tab" });
    x.setAttribute("aria-label", "Close tab");
    x.onclick = (e) => { e.stopPropagation(); window.shell.send("close", t.id); };
    el.onmousedown = (e) => { if (e.button === 1) { e.preventDefault(); window.shell.send("close", t.id); } else if (e.button === 0) window.shell.send("activate", t.id); };
    el.append(icon, title, x);
    tabsEl.append(el);
  }
  const plus = Object.assign(document.createElement("button"), { id: "new", textContent: "+", title: "New tab" });
  plus.setAttribute("aria-label", "New tab");
  plus.onclick = () => window.shell.send("new");
  tabsEl.append(plus);

  const a = st.tabs.find((t) => t.id === st.active);
  $("back").disabled = !a || !a.canBack;
  $("fwd").disabled = !a || !a.canFwd;
  if (document.activeElement !== url) url.value = a ? displayUrl(a.url) : "";
}
// Our own pages and the offline page show an empty bar, like a new tab.
function displayUrl(u) { return !u || u.startsWith("file:") ? "" : u; }

window.shell.onState((s) => { st = s; render(); });
window.shell.onFocusUrl(() => { url.focus(); url.select(); });
$("back").onclick = () => window.shell.send("back");
$("fwd").onclick = () => window.shell.send("forward");
$("reload").onclick = () => window.shell.send("reload");
$("home").onclick = () => window.shell.send("home");
url.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { window.shell.send("go", url.value); url.blur(); }
  if (e.key === "Escape") { url.blur(); render(); }
});
url.addEventListener("focus", () => url.select());
url.addEventListener("blur", render);
render();
