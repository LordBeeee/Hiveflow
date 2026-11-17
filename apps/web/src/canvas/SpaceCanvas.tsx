import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import { useStore } from 'zustand';
import {
  APP_NAME,
  validateConnection,
  connectionForNewNode,
  nodeRegistry,
  type ConnectionOrigin,
  type NodeType,
  type Point,
} from '@hiveflow/shared';
import { redo, undo, useGraphStore } from '../store/graph';
import { useUIStore } from '../store/ui';
import { ImageGeneratorNode } from '../nodes/image_generator/ImageGeneratorNode';
import { ImageUploadNode } from '../nodes/image_upload/ImageUploadNode';
import { TextNode } from '../nodes/text/TextNode';
import type { CanvasNode } from '../nodes/NodeFrame';
import { Icon } from './Icons';
import { NodePicker } from './NodePicker/NodePicker';
import { nodeCatalog } from '../nodes/catalog';

const nodeTypes = {
  text: TextNode,
  image_upload: ImageUploadNode,
  image_generator: ImageGeneratorNode,
};
function useShortcuts(openPicker: () => void) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        useUIStore.getState().menuOpen
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      )
        return;
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'n'
      ) {
        event.preventDefault();
        openPicker();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        useGraphStore.getState().deleteSelection();
      } else if (event.key === 'Escape') {
        useUIStore.getState().setMenuOpen(false);
        useGraphStore.getState().select([], []);
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'v'
      ) {
        useUIStore.getState().setMode('select');
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'h'
      ) {
        useUIStore.getState().setMode('hand');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [openPicker]);
}

