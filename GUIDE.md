# BNA Desktop — Cursor-like Electron IDE

## Architecture Overview

```
bna-desktop/
├── package.json
├── electron/
│   ├── main.ts                 # Electron main process
│   ├── preload.ts              # Bridge between main & renderer
│   ├── ipc/
│   │   ├── filesystem.ts       # Real fs read/write/watch
│   │   ├── terminal.ts         # node-pty terminal sessions
│   │   ├── ai-agent.ts         # Anthropic API + tool calls
│   │   └── project.ts          # Project open/create/manage
│   ├── ai/
│   │   ├── agent.ts            # Core agent loop
│   │   ├── tools.ts            # Tool definitions (view/edit/write/run)
│   │   └── system-prompt.ts    # System prompt for Expo RN
│   └── auth/
│       └── convex-auth.ts      # Convex auth bridge
├── src/                        # React renderer
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Editor.tsx          # Monaco editor
│   │   ├── FileTree.tsx        # File explorer
│   │   ├── Terminal.tsx         # xterm.js terminal
│   │   ├── Chat.tsx            # AI chat panel
│   │   ├── Sidebar.tsx
│   │   ├── StatusBar.tsx
│   │   └── auth/
│   │       ├── LoginPage.tsx
│   │       └── CreditsDisplay.tsx
│   ├── stores/
│   │   ├── editor.ts
│   │   ├── files.ts
│   │   ├── chat.ts
│   │   └── auth.ts
│   └── styles/
│       └── globals.css         # Dark industrial theme
├── convex/                     # Shared with web — auth, credits, payments
│   ├── schema.ts
│   ├── auth.ts
│   ├── credits.ts
│   ├── payments.ts
│   └── users.ts
└── electron-builder.yml
```

## Key Differences from Web BNA

| Feature | Web BNA | Desktop BNA |
|---------|---------|-------------|
| Filesystem | WebContainers (virtual) | Real OS filesystem via Node.js `fs` |
| Terminal | WebContainer jsh shell | Real PTY via `node-pty` |
| Editor | CodeMirror | Monaco Editor (VS Code engine) |
| AI Tools | Virtual file writes | Real `fs.writeFile`, real shell commands |
| Preview | iframe WebContainer | Launches real Expo dev server |
| Auth | Browser cookies/Convex Auth | Convex Auth via Electron IPC |
| Deployment | Vercel | electron-builder (macOS/Windows/Linux) |

---

## Step 1: Initialize the Electron + React Project

```bash
mkdir bna-desktop && cd bna-desktop
npm init -y

# Core dependencies
npm install electron electron-builder --save-dev
npm install @anthropic-ai/sdk                    # AI
npm install node-pty                              # Real terminal
npm install chokidar                              # File watching
npm install convex @convex-dev/auth              # Auth + DB
npm install monaco-editor @monaco-editor/react   # Code editor
npm install xterm @xterm/addon-fit xterm-addon-web-links  # Terminal UI
npm install nanostores @nanostores/react          # State
npm install react react-dom                       # UI
npm install lucide-react sonner                   # Icons + toasts
npm install electron-store                        # Local settings
npm install tailwindcss postcss autoprefixer      # Styling

# Dev dependencies
npm install --save-dev typescript vite @vitejs/plugin-react
npm install --save-dev vite-plugin-electron vite-plugin-electron-renderer
```

---

## Step 2: Electron Main Process

### `electron/main.ts`
```typescript
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { setupFileSystemHandlers } from './ipc/filesystem';
import { setupTerminalHandlers } from './ipc/terminal';
import { setupAIHandlers } from './ipc/ai-agent';
import { setupProjectHandlers } from './ipc/project';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for node-pty
    },
  });

  // Dev or production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();

  // Register all IPC handlers
  setupFileSystemHandlers(ipcMain);
  setupTerminalHandlers(ipcMain);
  setupAIHandlers(ipcMain);
  setupProjectHandlers(ipcMain, () => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

---

## Step 3: Real Filesystem Access

### `electron/ipc/filesystem.ts`
```typescript
import { IpcMain } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import chokidar from 'chokidar';

let watcher: chokidar.FSWatcher | null = null;

