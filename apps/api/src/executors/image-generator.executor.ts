import { Inject, Injectable } from '@nestjs/common';
import { imageGeneratorParamsSchema } from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import {
  IMAGE_PROVIDER,
  type ImageProvider,
} from '../providers/image-provider';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class ImageGeneratorExecutor implements NodeExecutor {
  readonly type = 'image_generator';
  constructor(
    private readonly assets: AssetsService,
    @Inject(IMAGE_PROVIDER) private readonly provider: ImageProvider,
  ) {}
  async execute(context: ExecutionContext) {
    const params = imageGeneratorParamsSchema.parse(context.params);
    const prompt = context.inputs?.prompt ?? params.prompt;
    if (!prompt.trim())
      throw new Error(
        'No prompt is available. Connect a non-empty Text node or enter a local prompt in this Image Generator.',
      );
    const references = [];
    for (const reference of context.inputs?.references ?? []) {
      context.signal.throwIfAborted();
      references.push(
        await this.assets.providerReference(context.spaceId, reference.assetId),
      );
    }
    const result = await this.provider.generate(
      { ...params, prompt, references },
      context.signal,
    );
    const image = [];
    for (const generated of result.images) {
      context.signal.throwIfAborted();
      const asset = await this.assets.store(context.spaceId, generated.bytes);
      image.push({
        assetId: asset.id,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
      });
    }
    context.signal.throwIfAborted();
    return { output: { image }, provider: this.provider.id };
  }
}
