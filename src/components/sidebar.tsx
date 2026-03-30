// src/components/Sidebar.tsx
import { useState, useEffect } from 'react';
import {
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
} from 'lucide-react';

interface Props {
  projectPath: string | null;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  onOpenProject: () => void;
}

export function Sidebar({
  projectPath,
  selectedFile,
  onFileSelect,
  onOpenProject,
}: Props) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const loadTree = async () => {
    if (!projectPath) return;
    const t = await window.electronAPI.fs.readDir(projectPath);
    setTree(t);
  };

  useEffect(() => {
    loadTree();
    if (projectPath) {
      window.electronAPI.fs.watch(projectPath);
      const cleanup = window.electronAPI.fs.onChanged(() => {
        // Debounce reload
        setTimeout(loadTree, 300);
      });
      return cleanup;
    }
  }, [projectPath]);

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const renderNode = (node: FileNode, depth = 0) => {
    const isDir = node.type === 'directory';
    const isCollapsed = collapsed.has(node.path);
    const isActive = node.path === selectedFile;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-2 px-2 py-0.5 text-xs cursor-pointer rounded-sm transition-colors duration-75 ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => {
            if (isDir) toggle(node.path);
            else onFileSelect(node.path);
          }}
        >
          {isDir ? (
            isCollapsed ? (
              <ChevronRight size={12} className='text-[#555] shrink-0' />
            ) : (
              <ChevronDown size={12} className='text-[#555] shrink-0' />
            )
          ) : (
            <span className='w-3' />
          )}

          {isDir ? (
            <FolderOpen size={13} className='text-[#666] shrink-0' />
          ) : (
            <File size={13} className={`shrink-0 ${getFileColor(node.name)}`} />
          )}

          <span className='truncate'>{node.name}</span>
        </div>

        {isDir &&
          !isCollapsed &&
          node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className='w-56 border-r border-[#1a1a1a] flex flex-col bg-[#0d0d0d] shrink-0'>
      {/* Header */}
      <div className='h-9 border-b border-[#1a1a1a] flex items-center justify-between px-3'>
        <span className='text-[10px] font-semibold text-[#555] uppercase tracking-wider'>
          Explorer
        </span>
        <div className='flex items-center gap-1'>
          <button
            onClick={loadTree}
            className='p-1 rounded hover:bg-[#1a1a1a] text-[#555] hover:text-[#888]'
            title='Refresh'
          >
            <RefreshCw size={11} />
          </button>
          <button
            onClick={onOpenProject}
            className='p-1 rounded hover:bg-[#1a1a1a] text-[#555] hover:text-[#888]'
            title='Open Project'
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className='flex-1 overflow-y-auto py-1'>
        {!projectPath ? (
          <div className='flex flex-col items-center justify-center h-full text-[#444] text-xs gap-3 px-4'>
            <FolderOpen size={24} className='text-[#333]' />
            <p className='text-center'>No project open</p>
            <button
              onClick={onOpenProject}
              className='btn-primary text-xs px-3 py-1.5'
            >
              Open Project
            </button>
          </div>
        ) : tree.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-32 text-[#444] text-xs'>
            <p>Empty project</p>
          </div>
        ) : (
          tree.map((n) => renderNode(n))
        )}
      </div>
    </div>
  );
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const colors: Record<string, string> = {
    ts: 'text-blue-400',
    tsx: 'text-blue-400',
    js: 'text-yellow-400',
    jsx: 'text-yellow-400',
    json: 'text-green-400',
    css: 'text-purple-400',
    md: 'text-gray-400',
    html: 'text-orange-400',
    png: 'text-pink-400',
    jpg: 'text-pink-400',
    svg: 'text-orange-300',
  };
  return colors[ext || ''] || 'text-[#666]';
}
