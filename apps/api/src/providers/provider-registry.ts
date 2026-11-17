import { Injectable } from '@nestjs/common';
import { findModel, type ModelKind } from '@hiveflow/shared';
export interface ProviderBase {
  id: string;
}
@Injectable()
export class ProviderRegistry {
  private readonly implementations = new Map<string, ProviderBase>();
  register(kind: ModelKind, code: string, provider: ProviderBase) {
    this.implementations.set(`${kind}:${code}`, provider);
  }
  has(kind: ModelKind, code: string) {
    return this.implementations.has(`${kind}:${code}`);
  }
  forModel(id: string) {
    const model = findModel(id);
    if (!model || model.status === 'removed')
      throw new Error(
        'This model is unknown or removed. Please choose another model.',
      );
    const provider = this.implementations.get(
      `${model.kind}:${model.provider}`,
    );
    if (!provider)
      throw new Error(
        `${model.label}: provider adapter is not configured. Please choose another model.`,
      );
    return { model, provider };
  }
}
