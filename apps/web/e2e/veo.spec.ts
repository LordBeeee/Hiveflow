import { test, expect } from '@playwright/test';
import { nodeRegistry, type AvailableModel } from '@hiveflow/shared';
test('Veo supports text-only and first/last frames with explicit ratio, duration/audio and Fast resolution limits', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.route('**/api/models*', async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as AvailableModel[];
      for (const row of rows) if (row.provider === 'veo') row.available = true;
      await route.fulfill({ response, json: rows });
    });
    await page.goto('/spaces');
    await page.getByLabel('New space name').fill(`E2E Veo ${Date.now()}`);
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
        model: 'veo-3-1',
        duration: 4,
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
    await expect(run).toBeEnabled();
    await expect(
      card.getByLabel('Video Generator #1 prompt', { exact: true }),
    ).toHaveAttribute('maxlength', '2500');
    await card
      .getByLabel('Video Generator #1 resolution', { exact: true })
      .selectOption('4k');
    await card
      .getByLabel('Video Generator #1 duration', { exact: true })
      .selectOption('8');
    await card
      .getByLabel('Video Generator #1 aspect ratio', { exact: true })
      .selectOption('9:16');
    await card
      .getByLabel('Video Generator #1 generate audio', { exact: true })
      .check();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const saved = await (await request.get(`/api/spaces/${id}`)).json();
    saved.graph.edges = [
      {
        id: crypto.randomUUID(),
        source: image.id,
        sourceHandle: 'image',
        target: video.id,
        targetHandle: 'end_image',
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
    await expect(run).toBeDisabled();
    const connected = await (await request.get(`/api/spaces/${id}`)).json();
    connected.graph.edges.push({
      id: crypto.randomUUID(),
      source: image.id,
      sourceHandle: 'image',
      target: video.id,
      targetHandle: 'start_image',
    });
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: connected.version, graph: connected.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(run).toBeEnabled();
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toHaveValue('9:16');
    await card
      .getByLabel('Model', { exact: true })
      .selectOption('veo-3-1-fast');
    await expect(
      card.getByLabel('Video Generator #1 resolution', { exact: true }),
    ).toHaveValue('720p');
    await expect(
      card
        .getByLabel('Video Generator #1 resolution', { exact: true })
        .getByRole('option', { name: '4k', exact: true }),
    ).toBeDisabled();
    await card
      .getByLabel('Video Generator #1 duration', { exact: true })
      .selectOption('6');
    await expect(
      card.getByLabel('Video Generator #1 generate audio', { exact: true }),
    ).toBeChecked();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
