// Offline HTTP acceptance: a minimal Models controller, no DB/queue/storage/provider calls.
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import shared from '@hiveflow/shared';
import {
  ModelsService,
  ModelsController,
} from '../dist/providers/models.service.js';
import { ProviderRegistry } from '../dist/providers/provider-registry.js';
import { registerOpenRouter } from '../dist/providers/openrouter.provider.js';
const selected = shared.openrouterCatalog;
for (const configured of [false, true]) {
  const registry = new ProviderRegistry();
  for (const kind of ['llm', 'image', 'tts', 'video'])
    registry.register(kind, kind === 'video' ? 'mock-video' : 'mock', {
      id: 'mock',
    });
  const config = new ConfigService({
    OPENROUTER_API_KEY: configured ? 'offline-fixture' : '',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    PROVIDER_TIMEOUT_MS: 1000,
    DEFAULT_IMAGE_MODEL: 'mock-image',
    DEFAULT_LLM_MODEL: 'mock-llm',
    DEFAULT_TTS_MODEL: 'mock-tts',
    DEFAULT_VIDEO_MODEL: 'mock-video',
  });
  registerOpenRouter(registry, config);
  class CatalogCheckModule {}
  Module({
    controllers: [ModelsController],
    providers: [
      { provide: ModelsService, useValue: new ModelsService(config, registry) },
    ],
  })(CatalogCheckModule);
  const app = await NestFactory.create(CatalogCheckModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(base + '/models');
    assert.equal(response.status, 200);
    const models = await response.json();
    for (const row of selected) {
      const actual = models.find((model) => model.id === row.id);
      assert(actual, row.id);
      assert.equal(
        actual.available,
        configured && row.status !== 'removed',
        row.id,
      );
      if (!configured && row.status !== 'removed')
        assert.match(actual.unavailableReason, /not configured/);
    }
    assert(
      models
        .filter((model) => model.isDefault)
        .every((model) => model.id.startsWith('mock-')),
    );
    assert(
      models
        .filter((model) => model.provider === 'custom')
        .every((model) => !model.available),
    );
    for (const kind of ['llm', 'image', 'tts']) {
      const rows = await (await fetch(`${base}/models?kind=${kind}`)).json();
      assert(rows.every((model) => model.kind === kind));
    }
    console.log(
      `GET /models passed: key ${configured ? 'configured (dummy)' : 'absent'}, ${selected.length} chosen rows, mocks remain defaults.`,
    );
  } finally {
    await app.close();
  }
}
