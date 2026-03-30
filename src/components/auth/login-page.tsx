// src/components/auth/login-page.tsx
import { useState, useEffect } from 'react';
import {
  Zap,
  ExternalLink,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

interface Props {
  onAuth: () => void;
}

export function LoginPage({ onAuth }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Listen for successful auth token
    const cleanupToken = window.electronAPI.auth.onTokenReceived(() => {
      setLoading(false);
      setError(null);
      onAuth();
    });

    // Listen for auth errors (e.g. timeout from polling)
    const cleanupError = window.electronAPI.ai.onError?.((err: string) => {
      if (err.includes('Login timed out')) {
        setLoading(false);
        setError('Login timed out. Please try again.');
      }
    });

    return () => {
      cleanupToken();
      cleanupError?.();
    };
  }, [onAuth]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    await window.electronAPI.auth.login();
  };

  const handleCancel = async () => {
    setLoading(false);
    setError(null);
    // Cancel the polling in the main process
    try {
      await (window.electronAPI.auth as any).cancelLogin?.();
    } catch {
      // cancelLogin may not exist on older preload versions
    }
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

        {/* Error message */}
        {error && (
          <div className='mb-4 p-3 rounded-lg bg-[#ff5c5710] border border-[#ff5c5730] flex items-start gap-2'>
            <AlertCircle size={14} className='text-[#ff5c57] mt-0.5 shrink-0' />
            <p className='text-xs text-[#ff5c57]'>{error}</p>
          </div>
        )}

        {loading ? (
          <div className='space-y-4'>
            <div className='text-center py-8'>
              <Loader2
                size={28}
                className='animate-spin text-[#FAD40B] mx-auto mb-4'
              />
              <p className='text-sm text-[#888] mb-1'>Waiting for sign-in...</p>
              <p className='text-xs text-[#444]'>
                Complete login in your browser.
              </p>
              <p className='text-xs text-[#333] mt-3'>
                A browser window should have opened. Sign in with your Google or
                GitHub account.
              </p>
            </div>

            <div className='flex flex-col gap-2'>
              <button
                onClick={handleLogin}
                className='w-full h-10 rounded-xl bg-[#111] border border-[#222] text-[#888] font-medium text-xs
                           flex items-center justify-center gap-2 hover:bg-[#1a1a1a] hover:text-white
                           transition-all'
              >
                <RotateCcw size={12} />
                Reopen Browser
              </button>

              <button
                onClick={handleCancel}
                className='w-full text-[#555] text-xs hover:text-[#888] transition-colors py-2'
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className='space-y-4'>
            <button
              onClick={handleLogin}
              className='w-full h-14 rounded-xl bg-[#FAD40B] text-black font-bold text-sm
                         flex items-center justify-center gap-2 hover:bg-[#e5c200]
                         active:scale-[0.98] transition-all'
            >
              <ExternalLink size={16} />
              Sign in with BNA Account
            </button>

            <p className='text-[10px] text-[#333] text-center mt-4'>
              Sign in with your Google or GitHub account.
              <br />
              This will open your browser.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
