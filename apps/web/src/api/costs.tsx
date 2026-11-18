import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { costEstimateSchema, type CostEstimate } from '@hiveflow/shared';
import { request } from './spaces';
import { useRunStore } from '../store/runs';
export const estimateCost = async (
  spaceId: string,
  force = false,
  nodeId?: string,
) =>
  costEstimateSchema.parse(
    await request(`/spaces/${spaceId}/run/estimate`, {
      method: 'POST',
      body: JSON.stringify({ force, ...(nodeId ? { nodeId } : {}) }),
    }),
  );
const EstimateContext = createContext<CostEstimate | undefined>(undefined);
export function CostEstimateProvider({
  spaceId,
  version,
  saved,
  children,
}: {
  spaceId: string;
  version: number;
  saved: boolean;
  children: ReactNode;
}) {
  const runs = useRunStore((state) => state.nodes);
  const busy = useRunStore((state) => state.batch?.status === 'running');
  const signature = Object.values(runs)
    .map((run) => `${run.sequence}:${run.status}`)
    .join(',');
  const query = useQuery({
    queryKey: ['cost-estimate', spaceId, version, signature],
    queryFn: () => estimateCost(spaceId),
    enabled: saved && !busy,
    staleTime: 3000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <EstimateContext.Provider value={saved ? query.data : undefined}>
      {children}
    </EstimateContext.Provider>
  );
}
export function CostButton({
  nodeId,
  force = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  nodeId: string;
  force?: boolean;
}) {
  const estimate = useContext(EstimateContext)?.nodes.find(
    (node) => node.nodeId === nodeId,
  );
  const units = estimate
    ? force
      ? estimate.providerUnits
      : estimate.units
    : undefined;
  const title =
    estimate?.error ??
    (units !== undefined
      ? `${estimate?.upperBound ? 'Up to ' : ''}${units} estimated credits${!force && estimate?.cached ? ' · cached' : ''}. Estimates use the saved graph.`
      : 'Cost estimate available after saving. Run enforces the configured limits.');
  return <button {...props} title={props.title ?? title} />;
}
