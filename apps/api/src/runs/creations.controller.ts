import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  creationKindSchema,
  creationRequestSchema,
  creationNodeTypes,
  executionHash,
  nodeRegistry,
  type CreationKind,
  type CreationRequest,
  type GraphNode,
  type ResolvedInputs,
} from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { AssetsService } from '../assets/assets.service';
import { ModelsService } from '../providers/models.service';
import { CostsService } from './costs.service';
import { RunsService } from './runs.service';
import { NodeRunEntity } from './node-run.entity';

@Controller('creations/:kind')
export class CreationsController {
  constructor(
    private readonly db: DataSource,
    private readonly runs: RunsService,
    private readonly models: ModelsService,
    private readonly costs: CostsService,
    private readonly assets: AssetsService,
  ) {}
  private kind(value: string): CreationKind {
    const kind = creationKindSchema.safeParse(value);
    if (!kind.success) throw new BadRequestException('Unknown creation tool');
    return kind.data;
  }
  private async context(user: User, kind: CreationKind) {
    const [context]: { id: string }[] = await this.db.query(
      'SELECT id FROM execution_contexts WHERE user_id=$1 AND kind=$2',
      [user.id, kind],
    );
    return context?.id ?? null;
  }
  @Post('session')
  @UseGuards(ThrottlerGuard)
  async session(@CurrentUser() user: User, @Param('kind') value: string) {
    const kind = this.kind(value);
    const [context]: { id: string }[] = await this.db.query(
      `INSERT INTO execution_contexts(user_id,kind,name) VALUES($1,$2,$3) ON CONFLICT(user_id,kind) WHERE kind <> 'space' DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,
      [
        user.id,
        kind,
        `${kind === 'audio' ? 'Voice' : kind === 'image' ? 'Image' : 'Video'} creations`,
      ],
    );
    return { sessionId: context.id };
  }
  private async prepare(user: User, kind: CreationKind, body: unknown) {
    const parsed = creationRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid creation request');
    const input = parsed.data;
    const type = creationNodeTypes[kind];
    const params = nodeRegistry[type].paramsSchema.safeParse(input.params);
    if (!params.success) throw new BadRequestException('Invalid tool settings');
    const text =
      kind === 'audio'
        ? (params.data as { script: string }).script
        : (params.data as { prompt: string }).prompt;
    if (!text.trim())
      throw new BadRequestException(
        kind === 'audio' ? 'Enter a script.' : 'Enter a prompt.',
      );
    if (text.length > 32000)
      throw new BadRequestException('Prompt is too long.');
    if (
      (kind !== 'image' && input.references.length) ||
      (kind !== 'video' && (input.startImage || input.endImage))
    )
      throw new BadRequestException('Reference inputs do not match this tool.');
    const sessionId = await this.context(user, kind);
    const inputs: ResolvedInputs = { ports: {} };
    for (const [port, ids] of Object.entries({
      references: input.references,
      start_image: input.startImage ? [input.startImage] : [],
      end_image: input.endImage ? [input.endImage] : [],
    })) {
      for (const id of ids) {
        if (!sessionId)
          throw new BadRequestException(
            'Upload references in this tool first.',
          );
        const asset = await this.assets.forSpace(sessionId, id);
        if (asset.kind !== 'image')
          throw new BadRequestException('References must be images.');
        (inputs.ports[port] ??= []).push({
          kind: 'asset',
          assetId: id,
          sha256: asset.sha256,
          mediaKind: 'image',
        });
      }
    }
    const node: GraphNode = {
      id: sessionId ?? randomUUID(),
      type,
      params: params.data,
      position: { x: 0, y: 0 },
    };
    let prepared;
    try {
      prepared = this.models.prepare(node, inputs);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid model settings',
      );
    }
    const units = this.costs.price(prepared.params, inputs);
    this.costs.enforce({ providerNodes: 1, units });
    return {
      node,
      inputs,
      input,
      quote: {
        units,
        model: prepared.model!,
        fingerprint: await executionHash(type, prepared.params, inputs),
      },
    };
  }
  @Post('estimate')
  async estimate(
    @CurrentUser() user: User,
    @Param('kind') value: string,
    @Body() body: unknown,
  ) {
    return (await this.prepare(user, this.kind(value), body)).quote;
  }
  @Post('runs')
  @UseGuards(ThrottlerGuard)
  async start(
    @CurrentUser() user: User,
    @Param('kind') value: string,
    @Body() body: unknown,
  ) {
    const kind = this.kind(value);
    const prepared = await this.prepare(user, kind, body);
    const approval: CreationRequest['approval'] = prepared.input.approval;
    if (
      !approval ||
      approval.fingerprint !== prepared.quote.fingerprint ||
      approval.maxUnits < prepared.quote.units
    )
      throw new ConflictException(
        'Settings or estimate changed. Review the new estimate and try again.',
      );
    const { sessionId } = await this.session(user, kind);
    return this.runs.startResolved(
      user,
      sessionId,
      { ...prepared.node, id: sessionId },
      prepared.inputs,
      prepared.input.force,
    );
  }
  @Get('runs')
  async history(@CurrentUser() user: User, @Param('kind') value: string) {
    const sessionId = await this.context(user, this.kind(value));
    if (!sessionId) return { sessionId: null, runs: [] };
    const rows = await this.db.getRepository(NodeRunEntity).find({
      where: { spaceId: sessionId },
      order: { sequence: 'DESC' },
      take: 50,
    });
    return {
      sessionId,
      runs: rows.map((run) => {
        const { spaceId, nodeId, batchId, ...snapshot } =
          this.runs.snapshot(run);
        void nodeId;
        void batchId;
        const assetIds = (port: string) =>
          (run.inputs?.ports[port] ?? []).flatMap((value) =>
            value.kind === 'asset' ? [value.assetId] : [],
          );
        return {
          ...snapshot,
          sessionId: spaceId,
          params: run.params,
          references: assetIds('references'),
          startImage: assetIds('start_image')[0],
          endImage: assetIds('end_image')[0],
        };
      }),
    };
  }
}
