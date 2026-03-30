// electron/ipc/filesystem.ts
import { IpcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';

let watcher: chokidar.FSWatcher | null = null;

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  '.DS_Store',
  'android',
  'ios',
  '.cache',
  '__pycache__',
  '.turbo',
]);

async function buildFileTree(dirPath: string, depth = 0): Promise<FileNode[]> {
  if (depth > 6) return [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileNode[] = [];

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children: await buildFileTree(fullPath, depth + 1),
        });
      } else {
        nodes.push({ name: entry.name, path: fullPath, type: 'file' });
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

export function setupFileSystemHandlers(ipcMain: IpcMain) {
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    return await fs.readFile(filePath, 'utf-8');
  });

  ipcMain.handle(
    'fs:writeFile',
    async (_, filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    },
  );

  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    return await buildFileTree(dirPath);
  });

  ipcMain.handle('fs:delete', async (_, filePath: string) => {
    await fs.rm(filePath, { recursive: true });
    return true;
  });

  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath);
    return true;
  });

  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:stat', async (_, filePath: string) => {
    const stat = await fs.stat(filePath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  });

  ipcMain.handle('fs:watch', async (event, dirPath: string) => {
    if (watcher) await watcher.close();
    watcher = chokidar.watch(dirPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/.expo/**',
      ],
      persistent: true,
      ignoreInitial: true,
    });
    watcher
      .on('add', (p) =>
        event.sender.send('fs:changed', { type: 'add', path: p }),
      )
      .on('change', (p) =>
        event.sender.send('fs:changed', { type: 'change', path: p }),
      )
      .on('unlink', (p) =>
        event.sender.send('fs:changed', { type: 'unlink', path: p }),
      )
      .on('addDir', (p) =>
        event.sender.send('fs:changed', { type: 'addDir', path: p }),
      )
      .on('unlinkDir', (p) =>
        event.sender.send('fs:changed', { type: 'unlinkDir', path: p }),
      );
  });
}
