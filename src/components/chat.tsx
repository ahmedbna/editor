// src/components/Chat.tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  RotateCcw,
  Loader2,
  Zap,
  Settings,
  ChevronDown,
  ChevronUp,
  FileCode,
  Terminal as TerminalIcon,
  Eye,
  Pencil,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: any;
  collapsed?: boolean;
}

interface Props {
  projectPath: string | null;
  onFileOpen: (path: string) => void;
}

const TOOL_ICONS: Record<string, any> = {
  write_file: FileCode,
  edit_file: Pencil,
  view_file: Eye,
  run_command: TerminalIcon,
  list_directory: Search,
  search_files: Search,
};

function summarizeToolUse(tool: string, input: any): string {
  switch (tool) {
    case 'write_file':
      return `Writing ${input.path?.split('/').pop() || 'file'}`;
    case 'edit_file':
      return `Editing ${input.path?.split('/').pop() || 'file'}`;
    case 'view_file':
      return `Reading ${input.path?.split('/').pop() || 'file'}`;
    case 'run_command':
      return `Running: ${(input.command || '').slice(0, 60)}${(input.command || '').length > 60 ? '...' : ''}`;
    case 'list_directory':
      return `Listing ${input.path?.split('/').pop() || 'directory'}`;
    case 'search_files':
      return `Searching for "${input.pattern}"`;
    default:
      return `${tool}`;
  }
}

