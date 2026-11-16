import { Handle, NodeToolbar, Position, type Node } from '@xyflow/react';
import {
  nodeRegistry,
  type GraphNode,
  type NodeDef,
  type NodeType,
} from '@hiveflow/shared';
import { useGraphStore } from '../store/graph';
import { useUIStore } from '../store/ui';
import { Icon } from '../canvas/Icons';

export type CanvasNode = Node<
  { graphNode: GraphNode; number: number },
  NodeType
>;
const nodeIcons = {
  text: 'text',
  image_upload: 'image',
  image_generator: 'sparkles',
} as const;
export function runNode() {
  useUIStore
    .getState()
    .notify(
      'Image generation is coming soon. You can arrange and connect nodes in this preview.',
    );
}

export function NodeFrame({
  node,
  number,
  selected,
  children,
}: {
  node: GraphNode;
  number: number;
  selected: boolean;
  children: React.ReactNode;
}) {
  const definition: NodeDef<Record<string, unknown>> = nodeRegistry[node.type];
  return (
    <div
      className={`workflow-node ${node.type} ${selected ? 'is-selected' : ''}`}
    >
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        offset={42}
        className="node-floating-toolbar nodrag nopan"
      >
        {node.type === 'image_generator' && (
          <button onClick={runNode}>
            <Icon name="play" size={14} />
            Run
          </button>
        )}
        <button
          aria-label={`Delete ${definition.label} #${number}`}
          onClick={() => useGraphStore.getState().remove([node.id])}
        >
          <Icon name="trash" size={14} />
          Delete
        </button>
      </NodeToolbar>
      <div className="node-title">
        <Icon name={nodeIcons[node.type]} size={15} />
        <span>
          {definition.label} <span className="node-number">#{number}</span>
        </span>
        <span className="node-title-dot" />
      </div>
      <div className="node-card">{children}</div>
      {definition.inputs.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          className={`port port-${port.type}`}
          style={{ top: index === 0 ? '48%' : '66%' }}
          aria-label={`${definition.label} #${number} ${port.id} input`}
          title={`${port.id} · ${port.type}${port.multiple ? ' · multiple' : ''}`}
        />
      ))}
      {definition.outputs.map((port) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          className={`port port-${port.type}`}
          style={{ top: '48%' }}
          aria-label={`${definition.label} #${number} ${port.id} output`}
          title={`${port.id} output · ${port.type}`}
        />
      ))}
    </div>
  );
}
