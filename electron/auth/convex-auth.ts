// electron/auth/convex-auth.ts
import { IpcMain, BrowserWindow, shell } from 'electron';
import Store from 'electron-store';

interface StoreSchema {
  convexAuthToken: string;
}

const store = new Store<StoreSchema>();

const CONVEX_URL =
  process.env.CONVEX_URL || 'https://your-deployment.convex.cloud';
const AUTH_URL = process.env.AUTH_URL || 'https://ai.ahmedbna.com';

export function setupAuthHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('auth:login', async () => {
    const loginUrl = `${AUTH_URL}?desktop=true&redirect=bna-desktop://auth-callback`;
    await shell.openExternal(loginUrl);
  });

  ipcMain.handle('auth:setToken', (_, token: string) => {
    store.set('convexAuthToken', token);
  });

  ipcMain.handle('auth:getToken', () => {
    return store.get('convexAuthToken') || null;
  });

  ipcMain.handle('auth:getUser', async () => {
    const token = store.get('convexAuthToken');
    if (!token || token === 'apikey-mode') return null;

    try {
      const response = await fetch(`${CONVEX_URL}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: 'users:getUser',
          format: 'json',
          args: {},
        }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      return data.value;
    } catch {
      return null;
    }
  });

  ipcMain.handle('auth:getCredits', async () => {
    const token = store.get('convexAuthToken');
    if (!token || token === 'apikey-mode') return null;

    try {
      const response = await fetch(`${CONVEX_URL}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: 'credits:getMyCredits',
          format: 'json',
          args: {},
        }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      return data.value;
    } catch {
      return null;
    }
  });

  ipcMain.handle('auth:logout', () => {
    store.delete('convexAuthToken');
  });
}
