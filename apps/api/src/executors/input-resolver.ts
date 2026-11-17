import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  nodeRegistry,
  textParamsSchema,
  imageUploadParamsSchema,
  type GraphNode,
  type SpaceGraph,
  type RunOutput,
} from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import { NodeRunEntity } from '../runs/node-run.entity';
import { InputResolutionError, type ResolvedInputs } from './resolved-inputs';

@Injectable()
export class InputResolver {
  constructor(
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly assets: AssetsService,
  ) {}
  async resolve(
    spaceId: string,
    graph: SpaceGraph,
    node: GraphNode,
    batchOutputs?: Map<string, RunOutput | null>,
  ): Promise<ResolvedInputs> {
    const result: ResolvedInputs = { references: [] };
    try {
      for (const port of nodeRegistry[node.type].inputs) {
        const edges = graph.edges.filter(
          (edge) => edge.target === node.id && edge.targetHandle === port.id,
        );
        for (const edge of edges) {
          const source = graph.nodes.find(
            (candidate) => candidate.id === edge.source,
          );
          if (!source)
            throw new InputResolutionError(
              'A connected upstream node is missing. Reconnect the input and retry.',
            );
          const number =
            graph.nodes
              .filter((candidate) => candidate.type === source.type)
              .findIndex((candidate) => candidate.id === source.id) + 1;
          const label = `${nodeRegistry[source.type].label} #${number}`;
          const missing = () =>
            new InputResolutionError(
              `Upstream node '${label}' has no output. ${source.type === 'image_upload' ? 'Choose and upload an image' : source.type === 'text' ? 'Enter some text' : 'Run that node successfully'} before retrying.`,
            );
          if (source.type === 'text' && port.type === 'text') {
            const value = textParamsSchema.parse(source.params).value;
            if (!value.trim()) throw missing();
            result.prompt = value;
            continue;
          }
          let ids: string[];
          if (source.type === 'image_upload' && port.type === 'image') {
            const id = imageUploadParamsSchema.parse(source.params).assetId;
            ids = id ? [id] : [];
          } else {
            const latest = batchOutputs
              ? null
              : await this.runs.findOne({
                  where: { spaceId, nodeId: source.id, status: 'succeeded' },
                  order: { sequence: 'DESC' },
                });
            const output = batchOutputs
              ? batchOutputs.get(source.id)
              : latest?.output;
            ids = output?.image?.map((image) => image.assetId) ?? [];
          }
          if (!ids.length) throw missing();
          for (const id of ids) {
            try {
              const asset = await this.assets.forSpace(spaceId, id);
              result.references.push({
                assetId: asset.id,
                sha256: asset.sha256,
              });
            } catch (error) {
              if (error instanceof NotFoundException)
                throw new InputResolutionError(
                  `Upstream node '${label}' references an unavailable image. Upload or run that node again.`,
                );
              throw error;
            }
          }
        }
      }
      return result;
    } catch (error) {
      if (!(error instanceof InputResolutionError)) throw error;
      return { ...result, error: error.message };
    }
  }
}
