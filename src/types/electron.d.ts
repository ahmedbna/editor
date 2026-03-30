// src/types/electron.d.ts
export {};

declare global {
  interface Window {
    electronAPI: {
      fs: {
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<boolean>;
        readDir: (path: string) => Promise<FileNode[]>;
        delete: (path: string) => Promise<boolean>;
        rename: (oldPath: string, newPath: string) => Promise<boolean>;
        watch: (path: string) => Promise<void>;
        exists: (path: string) => Promise<boolean>;
        stat: (path: string) => Promise<{
          isFile: boolean;
          isDirectory: boolean;
          size: number;
          mtime: number;
        }>;
        onChanged: (
          cb: (data: { type: string; path: string }) => void,
        ) => () => void;
      };
      terminal: {
        create: (opts: {
          id: string;
          cwd?: string;
          cols?: number;
          rows?: number;
        }) => Promise<boolean>;
        write: (id: string, data: string) => Promise<void>;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        kill: (id: string) => Promise<void>;
        onData: (id: string, cb: (data: string) => void) => () => void;
        onExit: (id: string, cb: (code: number) => void) => () => void;
      };
      ai: {
        chat: (opts: {
          message: string;
          projectPath: string;
          apiKey?: string;
        }) => Promise<void>;
        reset: () => Promise<void>;
        onText: (cb: (text: string) => void) => () => void;
        onToolUse: (
          cb: (data: { tool: string; input: any }) => void,
        ) => () => void;
        onToolResult: (
          cb: (data: { tool: string; result: string }) => void,
        ) => () => void;
        onComplete: (cb: () => void) => () => void;
        onError: (cb: (err: string) => void) => () => void;
        onUsage: (
          cb: (u: {
            input: number;
            output: number;
            totalInput: number;
            totalOutput: number;
          }) => void,
        ) => () => void;
      };
      project: {
        open: () => Promise<string | null>;
        create: (opts: { name: string; path: string }) => Promise<{
          success: boolean;
          projectPath?: string;
          error?: string;
        }>;
        getCurrent: () => Promise<string | null>;
        isInitialized: (path: string) => Promise<boolean>;
        getInfo: (path: string) => Promise<{
          name: string;
          version: string;
          hasConvex: boolean;
          hasExpo: boolean;
          dependencies: string[];
          devDependencies: string[];
        } | null>;
        getRecent: () => Promise<string[]>;
        addRecent: (path: string) => Promise<void>;
      };
      settings: {
        setApiKey: (key: string) => Promise<void>;
        getApiKey: () => Promise<string>;
      };
      auth: {
        login: () => Promise<string>;
        cancelLogin: () => Promise<void>;
        logout: () => Promise<void>;
        setToken: (token: string) => Promise<void>;
        getToken: () => Promise<string | null>;
        getUser: () => Promise<any>;
        getCredits: () => Promise<{
          credits: number;
          totalCreditsUsed: number;
        } | null>;
        onTokenReceived: (cb: (token: string) => void) => () => void;
        onError: (cb: (err: string) => void) => () => void;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
    };
  }

  interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileNode[];
  }
}
