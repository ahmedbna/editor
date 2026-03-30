// electron/ai/tools.ts
import Anthropic from '@anthropic-ai/sdk';

export type ToolName =
  | 'view_file'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'list_directory'
  | 'search_files';

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'view_file',
    description:
      'Read the contents of a file. Returns the file with line numbers. Use this before edit_file to know the exact contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        start_line: {
          type: 'number',
          description: 'Optional start line (1-indexed)',
        },
        end_line: {
          type: 'number',
          description: 'Optional end line (1-indexed, -1 for EOF)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file with the given content. Creates parent directories automatically. Use for new files or when rewriting an entire file.',
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
    description:
      'Replace a unique string in a file. The old text must appear exactly once. Both old_text and new_text must be less than 1024 characters. Always use view_file first to know exact contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_text: {
          type: 'string',
          description: 'Exact text to find (must be unique, < 1024 chars)',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text (< 1024 chars)',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command in the project directory. Use for npm install, npx expo install, npx convex dev --once, etc. Returns stdout/stderr.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default 60000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List files and directories at the given path. Shows file/directory indicators.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute directory path' },
        recursive: {
          type: 'boolean',
          description:
            'Whether to list recursively (default false, max 3 levels)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search for a text pattern across files in a directory. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute directory path to search in',
        },
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        file_pattern: {
          type: 'string',
          description:
            'Optional glob pattern for file names (e.g. "*.ts", "*.tsx")',
        },
      },
      required: ['path', 'pattern'],
    },
  },
];
