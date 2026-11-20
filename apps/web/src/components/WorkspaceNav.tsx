import { useEffect, useRef, useState } from 'react';
import type { NodeType } from '@hiveflow/shared';
import { Icon, type IconName } from '../canvas/Icons';

const tools: {
  label: string;
  icon: IconName;
  type?: NodeType;
  color: string;
}[] = [
  { label: 'Space', icon: 'spaces', color: 'purple' },
  { label: 'Image', icon: 'image', type: 'image_generator', color: 'blue' },
  { label: 'Video', icon: 'video', type: 'video_generator', color: 'green' },
  { label: 'Audio', icon: 'audio', type: 'voiceover', color: 'teal' },
];

export function WorkspaceNav({
  onCreate,
  creating,
  active,
}: {
  onCreate: (type?: NodeType) => void;
  creating: boolean;
  active: 'spaces' | 'library';
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
          className="rail-create"
          aria-label="Create something new"
          aria-expanded={open}
          aria-controls="workspace-popover"
          onClick={() => setOpen(!open)}
        >
          <Icon name="plus" size={24} />
        </button>
        <a href="/" aria-label="Home" title="Home">
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
        {tools.slice(1).map((tool) => (
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
        <button
          ref={trigger}
          className="workspace-trigger"
          aria-expanded={open}
          aria-controls="workspace-popover"
          onClick={() => setOpen(!open)}
        >
          <span className="project-dot" />
          Personal project
          <Icon name="chevron" size={17} />
        </button>
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
              {tools.map((tool) => (
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
