import { useRef, useState } from 'react';
import { useLocalAssets } from '../../store/ui';
import { Icon } from '../../canvas/Icons';
import type { NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graph';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
export function ImageUploadNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const assetId = data.graphNode.params.assetId;
  const asset = useLocalAssets((state) =>
    typeof assetId === 'string' ? state.assets[assetId] : undefined,
  );
  function choose(file?: File) {
    if (!file) return;
    const assetId = useLocalAssets.getState().add(file);
    if (assetId) useGraphStore.getState().updateParams(id, { assetId });
  }
  return (
    <NodeFrame node={data.graphNode} number={data.number} selected={!!selected}>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept="image/*"
        aria-label={`Image Upload #${data.number} file`}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <button
        className={`upload-zone nodrag nopan ${dragOver ? 'drag-over' : ''}`}
        aria-label={`Choose image for Image Upload #${data.number}`}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        {asset ? (
          <img src={asset.url} alt={asset.name} draggable={false} />
        ) : (
          <>
            <span className="upload-icon">
              <Icon name="image" size={25} />
            </span>
            <strong>Drop an image here</strong>
            <span>or click to browse · up to 20 MB</span>
          </>
        )}
      </button>
      <div className="node-card-footer">
        <span className="filename">
          {asset?.name ?? 'Your reference starts here'}
        </span>
        <span className="image-port-label">
          Image <span>●</span>
        </span>
      </div>
    </NodeFrame>
  );
}
