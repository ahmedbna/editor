// src/components/Editor.tsx
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { useState, useEffect, useRef } from 'react';
import { Circle } from 'lucide-react';

interface Props {
  filePath: string | null;
}

export function Editor({ filePath }: Props) {
  const [content, setContent] = useState('');
  const [modified, setModified] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (!filePath) return;
    window.electronAPI.fs
      .readFile(filePath)
      .then((c) => {
        setContent(c);
        setModified(false);
      })
      .catch(() => setContent('// Error reading file'));
  }, [filePath]);

  const handleChange = (value: string | undefined) => {
    if (!value || !filePath) return;
    setContent(value);
    setModified(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await window.electronAPI.fs.writeFile(filePath, value);
      setModified(false);
    }, 1500);
  };

  const handleSave = async () => {
    if (!filePath || !modified) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await window.electronAPI.fs.writeFile(filePath, content);
    setModified(false);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave);

    monaco.editor.defineTheme('bna-industrial', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4a4a4a', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c678dd' },
        { token: 'string', foreground: '98c379' },
        { token: 'number', foreground: 'd19a66' },
        { token: 'type', foreground: '61afef' },
      ],
      colors: {
        'editor.background': '#0d0d0d',
        'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#ffffff06',
        'editor.selectionBackground': '#264f7844',
        'editorLineNumber.foreground': '#2a2a2a',
        'editorLineNumber.activeForeground': '#555',
        'editorCursor.foreground': '#FAD40B',
        'editorIndentGuide.background': '#1a1a1a',
        'editorIndentGuide.activeBackground': '#333',
        'editor.selectionHighlightBackground': '#ffffff10',
        'editorBracketMatch.background': '#FAD40B22',
        'editorBracketMatch.border': '#FAD40B44',
        'editorWidget.background': '#111',
        'editorSuggestWidget.background': '#111',
        'editorSuggestWidget.border': '#222',
        'editorSuggestWidget.selectedBackground': '#FAD40B15',
        'list.hoverBackground': '#ffffff08',
        'scrollbarSlider.background': '#2a2a2a88',
        'scrollbarSlider.hoverBackground': '#3a3a3aaa',
      },
    });
    monaco.editor.setTheme('bna-industrial');
  };

  if (!filePath) {
    return (
      <div className='flex-1 flex items-center justify-center bg-[#0a0a0a]'>
        <div className='text-center'>
          <div className='text-5xl mb-4 text-[#1a1a1a]'>⌘</div>
          <p className='text-[#333] text-sm'>Open a file to start editing</p>
          <p className='text-[#222] text-xs mt-1'>
            or ask BNA AI to build something
          </p>
        </div>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || '';

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Tab */}
      <div className='h-8 bg-[#0d0d0d] border-b border-[#1a1a1a] flex items-center px-2 shrink-0'>
        <div className='flex items-center gap-2 px-2 py-1 rounded-t text-xs bg-[#111] border-b border-[#FAD40B33]'>
          {modified ? (
            <Circle size={8} className='text-[#FAD40B] fill-[#FAD40B]' />
          ) : (
            <span className='w-2' />
          )}
          <span className='text-[#aaa]'>{fileName}</span>
        </div>
      </div>

      <MonacoEditor
        height='100%'
        language={detectLanguage(fileName)}
        value={content}
        onChange={handleChange}
        onMount={handleMount}
        theme='bna-industrial'
        options={{
          fontSize: 13,
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          tabSize: 2,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        }}
      />
    </div>
  );
}

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
  };
  return map[ext || ''] || 'plaintext';
}
