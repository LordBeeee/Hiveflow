// Explicit user-run, billable image-to-video check. Never load .env or retry submit.
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
if (
  process.env.HIVEFLOW_LIVE_CHECK !== '1' ||
  !process.env.KLING_API_KEY ||
  !process.argv[3]
) {
  console.error(
    'Set HIVEFLOW_LIVE_CHECK=1 and KLING_API_KEY, then node scripts/live-check.mjs kling <local-png-or-jpeg> (billable).',
  );
  process.exit(1);
}
const { default: shared } = await import('../packages/shared/dist/index.js');
const { default: adapters } =
  await import('../apps/api/dist/providers/kling.provider.js');
const { default: httpModule } =
  await import('../apps/api/dist/providers/provider-http.js');
const { default: errors } =
  await import('../apps/api/dist/providers/kling-error.js');
const configured = process.env.DEFAULT_VIDEO_MODEL;
const model =
  configured && !configured.startsWith('mock-')
    ? shared.klingCatalog.find((row) => row.id === configured)
    : shared.klingCatalog[0];
if (!model) {
  console.error('Choose a Kling catalog ID for DEFAULT_VIDEO_MODEL.');
  process.exit(1);
}
const signal = AbortSignal.timeout(15 * 60 * 1000);
let taskId;
try {
  const path = process.argv[3];
  const mime = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  }[extname(path).toLowerCase()];
  const info = await stat(path);
  if (
    !mime ||
    !info.isFile() ||
    info.size > model.capabilities.maxImageMb * 1024 * 1024
  )
    throw new Error('Invalid image file');
  const bytes = await readFile(path);
  const provider = new adapters.KlingProvider(
    new httpModule.ProviderHttp({
      baseUrl:
        process.env.KLING_BASE_URL || 'https://api-singapore.klingai.com',
      headers: { Authorization: `Bearer ${process.env.KLING_API_KEY}` },
      mapError: errors.klingError,
      embeddedErrors: false,
      maxResponseBytes: 1024 * 1024,
    }),
    250 * 1024 * 1024,
  );
  ({ taskId } = await provider.submit(
    {
      requestId: crypto.randomUUID(),
      model: model.providerModelId,
      prompt: 'A landscape with gently moving clouds.',
      duration: 3,
      resolution: '720p',
      aspectRatio: 'adaptive',
      generateAudio: model.capabilities.audio === 'included',
      startImage: { url: '', mime, read: async () => bytes },
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
          billing: result.billing ?? [],
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
        'Live check could not complete. Check the input file and Kling task history before retrying.',
    }),
  );
  process.exitCode = 1;
}
