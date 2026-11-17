import { nodeRegistry } from '@hiveflow/shared';
import type { NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graph';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
export function TextNode({ id, data, selected }: NodeProps<CanvasNode>) {
  return (
    <NodeFrame
      icon="text"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
    >
      <div className="text-card-label">PROMPT / TEXT</div>
      <textarea
        aria-label={`Text #${data.number} value`}
        className="nodrag nopan nowheel text-node-input"
        placeholder="Write something to start your workflow…"
        value={String(data.graphNode.params.value ?? '')}
        onChange={(event) =>
          useGraphStore
            .getState()
            .updateParams(id, { value: event.target.value })
        }
      />
      <div className="node-card-footer">
        <span>Connect to a prompt input</span>
        <span className="text-port-label">
          Text <span>●</span>
        </span>
      </div>
    </NodeFrame>
  );
}

export const nodeUI = {
  type: nodeRegistry.text.type,
  component: TextNode,
  icon: 'text' as const,
};
