import { runAll } from './helpers';
import { test, expect } from '@playwright/test';
import { nodeRegistry } from '@hiveflow/shared';
test.skip(
  !process.env.CREATIONS_TEST_API,
  'Start the isolated offline API harness and set CREATIONS_TEST_API.',
);

test('Assistant branches to image, voice and video with progress, playback/seek, Range, cache, stale and cancel', async ({
  page,
  request,
}) => {
  await page.route('**/api/models*', async (route) => {
    const response = await route.fetch();
    const models = await response.json();
    for (const model of models)
      if (model.id === 'veo-3-1-fast') {
        model.capabilities = {
          ...model.capabilities,
          durations: [5],
          aspectRatios: ['16:9', '1:1'],
          resolutions: ['720p'],
          supportsEndImage: false,
          supportsAudio: false,
          audio: 'none',
        };
      }
    await route.fulfill({ response, json: models });
  });
  let id: string | undefined;
  try {
    const node = (
      type: keyof typeof nodeRegistry,
      x: number,
      y: number,
      params: Record<string, unknown> = {},
    ) => ({
      id: crypto.randomUUID(),
      type,
      position: { x, y },
      params: { ...nodeRegistry[type].defaultParams, ...params },
    });
    const text = node('text', 0, 0, {
        value: 'A quiet mountain lake at sunrise',
      }),
      assistant = node('assistant', 420, 0, {
        message: 'Describe a short cinematic scene',
      }),
      image = node('image_generator', 850, 0),
      voice = node('voiceover', 1270, 0),
      video = node('video_generator', 1690, 0);
    const edge = (
      source: typeof text,
      target: typeof text,
      targetHandle: string,
    ) => ({
      id: crypto.randomUUID(),
      source: source.id,
      target: target.id,
      sourceHandle: 'text',
      targetHandle,
    });
    const response = await request.post('/api/spaces', {
      data: {
        name: `E2E video workflow ${Date.now()}`,
        graph: {
          schemaVersion: 1,
          nodes: [text, assistant, image, voice, video],
          edges: [
            edge(text, assistant, 'context'),
            edge(assistant, image, 'prompt'),
            edge(assistant, voice, 'script'),
            edge(assistant, video, 'prompt'),
          ],
          viewport: { x: 0, y: 80, zoom: 0.55 },
        },
      },
    });
    expect(response.ok()).toBe(true);
    id = (await response.json()).id;
    await page.goto(`/spaces/${id}`);
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    const videoCard = page.locator('.workflow-node.video_generator');
    await expect(
      videoCard.getByRole('option', { name: /Video Studio/ }),
    ).toBeDisabled();
    await runAll(page);
    await expect
      .poll(
        async () =>
          Number(
            await page
              .getByLabel('Video Generator #1 progress', { exact: true })
              .getAttribute('value'),
          ),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    await expect(page.getByLabel('Batch status')).toContainText('succeeded', {
      timeout: 40000,
    });
    await expect(
      page.getByLabel('Assistant #1 result', { exact: true }),
    ).toContainText('Creative assistant:');
    await expect(
      page.getByAltText('Generated image 1', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.workflow-node.voiceover audio')).toHaveCount(1);
    const player = videoCard.locator('video');
    await expect(player).toHaveCount(1);
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await player.evaluate((element: HTMLVideoElement) => element.duration),
    ).toBeCloseTo(2, 1);
    await player.evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      return element.play();
    });
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.05);
    await player.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = 1.3;
    });
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeCloseTo(1.3, 1);
    const src = (await player.getAttribute('src'))!;
    const partial = await request.get(src, {
      headers: { Range: 'bytes=0-15' },
    });
    expect(partial.status()).toBe(206);
    expect(partial.headers()['content-range']).toMatch(/^bytes 0-15\//);
    expect((await partial.body()).length).toBe(16);
    await runAll(page);
    await expect(page.getByText('Cache hit', { exact: true })).toHaveCount(4);
    await expect(page.getByLabel('Batch status')).toContainText('succeeded');
    await videoCard
      .getByLabel('Video Generator #1 duration', { exact: true })
      .selectOption('10');
    await videoCard
      .getByLabel('Video Generator #1 aspect ratio', { exact: true })
      .selectOption('9:16');
    await videoCard
      .getByLabel('Video Generator #1 resolution', { exact: true })
      .selectOption('1080p');
    await videoCard
      .getByLabel('Video Generator #1 generate audio', { exact: true })
      .check();
    await videoCard
      .getByLabel('Model', { exact: true })
      .selectOption('veo-3-1-fast');
    await expect(
      videoCard.getByLabel('Video Generator #1 duration', { exact: true }),
    ).toHaveValue('5');
    await expect(
      videoCard.getByRole('option', { name: '10 s', exact: true }),
    ).toBeDisabled();
    await expect(
      videoCard.getByRole('option', { name: '9:16', exact: true }),
    ).toBeDisabled();
    await expect(
      videoCard.getByLabel('Video Generator #1 generate audio', {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(videoCard.getByLabel('Model', { exact: true })).toHaveValue(
      'auto',
    );
    await expect(
      videoCard.getByLabel('Video Generator #1 duration', { exact: true }),
    ).toHaveValue('10');
    await expect(
      videoCard.getByLabel('Video Generator #1 generate audio', {
        exact: true,
      }),
    ).toBeChecked();
    await page
      .getByLabel('Text #1 value', { exact: true })
      .fill('A snowy lake under the northern lights');
    await expect(
      page.getByText('Stale · inputs changed', { exact: true }),
    ).toHaveCount(4);
    await page.getByLabel('Force rerun', { exact: true }).check();
    await runAll(page);
    await page
      .getByRole('button', { name: 'Cancel batch', exact: true })
      .click();
    await expect(page.getByLabel('Batch status')).toContainText('canceled');
    await page.reload();
    await expect(videoCard.locator('video')).toHaveAttribute('src', src);
    // A saved unsupported end-image connection must block Run in the UI before a request.
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const imageRuns = await (
      await request.get(
        `/api/spaces/${id}/runs?nodeId=${image.id}&succeeded=true`,
      )
    ).json();
    const upload = node('image_upload', 2100, 0, {
      assetId: imageRuns[0].output.image[0].assetId,
    });
    space.graph.nodes.push(upload);
    space.graph.edges.push({
      id: crypto.randomUUID(),
      source: upload.id,
      sourceHandle: 'image',
      target: video.id,
      targetHandle: 'end_image',
    });
    const savedVideo = space.graph.nodes.find(
      (value: { id: string }) => value.id === video.id,
    );
    savedVideo.params = {
      ...nodeRegistry.video_generator.defaultParams,
      model: 'veo-3-1-fast',
    };
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      videoCard.getByRole('button', {
        name: 'Run Video Generator #1',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(videoCard.getByRole('alert')).toContainText(
      'does not support an end image',
    );
    await expect(
      page.getByLabel('Video Generator #1 end_image input', { exact: true }),
    ).toHaveAttribute('title', /does not support an end image/);
    await videoCard.locator('.node-title').click();
    await expect(
      page
        .locator('.node-floating-toolbar')
        .getByRole('button', { name: 'Run', exact: true }),
    ).toBeDisabled();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
