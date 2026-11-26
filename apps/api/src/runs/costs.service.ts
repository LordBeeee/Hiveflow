import { lockUsage, refundLockedRun } from '../usage/ledger';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import {
  estimateModelUnits,
  executionHash,
  findModel,
  nodeRegistry,
  topoSort,
  type CostEstimate,
  type NodeDef,
  type ResolvedInputs,
  type RunOutput,
  type SpaceGraph,
} from '@hiveflow/shared';
import { ModelsService } from '../providers/models.service';
import { InputResolver } from '../executors/input-resolver';
import { RunCache } from './run-cache';
const sumUnits = (values: number[]) =>
  values.reduce((sum, value) => sum + Math.round(value * 1000), 0) / 1000;
@Injectable()
export class CostsService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly models: ModelsService,
    private readonly resolver: InputResolver,
    private readonly cache: RunCache,
  ) {}
  price(params: Record<string, unknown>, inputs: ResolvedInputs) {
    const model = findModel(String(params.model));
    return model && !inputs.error
      ? estimateModelUnits(model, params, inputs)
      : 0;
  }
  async plan(
    spaceId: string,
    graph: SpaceGraph,
    force = false,
    nodeId?: string,
  ) {
    const outputs = new Map<string, RunOutput | null>();
    const frozen = structuredClone(graph);
    const nodes: CostEstimate['nodes'] = [];
    const ordered = nodeId ? [nodeId] : topoSort(graph).flat();
    for (const id of ordered) {
      const node = graph.nodes.find((value) => value.id === id);
      if (!node)
        throw new UnprocessableEntityException(
          'Node not found in the saved graph.',
        );
      const def: NodeDef = nodeRegistry[node.type];
      if (def.staticOutput) outputs.set(id, def.staticOutput(node.params));
      if (!def.modelKind) {
        nodes.push({
          nodeId: id,
          units: 0,
          providerUnits: 0,
          cached: false,
          providerCall: false,
          upperBound: false,
          model: null,
        });
        continue;
      }
      const unknown =
        !nodeId &&
        graph.edges.some(
          (edge) =>
            edge.target === id &&
            !outputs.has(edge.source) &&
            !(
              nodeRegistry[
                graph.nodes.find((value) => value.id === edge.source)!.type
              ] as NodeDef
            ).staticOutput,
        );
      const resolved = await this.resolver.resolve(
        spaceId,
        graph,
        node,
        nodeId ? undefined : outputs,
      );
      const inputs: ResolvedInputs = unknown
        ? { ports: resolved.ports }
        : resolved;
      let prepared: ReturnType<ModelsService['prepare']>;
      let providerUnits: number;
      try {
        if (inputs.error) throw new Error(inputs.error);
        prepared = this.models.prepare(node, inputs);
        const model = findModel(prepared.model!)!;
        providerUnits = estimateModelUnits(
          model,
          prepared.params,
          inputs,
          !!unknown && model.kind === 'tts',
        );
      } catch (error) {
        nodes.push({
          nodeId: id,
          units: 0,
          providerUnits: 0,
          cached: false,
          providerCall: false,
          upperBound: false,
          model: null,
          error:
            error instanceof Error
              ? error.message
              : 'Could not estimate this node.',
        });
        continue;
      }
      // Database/cache failures must stop admission, never turn a paid node into a free quote.
      const hash = await executionHash(node.type, prepared.params, inputs);
      const cached =
        !force && !unknown ? await this.cache.find(spaceId, id, hash) : null;
      if (cached) outputs.set(id, cached.output);
      frozen.nodes.find((value) => value.id === id)!.params = prepared.params;
      nodes.push({
        nodeId: id,
        units: cached ? 0 : providerUnits,
        providerUnits,
        cached: !!cached,
        providerCall: !cached,
        upperBound: !!unknown,
        model: prepared.model,
      });
    }
    const estimate: CostEstimate = {
      providerNodes: nodes.filter((value) => value.providerCall).length,
      cachedNodes: nodes.filter((value) => value.cached).length,
      units: sumUnits(nodes.map((value) => value.units)),
      upperBound: nodes.some((value) => value.upperBound),
      nodes,
    };
    return { estimate, graph: frozen };
  }
  enforce(
    estimate: Pick<CostEstimate, 'providerNodes' | 'units'> &
      Partial<Pick<CostEstimate, 'nodes'>>,
  ) {
    const invalid = estimate.nodes?.find((node) => node.error);
    if (invalid) throw new UnprocessableEntityException(invalid.error);
    const maxNodes = this.config.getOrThrow<number>('MAX_BATCH_PROVIDER_NODES'),
      maxUnits = this.config.getOrThrow<number>('MAX_BATCH_UNITS');
    if (estimate.providerNodes > maxNodes)
      throw new UnprocessableEntityException(
        `This request needs ${estimate.providerNodes} provider nodes; the limit is ${maxNodes}. Reduce the graph or reuse cached results.`,
      );
    if (estimate.units > maxUnits)
      throw new UnprocessableEntityException(
        `This request needs about ${estimate.units} estimated credits; the limit is ${maxUnits}. Reduce the request or reuse cached results.`,
      );
  }
  async lockUser(manager: EntityManager, userId: string) {
    await lockUsage(manager, userId);
  }
  async lockRunUser(manager: EntityManager, runId: string) {
    const [row]: { cost_user_id: string }[] = await manager.query(
      'SELECT cost_user_id FROM node_runs WHERE id=$1',
      [runId],
    );
    if (row) await this.lockUser(manager, row.cost_user_id);
  }
  private async checkDaily(
    manager: EntityManager,
    userId: string,
    additional: number,
    budgetDate?: string,
  ) {
    if (additional <= 0) return;
    const [row]: { used: string }[] = await manager.query(
      "SELECT COALESCE(sum(units),0)::text AS used FROM usage_ledger WHERE user_id=$1 AND budget_date=COALESCE($2::date,(now() AT TIME ZONE 'UTC')::date)",
      [userId, budgetDate ?? null],
    );
    if (
      Math.round(Number(row.used) * 1000) + Math.round(additional * 1000) >
      this.config.getOrThrow<number>('DAILY_UNITS_LIMIT') * 1000
    )
      throw new UnprocessableEntityException(
        'Daily credit limit reached (UTC). Cancel pending work or wait for the next budget day.',
      );
  }
  async reserve(
    manager: EntityManager,
    userId: string,
    runId: string,
    units: number,
    providerCall = false,
  ) {
    await this.lockUser(manager, userId);
    await this.checkDaily(manager, userId, units);
    await manager.query(
      "UPDATE node_runs SET cost_user_id=$2,cost_units=$3,cost_reserved=true,cost_provider=$4,budget_date=(now() AT TIME ZONE 'UTC')::date WHERE id=$1",
      [runId, userId, units, providerCall],
    );
    await manager.query(
      "INSERT INTO usage_ledger(user_id,run_id,units,entry_type,budget_date) SELECT cost_user_id,id,cost_units,'reserve',budget_date FROM node_runs WHERE id=$1",
      [runId],
    );
  }
  async adjust(
    manager: EntityManager,
    runId: string,
    units: number,
    providerCall = false,
  ) {
    await this.lockRunUser(manager, runId);
    const [row]: {
      batch_id: string | null;
      cost_user_id: string;
      cost_units: string;
      cost_refunded: boolean;
      cost_provider: boolean;
      budget_date: string;
      status: string;
    }[] = await manager.query(
      'SELECT * FROM node_runs WHERE id=$1 FOR UPDATE',
      [runId],
    );
    if (
      !row ||
      row.cost_refunded ||
      ['failed', 'canceled', 'skipped'].includes(row.status)
    )
      return;
    if (units > Number(row.cost_units) || (providerCall && !row.cost_provider))
      throw new UnprocessableEntityException(
        'The reserved estimate changed. Review a fresh estimate and run again.',
      );
    if (row.batch_id) {
      const [total]: { units: string; nodes: number }[] = await manager.query(
        'SELECT COALESCE(sum(cost_units),0)::text AS units,COALESCE(sum(cost_provider::int),0)::int AS nodes FROM node_runs WHERE batch_id=$1 AND id<>$2',
        [row.batch_id, runId],
      );
      this.enforce({
        providerNodes: total.nodes + (providerCall ? 1 : 0),
        units: sumUnits([Number(total.units), units]),
      });
    }
    await manager.query('UPDATE node_runs SET cost_provider=$2 WHERE id=$1', [
      runId,
      providerCall,
    ]);
    const difference =
      (Math.round(units * 1000) - Math.round(Number(row.cost_units) * 1000)) /
      1000;
    if (!difference) return;
    await this.checkDaily(
      manager,
      row.cost_user_id,
      difference,
      row.budget_date,
    );
    await manager.query(
      "INSERT INTO usage_ledger(user_id,run_id,units,entry_type,budget_date) VALUES($1,$2,$3,'adjustment',$4)",
      [row.cost_user_id, runId, difference, row.budget_date],
    );
    await manager.query('UPDATE node_runs SET cost_units=$2 WHERE id=$1', [
      runId,
      units,
    ]);
  }
  async refund(runId: string) {
    await this.db.transaction(async (manager) => {
      await this.lockRunUser(manager, runId);
      const [row]: {
        cost_user_id: string;
        cost_units: string;
        cost_refunded: boolean;
        budget_date: string;
        status: string;
      }[] = await manager.query(
        'SELECT * FROM node_runs WHERE id=$1 FOR UPDATE',
        [runId],
      );
      if (
        !row ||
        row.cost_refunded ||
        !['failed', 'canceled', 'skipped'].includes(row.status)
      )
        return;
      await refundLockedRun(manager, { ...row, id: runId });
    });
  }
  async reconcileRefunds() {
    const rows: { id: string }[] = await this.db.query(
      "SELECT id FROM node_runs WHERE status IN ('failed','canceled','skipped') AND cost_reserved=true AND cost_refunded=false ORDER BY sequence LIMIT 500",
    );
    for (const row of rows) await this.refund(row.id);
  }
  async usage(userId: string) {
    const [row]: { day: string; used: string }[] = await this.db.query(
      "SELECT to_char((now() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS day,COALESCE(sum(units),0)::text AS used FROM usage_ledger WHERE user_id=$1 AND budget_date=(now() AT TIME ZONE 'UTC')::date",
      [userId],
    );
    const limit = this.config.getOrThrow<number>('DAILY_UNITS_LIMIT');
    return {
      day: row.day,
      used: Number(row.used),
      limit,
      remaining: Math.max(0, limit - Number(row.used)),
      timezone: 'UTC',
    };
  }
}
