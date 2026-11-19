import { test, expect } from '@playwright/test';
import { nodeRegistry, type AvailableModel } from '@hiveflow/shared';
test('provider capabilities disable speed, require start image and derive adaptive ratio', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.route('**/api/models*', async (route) => {
      const response = await route.fetch();
      const models = (await response.json()) as AvailableModel[];
      for (const model of models) {
        if (model.id === 'mock-tts')
          model.capabilities = {
            ...model.capabilities,
            supportsSpeed: false,
            maxInputChars: 3,
          };
        if (model.id === 'mock-video')
          model.capabilities = {
            ...model.capabilities,
            requiresStartImage: true,
            imageToVideoRatio: 'adaptive',
            audio: 'included',
            maxPromptChars: 4,
          };
      }
      await route.fulfill({ response, json: models });
    });
    await page.goto('/');
    await page
      .getByLabel('New space name')
      .fill(`E2E provider capabilities ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const image = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'image_generator',
    );
    const voice = {
      id: crypto.randomUUID(),
      type: 'voiceover',
      position: { x: 50, y: 50 },
      params: { ...nodeRegistry.voiceover.defaultParams, model: 'mock-tts' },
    };
    const video = {
      id: crypto.randomUUID(),
      type: 'video_generator',
      position: { x: 520, y: 50 },
      params: {
        ...nodeRegistry.video_generator.defaultParams,
        model: 'mock-video',
      },
    };
    space.graph.nodes = [image, voice, video];
    space.graph.edges = [];
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel('Voiceover #1 script', { exact: true }),
    ).toHaveAttribute('maxlength', '3');
    await expect(
      page.getByLabel('Video Generator #1 prompt', { exact: true }),
    ).toHaveAttribute('maxlength', '4');
    await expect(
      page.getByRole('button', { name: 'Run Video Generator #1', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel('Video Generator #1 generate audio', { exact: true }),
    ).toHaveCount(0);
    const saved = await (await request.get(`/api/spaces/${id}`)).json();
    saved.graph.edges = [
      {
        id: crypto.randomUUID(),
        source: image.id,
        sourceHandle: 'image',
        target: video.id,
        targetHandle: 'start_image',
      },
    ];
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: saved.version, graph: saved.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toHaveValue('adaptive');
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
