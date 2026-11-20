import { useEffect, useRef, useState } from 'react';
import type { NodeType } from '@hiveflow/shared';
import { Icon } from '../canvas/Icons';
import { creationTools, workspaceTools } from './workspaceTools';

export function WorkspaceNav({
  onCreate,
  creating,
  active,
}: {
  onCreate: (type?: NodeType) => void;
  creating: boolean;
  active: 'home' | 'spaces' | 'library';
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="workspace-navigation" ref={container}>
      <aside className="workspace-rail" aria-label="Workspace navigation">
        <a className="rail-brand" href="/" aria-label="Hiveflow home">
          <img src="/brand/hiveflow-icon-transparent.png" alt="Hiveflow" />
        </a>
        <button
          ref={trigger}
          className="rail-create"
          aria-label="Create something new"
          aria-expanded={open}
          aria-controls="workspace-popover"
          onClick={() => setOpen(!open)}
        >
          <Icon name="plus" size={24} />
        </button>
        <a
          href="/"
          aria-label="Home"
          title="Home"
          className={active === 'home' ? 'rail-active' : undefined}
          aria-current={active === 'home' ? 'page' : undefined}
        >
          <Icon name="home" size={21} />
        </a>
        <a
          href="/library"
          aria-label="Library"
          title="Library"
          className={active === 'library' ? 'rail-active' : undefined}
          aria-current={active === 'library' ? 'page' : undefined}
        >
          <Icon name="library" size={21} />
        </a>
        <span className="rail-divider" />
        <a
          href="/spaces"
          className={active === 'spaces' ? 'rail-active' : undefined}
          aria-label="Spaces"
          aria-current={active === 'spaces' ? 'page' : undefined}
          title="Spaces"
        >
          <Icon name="spaces" size={22} />
        </a>
        {creationTools.map((tool) => (
          <button
            key={tool.label}
            aria-label={`Create ${tool.label.toLowerCase()} space`}
            title={`Create ${tool.label.toLowerCase()} space`}
            disabled={creating}
            onClick={() => onCreate(tool.type)}
          >
            <Icon name={tool.icon} size={21} />
          </button>
        ))}
        <span className="rail-bottom" title="Personal workspace">
          H
        </span>
      </aside>
      <div className="workspace-switcher">
        {open && (
          <div
            className="workspace-popover"
            id="workspace-popover"
            aria-label="Create in Personal project"
          >
            <div className="popover-project">
              <span className="project-dot" />
              Personal project<span className="project-caption">Workspace</span>
            </div>
            <div className="workspace-tool-list">
              {workspaceTools.map((tool) => (
                <button
                  key={tool.label}
                  disabled={creating}
                  onClick={() => {
                    setOpen(false);
                    onCreate(tool.type);
                  }}
                >
                  <span className={`tool-color-${tool.color}`}>
                    <Icon name={tool.icon} size={20} />
                  </span>
                  {tool.label}
                </button>
              ))}
              {(
                [
                  { label: 'Design', icon: 'design' },
                  { label: 'Motion Graphics', icon: 'motion' },
                  { label: '3D', icon: 'cube' },
                ] as const
              ).map((tool) => (
                <button key={tool.label} disabled title="Coming soon">
                  <Icon name={tool.icon} size={20} />
                  {tool.label}
                  <span className="coming-soon">Soon</span>
                </button>
              ))}
            </div>
            <div className="popover-footer">
              <Icon name="grid" size={16} />
              Your ideas, all in one place.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
