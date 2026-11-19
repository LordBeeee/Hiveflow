import { test, expect } from '@playwright/test';
import { nodeRegistry, type AvailableModel } from '@hiveflow/shared';
test('Kling requires start, derives ratio and gates turbo audio/end-frame/4k without generation', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.route('**/api/models*', async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as AvailableModel[];
      for (const row of rows)
        if (row.provider === 'kling') row.available = true;
      await route.fulfill({ response, json: rows });
    });
    await page.goto('/');
    await page.getByLabel('New space name').fill(`E2E Kling ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const image = space.graph.nodes.find(
      (n: { type: string }) => n.type === 'image_generator',
    );
    const video = {
      id: crypto.randomUUID(),
      type: 'video_generator',
      position: { x: 500, y: 50 },
      params: {
        ...nodeRegistry.video_generator.defaultParams,
        model: 'kling-3-0-turbo',
        aspectRatio: 'adaptive',
        generateAudio: true,
        prompt: 'Landscape',
      },
    };
    space.graph.nodes = [image, video];
    space.graph.edges = [];
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    const card = page.locator('.workflow-node.video_generator');
    const run = card.getByRole('button', {
      name: 'Run Video Generator #1',
      exact: true,
    });
    await expect(run).toBeDisabled();
    await expect(
      card.getByLabel('Video Generator #1 prompt', { exact: true }),
    ).toHaveAttribute('maxlength', '2500');
    await expect(
      card.getByLabel('Video Generator #1 generate audio', { exact: true }),
    ).toHaveCount(0);
    await expect(
      card
        .getByLabel('Video Generator #1 resolution', { exact: true })
        .getByRole('option', { name: '4k', exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByText(
        'Cancel stops local processing. The provider task cannot be canceled and may still be billed.',
      ),
    ).toBeVisible();
    const connected = await (await request.get(`/api/spaces/${id}`)).json();
    connected.graph.edges = ['start_image', 'end_image'].map(
      (targetHandle) => ({
        id: crypto.randomUUID(),
        source: image.id,
        sourceHandle: 'image',
        target: video.id,
        targetHandle,
      }),
    );
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: connected.version, graph: connected.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(run).toBeDisabled();
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toHaveValue('adaptive');
    await card.getByLabel('Model', { exact: true }).selectOption('kling-3-0');
    await expect(run).toBeEnabled();
    await expect(
      card.getByLabel('Video Generator #1 prompt', { exact: true }),
    ).toHaveAttribute('maxlength', '3072');
    await expect(
      card.getByLabel('Video Generator #1 generate audio', { exact: true }),
    ).toBeChecked();
    await card
      .getByLabel('Video Generator #1 resolution', { exact: true })
      .selectOption('4k');
    await card
      .getByLabel('Video Generator #1 duration', { exact: true })
      .selectOption('15');
    await card
      .getByLabel('Model', { exact: true })
      .selectOption('kling-3-0-turbo');
    await expect(
      card.getByLabel('Video Generator #1 resolution', { exact: true }),
    ).toHaveValue('720p');
    await expect(run).toBeDisabled();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
