import type { ReactNode } from 'react';
import type { NodeType } from '@hiveflow/shared';
import { WorkspaceNav } from './WorkspaceNav';
import '../pages/SpacesPage.css';

export function WorkspaceLayout({
  active,
  creating,
  onCreate,
  children,
}: {
  active: 'home' | 'spaces' | 'library';
  creating: boolean;
  onCreate: (type?: NodeType) => void;
  children: ReactNode;
}) {
  return (
    <div className="spaces-page">
      <WorkspaceNav active={active} creating={creating} onCreate={onCreate} />
      <header className="workspace-header">
        <span className="workspace-header-label">YOUR WORKSPACE</span>
        <span className="workspace-profile" title="Personal workspace">
          H
        </span>
      </header>
      <main className="spaces-content">{children}</main>
    </div>
  );
}
