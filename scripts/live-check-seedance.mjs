// Manual, billable opt-in. No dotenv loading and no automatic task resubmission.
import { setTimeout as delay } from 'node:timers/promises';
if (process.env.HIVEFLOW_LIVE_CHECK !== '1' || !process.env.ARK_API_KEY) {
  console.error(
    'Set HIVEFLOW_LIVE_CHECK=1 and ARK_API_KEY, then node scripts/live-check.mjs seedance (billable).',
  );
  process.exit(1);
}
const { default: shared } = await import('../packages/shared/dist/index.js');
const { default: adapters } =
  await import('../apps/api/dist/providers/seedance.provider.js');
const { default: httpModule } =
  await import('../apps/api/dist/providers/provider-http.js');
const { default: errors } =
  await import('../apps/api/dist/providers/seedance-error.js');
const configured = process.env.DEFAULT_VIDEO_MODEL;
const model =
  configured && !configured.startsWith('mock-')
    ? shared.seedanceCatalog.find((row) => row.id === configured)
    : shared.seedanceCatalog[0];
if (!model) {
  console.error('Choose a Seedance catalog ID for DEFAULT_VIDEO_MODEL.');
  process.exit(1);
}
const provider = new adapters.SeedanceProvider(
  new httpModule.ProviderHttp({
    baseUrl:
      process.env.ARK_BASE_URL ||
      'https://ark.ap-southeast.bytepluses.com/api/v3',
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}` },
    mapError: errors.seedanceError,
    embeddedErrors: false,
    maxResponseBytes: 1024 * 1024,
  }),
  250 * 1024 * 1024,
);
const signal = AbortSignal.timeout(65 * 60 * 1000);
let taskId;
try {
  ({ taskId } = await provider.submit(
    {
      requestId: crypto.randomUUID(),
      model: model.providerModelId,
      prompt: 'A still landscape with gently moving clouds.',
      duration: 4,
      resolution: '480p',
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
          outputTokens: result.usage?.outputTokens ?? null,
          costUsd: null,
        }),
      );
      break;
    }
    await delay(5000, undefined, { signal });
  }
} catch (error) {
  // Raw vendor errors, credentials and result URLs must never reach the terminal.
  console.error(
    JSON.stringify({
      taskId: taskId ?? null,
      code: error.code ?? 'unavailable',
      message:
        error.userMessage ??
        'Live check could not complete. Inspect the task in ModelArk before retrying.',
    }),
  );
  process.exitCode = 1;
}