export function setupFileSystemHandlers(ipcMain: IpcMain) {
  // Read file
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  });

  // Write file
  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  });

  // Read directory tree
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    return buildFileTree(dirPath);
  });

  // Delete file
  ipcMain.handle('fs:delete', async (_, filePath: string) => {
    await fs.rm(filePath, { recursive: true });
    return true;
  });

  // Rename
  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath);
    return true;
  });

  // Watch directory for changes
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
      .on('add', (p) => event.sender.send('fs:changed', { type: 'add', path: p }))
      .on('change', (p) => event.sender.send('fs:changed', { type: 'change', path: p }))
      .on('unlink', (p) => event.sender.send('fs:changed', { type: 'unlink', path: p }))
      .on('addDir', (p) => event.sender.send('fs:changed', { type: 'addDir', path: p }))
      .on('unlinkDir', (p) => event.sender.send('fs:changed', { type: 'unlinkDir', path: p }));
  });

  // Check if path exists
  ipcMain.handle('fs:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch { return false; }
  });

  // Stat
  ipcMain.handle('fs:stat', async (_, filePath: string) => {
    const stat = await fs.stat(filePath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  });
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

async function buildFileTree(dirPath: string, depth = 0): Promise<FileNode[]> {
  if (depth > 5) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  const IGNORED = new Set([
    'node_modules', '.git', '.expo', 'dist',
    '.DS_Store', 'android', 'ios',
  ]);

  for (const entry of entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
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
}
```

---

## Step 4: Real Terminal via node-pty

### `electron/ipc/terminal.ts`
```typescript
import { IpcMain, BrowserWindow } from 'electron';
import os from 'os';

// node-pty must be required, not imported (native module)
const pty = require('node-pty');

const terminals = new Map<string, any>();

export function setupTerminalHandlers(ipcMain: IpcMain) {
  ipcMain.handle('terminal:create', (event, opts: {
    id: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }) => {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'zsh';
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd: opts.cwd || os.homedir(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    terminals.set(opts.id, term);

    term.onData((data: string) => {
      event.sender.send(`terminal:data:${opts.id}`, data);
    });

    term.onExit(({ exitCode }: { exitCode: number }) => {
      event.sender.send(`terminal:exit:${opts.id}`, exitCode);
      terminals.delete(opts.id);
    });

    return true;
  });

  ipcMain.handle('terminal:write', (_, id: string, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });

  ipcMain.handle('terminal:kill', (_, id: string) => {
    terminals.get(id)?.kill();
    terminals.delete(id);
  });

  // Run a command and capture output (for AI tools)
  ipcMain.handle('terminal:exec', async (_, opts: {
    command: string;
    cwd: string;
    timeout?: number;
  }) => {
    return new Promise((resolve) => {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      const args = os.platform() === 'win32' ? ['-Command', opts.command] : ['-c', opts.command];

      const proc = pty.spawn(shell, args, {
        cwd: opts.cwd,
        env: process.env,
      });

      let output = '';
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ output, exitCode: -1, timedOut: true });
      }, opts.timeout || 30000);

      proc.onData((data: string) => { output += data; });
      proc.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timeout);
        resolve({ output, exitCode, timedOut: false });
      });
    });
  });
}
```

---

## Step 5: AI Agent with Anthropic Tool Calls

### `electron/ai/tools.ts`
```typescript
import Anthropic from '@anthropic-ai/sdk';

