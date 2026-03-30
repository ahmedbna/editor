// src/components/auth/LoginPage.tsx
import { useState, useEffect } from 'react';
import { Zap, Key, ExternalLink, Loader2 } from 'lucide-react';

interface Props {
  onAuth: () => void;
}

export function LoginPage({ onAuth }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'choose' | 'apikey' | 'convex'>('choose');

  useEffect(() => {
    const cleanup = window.electronAPI.auth.onTokenReceived(() => {
      onAuth();
    });
    return cleanup;
  }, [onAuth]);

  const handleApiKeyLogin = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    await window.electronAPI.settings.setApiKey(apiKey.trim());
    await window.electronAPI.auth.setToken('apikey-mode');
    setLoading(false);
    onAuth();
  };

  const handleConvexLogin = async () => {
    setLoading(true);
    await window.electronAPI.auth.login();
  };

  return (
    <div className='h-screen flex items-center justify-center bg-[#0a0a0a] relative overflow-hidden'>
      {/* Background decoration */}
      <div className='absolute inset-0 pointer-events-none'>
        <div className='absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full border border-[#111]' />
        <div className='absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full border border-[#0f0f0f]' />
        <div
          className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full'
          style={{
            background:
              'radial-gradient(circle, rgba(250,212,11,0.03) 0%, transparent 70%)',
          }}
        />
      </div>

      <div className='relative z-10 w-full max-w-sm px-6'>
        {/* Logo */}
        <div className='text-center mb-10'>
          <div className='inline-flex items-center gap-2 mb-3'>
            <div className='w-10 h-10 rounded-xl bg-[#FAD40B] flex items-center justify-center'>
              <Zap size={20} className='text-black' />
            </div>
            <h1 className='text-3xl font-black tracking-tight text-white'>
              BNA
            </h1>
          </div>
          <p className='text-[#555] text-sm'>
            Desktop IDE for Expo React Native + Convex
          </p>
        </div>

        {mode === 'choose' && (
          <div className='space-y-3'>
            <button
              onClick={() => setMode('convex')}
              className='w-full h-14 rounded-xl bg-[#FAD40B] text-black font-bold text-sm
                         flex items-center justify-center gap-2 hover:bg-[#e5c200]
                         active:scale-[0.98] transition-all'
            >
              <ExternalLink size={16} />
              Sign in with BNA Account
            </button>

            <div className='flex items-center gap-3 text-[#333]'>
              <div className='flex-1 h-px bg-[#1a1a1a]' />
              <span className='text-[10px] uppercase tracking-wider'>or</span>
              <div className='flex-1 h-px bg-[#1a1a1a]' />
            </div>

            <button
              onClick={() => setMode('apikey')}
              className='w-full h-12 rounded-xl bg-[#111] border border-[#222] text-[#888] font-medium text-sm
                         flex items-center justify-center gap-2 hover:bg-[#1a1a1a] hover:text-white
                         active:scale-[0.98] transition-all'
            >
              <Key size={14} />
              Use your own API Key
            </button>

            <p className='text-[10px] text-[#333] text-center mt-4'>
              BNA Account includes credits and project sync.
              <br />
              API Key mode uses your Anthropic key directly.
            </p>
          </div>
        )}

        {mode === 'convex' && (
          <div className='space-y-4'>
            {loading ? (
              <div className='text-center py-8'>
                <Loader2
                  size={24}
                  className='animate-spin text-[#FAD40B] mx-auto mb-3'
                />
                <p className='text-sm text-[#888]'>Waiting for sign-in...</p>
                <p className='text-xs text-[#444] mt-1'>
                  Complete login in your browser
                </p>
              </div>
            ) : (
              <>
                <p className='text-xs text-[#666] text-center'>
                  This will open your browser to sign in with Google or GitHub.
                </p>
                <button
                  onClick={handleConvexLogin}
                  className='w-full h-12 rounded-xl bg-[#FAD40B] text-black font-bold text-sm
                             flex items-center justify-center gap-2 hover:bg-[#e5c200] transition-colors'
                >
                  <ExternalLink size={16} />
                  Open Browser to Sign In
                </button>
              </>
            )}
            <button
              onClick={() => {
                setMode('choose');
                setLoading(false);
              }}
              className='w-full text-[#555] text-xs hover:text-[#888] transition-colors'
            >
              ← Back
            </button>
          </div>
        )}

        {mode === 'apikey' && (
          <div className='space-y-4'>
            <div>
              <label className='text-[10px] text-[#555] uppercase tracking-wider font-semibold block mb-1.5'>
                Anthropic API Key
              </label>
              <input
                type='password'
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
                placeholder='sk-ant-api03-...'
                className='w-full bg-[#111] border border-[#222] rounded-lg px-3 py-2.5 text-sm text-[#ccc]
                           focus:border-[#FAD40B33] transition-colors placeholder:text-[#333]'
                autoFocus
              />
            </div>

            <button
              onClick={handleApiKeyLogin}
              disabled={!apiKey.trim() || loading}
              className='w-full h-11 rounded-xl bg-[#FAD40B] text-black font-bold text-sm
                         flex items-center justify-center gap-2 hover:bg-[#e5c200]
                         disabled:opacity-30 disabled:cursor-not-allowed transition-all'
            >
              {loading ? (
                <Loader2 size={14} className='animate-spin' />
              ) : (
                <Key size={14} />
              )}
              Continue with API Key
            </button>

            <p className='text-[10px] text-[#333] text-center'>
              Your key is stored locally and never sent to BNA servers.
              <br />
              <button
                onClick={() =>
                  window.electronAPI.shell.openExternal(
                    'https://console.anthropic.com/settings/keys',
                  )
                }
                className='text-[#FAD40B55] hover:text-[#FAD40B] transition-colors underline'
              >
                Get an API key from Anthropic →
              </button>
            </p>

            <button
              onClick={() => setMode('choose')}
              className='w-full text-[#555] text-xs hover:text-[#888] transition-colors'
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
