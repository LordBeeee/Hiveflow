// Offline HTTP acceptance: a minimal Models controller, no DB/queue/storage/provider calls.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
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
import { registerSeedance } from '../dist/providers/seedance.provider.js';
import { registerKling } from '../dist/providers/kling.provider.js';
import { registerVeo } from '../dist/providers/veo.provider.js';
const fixtureCredentials = JSON.stringify({
  type: 'service_account',
  client_email: 'fixture@offline-project.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
});
const selected = shared.openrouterCatalog;
for (const mode of ['none', 'openrouter', 'seedance', 'kling', 'veo']) {
  const configured = mode === 'openrouter';
  const registry = new ProviderRegistry();
  const config = new ConfigService({
    OPENROUTER_API_KEY: configured ? 'offline-fixture' : '',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    ARK_API_KEY: mode === 'seedance' ? 'offline-fixture' : '',
    ARK_BASE_URL: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    KLING_API_KEY: mode === 'kling' ? 'offline-fixture' : '',
    KLING_BASE_URL: 'https://api-singapore.klingai.com',
    GOOGLE_CLOUD_PROJECT_ID: mode === 'veo' ? 'offline-project' : '',
    GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: mode === 'veo' ? fixtureCredentials : '',
    MAX_VIDEO_MB: 250,
    PROVIDER_TIMEOUT_MS: 1000,
  });
  registerOpenRouter(registry, config);
  registerSeedance(registry, config);
  registerKling(registry, config);
  registerVeo(registry, config);
  class CatalogCheckModule {}
  Module({
    controllers: [ModelsController],
    providers: [
      { provide: ModelsService, useValue: new ModelsService(registry) },
    ],
  })(CatalogCheckModule);
  const app = await NestFactory.create(CatalogCheckModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(base + '/models');
    assert.equal(response.status, 200);
    const models = await response.json();
    for (const row of shared.veoCatalog) {
      const actual = models.find((model) => model.id === row.id);
      assert(actual, row.id);
      assert.equal(actual.available, mode === 'veo', row.id);
    }
    for (const row of shared.klingCatalog) {
      const actual = models.find((model) => model.id === row.id);
      assert(actual, row.id);
      assert.equal(actual.available, mode === 'kling', row.id);
    }
    for (const row of shared.seedanceCatalog) {
      const actual = models.find((model) => model.id === row.id);
      assert(actual, row.id);
      assert.equal(actual.available, mode === 'seedance', row.id);
    }
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
    assert(models.every((model) => !/^(mock|custom)/.test(model.provider)));
    assert(models.every((model) => !('isDefault' in model)));
    for (const kind of ['llm', 'image', 'tts', 'video']) {
      const rows = await (await fetch(`${base}/models?kind=${kind}`)).json();
      assert(rows.every((model) => model.kind === kind));
    }
    console.log(
      `GET /models passed: ${mode} credential configuration (dummy), ${selected.length} OpenRouter, 2 Seedance, 2 Kling and 2 Veo rows; explicit model selection only.`,
    );
  } finally {
    await app.close();
  }
}
