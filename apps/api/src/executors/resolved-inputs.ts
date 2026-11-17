// Durable input values; signed URLs are created only when the worker executes.
export interface ResolvedInputs {
  prompt?: string;
  references: { assetId: string; sha256: string }[];
  error?: string;
}
export class InputResolutionError extends Error {}
