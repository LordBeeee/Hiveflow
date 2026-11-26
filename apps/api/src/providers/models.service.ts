import {
  Controller,
  Get,
  Injectable,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  modelCatalog,
  modelKinds,
  nodeRegistry,
  selectModel,
  validateModelParams,
  type AvailableModel,
  type ModelKind,
  type GraphNode,
  type ResolvedInputs,
  type NodeDef,
} from '@hiveflow/shared';
import { ProviderRegistry } from './provider-registry';
@Injectable()
export class ModelsService {
  constructor(private readonly providers: ProviderRegistry) {}
  list(kind?: ModelKind): AvailableModel[] {
    const entries: AvailableModel[] = modelCatalog.map((model) => {
      const configured = this.providers.has(model.kind, model.provider);
      const reason =
        model.status === 'removed'
          ? 'Model removed; choose another model'
          : configured
            ? undefined
            : 'Provider adapter/API key not configured';
      return {
        ...model,
        available: !reason,
        ...(reason ? { unavailableReason: reason } : {}),
      };
    });
    return kind ? entries.filter((model) => model.kind === kind) : entries;
  }
  prepare(node: GraphNode, inputs: ResolvedInputs) {
    const definition: NodeDef = nodeRegistry[node.type];
    const params = definition.paramsSchema.parse(node.params);
    if (!definition.modelKind) return { params, model: null, provider: null };
    const model = selectModel(
      String(params.model ?? ''),
      definition.modelKind,
      this.list(),
    );
    const imageCount = Object.values(inputs.ports)
      .flat()
      .filter(
        (value) => value.kind === 'asset' && value.mediaKind === 'image',
      ).length;
    if (
      definition.modelKind === 'llm' &&
      imageCount &&
      !model.capabilities.supportsImageInput
    )
      throw new Error(`${model.label} does not support image input.`);
    if (inputs.ports.end_image?.length && !model.capabilities.supportsEndImage)
      throw new Error(`${model.label} does not support an end image.`);
    if (
      model.capabilities.requiresStartImage &&
      !inputs.ports.start_image?.length
    )
      throw new Error(`${model.label} requires a start image.`);
    if (
      model.capabilities.endImageRequiresStart &&
      inputs.ports.end_image?.length &&
      !inputs.ports.start_image?.length
    )
      throw new Error('Connect a start image before using an end image.');
    const validation = {
      ...params,
      hasStartImage: !!inputs.ports.start_image?.length,
    };
    const validated = validateModelParams(validation, model, imageCount);
    return {
      params: { ...params, model: model.id, options: validated.options },
      model: model.id,
      provider: model.provider,
    };
  }
}
@Controller('models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}
  @Get() list(@Query('kind') kind?: string) {
    if (kind && !modelKinds.includes(kind as ModelKind))
      throw new BadRequestException('Unknown model kind');
    return this.models.list(kind as ModelKind | undefined);
  }
}
