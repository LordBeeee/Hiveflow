import { createContext, useContext } from 'react';
import { assetSchema, nodeRunSchema, type NodeRun } from '@hiveflow/shared';
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
  run: async (spaceId: string, nodeId: string) => {
    await request(`/spaces/${spaceId}/nodes/${nodeId}/run`, {
      method: 'POST',
      body: '{}',
    });
  },
  history: async (spaceId: string): Promise<NodeRun[]> =>
    nodeRunSchema.array().parse(await request(`/spaces/${spaceId}/runs`)),
};
export interface ExecutionActions {
  runNode: (nodeId: string) => Promise<void>;
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
