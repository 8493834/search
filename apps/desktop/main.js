// SPS Search desktop app: a small browser. Tabs, an address bar, and the SPS Search site as the home page.
const { app, BrowserWindow, WebContentsView, shell, Menu, ipcMain } = require("electron");
const path = require("path");
const { parseAuthUrl } = require("./auth-url");

const SITE_URL = "https://8493834.github.io/search/";
const SITE = new URL(SITE_URL);
const PROTOCOL = "spssearch";
const TOP = 80; // height of the tab strip + address bar

let win = null;
let shellView = null;
let pendingAuth = null;
let tabs = [];          // { id, view, title, favicon, loading }
let activeId = null;
let nextId = 1;

const onOurSite = (url) => {
  try { const u = new URL(url); return u.origin === SITE.origin && u.pathname.startsWith(SITE.pathname); } catch { return false; }
};
const hist = (wc) => wc.navigationHistory || wc;
const activeTab = () => tabs.find((t) => t.id === activeId);

/* ---- what the address bar types turn into ---- */
function toUrl(input) {
  const s = String(input || "").trim();
  if (!s) return SITE_URL;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s) || /^localhost(:\d+)?([/?#]\S*)?$/.test(s)) return "https://" + s;
  return SITE_URL + "#/search?q=" + encodeURIComponent(s); // anything else is a search on SPS Search
}

/* ---- keep the tab bar up to date ---- */
function pushState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  shellView.webContents.send("shell:state", {
    active: activeId,
    tabs: tabs.map((t) => {
      const wc = t.view.webContents;
      return { id: t.id, title: t.title, favicon: t.favicon, loading: t.loading, url: wc.getURL(),
        canBack: hist(wc).canGoBack(), canFwd: hist(wc).canGoForward() };
    }),
  });
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  shellView.setBounds({ x: 0, y: 0, width: w, height: TOP });
  const t = activeTab();
  if (t) t.view.setBounds({ x: 0, y: TOP, width: w, height: Math.max(0, h - TOP) });
}

/* ---- tabs ---- */
function openTab(url = SITE_URL, { background = false } = {}) {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  const tab = { id: nextId++, view, title: "New tab", favicon: "", loading: true };
  tabs.push(tab);
  const wc = view.webContents;

  wc.setWindowOpenHandler(({ url: u }) => {
    if (u.includes("#/app-signin") || /^mailto:/i.test(u)) shell.openExternal(u);
    else if (/^https?:/i.test(u)) openTab(u);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, u) => { if (!/^(https?|file):/i.test(u)) e.preventDefault(); });
  wc.on("page-title-updated", (_e, title) => { tab.title = title; pushState(); });
  wc.on("page-favicon-updated", (_e, icons) => { tab.favicon = icons[0] || ""; pushState(); });
  wc.on("did-start-loading", () => { tab.loading = true; pushState(); });
  wc.on("did-stop-loading", () => { tab.loading = false; pushState(); });
  wc.on("did-navigate", pushState);
  wc.on("did-navigate-in-page", pushState);
  wc.on("did-finish-load", deliverAuth);
  wc.on("did-fail-load", (_e, code, _d, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && !failedUrl.startsWith("file:")) {
      wc.loadFile(path.join(__dirname, "offline.html"));
    }
  });

  win.contentView.addChildView(view);
  if (!background) switchTo(tab.id);
  wc.loadURL(toUrl(url));
  pushState();
  return tab;
}
function switchTo(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  for (const o of tabs) o.view.setVisible(o.id === id);
  activeId = id;
  layout();
  t.view.webContents.focus();
  pushState();
}
function closeTab(id) {
  const i = tabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) { win.close(); return; } // closing the last tab closes the window
  if (id === activeId) switchTo(tabs[Math.min(i, tabs.length - 1)].id);
  else pushState();
}
function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((x) => x.id === activeId);
  switchTo(tabs[(i + dir + tabs.length) % tabs.length].id);
}
function focusUrlBar() {
  shellView.webContents.focus();
  shellView.webContents.send("shell:focus-url");
}

