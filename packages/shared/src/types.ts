import type { nodeRegistry } from './nodes';
export type PortType = 'text' | 'image' | 'video' | 'audio';
export type NodeType = keyof typeof nodeRegistry;
export const portColors: Record<PortType, string> = {
  text: '#b5a0f2',
  image: '#b5ce78',
  video: '#79bdf2',
  audio: '#efad83',
};
export interface Point {
  x: number;
  y: number;
}
export interface GraphNode {
  id: string;
  type: NodeType;
  position: Point;
  params: Record<string, unknown>;
}
export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}
export interface SpaceGraph {
  schemaVersion: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: Point & { zoom: number };
}
