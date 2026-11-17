import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { nodeRegistry } from '@hiveflow/shared';
import type { NodeExecutor } from './node-executor';
@Injectable()
export class ExecutorRegistry implements OnModuleInit {
  private readonly executors = new Map<string, NodeExecutor>();
  constructor(private readonly discovery: DiscoveryService) {}
  onModuleInit() {
    for (const wrapper of this.discovery.getProviders()) {
      const value: unknown = wrapper.instance;
      if (
        !value ||
        typeof value !== 'object' ||
        !('type' in value) ||
        !('execute' in value)
      )
        continue;
      if (
        typeof value.type === 'string' &&
        value.type in nodeRegistry &&
        typeof value.execute === 'function'
      )
        this.executors.set(value.type, value as NodeExecutor);
    }
  }
  get(type: string) {
    return this.executors.get(type);
  }
}
