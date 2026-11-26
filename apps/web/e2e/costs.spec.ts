import { test, expect } from '@playwright/test';
test.skip(
  !process.env.CREATIONS_TEST_API,
  'Start the isolated offline API harness and set CREATIONS_TEST_API.',
);

test('Run all reviews cost before admission, cancel is free, cache costs zero and limits are visible', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.goto('/spaces');
    await page
      .getByLabel('New space name')
      .fill(`E2E cost review ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    await page
      .getByLabel('Image Generator #1 prompt', { exact: true })
      .fill('A calm lake for cost review');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Run Image Generator #1', exact: true }),
    ).toHaveAttribute('title', /4 estimated credits/);
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Review estimated cost',
      exact: true,
    });
    await expect(dialog).toContainText('4 estimated credits');
    await expect(dialog).toContainText('provider pricing may differ');
    expect(
      (await (await request.get(`/api/spaces/${id}/runs`)).json()).length,
    ).toBe(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (await (await request.get(`/api/spaces/${id}/runs`)).json()).length,
    ).toBe(0);
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Confirm run', exact: true })
      .click();
    await expect(page.getByLabel('Batch status')).toContainText('succeeded', {
      timeout: 25000,
    });
    await expect(
      page.getByAltText('Generated image 1', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await expect(dialog).toContainText('0 estimated credits');
    await expect(dialog).toContainText('1 cached');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const source = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'image_generator',
    );
    for (let index = 0; index < 100; index++)
      space.graph.nodes.push({
        ...source,
        id: crypto.randomUUID(),
        position: { x: 1000 + index * 20, y: 1000 },
        params: { ...source.params, prompt: `Limit fixture ${index}` },
      });
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByLabel('Force rerun', { exact: true }).check();
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('provider nodes');
    await expect(
      dialog.getByRole('button', { name: 'Confirm run', exact: true }),
    ).toBeDisabled();
    expect(
      (
        await request.post(`/api/spaces/${id}/run`, { data: { force: true } })
      ).status(),
    ).toBe(422);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
