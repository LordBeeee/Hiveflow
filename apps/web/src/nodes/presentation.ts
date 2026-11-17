import type { NodeProps } from '@xyflow/react';
import type { ComponentType } from 'react';
import type { NodeType } from '@hiveflow/shared';
import type { IconName } from '../canvas/Icons';
import type { CanvasNode } from './NodeFrame';
interface Presentation {
  type: NodeType;
  component: ComponentType<NodeProps<CanvasNode>>;
  icon: IconName;
}
const modules = import.meta.glob<{ nodeUI: Presentation }>('./*/*Node.tsx', {
  eager: true,
});
export const nodePresentations = Object.fromEntries(
  Object.values(modules).map((module) => [module.nodeUI.type, module.nodeUI]),
);