export function SpaceCanvas({
  spaceName = 'Untitled space',
  onNameChange,
  onBack,
  headerEnd,
  notice,
}: {
  spaceName?: string;
  onNameChange?: (name: string) => void;
  onBack?: () => void;
  headerEnd?: ReactNode;
  notice?: ReactNode;
}) {
  const state = useGraphStore();
  const { mode, menuOpen, setMode, setMenuOpen, message, notify } =
    useUIStore();
  const canUndo = useStore(
    useGraphStore.temporal,
    (state) => state.pastStates.length > 0,
  );
  const canRedo = useStore(
    useGraphStore.temporal,
    (state) => state.futureStates.length > 0,
  );
  const flow = useReactFlow<CanvasNode>();
  const addButton = useRef<HTMLButtonElement>(null);
  const [pickerConnection, setPickerConnection] = useState<{
    origin: ConnectionOrigin;
    position: Point;
    anchor: Point;
  } | null>(null);
  const openPicker = useCallback(() => {
    setPickerConnection(null);
    setMenuOpen(true);
  }, [setMenuOpen]);
  useShortcuts(openPicker);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => notify(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message, notify]);

  const nodes = useMemo(() => {
    const counts = { text: 0, image_upload: 0, image_generator: 0 };
    return state.nodes.map((node): CanvasNode => ({
      id: node.id,
      type: node.type,
      position: state.dragPositions[node.id] ?? node.position,
      data: { graphNode: node, number: ++counts[node.type] },
      selected: state.selectedNodes.includes(node.id),
    }));
  }, [state.nodes, state.dragPositions, state.selectedNodes]);
  const edges = useMemo(
    () =>
      state.edges.map((edge): Edge => ({
        ...edge,
        selected: state.selectedEdges.includes(edge.id),
        type: 'default',
        style: {
          stroke: edge.sourceHandle === 'text' ? '#b5a0f2' : '#b5ce78',
          strokeWidth: 2,
        },
      })),
    [state.edges, state.selectedEdges],
  );
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const preview: Record<string, Point> = {};
    const committed: Record<string, Point> = {};
    const removed: string[] = [];
    const selection = new Set(useGraphStore.getState().selectedNodes);
    let selectionChanged = false;
    for (const change of changes) {
      if (change.type === 'select') {
        selectionChanged = true;
        if (change.selected) selection.add(change.id);
        else selection.delete(change.id);
      }
      if (change.type === 'position' && change.position) {
        if (change.dragging !== true) committed[change.id] = change.position;
        else preview[change.id] = change.position;
      }
      if (change.type === 'remove') removed.push(change.id);
    }
    if (Object.keys(preview).length)
      useGraphStore.getState().previewPositions(preview);
    if (Object.keys(committed).length)
      useGraphStore.getState().commitPositions(committed);
    if (removed.length) useGraphStore.getState().remove(removed);
    if (selectionChanged)
      useGraphStore
        .getState()
        .select([...selection], useGraphStore.getState().selectedEdges);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const selection = new Set(useGraphStore.getState().selectedEdges);
    const removed: string[] = [];
    let selectionChanged = false;
    for (const change of changes) {
      if (change.type === 'remove') removed.push(change.id);
      if (change.type === 'select') {
        selectionChanged = true;
        if (change.selected) selection.add(change.id);
        else selection.delete(change.id);
      }
    }
    if (removed.length) useGraphStore.getState().remove([], removed);
    if (selectionChanged)
      useGraphStore
        .getState()
        .select(useGraphStore.getState().selectedNodes, [...selection]);
  }, []);
  const validConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.sourceHandle || !connection.targetHandle) return false;
    return validateConnection(useGraphStore.getState(), {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    }).valid;
  }, []);
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connection) => {
      if (connection.isValid) return;
      if (
        connection.fromNode &&
        connection.fromHandle?.id &&
        !connection.toNode &&
        event.target instanceof Element &&
        event.target.closest('.react-flow__pane')
      ) {
        const point =
          'changedTouches' in event ? event.changedTouches[0] : event;
        if (!point) return;
        const anchor = { x: point.clientX, y: point.clientY };
        setPickerConnection({
          origin: {
            nodeId: connection.fromNode.id,
            handleId: connection.fromHandle.id,
            handleType: connection.fromHandle.type,
          },
          position: flow.screenToFlowPosition(anchor),
          anchor,
        });
        setMenuOpen(true);
        return;
      }
      if (
        !connection.fromNode ||
        !connection.toNode ||
        !connection.fromHandle ||
        !connection.toHandle
      )
        return;
      const forward = connection.fromHandle.type === 'source';
      const result = validateConnection(useGraphStore.getState(), {
        source: (forward ? connection.fromNode : connection.toNode).id,
        target: (forward ? connection.toNode : connection.fromNode).id,
        sourceHandle:
          (forward ? connection.fromHandle : connection.toHandle).id ?? '',
        targetHandle:
          (forward ? connection.toHandle : connection.fromHandle).id ?? '',
      });
      if (!result.valid) notify(result.error);
    },
    [notify, flow, setMenuOpen],
  );
  function addNode(type: NodeType) {
    if (pickerConnection) {
      const added = state.addConnectedNode(
        type,
        pickerConnection.position,
        pickerConnection.origin,
      );
      if (!added)
        notify('This port is no longer available. Reconnect and try again.');
      setMenuOpen(false);
      setPickerConnection(null);
      return;
    }
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2 - 160,
      y: window.innerHeight / 2 - 100,
    });
    const offset = (state.nodes.length % 5) * 24;
    state.addNode(type, { x: position.x + offset, y: position.y + offset });
    setMenuOpen(false);
  }
  return (
    <div className="space-app">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="Hiveflow home">
          <span className="brand-mark">
            <Icon name="sparkles" size={17} />
          </span>
          {APP_NAME}
          <span className="brand-dot">.</span>
        </a>
        <span className="header-divider" />
        <button
          className="header-breadcrumb"
          onClick={onBack}
          aria-label="Back to spaces"
        >
          Spaces
        </button>
        <span className="breadcrumb-slash">/</span>
        {onNameChange ? (
          <input
            className="space-name-input"
            aria-label="Space name"
            value={spaceName}
            placeholder="Untitled space"
            maxLength={120}
            onChange={(event) => onNameChange(event.target.value)}
          />
        ) : (
          <span className="space-name">{spaceName}</span>
        )}
        <div className="header-end">
          {headerEnd ?? (
            <>
              <span className="local-indicator">
                <span />
                Local session
              </span>
              <span className="avatar">H</span>
            </>
          )}
        </div>
      </header>
      <main
        className={`canvas-shell mode-${mode}`}
        aria-label="Workflow canvas"
      >
        {notice}
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection) => {
            if (connection.sourceHandle && connection.targetHandle)
              state.connect({
                ...connection,
                sourceHandle: connection.sourceHandle,
                targetHandle: connection.targetHandle,
              });
          }}
          onConnectEnd={onConnectEnd}
          isValidConnection={validConnection}
          viewport={state.viewport}
          onMove={(_event, viewport) => state.setViewport(viewport)}
          panOnDrag={mode === 'hand' ? true : [1, 2]}
          selectionOnDrag={mode === 'select'}
          selectionMode={SelectionMode.Partial}
          panActivationKeyCode="Space"
          nodesDraggable={mode === 'select'}
          deleteKeyCode={null}
          minZoom={0.2}
          maxZoom={2}
          connectionRadius={28}
          onPaneClick={() => {
            state.select([], []);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.1}
            color="#353938"
            bgColor="#161918"
          />
        </ReactFlow>
        <div className="canvas-heading">
          <div className="canvas-eyebrow">
            <span />
            YOUR WORKSPACE
          </div>
          <h1>Make room for ideas.</h1>
          <p>Add nodes. Connect the dots. See what happens.</p>
        </div>
        <div className="left-tools" role="toolbar" aria-label="Canvas tools">
          <button
            ref={addButton}
            className={`add-node-button ${menuOpen ? 'active' : ''}`}
            aria-label="Add node"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            title="Add node (N)"
            onClick={openPicker}
          >
            <Icon name="plus" size={23} />
          </button>
          <div className="tool-divider" />
          <button
            aria-label="Select tool"
            aria-pressed={mode === 'select'}
            className={mode === 'select' ? 'active' : ''}
            title="Select (V)"
            onClick={() => setMode('select')}
          >
            <Icon name="cursor" />
          </button>
          <button
            aria-label="Hand tool"
            aria-pressed={mode === 'hand'}
            className={mode === 'hand' ? 'active' : ''}
            title="Pan (H) · hold Space"
            onClick={() => setMode('hand')}
          >
            <Icon name="hand" />
          </button>
          <div className="tool-divider" />
          <button
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!canUndo}
            onClick={undo}
          >
            <Icon name="undo" />
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!canRedo}
            onClick={redo}
          >
            <Icon name="redo" />
          </button>
        </div>
        {menuOpen && (
          <NodePicker
            onInsert={addNode}
            onClose={() => {
              setMenuOpen(false);
              setPickerConnection(null);
            }}
            returnFocus={addButton}
            anchor={pickerConnection?.anchor}
            catalog={
              pickerConnection
                ? nodeCatalog.filter((node) =>
                    connectionForNewNode(state, pickerConnection.origin, {
                      id: 'node-picker-preview',
                      type: node.type,
                      position: pickerConnection.position,
                      params: { ...nodeRegistry[node.type].defaultParams },
                    }),
                  )
                : nodeCatalog
            }
            compatibleOnly={!!pickerConnection}
          />
        )}
        {state.nodes.length === 0 && (
          <div className="empty-canvas">
            <Icon name="sparkles" size={32} />
            <h2>A fresh space for your next idea.</h2>
            <p>Start with a prompt, a reference, or a little imagination.</p>
            <button onClick={openPicker}>
              <Icon name="plus" size={16} />
              Add your first node
            </button>
          </div>
        )}
        <div className="canvas-bottom-left">
          <span className="phase-chip">SPACE</span>
          <span>Autosave on</span>
        </div>
        <div className="canvas-bottom-center">
          <kbd>Space</kbd>
          <span>to pan</span>
          <span>·</span>
          <kbd>⌘ / Ctrl Z</kbd>
          <span>to undo</span>
        </div>
        <div className="zoom-tools" role="toolbar" aria-label="Zoom controls">
          <button
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => void flow.zoomOut()}
          >
            <Icon name="minus" size={16} />
          </button>
          <span aria-label="Canvas zoom">
            {Math.round(state.viewport.zoom * 100)}%
          </span>
          <button
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => void flow.zoomIn()}
          >
            <Icon name="plus" size={16} />
          </button>
          <div className="zoom-divider" />
          <button
            aria-label="Fit view"
            title="Fit all nodes"
            onClick={() => void flow.fitView({ padding: 0.3, duration: 250 })}
          >
            <Icon name="fit" size={16} />
          </button>
        </div>
        {message && (
          <div className="canvas-toast" role="status">
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => notify(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
