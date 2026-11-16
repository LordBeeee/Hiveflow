import { ReactFlowProvider } from '@xyflow/react';
import { SpaceCanvas } from './canvas/SpaceCanvas';
import '@xyflow/react/dist/style.css';

export function App() {
  return (
    <ReactFlowProvider>
      <SpaceCanvas />
    </ReactFlowProvider>
  );
}
