import { contextBridge, ipcRenderer } from 'electron';

// Minimal, safe bridge. The UI talks to the embedded server over HTTP as before;
// this just lets it discover it's running inside Ployd (and the base URL).
contextBridge.exposeInMainWorld('ployd', {
  isElectron: true,
  getUrl: () => ipcRenderer.invoke('ployd:get-url'),
  pickFolder: () => ipcRenderer.invoke('ployd:pick-folder'),
  // Native menu bar clicks (New Task, Settings, …) are forwarded here so the
  // renderer can drive its existing modals — main.ts owns no UI of its own.
  onMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('ployd:menu-action', listener);
    return () => ipcRenderer.removeListener('ployd:menu-action', listener);
  },
  // Auto-update: main process notifies when a new version starts downloading in
  // the background, and again once it's ready; the renderer says so, then shows
  // a "relaunch" banner.
  onUpdateDownloading: (callback: (version: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
    ipcRenderer.on('ployd:update-downloading', listener);
    return () => ipcRenderer.removeListener('ployd:update-downloading', listener);
  },
  onUpdateReady: (callback: (version: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
    ipcRenderer.on('ployd:update-ready', listener);
    return () => ipcRenderer.removeListener('ployd:update-ready', listener);
  },
  // Fired when a downloaded update can't be applied automatically on this
  // build (e.g. an ad-hoc-signed macOS build failing Squirrel.Mac's signature
  // check) — the renderer offers a manual download link instead.
  onUpdateInstallFailed: (callback: (releasesUrl: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, releasesUrl: string) => callback(releasesUrl);
    ipcRenderer.on('ployd:update-install-failed', listener);
    return () => ipcRenderer.removeListener('ployd:update-install-failed', listener);
  },
  // Whatever the main process knew before this window finished loading.
  getUpdateStatus: () => ipcRenderer.invoke('ployd:update-status'),
  restartToUpdate: () => ipcRenderer.invoke('ployd:restart-to-update'),
});

// Electron-only presentation tweaks — untouched when the UI runs in a browser.
// 1) shift the top bar clear of the mac traffic lights (hiddenInset title bar)
// 2) make the top bar a draggable window region; keep controls clickable.
function applyElectronChrome(): void {
  document.documentElement.classList.add('is-electron');
  const style = document.createElement('style');
  style.textContent = `
    .is-electron .topbar {
      -webkit-app-region: drag;
      padding-left: 88px;
    }
    .is-electron .topbar button,
    .is-electron .topbar .health-chip,
    .is-electron .topbar input,
    .is-electron .topbar a {
      -webkit-app-region: no-drag;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', applyElectronChrome);
} else {
  applyElectronChrome();
}
