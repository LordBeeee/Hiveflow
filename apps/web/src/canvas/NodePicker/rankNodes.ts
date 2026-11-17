import type { NodeCategory } from '@hiveflow/shared';
import type { NodeCatalogEntry } from '../../nodes/catalog';
export type CategoryFilter = NodeCategory | 'All';
export function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}
export function rankNodes(
  catalog: readonly NodeCatalogEntry[],
  query: string,
  category: CategoryFilter,
): NodeCatalogEntry[] {
  const term = normalizeSearch(query);
  return catalog
    .filter((node) => category === 'All' || node.category === category)
    .map((node, index) => {
      const label = normalizeSearch(node.label);
      const rank =
        !term || label.startsWith(term)
          ? 0
          : label.includes(term)
            ? 1
            : node.keywords.some((keyword) =>
                  normalizeSearch(keyword).includes(term),
                )
              ? 2
              : normalizeSearch(node.category).includes(term)
                ? 3
                : 4;
      return { node, rank, index };
    })
    .filter(({ rank }) => rank < 4)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ node }) => node);
}
