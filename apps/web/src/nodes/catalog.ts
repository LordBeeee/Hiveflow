import {
  nodeRegistry,
  type NodeCategory,
  type NodeType,
  type NodeDef,
} from '@hiveflow/shared';
import { nodePresentations } from './presentation';
import type { IconName } from '../canvas/Icons';

export interface NodeCatalogEntry {
  type: NodeType;
  label: string;
  category: NodeCategory;
  description: string;
  keywords: readonly string[];
  icon: IconName;
  isNew?: boolean;
}
export const nodeCatalog: NodeCatalogEntry[] = Object.values(nodeRegistry)
  .map((definition) => ({
    type: definition.type,
    label: definition.label,
    category: definition.category,
    description: definition.description,
    keywords: definition.keywords,
    icon: nodePresentations[definition.type]?.icon ?? 'sparkles',
    isNew: (definition as NodeDef).isNew,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));
