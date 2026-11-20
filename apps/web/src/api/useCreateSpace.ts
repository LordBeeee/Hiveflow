import { useMutation } from '@tanstack/react-query';
import { nodeRegistry, type NodeType } from '@hiveflow/shared';
import { spacesApi } from './spaces';
import { initialGraph } from '../store/graph';

export function useCreateSpace(name = '') {
  return useMutation({
    mutationFn: (type?: NodeType) =>
      spacesApi.create({
        name: name.trim() || 'Untitled space',
        graph: type
          ? {
              ...structuredClone(initialGraph),
              edges: [],
              nodes: [
                {
                  id: crypto.randomUUID(),
                  type,
                  position: { x: 480, y: 160 },
                  params: structuredClone(nodeRegistry[type].defaultParams),
                },
              ],
            }
          : structuredClone(initialGraph),
      }),
    onSuccess: (space) => window.location.assign(`/spaces/${space.id}`),
  });
}
