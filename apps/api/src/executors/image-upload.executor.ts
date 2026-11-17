import { Injectable } from '@nestjs/common';
import { imageUploadParamsSchema } from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class ImageUploadExecutor implements NodeExecutor {
  readonly type = 'image_upload';
  constructor(private readonly assets: AssetsService) {}
  async execute(context: ExecutionContext) {
    context.signal.throwIfAborted();
    const { assetId } = imageUploadParamsSchema.parse(context.params);
    if (!assetId)
      throw new Error('Choose and upload an image before running this node.');
    const asset = await this.assets.forSpace(context.spaceId, assetId);
    return {
      output: {
        image: [
          {
            assetId: asset.id,
            url: asset.url,
            width: asset.width,
            height: asset.height,
            sha256: asset.sha256,
          },
        ],
      },
    };
  }
}
