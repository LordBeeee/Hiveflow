import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { spaceSummarySchema } from '@hiveflow/shared';
import { SpacesPage } from './pages/SpacesPage';
import { SpacePage } from './pages/SpacePage';
import { LibraryPage } from './pages/LibraryPage';
import { HomePage } from './pages/HomePage';
import { CreationPage } from './pages/CreationPage';
import { creationKindSchema } from '@hiveflow/shared';
import '@xyflow/react/dist/style.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});
export function App() {
  const path = window.location.pathname;
  const match = /^\/spaces\/([^/]+)\/?$/.exec(path);
  const id = match && spaceSummarySchema.shape.id.safeParse(match[1]);
  const toolMatch = /^\/create\/(image|video|audio)\/?$/.exec(path);
  const tool = toolMatch && creationKindSchema.parse(toolMatch[1]);
  const content =
    path === '/' ? (
      <HomePage />
    ) : tool ? (
      <CreationPage key={tool} kind={tool} />
    ) : /^\/spaces\/?$/.test(path) ? (
      <SpacesPage />
    ) : /^\/library\/?$/.test(path) ? (
      <LibraryPage />
    ) : id && id.success ? (
      <SpacePage id={id.data} />
    ) : (
      <div className="page-message">
        <h1>Space not found.</h1>
        <a href="/spaces">Back to spaces</a>
      </div>
    );
  return (
    <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
  );
}
