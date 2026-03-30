// src/components/Terminal.tsx
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface Props {
  projectPath: string;
}

interface TerminalTab {
  id: string;
  label: string;
}

export function TerminalPanel({ projectPath }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalsRef = useRef<
    Map<string, { xterm: XTerm; fit: FitAddon; cleanup: () => void }>
  >(new Map());
  const initializedRef = useRef(false);

  const createTerminal = () => {
    const id = `term-${Date.now()}`;
    const label = `Terminal ${tabs.length + 1}`;
    setTabs((prev) => [...prev, { id, label }]);
    setActiveTab(id);
    return id;
  };

  const closeTerminal = (id: string) => {
    const t = terminalsRef.current.get(id);
    if (t) {
      t.cleanup();
      t.xterm.dispose();
      terminalsRef.current.delete(id);
    }
    window.electronAPI.terminal.kill(id);
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (activeTab === id) {
        setActiveTab(
          remaining.length > 0 ? remaining[remaining.length - 1].id : null,
        );
      }
      return remaining;
    });
  };

  // Auto-create first terminal
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      createTerminal();
    }
  }, []);

  // Mount/show active terminal
  useEffect(() => {
    if (!activeTab || !containerRef.current) return;

    // Hide all terminals
    terminalsRef.current.forEach((t) => {
      if (t.xterm.element?.parentElement) {
        t.xterm.element.parentElement.style.display = 'none';
      }
    });

    // Show or create active terminal
    const existing = terminalsRef.current.get(activeTab);
    if (existing) {
      if (existing.xterm.element?.parentElement) {
        existing.xterm.element.parentElement.style.display = 'block';
      }
      existing.fit.fit();
      existing.xterm.focus();
      return;
    }

    // Create new xterm instance
    const xterm = new XTerm({
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#FAD40B',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#FAD40B33',
        black: '#1a1a1a',
        red: '#ff5c57',
        green: '#5af78e',
        yellow: '#f3f99d',
        blue: '#57c7ff',
        magenta: '#ff6ac1',
        cyan: '#9aedfe',
        white: '#f1f1f0',
        brightBlack: '#555555',
        brightRed: '#ff5c57',
        brightGreen: '#5af78e',
        brightYellow: '#f3f99d',
        brightBlue: '#57c7ff',
        brightMagenta: '#ff6ac1',
        brightCyan: '#9aedfe',
        brightWhite: '#ffffff',
      },
      allowTransparency: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(new WebLinksAddon());

    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    wrapper.style.width = '100%';
    containerRef.current.appendChild(wrapper);
    xterm.open(wrapper);
    fit.fit();

    // Create PTY in main process
    window.electronAPI.terminal.create({
      id: activeTab,
      cwd: projectPath,
      cols: xterm.cols,
      rows: xterm.rows,
    });

    // Wire up data
    const cleanupData = window.electronAPI.terminal.onData(
      activeTab,
      (data) => {
        xterm.write(data);
      },
    );

    const cleanupExit = window.electronAPI.terminal.onExit(
      activeTab,
      (code) => {
        xterm.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
      },
    );

    xterm.onData((data) => {
      window.electronAPI.terminal.write(activeTab, data);
    });

    xterm.onResize(({ cols, rows }) => {
      window.electronAPI.terminal.resize(activeTab, cols, rows);
    });

    const cleanup = () => {
      cleanupData();
      cleanupExit();
    };

    terminalsRef.current.set(activeTab, { xterm, fit, cleanup });

    // Handle window resizes
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    xterm.focus();

    return () => {
      resizeObserver.disconnect();
    };
  }, [activeTab, projectPath]);

  return (
    <div className='h-full flex flex-col bg-[#0a0a0a]'>
      {/* Tab bar */}
      <div className='h-7 bg-[#0d0d0d] border-b border-[#1a1a1a] flex items-center px-1 gap-0.5 shrink-0'>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] cursor-pointer transition-colors
              ${tab.id === activeTab ? 'bg-[#1a1a1a] text-[#ccc]' : 'text-[#555] hover:text-[#888]'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <TerminalIcon
              size={10}
              className={tab.id === activeTab ? 'text-[#FAD40B]' : ''}
            />
            <span>{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTerminal(tab.id);
              }}
              className='ml-1 hover:text-[#ff5c57] transition-colors'
            >
              <X size={9} />
            </button>
          </div>
        ))}
        <button
          onClick={() => createTerminal()}
          className='p-0.5 rounded hover:bg-[#1a1a1a] text-[#555] hover:text-[#888] ml-0.5'
          title='New Terminal'
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className='flex-1 overflow-hidden' />
    </div>
  );
}
