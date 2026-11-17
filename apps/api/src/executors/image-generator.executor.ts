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
    if (!params.prompt.trim())
      throw new Error(
        'Enter a prompt in this Image Generator before running it.',
      );
    const result = await this.provider.generate(
      { ...params, references: [] },
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
      });
    }
    context.signal.throwIfAborted();
    return { output: { image }, provider: this.provider.id };
  }
}
