// Read-only discovery. Run locally; never prints credentials or raw error bodies.
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('Set OPENROUTER_API_KEY in your environment.');
  process.exit(1);
}
const base = 'https://openrouter.ai/api/v1';
const groups = [
  ['chat', '/models?output_modalities=text&endpoints=/api/v1/chat/completions'],
  ['image', '/images/models'],
  ['speech', '/models?output_modalities=speech'],
];
const { openrouterImageCandidates } =
  await import('../packages/shared/dist/models.js');
for (const [kind, path] of groups) {
  try {
    const response = await fetch(base + path, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { data } = await response.json();
    const rows = data
      .filter((model) => {
        const input = model.architecture?.input_modalities ?? [];
        const output = model.architecture?.output_modalities ?? [];
        if (kind === 'image')
          return openrouterImageCandidates.includes(model.id);
        if (!input.includes('text')) return false;
        return kind === 'chat'
          ? /^(openai|google)\//.test(model.id) &&
              output.length === 1 &&
              output[0] === 'text' &&
              model.supports_streaming !== false &&
              !/batch/i.test(model.id)
          : /^(elevenlabs|google)\//.test(model.id) &&
              output.includes('speech');
      })
      .map((model) => ({
        id: model.id,
        name: model.name,
        context_length: model.context_length,
        top_provider: model.top_provider,
        architecture: model.architecture,
        supported_voices: model.supported_voices,
        supported_parameters: model.supported_parameters,
        pricing: model.pricing,
        endpoints: model.endpoints,
      }));
    console.log(JSON.stringify({ kind, models: rows }, null, 2));
  } catch {
    console.error(
      `Could not retrieve ${kind} catalog. Check credentials and network access.`,
    );
    process.exitCode = 1;
  }
}
