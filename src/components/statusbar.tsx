// src/components/StatusBar.tsx
import { useEffect, useState } from 'react';
import { CreditCard, LogOut, Wifi, WifiOff } from 'lucide-react';

interface Props {
  projectPath: string | null;
  onLogout: () => void;
}

export function StatusBar({ projectPath, onLogout }: Props) {
  const [credits, setCredits] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const u = await window.electronAPI.auth.getUser();
      setUser(u);
      const c = await window.electronAPI.auth.getCredits();
      if (c) setCredits(c.credits);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className='h-6 bg-[#0d0d0d] border-t border-[#1a1a1a] flex items-center justify-between px-3 text-[10px] text-[#555] shrink-0'>
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1'>
          {projectPath ? (
            <>
              <Wifi size={10} className='text-[#5af78e]' />
              <span>Connected</span>
            </>
          ) : (
            <>
              <WifiOff size={10} className='text-[#555]' />
              <span>No project</span>
            </>
          )}
        </div>

        {projectPath && (
          <span className='text-[#444]'>{projectPath.split('/').pop()}</span>
        )}
      </div>

      <div className='flex items-center gap-3'>
        {credits !== null && (
          <button
            onClick={() =>
              window.electronAPI.shell.openExternal(
                'https://ai.ahmedbna.com/credits',
              )
            }
            className='flex items-center gap-1 hover:text-[#FAD40B] transition-colors'
          >
            <CreditCard size={10} />
            <span>{credits} credits</span>
          </button>
        )}

        {user && <span className='text-[#444]'>{user.email || user.name}</span>}

        <button
          onClick={onLogout}
          className='flex items-center gap-1 hover:text-[#ff5c57] transition-colors'
          title='Sign out'
        >
          <LogOut size={10} />
        </button>
      </div>
    </div>
  );
}
