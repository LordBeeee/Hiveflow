import type { ReactNode } from 'react';
import { WorkspaceNav } from './WorkspaceNav';
import '../pages/SpacesPage.css';

export function WorkspaceLayout({
  active,
  creating,
  onCreate,
  children,
}: {
  active: 'home' | 'spaces' | 'library' | 'image' | 'video' | 'audio';
  creating: boolean;
  onCreate: () => void;
  children: ReactNode;
}) {
  return (
    <div className="spaces-page">
      <WorkspaceNav active={active} creating={creating} onCreate={onCreate} />
      <main className="spaces-content">{children}</main>
    </div>
  );
}
