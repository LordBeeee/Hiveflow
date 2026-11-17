import {
  Controller,
  Get,
  Injectable,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private readonly config: ConfigService,
    private readonly providers: ProviderRegistry,
  ) {}
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
        isDefault: false,
      };
    });
    for (const item of modelKinds) {
      const defaultId = this.config.get<string>(
        `DEFAULT_${item.toUpperCase()}_MODEL`,
      );
      const defaultModel = defaultId
        ? entries.find(
            (entry) =>
              entry.id === defaultId || entry.aliases?.includes(defaultId),
          )
        : entries.find((entry) => entry.kind === item && entry.available);
      if (defaultModel?.kind === item && defaultModel.available)
        defaultModel.isDefault = true;
    }
    return kind ? entries.filter((model) => model.kind === kind) : entries;
  }
  prepare(node: GraphNode, inputs: ResolvedInputs) {
    const definition: NodeDef = nodeRegistry[node.type];
    const params = definition.paramsSchema.parse(node.params);
    if (!definition.modelKind) return { params, model: null, provider: null };
    const model = selectModel(
      String(params.model ?? 'auto'),
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
    return {
      params: validateModelParams(params, model, imageCount),
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
