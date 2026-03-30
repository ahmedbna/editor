# BNA Desktop

A Cursor-like AI-powered desktop IDE built with Electron, designed for building Expo React Native apps with Convex backend. Features a real filesystem, integrated terminal, Monaco code editor, and an AI agent powered by Claude that can read, write, edit files and run commands.

## Features

- **AI Agent** — Claude-powered assistant that can create files, edit code, run shell commands, and deploy your app
- **Monaco Editor** — VS Code's editor engine with syntax highlighting, bracket matching, and auto-save
- **Real Terminal** — Full PTY terminal via node-pty with multi-tab support
- **File Explorer** — Live file tree with chokidar watching for real-time updates
- **Dark Industrial Theme** — Custom dark UI with accent color theming throughout
- **Auth** — Sign in with a BNA account (Convex Auth) or use your own Anthropic API key
- **Cross-Platform** — Builds for macOS, Windows, and Linux

## Architecture

```
bna-desktop/
├── electron/                   # Main process (Node.js)
│   ├── main.ts                 # App entry, window creation, IPC setup
│   ├── preload.ts              # Context bridge (renderer ↔ main)
│   ├── ipc/
│   │   ├── filesystem.ts       # fs read/write/watch via chokidar
│   │   ├── terminal.ts         # node-pty terminal sessions
│   │   ├── ai-agent.ts         # Anthropic API + tool execution loop
│   │   └── project.ts          # Project open/create/recent
│   ├── ai/
│   │   ├── tools.ts            # Tool definitions (view/edit/write/run/search)
│   │   └── system-prompt.ts    # System prompt for Expo + Convex stack
│   └── auth/
│       └── convex-auth.ts      # Convex auth bridge
├── src/                        # Renderer process (React)
│   ├── main.tsx                # React entry
│   ├── App.tsx                 # Root layout
│   ├── components/
│   │   ├── Editor.tsx          # Monaco editor with custom theme
│   │   ├── Sidebar.tsx         # File tree explorer
│   │   ├── Terminal.tsx        # xterm.js multi-tab terminal
│   │   ├── Chat.tsx            # AI chat panel
│   │   ├── StatusBar.tsx       # Credits, user info, connection status
│   │   └── auth/
│   │       └── login-page.tsx  # Login / API key entry
│   ├── styles/
│   │   └── globals.css         # Tailwind + custom CSS variables
│   └── types/
│       ├── electron.d.ts       # Type declarations for window.electronAPI
│       └── css.d.ts            # CSS module type declarations
├── vite.config.ts              # Vite + vite-plugin-electron config
├── tsconfig.json               # TypeScript config (renderer)
├── electron/tsconfig.json      # TypeScript config (main process)
├── tailwind.config.js
└── postcss.config.js
```

## Prerequisites

- **Node.js** ≥ 18
- **pnpm** (recommended) or npm
- **Python** ≥ 3.x (for node-pty native build)
- **Xcode Command Line Tools** (macOS) or equivalent build tools for native modules