export type ToolName = 'view_file' | 'write_file' | 'edit_file' | 'run_command' | 'list_directory';

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'view_file',
    description: 'Read the contents of a file. Returns the file with line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        start_line: { type: 'number', description: 'Optional start line (1-indexed)' },
        end_line: { type: 'number', description: 'Optional end line (1-indexed, -1 for EOF)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to write' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a unique string in a file. The old text must appear exactly once.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_text: { type: 'string', description: 'Exact text to find (must be unique)' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the project directory. Use for npm install, convex dev, expo commands, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the given path.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute directory path' },
      },
      required: ['path'],
    },
  },
];
```

### `electron/ai/agent.ts`
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { AI_TOOLS } from './tools';
import { SYSTEM_PROMPT } from './system-prompt';
import fs from 'fs/promises';
import path from 'path';

const pty = require('node-pty');

interface AgentOptions {
  apiKey: string;
  projectPath: string;
  onText: (text: string) => void;
  onToolUse: (tool: string, input: any) => void;
  onToolResult: (tool: string, result: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onUsage: (usage: { input: number; output: number }) => void;
}

export class BNAAgent {
  private client: Anthropic;
  private projectPath: string;
  private messages: Anthropic.MessageParam[] = [];
  private opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.projectPath = opts.projectPath;
    this.opts = opts;
  }

  async chat(userMessage: string) {
    this.messages.push({ role: 'user', content: userMessage });

    try {
      await this.runAgentLoop();
    } catch (err) {
      this.opts.onError(err as Error);
    }
  }

  private async runAgentLoop() {
    while (true) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        system: SYSTEM_PROMPT(this.projectPath),
        tools: AI_TOOLS,
        messages: this.messages,
      });

      // Track usage
      this.opts.onUsage({
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      });

      // Process content blocks
      const assistantContent: Anthropic.ContentBlock[] = [];
      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === 'text') {
          this.opts.onText(block.text);
        } else if (block.type === 'tool_use') {
          this.opts.onToolUse(block.name, block.input);
        }
      }

      this.messages.push({ role: 'assistant', content: assistantContent });

      // If stop_reason is 'end_turn', we're done
      if (response.stop_reason === 'end_turn') {
        this.opts.onComplete();
        break;
      }

      // If stop_reason is 'tool_use', execute tools and continue
      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const result = await this.executeTool(block.name, block.input as Record<string, any>);
          this.opts.onToolResult(block.name, result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }

        this.messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Otherwise, break
      break;
    }
  }

  private async executeTool(name: string, input: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'view_file': {
          const absPath = this.resolvePath(input.path);
          const content = await fs.readFile(absPath, 'utf-8');
          const lines = content.split('\n');
          const start = (input.start_line || 1) - 1;
          const end = input.end_line === -1 ? lines.length : (input.end_line || lines.length);
          return lines
            .slice(start, end)
            .map((line, i) => `${start + i + 1}: ${line}`)
            .join('\n');
        }

        case 'write_file': {
          const absPath = this.resolvePath(input.path);
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, input.content, 'utf-8');
          return `Successfully wrote ${absPath}`;
        }

        case 'edit_file': {
          const absPath = this.resolvePath(input.path);
          let content = await fs.readFile(absPath, 'utf-8');
          const count = content.split(input.old_text).length - 1;
          if (count === 0) return `Error: old_text not found in ${absPath}`;
          if (count > 1) return `Error: old_text found ${count} times (must be unique)`;
          content = content.replace(input.old_text, input.new_text);
          await fs.writeFile(absPath, content, 'utf-8');
          return `Successfully edited ${absPath}`;
        }

        case 'run_command': {
          return await this.runCommand(input.command, input.timeout || 30000);
        }

        case 'list_directory': {
          const absPath = this.resolvePath(input.path);
          const entries = await fs.readdir(absPath, { withFileTypes: true });
          return entries
            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
            .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
            .join('\n');
        }

        default:
          return `Error: Unknown tool ${name}`;
      }
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private resolvePath(p: string): string {
    if (path.isAbsolute(p)) return p;
    return path.join(this.projectPath, p);
  }

  private async runCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const args = process.platform === 'win32' ? ['-Command', command] : ['-c', command];

      const proc = pty.spawn(shell, args, {
        cwd: this.projectPath,
        env: { ...process.env, TERM: 'dumb' },
      });

      let output = '';
      const timer = setTimeout(() => {
        proc.kill();
        resolve(`${output}\n[Command timed out after ${timeout}ms]`);
      }, timeout);

      proc.onData((data: string) => { output += data; });
      proc.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timer);
        resolve(exitCode === 0 ? output : `${output}\n[Exit code: ${exitCode}]`);
      });
    });
  }
}
```

### `electron/ai/system-prompt.ts`
```typescript
export const SYSTEM_PROMPT = (projectPath: string) => `
You are BNA, an expert AI assistant and senior software engineer specializing in full-stack mobile development with Expo (development builds), React Native, TypeScript, and Convex backend.

You are running inside a desktop IDE with real filesystem access. The current project is at: ${projectPath}

You have the following tools:
- view_file: Read file contents with line numbers
- write_file: Create or overwrite files (creates parent dirs)
- edit_file: Replace a unique string in a file
- run_command: Execute shell commands (npm, npx, convex, etc.)
- list_directory: List files in a directory

