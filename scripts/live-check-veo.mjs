// Explicit user-run, billable check. No ambient ADC, .env loading, or submit retry.
import { setTimeout as delay } from 'node:timers/promises';
if (
  process.env.HIVEFLOW_LIVE_CHECK !== '1' ||
  !process.env.GOOGLE_CLOUD_PROJECT_ID ||
  !process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON
) {
  console.error(
    'Set HIVEFLOW_LIVE_CHECK=1, GOOGLE_CLOUD_PROJECT_ID and GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON, then node scripts/live-check.mjs veo (billable).',
  );
  process.exit(1);
}
const { default: shared } = await import('../packages/shared/dist/index.js');
const { default: adapters } =
  await import('../apps/api/dist/providers/veo.provider.js');
const { default: auth } =
  await import('../apps/api/dist/providers/veo-auth.js');
const configured = process.env.DEFAULT_VIDEO_MODEL;
const model =
  configured && !configured.startsWith('mock-')
    ? shared.veoCatalog.find((row) => row.id === configured)
    : [...shared.veoCatalog].sort((a, b) => a.costUnits - b.costUnits)[0];
if (!model) {
  console.error('Choose a Veo catalog ID for DEFAULT_VIDEO_MODEL.');
  process.exit(1);
}
const signal = AbortSignal.timeout(15 * 60 * 1000);
let taskId;
try {
  const provider = new adapters.VeoProvider(
    {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      timeoutMs: 120000,
      maxBytes: 64 * 1024 * 1024,
    },
    auth.veoTokenSource(
      auth.veoAuthClient(process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON, 30000),
      30000,
    ),
  );
  ({ taskId } = await provider.submit(
    {
      requestId: crypto.randomUUID(),
      model: model.providerModelId,
      prompt: 'A still landscape with gently moving clouds.',
      duration: 4,
      resolution: '720p',
      aspectRatio: '16:9',
      generateAudio: false,
    },
    signal,
  ));
  console.log(JSON.stringify({ model: model.id, taskId, status: 'accepted' }));
  for (;;) {
    const result = await provider.poll(taskId, signal);
    if (result.status === 'succeeded') {
      let bytes = 0;
      for await (const chunk of result.result.stream) bytes += chunk.length;
      console.log(
        JSON.stringify({
          model: model.id,
          taskId,
          status: 'succeeded',
          bytes,
          costUsd: result.costUsd ?? null,
        }),
      );
      break;
    }
    await delay(5000, undefined, { signal });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      taskId: taskId ?? null,
      code: error.code ?? 'unavailable',
      message:
        error.userMessage ??
        'Live check could not complete. Check service-account configuration and the Vertex AI operation history before retrying.',
    }),
  );
  process.exitCode = 1;
}
