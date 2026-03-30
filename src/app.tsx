// src/App.tsx
import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/sidebar';
import { Editor } from './components/editor';
import { Chat } from './components/chat';
import { TerminalPanel } from './components/terminal';
import { StatusBar } from './components/statusbar';
import { LoginPage } from './components/auth/login-page';
import { Toaster } from 'sonner';

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    if (!window.electronAPI) {
      console.error(
        'electronAPI not available — preload script failed to load',
      );
      setCheckingAuth(false);
      return;
    }

    // Check existing auth token
    window.electronAPI.auth.getToken().then(async (token) => {
      if (token) {
        // Validate the token by trying to get the user
        const user = await window.electronAPI.auth.getUser();
        if (user) {
          setIsAuthenticated(true);
        } else {
          // Token is invalid/expired — clear it
          await window.electronAPI.auth.logout();
          setIsAuthenticated(false);
        }
      }
      setCheckingAuth(false);
    });

    // Check for saved project
    window.electronAPI.project.getCurrent().then((p) => {
      if (p) setProjectPath(p);
    });

    // Listen for auth callback (deep link or polling)
    const cleanup = window.electronAPI.auth.onTokenReceived(() => {
      setIsAuthenticated(true);
    });

    return cleanup;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setShowTerminal((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        setShowChat((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenProject = useCallback(async () => {
    const p = await window.electronAPI.project.open();
    if (p) {
      setProjectPath(p);
      setSelectedFile(null);
      window.electronAPI.project.addRecent(p);
    }
  }, []);

  if (checkingAuth) {
    return (
      <div className='h-screen flex items-center justify-center bg-[#0a0a0a]'>
        <div className='text-[#FAD40B] font-bold text-xl animate-pulse'>
          BNA
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onAuth={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className='flex flex-col h-screen bg-[#0a0a0a] text-[#e0e0e0]'>
      {/* Title bar */}
      <div className='titlebar-drag h-9 bg-[#0d0d0d] border-b border-[#1a1a1a] flex items-center px-20 shrink-0'>
        <div className='flex items-center gap-2 text-xs text-[#555]'>
          <span className='text-[#FAD40B] font-black tracking-tight'>BNA</span>
          <span className='text-[#333]'>|</span>
          <span>
            {projectPath ? projectPath.split('/').pop() : 'No project'}
          </span>
        </div>
        <div className='ml-auto flex items-center gap-1'>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
              ${showChat ? 'text-[#FAD40B] bg-[#FAD40B15]' : 'text-[#555] hover:text-[#888]'}`}
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title='Toggle AI Panel (⌘L)'
          >
            AI
          </button>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
              ${showTerminal ? 'text-[#FAD40B] bg-[#FAD40B15]' : 'text-[#555] hover:text-[#888]'}`}
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title='Toggle Terminal (⌘J)'
          >
            Terminal
          </button>
        </div>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        {/* Sidebar */}
        <Sidebar
          projectPath={projectPath}
          selectedFile={selectedFile}
          onFileSelect={setSelectedFile}
          onOpenProject={handleOpenProject}
        />

        {/* Main editor area */}
        <div className='flex-1 flex flex-col overflow-hidden'>
          <Editor filePath={selectedFile} />

          {showTerminal && projectPath && (
            <div
              className='border-t border-[#1a1a1a]'
              style={{ height: '240px' }}
            >
              <TerminalPanel projectPath={projectPath} />
            </div>
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
        onLogout={async () => {
          await window.electronAPI.auth.logout();
          setIsAuthenticated(false);
        }}
      />

      <Toaster
        theme='dark'
        position='bottom-right'
        toastOptions={{
          style: {
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            color: '#e0e0e0',
          },
        }}
      />
    </div>
  );
}