## Rules
1. Always use absolute paths based on the project root: ${projectPath}
2. Write complete files — no placeholders like "// rest unchanged"
3. Use \`npx expo install\` for Expo packages
4. After schema changes, run \`npx convex dev --once\`
5. Design a unique theme for each app (never copy template colors)
6. Create reusable UI components in components/ui/ before screens
7. Use react-native-reanimated for animations, never Animated API
8. Always handle auth: \`const userId = await getAuthUserId(ctx)\`

## Planning Order
1. Theme (theme/colors.ts)
2. UI Components (components/ui/)
3. Schema (convex/schema.ts)
4. Backend functions (convex/)
5. Screens (app/)
6. Deploy: \`npx convex dev --once\` then \`npx expo run:ios\` or \`npx expo run:android\`
`;
```

### `electron/ipc/ai-agent.ts`
```typescript
import { IpcMain } from 'electron';
import { BNAAgent } from '../ai/agent';
import Store from 'electron-store';

const store = new Store();
let currentAgent: BNAAgent | null = null;

export function setupAIHandlers(ipcMain: IpcMain) {
  ipcMain.handle('ai:chat', async (event, opts: {
    message: string;
    projectPath: string;
    apiKey?: string;
  }) => {
    const apiKey = opts.apiKey || store.get('anthropicApiKey') as string;
    if (!apiKey) {
      event.sender.send('ai:error', 'No Anthropic API key configured');
      return;
    }

    // Create agent if needed (or reuse for conversation continuity)
    if (!currentAgent || (currentAgent as any).projectPath !== opts.projectPath) {
      currentAgent = new BNAAgent({
        apiKey,
        projectPath: opts.projectPath,
        onText: (text) => event.sender.send('ai:text', text),
        onToolUse: (tool, input) => event.sender.send('ai:toolUse', { tool, input }),
        onToolResult: (tool, result) => event.sender.send('ai:toolResult', { tool, result }),
        onComplete: () => event.sender.send('ai:complete'),
        onError: (err) => event.sender.send('ai:error', err.message),
        onUsage: (usage) => event.sender.send('ai:usage', usage),
      });
    }

    await currentAgent.chat(opts.message);
  });

  ipcMain.handle('ai:reset', () => {
    currentAgent = null;
  });

  ipcMain.handle('settings:setApiKey', (_, key: string) => {
    store.set('anthropicApiKey', key);
  });

  ipcMain.handle('settings:getApiKey', () => {
    return store.get('anthropicApiKey') || '';
  });
}
```

---

## Step 6: Preload Script (IPC Bridge)

### `electron/preload.ts`
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Filesystem
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    rename: (old: string, n: string) => ipcRenderer.invoke('fs:rename', old, n),
    watch: (path: string) => ipcRenderer.invoke('fs:watch', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    onChanged: (cb: (data: any) => void) => {
      ipcRenderer.on('fs:changed', (_, data) => cb(data));
      return () => ipcRenderer.removeAllListeners('fs:changed');
    },
  },

  // Terminal
  terminal: {
    create: (opts: any) => ipcRenderer.invoke('terminal:create', opts),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (id: string, cb: (data: string) => void) => {
      ipcRenderer.on(`terminal:data:${id}`, (_, data) => cb(data));
      return () => ipcRenderer.removeAllListeners(`terminal:data:${id}`);
    },
    onExit: (id: string, cb: (code: number) => void) => {
      ipcRenderer.on(`terminal:exit:${id}`, (_, code) => cb(code));
      return () => ipcRenderer.removeAllListeners(`terminal:exit:${id}`);
    },
  },

  // AI Agent
  ai: {
    chat: (opts: any) => ipcRenderer.invoke('ai:chat', opts),
    reset: () => ipcRenderer.invoke('ai:reset'),
    onText: (cb: (text: string) => void) => {
      ipcRenderer.on('ai:text', (_, t) => cb(t));
      return () => ipcRenderer.removeAllListeners('ai:text');
    },
    onToolUse: (cb: (data: any) => void) => {
      ipcRenderer.on('ai:toolUse', (_, d) => cb(d));
      return () => ipcRenderer.removeAllListeners('ai:toolUse');
    },
    onToolResult: (cb: (data: any) => void) => {
      ipcRenderer.on('ai:toolResult', (_, d) => cb(d));
      return () => ipcRenderer.removeAllListeners('ai:toolResult');
    },
    onComplete: (cb: () => void) => {
      ipcRenderer.on('ai:complete', () => cb());
      return () => ipcRenderer.removeAllListeners('ai:complete');
    },
    onError: (cb: (err: string) => void) => {
      ipcRenderer.on('ai:error', (_, e) => cb(e));
      return () => ipcRenderer.removeAllListeners('ai:error');
    },
    onUsage: (cb: (u: any) => void) => {
      ipcRenderer.on('ai:usage', (_, u) => cb(u));
      return () => ipcRenderer.removeAllListeners('ai:usage');
    },
  },

  // Project
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    create: (path: string) => ipcRenderer.invoke('project:create', path),
    getCurrent: () => ipcRenderer.invoke('project:getCurrent'),
  },

  // Settings
  settings: {
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  },

  // Shell
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
});
```

