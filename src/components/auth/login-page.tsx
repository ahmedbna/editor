// src/components/auth/login-page.tsx
import { useState, useEffect } from 'react';
import { ExternalLink, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    <div className='relative h-screen w-full bg-[#FAD40B] text-black overflow-hidden'>
      {/* Fixed Background Layers */}
      <div className='absolute inset-0 z-0 pointer-events-none'>
        <div
          className='absolute inset-0'
          style={{
            background:
              'radial-gradient(ellipse 80% 55% at 50% 0%, rgba(255,255,255,0.5) 0%, transparent 65%)',
          }}
        />
        {/* Decorative rings */}
        <div className='absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full border border-black/[0.05]' />
        <div className='absolute -top-16 -right-16 w-[280px] h-[280px] rounded-full border border-black/[0.07]' />
        <div className='absolute -bottom-32 -left-32 w-[440px] h-[440px] rounded-full border border-black/[0.05]' />
        <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-black/[0.03]' />
      </div>

      {/* Scrollable Snap Container */}
      <div className='relative h-full overflow-y-scroll snap-y snap-mandatory scroll-smooth z-10'>
        {/* Hero Section */}
        <section
          id='home'
          className='relative min-h-screen w-full flex items-center justify-center px-6 snap-start'
        >
          <div className='relative z-10 max-w-6xl mx-auto text-center'>
            <div className='w-full flex items-center justify-center gap-2 mb-2 '>
              <img src='/bricks.png' alt='BNA Logo' className='size-12' />
              <h1 className='text-4xl md:text-6xl font-black tracking-[-0.04em] leading-tight text-black'>
                BNA
              </h1>
            </div>

            <h2 className='text-3xl md:text-5xl font-black mb-4 leading-tight'>
              <span className='text-black'>{`Build FullStack Mobile Apps `}</span>
              <span className='text-black/50'>in Seconds</span>
            </h2>

            <p className='text-xl md:text-2xl text-black/60 mb-6 max-w-3xl mx-auto font-medium'>
              Turn your ideas into fullstack authenticated iOS &amp; Android
              apps with AI
            </p>

            <div className='flex flex-col sm:flex-row gap-4 justify-center items-center'>
              {loading ? (
                <div className='space-y-4'>
                  <div className='text-center py-8'>
                    <Loader2 size={28} className='animate-spin mx-auto mb-4' />
                    <p className='text-sm text-[#888] mb-1'>
                      Waiting for sign-in...
                    </p>
                    <p className='text-xs text-[#444]'>
                      Complete login in your browser.
                    </p>
                    <p className='text-xs text-[#333] mt-3'>
                      A browser window should have opened. Sign in with your
                      Google or GitHub account.
                    </p>
                  </div>

                  <div className='flex flex-col gap-2'>
                    <Button onClick={handleLogin}>
                      <RotateCcw size={12} />
                      Reopen Browser
                    </Button>

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
                  <Button
                    onClick={handleLogin}
                    variant='secondary'
                    size='lg'
                    className='h-14 min-w-80 flex items-center justify-center gap-2 bg-black text-white hover:bg-black/80 font-medium text-lg'
                  >
                    <ExternalLink size={16} />
                    Login with BNA
                  </Button>

                  <p className='text-[10px] text-[#333] text-center mt-4'>
                    This will open your browser.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Error message */}
      {error && (
        <div className='mb-4 p-3 rounded-lg bg-[#ff5c5710] border border-[#ff5c5730] flex items-start gap-2'>
          <AlertCircle size={14} className='text-[#ff5c57] mt-0.5 shrink-0' />
          <p className='text-xs text-[#ff5c57]'>{error}</p>
        </div>
      )}
    </div>
  );
}
