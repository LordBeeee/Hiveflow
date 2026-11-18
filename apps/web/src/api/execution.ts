import { createContext, useContext } from 'react';
import {
  assetSchema,
  nodeRunSchema,
  batchSchema,
  type NodeRun,
} from '@hiveflow/shared';
import { request } from './spaces';

export const executionApi = {
  upload: async (spaceId: string, file: File) => {
    const form = new FormData();
    form.set('spaceId', spaceId);
    form.set('file', file);
    return assetSchema.parse(
      await request('/assets', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000),
      }),
    );
  },
  asset: async (id: string) =>
    assetSchema.parse(await request(`/assets/${id}/metadata`)),
  run: async (spaceId: string, nodeId: string, force = false) => {
    await request(`/spaces/${spaceId}/nodes/${nodeId}/run`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  },
  history: async (spaceId: string, succeeded = false): Promise<NodeRun[]> =>
    nodeRunSchema
      .array()
      .parse(
        await request(
          `/spaces/${spaceId}/runs${succeeded ? '?succeeded=true' : ''}`,
        ),
      ),
  runAll: (
    spaceId: string,
    force = false,
    approved?: {
      version?: number;
      graphHash?: string;
      maxUnits?: number;
      maxProviderNodes?: number;
    },
  ) =>
    request(`/spaces/${spaceId}/run`, {
      method: 'POST',
      body: JSON.stringify({ force, ...approved }),
    }),
  batches: async (spaceId: string) =>
    batchSchema.array().parse(await request(`/spaces/${spaceId}/batches`)),
  cancel: async (id: string) =>
    nodeRunSchema.parse(
      await request(`/runs/${id}/cancel`, { method: 'POST' }),
    ),
  cancelBatch: async (id: string) =>
    batchSchema.parse(
      await request(`/batches/${id}/cancel`, { method: 'POST' }),
    ),
};
export interface ExecutionActions {
  runNode: (nodeId: string, force?: boolean) => Promise<void>;
  cancelNode: (nodeId: string) => Promise<void>;
  uploadFile: (nodeId: string, file: File) => Promise<void>;
  retryUpload: (nodeId: string) => Promise<void>;
  attachReference: (nodeId: string, file: File) => Promise<void>;
}
export const ExecutionContext = createContext<ExecutionActions | null>(null);
export function useExecution() {
  const value = useContext(ExecutionContext);
  if (!value) throw new Error('Execution controls require a Space editor');
  return value;
}