---

## Step 7: React Renderer — Main App Layout

### `src/App.tsx`
```tsx
import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { TerminalPanel } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { LoginPage } from './components/auth/LoginPage';
import { Toaster } from 'sonner';

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check for saved project
    window.electronAPI.project.getCurrent().then((p: string | null) => {
      if (p) setProjectPath(p);
    });
  }, []);

  if (!isAuthenticated) {
    return <LoginPage onAuth={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-[#e0e0e0] font-mono">
      {/* Title bar drag region */}
      <div className="h-8 bg-[#111] flex items-center px-4 select-none"
           style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-2 text-xs text-[#666]">
          <span className="text-[#FAD40B] font-bold">BNA</span>
          <span>Desktop</span>
          {projectPath && <span>— {projectPath.split('/').pop()}</span>}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar / File Tree */}
        <Sidebar
          projectPath={projectPath}
          onFileSelect={setSelectedFile}
          onOpenProject={async () => {
            const p = await window.electronAPI.project.open();
            if (p) setProjectPath(p);
          }}
          selectedFile={selectedFile}
        />

        {/* Editor + Terminal */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Editor
            filePath={selectedFile}
            projectPath={projectPath}
          />
          {showTerminal && projectPath && (
            <TerminalPanel projectPath={projectPath} />
          )}
        </div>

        {/* AI Chat Panel */}
        {showChat && (
          <Chat
            projectPath={projectPath}
            onFileOpen={(f) => setSelectedFile(f)}
          />
        )}
      </div>

      <StatusBar
        projectPath={projectPath}
        toggleChat={() => setShowChat(!showChat)}
        toggleTerminal={() => setShowTerminal(!showTerminal)}
      />

      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}
```

### `src/components/Editor.tsx` — Monaco Editor
```tsx
import MonacoEditor from '@monaco-editor/react';
import { useState, useEffect, useRef } from 'react';

interface Props {
  filePath: string | null;
  projectPath: string | null;
}

export function Editor({ filePath, projectPath }: Props) {
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('typescript');
  const [modified, setModified] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!filePath) return;
    window.electronAPI.fs.readFile(filePath).then((c: string) => {
      setContent(c);
      setModified(false);
      setLanguage(detectLanguage(filePath));
    });
  }, [filePath]);

  const handleChange = (value: string | undefined) => {
    if (!value || !filePath) return;
    setContent(value);
    setModified(true);

    // Auto-save with debounce
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await window.electronAPI.fs.writeFile(filePath, value);
      setModified(false);
    }, 1000);
  };

  const handleSave = async () => {
    if (!filePath) return;
    await window.electronAPI.fs.writeFile(filePath, content);
    setModified(false);
  };

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d0d0d]">
        <div className="text-center text-[#444]">
          <div className="text-6xl mb-4">⌘</div>
          <p className="text-lg">Open a file to start editing</p>
          <p className="text-sm mt-2">or ask BNA AI to build something</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="h-9 bg-[#111] border-b border-[#1a1a1a] flex items-center px-3 gap-2">
        <span className="text-xs text-[#888] flex items-center gap-1.5">
          {modified && <span className="w-2 h-2 rounded-full bg-[#FAD40B]" />}
          {filePath.split('/').pop()}
        </span>
        <button
          onClick={handleSave}
          className="ml-auto text-xs text-[#555] hover:text-white px-2 py-0.5 rounded bg-[#1a1a1a]"
        >
          ⌘S
        </button>
      </div>

      <MonacoEditor
        height="100%"
        language={language}
        value={content}
        onChange={handleChange}
        theme="bna-dark"
        beforeMount={(monaco) => {
          monaco.editor.defineTheme('bna-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
              'editor.background': '#0d0d0d',
              'editor.foreground': '#d4d4d4',
              'editorLineNumber.foreground': '#3a3a3a',
              'editorLineNumber.activeForeground': '#666',
              'editor.selectionBackground': '#264f7844',
              'editor.lineHighlightBackground': '#ffffff08',
              'editorCursor.foreground': '#FAD40B',
              'editorIndentGuide.background': '#1a1a1a',
            },
          });
        }}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 12 },
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          smoothScrolling: true,
          tabSize: 2,
        }}
        onMount={(editor, monaco) => {
          // ⌘S save
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave);
        }}
      />
    </div>
  );
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python',
  };
  return map[ext || ''] || 'plaintext';
}
```

