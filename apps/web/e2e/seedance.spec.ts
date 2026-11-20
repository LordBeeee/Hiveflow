import { test, expect } from '@playwright/test';
import { nodeRegistry, type AvailableModel } from '@hiveflow/shared';
test('Seedance controls support 4K/30s, adaptive frame ratio and end-frame validation without generation', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.route('**/api/models*', async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as AvailableModel[];
      for (const row of rows)
        if (row.provider === 'seedance') row.available = true;
      await route.fulfill({ response, json: rows });
    });
    await page.goto('/spaces');
    await page.getByLabel('New space name').fill(`E2E Seedance ${Date.now()}`);
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
        model: 'seedance-2-5',
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
    await card
      .getByLabel('Video Generator #1 duration', { exact: true })
      .selectOption('30');
    await card
      .getByLabel('Video Generator #1 resolution', { exact: true })
      .selectOption('4k');
    await card
      .getByLabel('Video Generator #1 aspect ratio', { exact: true })
      .selectOption('21:9');
    await expect(
      card.getByLabel('Video Generator #1 prompt', { exact: true }),
    ).toHaveAttribute('maxlength', '2500');
    await expect(
      card.getByText(
        'This model does not accept images containing real people.',
      ),
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Run Video Generator #1', exact: true }),
    ).toBeEnabled();
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
    await expect(
      card.getByRole('button', { name: 'Run Video Generator #1', exact: true }),
    ).toBeDisabled();
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
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toHaveValue('adaptive');
    await card
      .getByLabel('Model', { exact: true })
      .selectOption('seedance-2-0');
    await expect(
      card.getByLabel('Video Generator #1 duration', { exact: true }),
    ).toHaveValue('15');
    await expect(
      card.getByLabel('Video Generator #1 aspect ratio', { exact: true }),
    ).toBeEnabled();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
