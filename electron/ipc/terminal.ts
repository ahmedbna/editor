// electron/ipc/terminal.ts
import { IpcMain } from 'electron';
import os from 'os';

const pty = require('node-pty');

const terminals = new Map<string, any>();

export function setupTerminalHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    'terminal:create',
    (
      event,
      opts: {
        id: string;
        cwd?: string;
        cols?: number;
        rows?: number;
      },
    ) => {
      // Kill existing terminal with same ID
      if (terminals.has(opts.id)) {
        try {
          terminals.get(opts.id).kill();
        } catch {}
        terminals.delete(opts.id);
      }

      const shell =
        os.platform() === 'win32'
          ? 'powershell.exe'
          : process.env.SHELL || '/bin/zsh';

      const term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: opts.cwd || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
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
    },
  );

  ipcMain.handle('terminal:write', (_, id: string, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.handle(
    'terminal:resize',
    (_, id: string, cols: number, rows: number) => {
      try {
        terminals.get(id)?.resize(cols, rows);
      } catch {}
    },
  );

  ipcMain.handle('terminal:kill', (_, id: string) => {
    try {
      terminals.get(id)?.kill();
    } catch {}
    terminals.delete(id);
  });

  // One-shot command execution for AI tools
  ipcMain.handle(
    'terminal:exec',
    async (
      _,
      opts: {
        command: string;
        cwd: string;
        timeout?: number;
      },
    ) => {
      return new Promise((resolve) => {
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const args =
          os.platform() === 'win32'
            ? ['-Command', opts.command]
            : ['-c', opts.command];

        const proc = pty.spawn(shell, args, {
          cwd: opts.cwd,
          env: { ...process.env, TERM: 'dumb' },
        });

        let output = '';
        const timer = setTimeout(() => {
          proc.kill();
          resolve({ output, exitCode: -1, timedOut: true });
        }, opts.timeout || 30000);

        proc.onData((data: string) => {
          output += data;
        });
        proc.onExit(({ exitCode }: { exitCode: number }) => {
          clearTimeout(timer);
          resolve({ output, exitCode, timedOut: false });
        });
      });
    },
  );
}
