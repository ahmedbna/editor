// electron/ipc/project.ts
import { IpcMain, BrowserWindow, dialog, shell } from 'electron';
import Store from 'electron-store';
import fs from 'fs/promises';
import path from 'path';

interface StoreSchema {
  lastProjectPath: string;
  recentProjects: string[];
}

const store = new Store<StoreSchema>({
  defaults: {
    lastProjectPath: '',
    recentProjects: [],
  },
});

export function setupProjectHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Expo Project',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const projectPath = result.filePaths[0];
    store.set('lastProjectPath', projectPath);
    return projectPath;
  });

  ipcMain.handle('project:getCurrent', () => {
    return store.get('lastProjectPath') || null;
  });

  ipcMain.handle(
    'project:create',
    async (_, opts: { name: string; path: string }) => {
      try {
        const projectPath = path.join(opts.path, opts.name);

        try {
          await fs.access(projectPath);
          return {
            success: false,
            error: `Directory ${opts.name} already exists`,
          };
        } catch {
          // Good — directory doesn't exist
        }

        await fs.mkdir(projectPath, { recursive: true });
        store.set('lastProjectPath', projectPath);

        return { success: true, projectPath };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle('project:isInitialized', async (_, projectPath: string) => {
    try {
      await fs.access(path.join(projectPath, 'package.json'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('project:getInfo', async (_, projectPath: string) => {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf-8'),
      );

      let hasConvex = false;
      try {
        await fs.access(path.join(projectPath, 'convex'));
        hasConvex = true;
      } catch {}

      let hasExpo = false;
      try {
        await fs.access(path.join(projectPath, 'app.json'));
        hasExpo = true;
      } catch {}

      return {
        name: packageJson.name || path.basename(projectPath),
        version: packageJson.version,
        hasConvex,
        hasExpo,
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('project:getRecent', () => {
    return store.get('recentProjects') || [];
  });

  ipcMain.handle('project:addRecent', (_, projectPath: string) => {
    const recent = (store.get('recentProjects') || []).filter(
      (p) => p !== projectPath,
    );
    recent.unshift(projectPath);
    store.set('recentProjects', recent.slice(0, 10));
  });

  ipcMain.handle('shell:openExternal', (_, url: string) => {
    shell.openExternal(url);
  });
}
