const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jorgeDesktop', Object.freeze({
  state: () => ipcRenderer.invoke('auth:state'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  apiRequest: (input) => ipcRenderer.invoke('api:request', input),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  localStatus: () => ipcRenderer.invoke('local:status'),
  localInventory: () => ipcRenderer.invoke('local:inventory'),
  localOperations: () => ipcRenderer.invoke('local:operations'),
  localMove: (input) => ipcRenderer.invoke('local:move', input),
  syncNow: () => ipcRenderer.invoke('local:sync'),
}));
