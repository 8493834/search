// Gives the SPS Search website (and only that site) a small bridge to receive the sign-in result.
const { contextBridge, ipcRenderer } = require("electron");

if (location.origin === "https://8493834.github.io" && location.pathname.startsWith("/search/")) {
  let handler = null;
  let queued = null;
  ipcRenderer.on("auth-token", (_e, token) => {
    if (handler) handler(token);
    else queued = token;
  });
  contextBridge.exposeInMainWorld("spsApp", {
    isApp: true,
    onAuthToken(cb) {
      handler = cb;
      if (queued) { cb(queued); queued = null; }
    },
  });
}
