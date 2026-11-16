import { useEffect, useState } from 'react';
import {
  APP_NAME,
  healthResponseSchema,
  type HealthResponse,
} from '@hiveflow/shared';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((body) => setHealth(healthResponseSchema.parse(body)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-[#101111] text-zinc-100">
      <header className="flex h-20 items-center justify-between border-b border-white/10 px-10">
        <h1 className="text-xl font-semibold tracking-tight">
          {APP_NAME}
          <span className="text-lime-300">.</span>
        </h1>
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Spaces prototype
        </span>
      </header>
      <main className="mx-auto max-w-5xl px-10 py-28">
        <p className="mb-5 text-xs uppercase tracking-[0.3em] text-lime-300">
          Your creative workspace
        </p>
        <h2 className="max-w-2xl text-6xl font-medium leading-tight tracking-tight">
          Ideas, connected.
        </h2>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-400">
          A space for building image workflows. The foundation is ready; the
          canvas comes next.
        </p>
        <div
          role="status"
          className="mt-12 inline-flex items-center gap-3 rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-400"
        >
          <span
            className={`h-2 w-2 rounded-full ${health ? 'bg-lime-300' : failed ? 'bg-amber-400' : 'bg-zinc-500'}`}
          />
          {health
            ? 'API connected'
            : failed
              ? 'API unavailable — start the backend and database'
              : 'Connecting to API…'}
        </div>
      </main>
    </div>
  );
}