### `src/components/Chat.tsx` — AI Chat Panel
```tsx
import { useState, useRef, useEffect } from 'react';
import { Send, RotateCcw, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

interface Props {
  projectPath: string | null;
  onFileOpen: (path: string) => void;
}

export function Chat({ projectPath, onFileOpen }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.ai.onText((text) => {
        setCurrentText(prev => prev + text);
      }),
      window.electronAPI.ai.onToolUse(({ tool, input }) => {
        setMessages(prev => [...prev, {
          role: 'tool',
          content: `Using ${tool}: ${JSON.stringify(input).slice(0, 200)}...`,
          toolName: tool,
        }]);
      }),
      window.electronAPI.ai.onComplete(() => {
        setCurrentText(prev => {
          if (prev) {
            setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
          }
          return '';
        });
        setStreaming(false);
      }),
      window.electronAPI.ai.onError((err) => {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${err}` }]);
        setStreaming(false);
      }),
    ];
    return () => cleanups.forEach(c => c());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, currentText]);

  const send = async () => {
    if (!input.trim() || !projectPath || streaming) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setStreaming(true);
    setCurrentText('');

    await window.electronAPI.ai.chat({
      message: msg,
      projectPath,
    });
  };

  return (
    <div className="w-[420px] border-l border-[#1a1a1a] flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="h-9 border-b border-[#1a1a1a] flex items-center px-3 gap-2">
        <span className="text-[#FAD40B] font-bold text-xs">BNA AI</span>
        <button
          onClick={() => { window.electronAPI.ai.reset(); setMessages([]); }}
          className="ml-auto text-[#555] hover:text-white"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${
            m.role === 'user' ? 'bg-[#1a1a1a] rounded-lg p-3' :
            m.role === 'tool' ? 'text-[#666] text-xs border-l-2 border-[#333] pl-2 py-1' :
            'text-[#ccc]'
          }`}>
            {m.role === 'tool' && <span className="text-[#FAD40B]">⚡ </span>}
            <pre className="whitespace-pre-wrap font-mono">{m.content}</pre>
          </div>
        ))}
        {currentText && (
          <div className="text-sm text-[#ccc]">
            <pre className="whitespace-pre-wrap font-mono">{currentText}</pre>
            <span className="animate-pulse text-[#FAD40B]">▊</span>
          </div>
        )}
        {streaming && !currentText && (
          <div className="flex items-center gap-2 text-[#666] text-sm">
            <Loader2 size={14} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#1a1a1a] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask BNA to build something..."
            className="flex-1 bg-[#111] border border-[#222] rounded-lg px-3 py-2 text-sm
                       resize-none focus:outline-none focus:border-[#FAD40B33]
                       placeholder:text-[#444] min-h-[38px] max-h-[200px]"
            rows={1}
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="p-2 rounded-lg bg-[#FAD40B] text-black hover:bg-[#e5c200]
                       disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 8: Auth, Credits & Payments

### Auth Strategy
The desktop app uses the same Convex backend. Auth flow:
1. User clicks "Login" → opens browser to your Convex auth endpoint
2. After auth, a deep link (`bna-desktop://auth-callback?token=...`) redirects back to the Electron app
3. The app stores the Convex auth token locally via `electron-store`

### `electron/auth/convex-auth.ts`
```typescript
import { IpcMain, BrowserWindow, shell } from 'electron';
import Store from 'electron-store';
import { ConvexHttpClient } from 'convex/browser';

const store = new Store();

export function setupAuthHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  const CONVEX_URL = 'https://your-deployment.convex.cloud';

  ipcMain.handle('auth:login', async () => {
    // Open browser for OAuth login
    const authUrl = `${CONVEX_URL.replace('.cloud', '.site')}/auth/login?redirect=bna-desktop://auth-callback`;
    await shell.openExternal(authUrl);
  });

  ipcMain.handle('auth:setToken', (_, token: string) => {
    store.set('convexAuthToken', token);
  });

  ipcMain.handle('auth:getToken', () => {
    return store.get('convexAuthToken') || null;
  });

  ipcMain.handle('auth:getUser', async () => {
    const token = store.get('convexAuthToken') as string;
    if (!token) return null;

    try {
      const client = new ConvexHttpClient(CONVEX_URL);
      client.setAuth(() => token);
      // Call your Convex query
      const user = await client.query('users:getUser' as any);
      return user;
    } catch {
      return null;
    }
  });

  ipcMain.handle('auth:getCredits', async () => {
    const token = store.get('convexAuthToken') as string;
    if (!token) return null;

    try {
      const client = new ConvexHttpClient(CONVEX_URL);
      client.setAuth(() => token);
      return await client.query('credits:getMyCredits' as any);
    } catch {
      return null;
    }
  });

  ipcMain.handle('auth:logout', () => {
    store.delete('convexAuthToken');
  });
}
```

### Credits Deduction (Desktop)
After each AI generation, call your existing Convex mutation:

```typescript
// In the AI agent's onUsage callback
ipcMain.handle('credits:deduct', async (_, usage: { input: number; output: number }) => {
  const token = store.get('convexAuthToken') as string;
  if (!token) return;

  const client = new ConvexHttpClient(CONVEX_URL);
  client.setAuth(() => token);

  await client.mutation('credits:deductCreditsForTokensPublic' as any, {
    userId: currentUserId,
    promptTokens: usage.input,
    completionTokens: usage.output,
    chatInitialId: `desktop-${Date.now()}`,
  });
});
```

### Payments
For desktop, redirect to your existing web credits page:
```typescript
ipcMain.handle('payments:buyCredits', async () => {
  await shell.openExternal('https://ai.ahmedbna.com/credits');
});
```

---

## Step 9: Dark Industrial CSS Theme

### `src/styles/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary: #0a0a0a;
  --bg-secondary: #111111;
  --bg-tertiary: #1a1a1a;
  --border: #222222;
  --text-primary: #e0e0e0;
  --text-secondary: #888888;
  --text-muted: #555555;
  --accent: #FAD40B;
  --accent-dim: #FAD40B33;
  --error: #ff5c57;
  --success: #5af78e;
}

