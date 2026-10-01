// SPS Search desktop app: a window around the live website, so it is always up to date.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const SITE_URL = "https://8493834.github.io/search/";
const SITE = new URL(SITE_URL);

function isInsideApp(url) {
  try {
    const u = new URL(url);
    return u.origin === SITE.origin && u.pathname.startsWith(SITE.pathname);
  } catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 800, minWidth: 360, minHeight: 480,
    title: "SPS Search", backgroundColor: "#e9eef0",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The website checks for this word. Google blocks sign-in inside apps, so the site sends sign-in to your browser.
  win.webContents.setUserAgent(win.webContents.getUserAgent() + " SPSSearchApp");

  // Search-result links and anything outside this site open in your normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInsideApp(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  // No internet: show a friendly page with a Retry button.
  win.webContents.on("did-fail-load", (_e, code, _d, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, "offline.html"));
  });

  win.loadURL(SITE_URL);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