export function Chat({ projectPath, onFileOpen }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [totalTokens, setTotalTokens] = useState({
    input: 0,
    output: 0,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.electronAPI.settings.getApiKey().then(setApiKey);
  }, []);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.ai.onText((text) => {
        setCurrentText((prev) => prev + text);
      }),
      window.electronAPI.ai.onToolUse(({ tool, input: toolInput }) => {
        const summary = summarizeToolUse(tool, toolInput);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'tool',
            content: summary,
            toolName: tool,
            toolInput,
          },
        ]);
      }),
      window.electronAPI.ai.onToolResult(({ tool, result }) => {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'tool',
            content: `✓ ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`,
            toolName: tool,
            collapsed: true,
          },
        ]);
      }),
      window.electronAPI.ai.onComplete(() => {
        setCurrentText((prev) => {
          if (prev.trim()) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: prev,
              },
            ]);
          }
          return '';
        });
        setStreaming(false);
      }),
      window.electronAPI.ai.onError((err) => {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${err}`,
          },
        ]);
        setStreaming(false);
        toast.error('AI Error', { description: err });
      }),
      window.electronAPI.ai.onUsage((u) => {
        setTotalTokens({
          input: u.totalInput || u.input,
          output: u.totalOutput || u.output,
        });
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentText]);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    if (!projectPath) {
      toast.error('Open a project first');
      return;
    }

    const msg = input.trim();
    setInput('');
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: msg },
    ]);
    setStreaming(true);
    setCurrentText('');

    await window.electronAPI.ai.chat({ message: msg, projectPath });
  }, [input, streaming, projectPath]);

  const reset = useCallback(async () => {
    await window.electronAPI.ai.reset();
    setMessages([]);
    setCurrentText('');
    setTotalTokens({ input: 0, output: 0 });
  }, []);

  const saveApiKey = useCallback(async () => {
    await window.electronAPI.settings.setApiKey(apiKey);
    setShowSettings(false);
    toast.success('API key saved');
  }, [apiKey]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const toggleToolCollapse = (id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, collapsed: !m.collapsed } : m)),
    );
  };

  return (
    <div className='w-[400px] border-l border-[#1a1a1a] flex flex-col bg-[#0a0a0a] shrink-0'>
      {/* Header */}
      <div className='h-9 border-b border-[#1a1a1a] flex items-center justify-between px-3 shrink-0'>
        <div className='flex items-center gap-2'>
          <Zap size={12} className='text-[#FAD40B]' />
          <span className='text-[10px] font-bold text-[#FAD40B] tracking-wide'>
            BNA AI
          </span>
          {totalTokens.input > 0 && (
            <span className='text-[9px] text-[#444] ml-1'>
              {((totalTokens.input + totalTokens.output) / 1000).toFixed(1)}k
              tok
            </span>
          )}
        </div>
        <div className='flex items-center gap-0.5'>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className='p-1 rounded hover:bg-[#1a1a1a] text-[#555]'
            title='Settings'
          >
            <Settings size={11} />
          </button>
          <button
            onClick={reset}
            className='p-1 rounded hover:bg-[#1a1a1a] text-[#555]'
            title='New conversation'
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className='border-b border-[#1a1a1a] p-3 bg-[#0d0d0d]'>
          <label className='text-[10px] text-[#555] uppercase tracking-wider font-semibold'>
            Anthropic API Key
          </label>
          <div className='flex gap-2 mt-1.5'>
            <input
              type='password'
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder='sk-ant-...'
              className='flex-1 bg-[#111] border border-[#222] rounded px-2 py-1 text-xs text-[#ccc] focus:border-[#FAD40B33] transition-colors'
            />
            <button
              onClick={saveApiKey}
              className='px-2 py-1 rounded bg-[#FAD40B] text-black text-xs font-medium'
            >
              Save
            </button>
          </div>
          <p className='text-[9px] text-[#444] mt-2'>
            Your key is stored locally and never sent to BNA servers.
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className='flex-1 overflow-y-auto p-3 space-y-2.5'>
        {messages.length === 0 && !streaming && (
          <div className='flex flex-col items-center justify-center h-full text-center px-6'>
            <div className='w-12 h-12 rounded-xl bg-[#FAD40B15] flex items-center justify-center mb-3'>
              <Zap size={20} className='text-[#FAD40B]' />
            </div>
            <p className='text-[#555] text-xs leading-relaxed'>
              Ask BNA to build an Expo React Native app with Convex backend.
              <br />
              <br />
              It can create files, edit code, run commands, and deploy.
            </p>
            {!apiKey && (
              <button
                onClick={() => setShowSettings(true)}
                className='mt-3 text-[10px] text-[#FAD40B55] hover:text-[#FAD40B] transition-colors'
              >
                Set up your API key to get started →
              </button>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message ${
              m.role === 'user'
                ? 'bg-[#1a1a1a] rounded-lg p-2.5'
                : m.role === 'tool'
                  ? 'text-[10px] text-[#555] border-l-2 border-[#252525] pl-2 py-0.5 font-mono'
                  : 'text-[#ccc] text-sm'
            }`}
          >
            {m.role === 'user' && (
              <div className='text-[9px] text-[#444] mb-1 font-semibold uppercase tracking-wider'>
                You
              </div>
            )}
            {m.role === 'tool' && (
              <div className='flex items-center gap-1'>
                {(() => {
                  const Icon = TOOL_ICONS[m.toolName || ''] || Zap;
                  return <Icon size={10} className='text-[#FAD40B]' />;
                })()}
                <span className='text-[#888]'>
                  {m.collapsed ? (
                    <button
                      onClick={() => toggleToolCollapse(m.id)}
                      className='hover:text-[#ccc] flex items-center gap-0.5'
                    >
                      <ChevronDown size={9} />
                      {m.content.slice(0, 60)}
                      {m.content.length > 60 ? '...' : ''}
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleToolCollapse(m.id)}
                      className='hover:text-[#ccc] flex items-start gap-0.5'
                    >
                      <ChevronUp size={9} className='mt-0.5' />
                      <span>{m.content}</span>
                    </button>
                  )}
                </span>
              </div>
            )}
            {m.role !== 'tool' && (
              <pre className='whitespace-pre-wrap break-words font-mono text-xs leading-relaxed'>
                {m.content}
              </pre>
            )}

            {/* Clickable file paths in write_file tool results */}
            {m.role === 'tool' &&
              m.toolName === 'write_file' &&
              m.toolInput?.path && (
                <button
                  onClick={() => onFileOpen(m.toolInput.path)}
                  className='text-[#57c7ff] hover:underline text-[10px] mt-0.5 block'
                >
                  → Open {m.toolInput.path.split('/').pop()}
                </button>
              )}
            {m.role === 'tool' &&
              m.toolName === 'edit_file' &&
              m.toolInput?.path && (
                <button
                  onClick={() => onFileOpen(m.toolInput.path)}
                  className='text-[#57c7ff] hover:underline text-[10px] mt-0.5 block'
                >
                  → Open {m.toolInput.path.split('/').pop()}
                </button>
              )}
          </div>
        ))}

        {/* Streaming text */}
        {currentText && (
          <div className='text-sm text-[#ccc]'>
            <pre className='whitespace-pre-wrap break-words font-mono text-xs leading-relaxed'>
              {currentText}
            </pre>
            <span className='text-[#FAD40B] animate-pulse-accent'>▊</span>
          </div>
        )}

        {streaming &&
          !currentText &&
          messages[messages.length - 1]?.role !== 'tool' && (
            <div className='flex items-center gap-2 text-[#555] text-xs'>
              <Loader2 size={12} className='animate-spin text-[#FAD40B]' />
              <span>Thinking...</span>
            </div>
          )}
      </div>

      {/* Input */}
      <div className='border-t border-[#1a1a1a] p-2.5 shrink-0'>
        <div className='flex items-end gap-2'>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              projectPath
                ? 'Build a fitness tracking app...'
                : 'Open a project first'
            }
            className='flex-1 bg-[#111] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs
                       resize-none focus:border-[#FAD40B33] transition-colors
                       placeholder:text-[#333] focus:outline-none'
            style={{ minHeight: '36px', maxHeight: '200px' }}
            rows={1}
            disabled={streaming || !projectPath}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim() || !projectPath}
            className='p-2 rounded-lg bg-[#FAD40B] text-black hover:bg-[#e5c200]
                       disabled:opacity-20 disabled:cursor-not-allowed transition-all
                       active:scale-95 shrink-0'
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
