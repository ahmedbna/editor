// electron/auth/convex-auth.ts
import { IpcMain, BrowserWindow, shell } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';

interface StoreSchema {
  convexAuthToken: string;
  authSessionId: string;
}

const store = new Store<StoreSchema>();

const CONVEX_URL =
  process.env.CONVEX_URL || 'https://your-deployment.convex.cloud';
const AUTH_URL = process.env.AUTH_URL || 'https://ai.ahmedbna.com';

// Polling interval and timeout for auth callback
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function setupAuthHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('auth:login', async () => {
    // Generate a unique session ID for this login attempt
    const sessionId = crypto.randomUUID();
    store.set('authSessionId', sessionId);

    // Open the DEDICATED desktop login route (not the homepage).
    // This route handles both already-authenticated and unauthenticated users.
    const loginUrl = `${AUTH_URL}/desktop-login?session_id=${encodeURIComponent(sessionId)}&redirect=${encodeURIComponent('bna-desktop://auth-callback')}`;
    await shell.openExternal(loginUrl);

    // Start polling as a fallback in case deep links don't work
    // The web app stores the token in Convex keyed by session_id
    stopPolling();
    const startTime = Date.now();

    pollTimer = setInterval(async () => {
      // Stop polling after timeout
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        stopPolling();
        const window = getWindow();
        if (window) {
          window.webContents.send(
            'auth:error',
            'Login timed out. Please try again.',
          );
        }
        return;
      }

      // Check if token was already received via deep link
      const existingToken = store.get('convexAuthToken');
      if (existingToken && existingToken !== 'apikey-mode') {
        stopPolling();
        return;
      }

      // Poll the web app for the token
      try {
        const response = await fetch(
          `${AUTH_URL}/api/desktop-auth?session_id=${sessionId}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          },
        );

        if (response.ok) {
          const data = await response.json();
          if (data.token) {
            store.set('convexAuthToken', data.token);
            const window = getWindow();
            if (window) {
              window.webContents.send('auth:tokenReceived', data.token);
              if (window.isMinimized()) window.restore();
              window.focus();
            }
            stopPolling();
          }
        }
      } catch {
        // Polling failed — will retry on next interval
      }
    }, POLL_INTERVAL_MS);

    return sessionId;
  });

  ipcMain.handle('auth:cancelLogin', () => {
    stopPolling();
  });

  ipcMain.handle('auth:setToken', (_, token: string) => {
    store.set('convexAuthToken', token);
    stopPolling();
  });

  ipcMain.handle('auth:getToken', () => {
    return store.get('convexAuthToken') || null;
  });

  ipcMain.handle('auth:getUser', async () => {
    const token = store.get('convexAuthToken');
    if (!token) return null;

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
    if (!token) return null;

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
    stopPolling();
  });
}
