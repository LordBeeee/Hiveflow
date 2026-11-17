import {
  nodeRegistry,
  type NodeCategory,
  type NodeType,
} from '@hiveflow/shared';
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
const icons: Record<NodeType, IconName> = {
  text: 'text',
  image_upload: 'image',
  image_generator: 'sparkles',
};
export const nodeCatalog: NodeCatalogEntry[] = Object.values(nodeRegistry)
  .map((definition) => ({
    type: definition.type,
    label: definition.label,
    category: definition.category,
    description: definition.description,
    keywords: definition.keywords,
    icon: icons[definition.type],
  }))
  .sort((a, b) => a.label.localeCompare(b.label));