/* ---- messages from the tab bar ---- */
function fromShell(e) { return shellView && e.sender === shellView.webContents; } // ignore anything else
ipcMain.on("shell:new", (e) => { if (fromShell(e)) { openTab(SITE_URL); } });
ipcMain.on("shell:activate", (e, id) => { if (fromShell(e)) switchTo(id); });
ipcMain.on("shell:close", (e, id) => { if (fromShell(e)) closeTab(id); });
ipcMain.on("shell:go", (e, text) => { if (fromShell(e)) { const t = activeTab(); if (t) { t.view.webContents.loadURL(toUrl(text)); t.view.webContents.focus(); } } });
ipcMain.on("shell:back", (e) => { if (fromShell(e)) { const t = activeTab(); if (t && hist(t.view.webContents).canGoBack()) hist(t.view.webContents).goBack(); } });
ipcMain.on("shell:forward", (e) => { if (fromShell(e)) { const t = activeTab(); if (t && hist(t.view.webContents).canGoForward()) hist(t.view.webContents).goForward(); } });
ipcMain.on("shell:reload", (e) => { if (fromShell(e)) { const t = activeTab(); if (t) t.view.webContents.reload(); } });
ipcMain.on("shell:home", (e) => { if (fromShell(e)) { const t = activeTab(); if (t) t.view.webContents.loadURL(SITE_URL); } });

/* ---- sign-in result from the browser: hand it to a tab that is showing our site ---- */
function deliverAuth() {
  if (!pendingAuth || !win || win.isDestroyed()) return;
  const t = tabs.find((x) => !x.view.webContents.isLoading() && onOurSite(x.view.webContents.getURL()));
  if (!t) return; // never hand tokens to other websites
  t.view.webContents.send("auth-token", pendingAuth);
  pendingAuth = null;
}
function handleLink(url) {
  const token = parseAuthUrl(url);
  if (!token) return;
  pendingAuth = token;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const t = tabs.find((x) => onOurSite(x.view.webContents.getURL()));
    if (t) switchTo(t.id); else openTab(SITE_URL);
  }
  deliverAuth();
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const act = (fn) => () => { if (win && !win.isDestroyed()) fn(); };
  const wcOf = () => activeTab()?.view.webContents;
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: act(() => openTab(SITE_URL)) },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: act(() => closeTab(activeId)) },
        { label: "Focus Address Bar", accelerator: "CmdOrCtrl+L", click: act(focusUrlBar) },
        { type: "separator" },
        mac ? { role: "close", visible: false } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Navigate",
      submenu: [
        { label: "Back", accelerator: mac ? "Cmd+[" : "Alt+Left", click: act(() => { const wc = wcOf(); if (wc && hist(wc).canGoBack()) hist(wc).goBack(); }) },
        { label: "Forward", accelerator: mac ? "Cmd+]" : "Alt+Right", click: act(() => { const wc = wcOf(); if (wc && hist(wc).canGoForward()) hist(wc).goForward(); }) },
        { label: "SPS Search Home", accelerator: "CmdOrCtrl+Shift+H", click: act(() => wcOf()?.loadURL(SITE_URL)) },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: act(() => wcOf()?.reload()) },
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: act(() => cycleTab(1)) },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: act(() => cycleTab(-1)) },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]);
}

function createWindow() {
  tabs = []; activeId = null;
  win = new BrowserWindow({
    width: 1100, height: 800, minWidth: 480, minHeight: 480,
    title: "SPS Search", backgroundColor: "#e9eef0",
    icon: path.join(__dirname, "build", "icon.png"),
  });
  shellView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "shell-preload.js") },
  });
  win.contentView.addChildView(shellView);
  shellView.webContents.loadFile(path.join(__dirname, "shell.html"));
  shellView.webContents.on("did-finish-load", pushState);
  shellView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  shellView.webContents.on("will-navigate", (e) => e.preventDefault());

  win.on("resize", layout);
  win.on("maximize", layout);
  win.on("unmaximize", layout);
  win.on("enter-full-screen", layout);
  win.on("leave-full-screen", layout);
  win.on("app-command", (_e, cmd) => { // mouse back/forward buttons on Windows
    const wc = activeTab()?.view.webContents;
    if (!wc) return;
    if (cmd === "browser-backward" && hist(wc).canGoBack()) hist(wc).goBack();
    if (cmd === "browser-forward" && hist(wc).canGoForward()) hist(wc).goForward();
  });
  win.on("closed", () => { win = null; shellView = null; tabs = []; activeId = null; });
  openTab(SITE_URL);
  layout();
}

// The spssearch:// link lets the browser hand the sign-in back to this app.
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {         // Windows / Linux
    const link = argv.find((a) => a.startsWith(PROTOCOL + "://"));
    if (link) handleLink(link);
    else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on("open-url", (e, url) => { e.preventDefault(); handleLink(url); }); // macOS

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    const link = process.argv.find((a) => a.startsWith(PROTOCOL + "://")); // app was started by the link
    if (link) handleLink(link);
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
