import { useMutation } from '@tanstack/react-query';
import { spacesApi } from './spaces';
import { initialGraph } from '../store/graph';

export function useCreateSpace(name = '') {
  return useMutation({
    mutationFn: () =>
      spacesApi.create({
        name: name.trim() || 'Untitled space',
        graph: structuredClone(initialGraph),
      }),
    onSuccess: (space) => window.location.assign(`/spaces/${space.id}`),
  });
}