## Setup

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url> bna-desktop
   cd bna-desktop
   pnpm install
   ```

   > `node-pty` is a native module and requires a C++ toolchain. On macOS, ensure Xcode CLI tools are installed (`xcode-select --install`). On Windows, install windows-build-tools.

2. **Configure environment (optional):**

   Create a `.env` file in the project root:

   ```env
   CONVEX_URL=https://your-deployment.convex.cloud
   AUTH_URL=https://your-auth-url.com
   ```

   Or skip this and use API Key mode (enter your Anthropic key directly in the app).

3. **Run in development:**

   ```bash
   pnpm dev
   ```

   This starts both the Vite dev server and Electron. The app hot-reloads on changes.

## Development

### Key Commands

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `pnpm dev`        | Start dev server + Electron                    |
| `pnpm build`      | Build renderer (Vite) + main process           |
| `pnpm dist:mac`   | Build + package for macOS (.dmg, .zip)         |
| `pnpm dist:win`   | Build + package for Windows (.nsis, .portable) |
| `pnpm dist:linux` | Build + package for Linux (.AppImage, .deb)    |

### How the AI Agent Works

The AI agent runs in the Electron main process and uses the Anthropic API with tool calling:

1. User sends a message from the Chat panel
2. The message is sent to Claude (claude-sonnet-4-20250514) with the system prompt and available tools
3. Claude responds with text and/or tool calls
4. Tool calls are executed in the main process:
   - **view_file** — reads file contents with line numbers
   - **write_file** — creates or overwrites files
   - **edit_file** — replaces a unique string in a file
   - **run_command** — executes shell commands via node-pty
   - **list_directory** — lists directory contents
   - **search_files** — searches for patterns across files
5. Tool results are sent back to Claude for the next iteration
6. The loop continues until Claude responds with `end_turn`

### IPC Communication

All communication between the renderer (React) and main process (Node.js) goes through Electron IPC, exposed via `window.electronAPI` in the preload script:

- `window.electronAPI.fs.*` — filesystem operations
- `window.electronAPI.terminal.*` — terminal session management
- `window.electronAPI.ai.*` — AI chat + event listeners
- `window.electronAPI.project.*` — project management
- `window.electronAPI.auth.*` — authentication
- `window.electronAPI.settings.*` — API key storage
- `window.electronAPI.shell.*` — open external URLs

### Auth Modes

1. **BNA Account** — Opens browser for OAuth login, returns token via deep link (`bna-desktop://auth-callback?token=...`). Includes credit tracking.
2. **API Key Mode** — Enter your own Anthropic API key directly. Stored locally via electron-store. No credit tracking.

## Packaging

Build distributable packages with electron-builder:

```bash
# macOS
pnpm dist:mac

# Windows
pnpm dist:win

# Linux
pnpm dist:linux
```

Output goes to the `release/` directory. The app registers the `bna-desktop://` protocol for deep link auth callbacks.

## Tech Stack

| Layer         | Technology                               |
| ------------- | ---------------------------------------- |
| Framework     | Electron                                 |
| Renderer      | React 19 + TypeScript                    |
| Bundler       | Vite + vite-plugin-electron              |
| Editor        | Monaco Editor (@monaco-editor/react)     |
| Terminal      | xterm.js + node-pty                      |
| AI            | Anthropic Claude API (@anthropic-ai/sdk) |
| Styling       | Tailwind CSS v4                          |
| State         | React hooks (useState/useEffect)         |
| File Watching | chokidar                                 |
| Local Storage | electron-store                           |
| Packaging     | electron-builder                         |
| Icons         | lucide-react                             |
| Toasts        | sonner                                   |

## Keyboard Shortcuts

| Shortcut      | Action                 |
| ------------- | ---------------------- |
| `⌘L`          | Toggle AI chat panel   |
| `⌘J`          | Toggle terminal        |
| `⌘S`          | Save current file      |
| `Enter`       | Send message (in chat) |
| `Shift+Enter` | New line (in chat)     |

## Troubleshooting

### Black screen / preload script not found

If you see `Cannot find module .../dist-electron/preload.cjs`:

```bash
rm -rf dist-electron/
pnpm dev
```

Verify both `dist-electron/main.cjs` and `dist-electron/preload.cjs` exist after startup.

### `window.electronAPI` is undefined

The preload script failed to load. Check the dev tools console for the specific error. Common causes:

- Preload file doesn't exist (see above)
- Preload built as `.mjs` instead of `.cjs` — check `vite.config.ts` preload output settings

### node-pty build errors

```bash
# macOS
xcode-select --install

# Rebuild native modules
pnpm rebuild node-pty
```

### CSS type errors

If TypeScript complains about `.css` imports, ensure `src/types/css.d.ts` exists:

```typescript
declare module '*.css' {}
```

## License

Proprietary
