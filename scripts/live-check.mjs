// Explicit opt-in only. Uses the same adapters as the API, never called by CI.
if (
  process.argv[2] !== 'openrouter' ||
  process.env.HIVEFLOW_LIVE_CHECK !== '1' ||
  !process.env.OPENROUTER_API_KEY
) {
  console.error(
    'Usage: HIVEFLOW_LIVE_CHECK=1 and OPENROUTER_API_KEY set, then node scripts/live-check.mjs openrouter',
  );
  process.exit(1);
}
const { default: shared } = await import('../packages/shared/dist/index.js');
const { default: adapters } =
  await import('../apps/api/dist/providers/openrouter.provider.js');
const { default: httpModule } =
  await import('../apps/api/dist/providers/provider-http.js');
const { default: errors } =
  await import('../apps/api/dist/providers/openrouter-error.js');
const selected = ['llm', 'image', 'tts'].map((kind) => {
  const id = process.env[`DEFAULT_${kind.toUpperCase()}_MODEL`];
  const model = shared.modelCatalog.find(
    (row) =>
      row.kind === kind &&
      row.provider === 'openrouter' &&
      row.status !== 'removed' &&
      (!id || row.id === id),
  );
  if (!model) {
    console.error(
      `Choose and add an OpenRouter ${kind} catalog model first; set DEFAULT_${kind.toUpperCase()}_MODEL to select it.`,
    );
    process.exit(1);
  }
  return model;
});
const http = new httpModule.ProviderHttp({
  baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  mapError: errors.openrouterError,
});
const providers = {
  llm: new adapters.OpenRouterLlmProvider(http),
  image: new adapters.OpenRouterImageProvider(http),
  tts: new adapters.OpenRouterTtsProvider(http),
};
for (const model of selected) {
  const signal = AbortSignal.timeout(120000);
  try {
    let result;
    if (model.kind === 'llm')
      result = await providers.llm.complete(
        {
          model: model.providerModelId,
          system: 'Be concise.',
          messages: [{ role: 'user', text: 'Say hello.' }],
          maxTokens: 32,
        },
        signal,
      );
    else if (model.kind === 'image')
      result = await providers.image.generate(
        {
          model: model.providerModelId,
          prompt: 'A small blue circle on white.',
          count: 1,
          aspectRatio: model.capabilities.aspectRatios?.[0] ?? '1:1',
          resolution: model.capabilities.resolutions?.[0] ?? '1K',
          references: [],
        },
        signal,
      );
    else
      result = await providers.tts.synthesize(
        {
          model: model.providerModelId,
          text: 'Hello.',
          voice: model.capabilities.voices?.[0],
          speed: 1,
          language: model.capabilities.languages?.[0] ?? 'auto',
        },
        signal,
      );
    let cost = result.usage?.costUsd ?? null;
    if (model.kind === 'tts' && result.generationId) {
      const response = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(result.generationId)}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          },
          signal,
          redirect: 'error',
        },
      );
      if (response.ok) cost = (await response.json()).data?.total_cost ?? null;
    }
    console.log(
      JSON.stringify({
        kind: model.kind,
        model: model.id,
        generationId: result.generationId ?? null,
        costUsd: cost,
      }),
    );
  } catch {
    console.error(
      `Live check failed for ${model.kind}; inspect API configuration and provider dashboard. Raw payload omitted.`,
    );
    process.exitCode = 1;
    break;
  }
}
