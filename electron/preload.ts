// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Filesystem
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', path, content),
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    rename: (oldP: string, newP: string) =>
      ipcRenderer.invoke('fs:rename', oldP, newP),
    watch: (path: string) => ipcRenderer.invoke('fs:watch', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    onChanged: (cb: (data: any) => void) => {
      const handler = (_: any, data: any) => cb(data);
      ipcRenderer.on('fs:changed', handler);
      return () => ipcRenderer.removeListener('fs:changed', handler);
    },
  },

  // Terminal
  terminal: {
    create: (opts: any) => ipcRenderer.invoke('terminal:create', opts),
    write: (id: string, data: string) =>
      ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (id: string, cb: (data: string) => void) => {
      const handler = (_: any, data: string) => cb(data);
      ipcRenderer.on(`terminal:data:${id}`, handler);
      return () => ipcRenderer.removeListener(`terminal:data:${id}`, handler);
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const handler = (_: any, code: number) => cb(code);
      ipcRenderer.on(`terminal:exit:${id}`, handler);
      return () => ipcRenderer.removeListener(`terminal:exit:${id}`, handler);
    },
  },

  // AI Agent
  ai: {
    chat: (opts: any) => ipcRenderer.invoke('ai:chat', opts),
    reset: () => ipcRenderer.invoke('ai:reset'),
    onText: (cb: (t: string) => void) => {
      const h = (_: any, t: string) => cb(t);
      ipcRenderer.on('ai:text', h);
      return () => ipcRenderer.removeListener('ai:text', h);
    },
    onToolUse: (cb: (d: any) => void) => {
      const h = (_: any, d: any) => cb(d);
      ipcRenderer.on('ai:toolUse', h);
      return () => ipcRenderer.removeListener('ai:toolUse', h);
    },
    onToolResult: (cb: (d: any) => void) => {
      const h = (_: any, d: any) => cb(d);
      ipcRenderer.on('ai:toolResult', h);
      return () => ipcRenderer.removeListener('ai:toolResult', h);
    },
    onComplete: (cb: () => void) => {
      const h = () => cb();
      ipcRenderer.on('ai:complete', h);
      return () => ipcRenderer.removeListener('ai:complete', h);
    },
    onError: (cb: (e: string) => void) => {
      const h = (_: any, e: string) => cb(e);
      ipcRenderer.on('ai:error', h);
      return () => ipcRenderer.removeListener('ai:error', h);
    },
    onUsage: (cb: (u: any) => void) => {
      const h = (_: any, u: any) => cb(u);
      ipcRenderer.on('ai:usage', h);
      return () => ipcRenderer.removeListener('ai:usage', h);
    },
  },

  // Project
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    create: (opts: { name: string; path: string }) =>
      ipcRenderer.invoke('project:create', opts),
    getCurrent: () => ipcRenderer.invoke('project:getCurrent'),
    isInitialized: (path: string) =>
      ipcRenderer.invoke('project:isInitialized', path),
    getInfo: (path: string) => ipcRenderer.invoke('project:getInfo', path),
    getRecent: () => ipcRenderer.invoke('project:getRecent'),
    addRecent: (path: string) => ipcRenderer.invoke('project:addRecent', path),
  },

  // Settings
  settings: {
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  },

  // Auth
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    cancelLogin: () => ipcRenderer.invoke('auth:cancelLogin'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    setToken: (token: string) => ipcRenderer.invoke('auth:setToken', token),
    getToken: () => ipcRenderer.invoke('auth:getToken'),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    getCredits: () => ipcRenderer.invoke('auth:getCredits'),
    onTokenReceived: (cb: (token: string) => void) => {
      const h = (_: any, t: string) => cb(t);
      ipcRenderer.on('auth:tokenReceived', h);
      return () => ipcRenderer.removeListener('auth:tokenReceived', h);
    },
    onError: (cb: (err: string) => void) => {
      const h = (_: any, e: string) => cb(e);
      ipcRenderer.on('auth:error', h);
      return () => ipcRenderer.removeListener('auth:error', h);
    },
  },

  // Shell
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
});
