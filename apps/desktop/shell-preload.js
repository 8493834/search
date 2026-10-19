// Bridge for the tab bar / address bar page only (never loaded into websites).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("shell", {
  send: (channel, ...args) => ipcRenderer.send("shell:" + channel, ...args),
  onState: (cb) => ipcRenderer.on("shell:state", (_e, s) => cb(s)),
  onFocusUrl: (cb) => ipcRenderer.on("shell:focus-url", () => cb()),
  platform: process.platform,
});