* {
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Inter', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #444; }

/* Xterm terminal styling */
.xterm { padding: 8px; }
.xterm-viewport { scrollbar-width: thin; }
```

---

## Step 10: Build & Package

### `package.json` scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p electron/tsconfig.json",
    "electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win",
    "dist:linux": "electron-builder --linux"
  }
}
```

### `electron-builder.yml`
```yaml
appId: com.bna.desktop
productName: BNA Desktop
directories:
  output: release
files:
  - dist/**/*
  - electron/**/*.js
  - node_modules/**/*
mac:
  category: public.app-category.developer-tools
  icon: assets/icon.icns
  target:
    - target: dmg
    - target: zip
win:
  target:
    - target: nsis
    - target: portable
linux:
  target:
    - target: AppImage
    - target: deb
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
protocols:
  - name: BNA Desktop
    schemes:
      - bna-desktop
```

---

## Summary of What Carries Over from Web BNA

| Component | Reuse Strategy |
|-----------|---------------|
| `convex/schema.ts` | **Direct reuse** — same DB schema |
| `convex/credits.ts` | **Direct reuse** — same credit logic |
| `convex/payments.ts` | **Direct reuse** — redirect to web for checkout |
| `convex/users.ts` | **Direct reuse** — same user queries |
| `convex/auth.ts` | **Direct reuse** — same providers |
| `bna-agent/prompts/` | **Adapted** — same system prompt, tweaked for real fs |
| `bna-agent/tools/` | **Replaced** — real fs/shell instead of WebContainer |
| Auth flow | **Adapted** — OAuth via browser → deep link callback |
| UI components | **Rebuilt** — React components for Electron, not Remix |

The desktop app is fundamentally the same AI agent but with **real power**: real filesystem, real terminal, real shell commands, and the same Convex backend for auth/credits/payments.
