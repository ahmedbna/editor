// electron/ipc/ai-agent.ts
import { IpcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import Store from 'electron-store';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SYSTEM_PROMPT } from '../ai/system-prompt';
import { AI_TOOLS } from '../ai/tools';

interface StoreSchema {
  anthropicApiKey: string;
}

const store = new Store<StoreSchema>();
const pty = require('node-pty');

let messages: Anthropic.MessageParam[] = [];
let currentProjectPath: string | null = null;

function resolvePath(projectPath: string, p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(projectPath, p);
}

async function runCommand(
  projectPath: string,
  command: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolve) => {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const args =
      os.platform() === 'win32' ? ['-Command', command] : ['-c', command];
    const proc = pty.spawn(shell, args, {
      cwd: projectPath,
      env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' },
    });
    let output = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve(`${output}\n[Command timed out after ${timeout}ms]`);
    }, timeout);
    proc.onData((data: string) => {
      output += data;
    });
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      clearTimeout(timer);
      resolve(exitCode === 0 ? output : `${output}\n[Exit code: ${exitCode}]`);
    });
  });
}

async function searchFiles(
  dirPath: string,
  pattern: string,
  filePattern?: string,
): Promise<string> {
  const results: string[] = [];
  const MAX_RESULTS = 50;
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
  ]);

  async function search(dir: string, depth: number): Promise<void> {
    if (depth > 5 || results.length >= MAX_RESULTS) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await search(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (filePattern) {
            const ext = filePattern.replace('*', '');
            if (!entry.name.endsWith(ext)) continue;
          }

          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            const regex = new RegExp(pattern, 'gi');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`);
                if (results.length >= MAX_RESULTS) break;
              }
            }
          } catch {
            // Skip binary files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await search(dirPath, 0);
  return results.length > 0
    ? results.join('\n')
    : `No matches found for "${pattern}" in ${dirPath}`;
}

async function executeTool(
  projectPath: string,
  name: string,
  input: Record<string, any>,
): Promise<string> {
  try {
    switch (name) {
      case 'view_file': {
        const absPath = resolvePath(projectPath, input.path);
        const content = await fs.readFile(absPath, 'utf-8');
        const lines = content.split('\n');
        const start = (input.start_line || 1) - 1;
        const end =
          input.end_line === -1 ? lines.length : input.end_line || lines.length;
        return lines
          .slice(start, end)
          .map((l, i) => `${start + i + 1}: ${l}`)
          .join('\n');
      }

      case 'write_file': {
        const absPath = resolvePath(projectPath, input.path);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, input.content, 'utf-8');
        return `Successfully wrote ${absPath} (${input.content.length} chars)`;
      }

      case 'edit_file': {
        const absPath = resolvePath(projectPath, input.path);
        let content = await fs.readFile(absPath, 'utf-8');
        if (input.old_text.length > 1024) {
          return `Error: old_text must be less than 1024 characters (got ${input.old_text.length})`;
        }
        if (input.new_text.length > 1024) {
          return `Error: new_text must be less than 1024 characters (got ${input.new_text.length})`;
        }
        const count = content.split(input.old_text).length - 1;
        if (count === 0)
          return `Error: old_text not found in ${absPath}. Use view_file first to check exact contents.`;
        if (count > 1)
          return `Error: old_text found ${count} times (must be unique). Make your search text more specific.`;
        content = content.replace(input.old_text, input.new_text);
        await fs.writeFile(absPath, content, 'utf-8');
        return `Successfully edited ${absPath}`;
      }

      case 'run_command': {
        return await runCommand(
          projectPath,
          input.command,
          input.timeout || 60000,
        );
      }

      case 'list_directory': {
        const absPath = resolvePath(projectPath, input.path);
        const recursive = input.recursive || false;

        async function listDir(
          dir: string,
          depth: number,
          prefix: string,
        ): Promise<string[]> {
          if (depth > 3) return [];
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const IGNORED_DIRS = new Set([
            'node_modules',
            '.git',
            '.expo',
            'dist',
            '.DS_Store',
            'android',
            'ios',
          ]);
          const lines: string[] = [];

          const sorted = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

          for (const entry of sorted) {
            if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.'))
              continue;
            const icon = entry.isDirectory() ? '📁' : '📄';
            lines.push(`${prefix}${icon} ${entry.name}`);
            if (recursive && entry.isDirectory()) {
              const subLines = await listDir(
                path.join(dir, entry.name),
                depth + 1,
                prefix + '  ',
              );
              lines.push(...subLines);
            }
          }
          return lines;
        }

        const lines = await listDir(absPath, 0, '');
        return lines.join('\n') || 'Empty directory';
      }

      case 'search_files': {
        const absPath = resolvePath(projectPath, input.path);
        return await searchFiles(absPath, input.pattern, input.file_pattern);
      }

      default:
        return `Error: Unknown tool ${name}`;
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g,
    '',
  );
}

export function setupAIHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    'ai:chat',
    async (
      event,
      opts: {
        message: string;
        projectPath: string;
        apiKey?: string;
      },
    ) => {
      const apiKey = opts.apiKey || store.get('anthropicApiKey');
      if (!apiKey) {
        event.sender.send(
          'ai:error',
          'No Anthropic API key configured. Go to Settings to add your key.',
        );
        return;
      }

      if (currentProjectPath !== opts.projectPath) {
        messages = [];
        currentProjectPath = opts.projectPath;
      }

      const client = new Anthropic({ apiKey });
      messages.push({ role: 'user', content: opts.message });

      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      try {
        while (true) {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 16384,
            system: SYSTEM_PROMPT(opts.projectPath),
            tools: AI_TOOLS,
            messages,
          });

          totalInputTokens += response.usage.input_tokens;
          totalOutputTokens += response.usage.output_tokens;

          event.sender.send('ai:usage', {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            totalInput: totalInputTokens,
            totalOutput: totalOutputTokens,
          });

          const assistantContent: Anthropic.ContentBlock[] = [];
          for (const block of response.content) {
            assistantContent.push(block);
            if (block.type === 'text') {
              event.sender.send('ai:text', block.text);
            } else if (block.type === 'tool_use') {
              event.sender.send('ai:toolUse', {
                tool: block.name,
                input: block.input,
              });
            }
          }
          messages.push({ role: 'assistant', content: assistantContent });

          if (response.stop_reason === 'end_turn') {
            event.sender.send('ai:complete');
            break;
          }

          if (response.stop_reason === 'tool_use') {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of response.content) {
              if (block.type !== 'tool_use') continue;
              const result = await executeTool(
                opts.projectPath,
                block.name,
                block.input as Record<string, any>,
              );

              const cleanResult =
                block.name === 'run_command' ? stripAnsi(result) : result;

              const maxLen = 8000;
              const truncated =
                cleanResult.length > maxLen
                  ? cleanResult.slice(0, maxLen) +
                    `\n... [truncated, ${cleanResult.length - maxLen} chars omitted]`
                  : cleanResult;

              event.sender.send('ai:toolResult', {
                tool: block.name,
                result: truncated.slice(0, 500),
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: truncated,
              });
            }
            messages.push({ role: 'user', content: toolResults });
            continue;
          }

          event.sender.send('ai:complete');
          break;
        }
      } catch (err) {
        const error = err as Error;
        let errorMessage = error.message;

        if (
          errorMessage.includes('401') ||
          errorMessage.includes('invalid_api_key')
        ) {
          errorMessage =
            'Invalid API key. Please check your Anthropic API key in Settings.';
        } else if (errorMessage.includes('429')) {
          errorMessage =
            'Rate limited by Anthropic. Please wait a moment and try again.';
        } else if (
          errorMessage.includes('529') ||
          errorMessage.includes('overloaded')
        ) {
          errorMessage =
            'Anthropic API is temporarily overloaded. Please try again shortly.';
        }

        event.sender.send('ai:error', errorMessage);
      }
    },
  );

  ipcMain.handle('ai:reset', () => {
    messages = [];
    currentProjectPath = null;
  });

  ipcMain.handle('settings:setApiKey', (_, key: string) => {
    store.set('anthropicApiKey', key);
  });

  ipcMain.handle(
    'settings:getApiKey',
    () => store.get('anthropicApiKey') || '',
  );
}
