import { CostButton } from '../api/costs';
import { Handle, NodeToolbar, Position, type Node } from '@xyflow/react';
import {
  nodeRegistry,
  type GraphNode,
  type NodeDef,
  type NodeType,
} from '@hiveflow/shared';
import { useGraphStore } from '../store/graph';
import { useExecution } from '../api/execution';
import { useRunStore } from '../store/runs';
import { Icon, type IconName } from '../canvas/Icons';

export type CanvasNode = Node<
  { graphNode: GraphNode; number: number },
  NodeType
>;
export function NodeFrame({
  node,
  number,
  selected,
  children,
  icon,
  portWarnings = {},
  runDisabledReason,
}: {
  node: GraphNode;
  number: number;
  selected: boolean;
  children: React.ReactNode;
  icon: IconName;
  portWarnings?: Record<string, string>;
  runDisabledReason?: string;
}) {
  const definition: NodeDef<Record<string, unknown>> = nodeRegistry[node.type];
  const { runNode } = useExecution();
  const run = useRunStore((state) => state.nodes[node.id]);
  const requesting = useRunStore((state) => state.requesting[node.id]);
  const busy =
    requesting || run?.status === 'queued' || run?.status === 'running';
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
        {!!definition.modelKind && (
          <CostButton
            nodeId={node.id}
            disabled={busy || !!runDisabledReason}
            title={runDisabledReason}
            onClick={() => void runNode(node.id)}
          >
            <Icon name="play" size={14} />
            Run
          </CostButton>
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
        <Icon name={icon} size={15} />
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
          style={{
            top:
              definition.inputs.length > 2
                ? `${36 + index * 20}%`
                : index === 0
                  ? '48%'
                  : '66%',
          }}
          aria-label={`${definition.label} #${number} ${port.id} input`}
          title={
            portWarnings[port.id] ??
            `${port.id} · ${port.type}${port.multiple ? ' · multiple' : ''}`
          }
        >
          {portWarnings[port.id] && (
            <span className="port-warning" aria-label={portWarnings[port.id]}>
              !
            </span>
          )}
        </Handle>
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
