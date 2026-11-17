import { nodeRegistry } from '@hiveflow/shared';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../canvas/Icons';
import type { NodeProps } from '@xyflow/react';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
import { executionApi, useExecution } from '../../api/execution';
import { useRunStore } from '../../store/runs';

export function ImageUploadNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { uploadFile, retryUpload } = useExecution();
  const upload = useRunStore((state) => state.uploads[id]);
  const assetId =
    typeof data.graphNode.params.assetId === 'string'
      ? data.graphNode.params.assetId
      : null;
  const asset = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => executionApi.asset(assetId!),
    enabled: !!assetId,
    retry: false,
    staleTime: Infinity,
  });
  const uploading = upload?.status === 'uploading';
  function choose(file?: File) {
    if (file && !uploading) void uploadFile(id, file).catch(() => {});
  }
  return (
    <NodeFrame
      icon="image"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
    >
      <input
        ref={input}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        aria-label={`Image Upload #${data.number} file`}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <button
        className={`upload-zone nodrag nopan ${dragOver ? 'drag-over' : ''}`}
        aria-label={`Choose image for Image Upload #${data.number}`}
        disabled={uploading}
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
        {asset.data ? (
          <img
            src={asset.data.url}
            alt="Uploaded reference"
            draggable={false}
          />
        ) : (
          <>
            <span className="upload-icon">
              <Icon name="image" size={25} />
            </span>
            <strong>
              {asset.isError
                ? 'Image unavailable — choose it again'
                : 'Drop an image here'}
            </strong>
            <span>PNG, JPEG, WebP, AVIF or GIF</span>
          </>
        )}
        {uploading && (
          <div className="run-progress" role="status">
            <span className="loading-spinner" />
            <span>Uploading image…</span>
          </div>
        )}
      </button>
      {upload?.status === 'failed' && (
        <div className="run-error nodrag nopan" role="alert">
          <span>{upload.error}</span>
          <button onClick={() => void retryUpload(id).catch(() => {})}>
            Retry upload
          </button>
        </div>
      )}
      <div className="node-card-footer">
        <span>
          {asset.data
            ? `${asset.data.width} × ${asset.data.height} · Saved image`
            : 'Choose a reference image'}
        </span>
        <span className="image-port-label">
          Image <span>●</span>
        </span>
      </div>
    </NodeFrame>
  );
}

export const nodeUI = {
  type: nodeRegistry.image_upload.type,
  component: ImageUploadNode,
  icon: 'image' as const,
};
