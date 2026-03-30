// electron/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { setupFileSystemHandlers } from './ipc/filesystem';
import { setupTerminalHandlers } from './ipc/terminal';
import { setupAIHandlers } from './ipc/ai-agent';
import { setupAuthHandlers } from './auth/convex-auth';
import { setupProjectHandlers } from './ipc/project';

interface StoreSchema {
  convexAuthToken: string;
}

const store = new Store<StoreSchema>();
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for node-pty
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Register all IPC handlers
  setupFileSystemHandlers(ipcMain);
  setupTerminalHandlers(ipcMain);
  setupAIHandlers(ipcMain);
  setupAuthHandlers(ipcMain, () => mainWindow);
  setupProjectHandlers(ipcMain, () => mainWindow);

  // Handle deep links (bna-desktop://auth-callback?token=...)
  app.on('open-url', (_event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'auth-callback') {
        const token = parsed.searchParams.get('token');
        if (token) {
          store.set('convexAuthToken', token);
          mainWindow?.webContents.send('auth:tokenReceived', token);
        }
      }
    } catch (e) {
      console.error('Failed to parse deep link URL:', e);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Register as protocol handler for deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('bna-desktop', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('bna-desktop');
}
