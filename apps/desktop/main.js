// SPS Search desktop app: a window around the live website, so it is always up to date.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const { parseAuthUrl } = require("./auth-url");

const SITE_URL = "https://8493834.github.io/search/";
const SITE = new URL(SITE_URL);
const PROTOCOL = "spssearch";

let win = null;
let pendingAuth = null;

const onOurSite = (url) => {
  try { const u = new URL(url); return u.origin === SITE.origin && u.pathname.startsWith(SITE.pathname); } catch { return false; }
};
const hist = (wc) => wc.navigationHistory || wc; // newer Electron keeps history on navigationHistory
const goBack = (wc) => { if (hist(wc).canGoBack()) hist(wc).goBack(); };
const goForward = (wc) => { if (hist(wc).canGoForward()) hist(wc).goForward(); };

// Sign-in result from the browser: deliver it once the window is showing our site.
function deliverAuth() {
  if (!pendingAuth || !win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isLoading() || !onOurSite(wc.getURL())) return; // never hand tokens to other websites
  wc.send("auth-token", pendingAuth);
  pendingAuth = null;
}
function handleLink(url) {
  const token = parseAuthUrl(url);
  if (!token) return;
  pendingAuth = token;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    if (!onOurSite(win.webContents.getURL())) win.loadURL(SITE_URL);
  }
  deliverAuth();
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const wcOf = () => BrowserWindow.getFocusedWindow()?.webContents;
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "Navigate",
      submenu: [
        { label: "Back", accelerator: mac ? "Cmd+[" : "Alt+Left", click: () => { const wc = wcOf(); if (wc) goBack(wc); } },
        { label: "Forward", accelerator: mac ? "Cmd+]" : "Alt+Right", click: () => { const wc = wcOf(); if (wc) goForward(wc); } },
        { label: "SPS Search Home", accelerator: "CmdOrCtrl+Shift+H", click: () => { const wc = wcOf(); if (wc) wc.loadURL(SITE_URL); } },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => { const wc = wcOf(); if (wc) wc.reload(); } },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 800, minWidth: 360, minHeight: 480,
    title: "SPS Search", backgroundColor: "#e9eef0",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });

  const wc = win.webContents;
  // Links open inside the app (use Back / Alt+Left to return). Only the browser sign-in page opens outside.
  wc.setWindowOpenHandler(({ url }) => {
    if (url.includes("#/app-signin") || /^mailto:/i.test(url)) { shell.openExternal(url); }
    else if (/^https?:/i.test(url)) { wc.loadURL(url); }
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
  wc.on("did-finish-load", deliverAuth);
  win.on("app-command", (_e, cmd) => { // mouse back/forward buttons on Windows
    if (cmd === "browser-backward") goBack(wc);
    if (cmd === "browser-forward") goForward(wc);
  });
  // No internet: show a friendly page with a Retry button.
  wc.on("did-fail-load", (_e, code, _d, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, "offline.html"));
  });
  win.on("closed", () => { win = null; });
  win.loadURL(SITE_URL);
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
