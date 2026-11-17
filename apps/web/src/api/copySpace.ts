import type { SpaceGraph } from '@hiveflow/shared';
import { spacesApi } from './spaces';
import { executionApi } from './execution';

export async function copySpaceWithAssets(name: string, graph: SpaceGraph) {
  const copy = structuredClone(graph);
  const references = new Map<string, string>();
  for (const node of copy.nodes)
    if (node.type === 'image_upload' && typeof node.params.assetId === 'string')
      references.set(node.id, node.params.assetId);
  for (const node of copy.nodes)
    if (node.type === 'image_upload') node.params.assetId = null;
  const space = await spacesApi.create({ name, graph: copy });
  try {
    const cloned = new Map<string, string>();
    for (const [nodeId, oldId] of references) {
      if (!cloned.has(oldId)) {
        const asset = await executionApi.asset(oldId);
        const response = await fetch(asset.url, {
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok)
          throw new Error(
            'Could not copy a reference image. Reselect it or remove it and retry.',
          );
        const file = new File([await response.blob()], 'reference.png', {
          type: 'image/png',
        });
        cloned.set(oldId, (await executionApi.upload(space.id, file)).id);
      }
      copy.nodes.find((node) => node.id === nodeId)!.params.assetId =
        cloned.get(oldId)!;
    }
    return references.size
      ? await spacesApi.update(space.id, {
          graph: copy,
          version: space.version,
        })
      : space;
  } catch (error) {
    await spacesApi.remove(space.id).catch(() => {});
    throw error;
  }
}
