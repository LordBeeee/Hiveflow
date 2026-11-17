import { expect, it } from 'vitest';
import { nodeRegistry } from '@hiveflow/shared';
import { nodeCatalog, type NodeCatalogEntry } from '../../nodes/catalog';
import { rankNodes } from './rankNodes';

it('derives every catalog entry from shared metadata without placeholders', () => {
  expect(nodeCatalog).toHaveLength(Object.keys(nodeRegistry).length);
  for (const node of nodeCatalog)
    expect(node).toMatchObject({
      label: nodeRegistry[node.type].label,
      category: nodeRegistry[node.type].category,
      description: nodeRegistry[node.type].description,
      keywords: nodeRegistry[node.type].keywords,
    });
  expect([...new Set(nodeCatalog.map((node) => node.category))].sort()).toEqual(
    ['Audio', 'Image', 'Text'],
  );
});
it('ranks label prefix before substring, keywords and category with stable ties', () => {
  const entry = nodeCatalog[0];
  const catalog: NodeCatalogEntry[] = [
    { ...entry, label: 'Other', category: 'Text', keywords: [] },
    { ...entry, label: 'Other keyword', keywords: ['text'] },
    { ...entry, label: 'Rich text', keywords: [] },
    { ...entry, label: 'Text', keywords: [] },
    { ...entry, label: 'Text note', keywords: [] },
  ];
  expect(rankNodes(catalog, 'text', 'All').map((node) => node.label)).toEqual([
    'Text',
    'Text note',
    'Rich text',
    'Other keyword',
    'Other',
  ]);
  expect(catalog[0].label).toBe('Other');
});
it('ignores case, surrounding whitespace, composed accents and Vietnamese đ', () => {
  expect(
    rankNodes(nodeCatalog, '  TÉX  ', 'All').map((node) => node.type),
  ).toEqual(['text', 'assistant']);
  expect(rankNodes(nodeCatalog, 'a\u0309nh', 'All')).toHaveLength(2);
  const entry = { ...nodeCatalog[0], label: 'Đèn Ánh Sáng' };
  expect(rankNodes([entry], 'DEN anh', 'All')).toEqual([entry]);
});
it('combines category and search, supports empty query and unmatched queries', () => {
  expect(rankNodes(nodeCatalog, '', 'Image')).toHaveLength(2);
  expect(rankNodes(nodeCatalog, 'text', 'Image')).toEqual([]);
  expect(
    rankNodes(nodeCatalog, 'file', 'All').map((node) => node.type),
  ).toEqual(['image_upload']);
  expect(rankNodes(nodeCatalog, 'unmatched search', 'All')).toEqual([]);
  expect(rankNodes(nodeCatalog, '', 'All')).toEqual(nodeCatalog);
});
