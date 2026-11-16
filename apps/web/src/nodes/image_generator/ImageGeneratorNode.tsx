import { useRef } from 'react';
import { nodeRegistry } from '@hiveflow/shared';
import { useLocalAssets } from '../../store/ui';
import { Icon } from '../../canvas/Icons';
import { runNode } from '../NodeFrame';
import type { NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graph';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
export function ImageGeneratorNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>) {
  const input = useRef<HTMLInputElement>(null);
  const { prompt, count, model, aspectRatio, resolution } =
    nodeRegistry.image_generator.paramsSchema.parse(data.graphNode.params);
  const update = (params: Record<string, unknown>) =>
    useGraphStore.getState().updateParams(id, params);
  return (
    <NodeFrame node={data.graphNode} number={data.number} selected={!!selected}>
      <div className="generator-preview">
        <div className="preview-grid" />
        <span className="preview-icon">
          <Icon name="sparkles" size={30} />
        </span>
        <p>
          A little imagination.
          <br />
          <span>Infinite possibilities.</span>
        </p>
        <span className="preview-tag">IMAGE GENERATOR</span>
      </div>
      <div className="generator-composer nodrag nopan">
        <div className="prompt-row">
          <button
            className="attach-button"
            title="Attach a reference image"
            aria-label={`Attach reference to Image Generator #${data.number}`}
            onClick={() => input.current?.click()}
          >
            <Icon name="plus" size={17} />
          </button>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                const assetId = useLocalAssets.getState().add(file);
                if (assetId) useGraphStore.getState().addReference(id, assetId);
              }
              event.target.value = '';
            }}
          />
          <textarea
            className="nowheel"
            aria-label={`Image Generator #${data.number} prompt`}
            placeholder="Describe the image you want to generate…"
            value={prompt}
            onChange={(event) => update({ prompt: event.target.value })}
          />
        </div>
        <div className="generator-settings">
          <div className="count-control">
            <button
              aria-label="Decrease image count"
              disabled={count === 1}
              onClick={() => update({ count: count - 1 })}
            >
              −
            </button>
            <span aria-label="Image count">x{count}</span>
            <button
              aria-label="Increase image count"
              disabled={count === 4}
              onClick={() => update({ count: count + 1 })}
            >
              +
            </button>
          </div>
          <label className="model-control">
            <Icon name="sparkles" size={12} />
            <select
              aria-label="Model"
              value={model}
              onChange={(event) => update({ model: event.target.value })}
            >
              <option value="auto">Auto</option>
            </select>
          </label>
          <select
            aria-label="Aspect ratio"
            value={aspectRatio}
            onChange={(event) => update({ aspectRatio: event.target.value })}
          >
            {['1:1', '16:9', '9:16', '4:3', '3:4'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Resolution"
            value={resolution}
            onChange={(event) => update({ resolution: event.target.value })}
          >
            {['1K', '2K', '4K'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <button className="run-button" onClick={runNode}>
            <Icon name="play" size={12} />
            Run
          </button>
        </div>
      </div>
    </NodeFrame>
  );
}
