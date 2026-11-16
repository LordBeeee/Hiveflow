export type PortType = 'text' | 'image';
export type NodeType = 'text' | 'image_upload' | 'image_generator';
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
