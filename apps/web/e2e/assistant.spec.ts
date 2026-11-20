import { runAll } from './helpers';
import { test, expect } from '@playwright/test';
test('Assistant picker, chained Run all, copy, cache, stale and cancel', async ({
  page,
  request,
  context,
}) => {
  let id: string | undefined;
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/spaces');
    await page.getByLabel('New space name').fill(`E2E assistant ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a node' });
    await picker.getByRole('combobox', { name: 'Search nodes' }).fill('assist');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await expect(picker.getByText('New', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Assistant #1 message')).toBeVisible();
    await page.getByLabel('Assistant #1 message').fill('Make it cinematic');
    await page
      .getByLabel('Assistant #1 preset')
      .selectOption('prompt_improver');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    // Position the three cards and connect the saved graph; browser checks execute the workflow.
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const text = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'text',
    );
    const assistant = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'assistant',
    );
    const image = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'image_generator',
    );
    text.position = { x: 80, y: 170 };
    assistant.position = { x: 490, y: 90 };
    image.position = { x: 940, y: 100 };
    space.graph.edges = [
      {
        id: crypto.randomUUID(),
        source: text.id,
        sourceHandle: 'text',
        target: assistant.id,
        targetHandle: 'context',
      },
      {
        id: crypto.randomUUID(),
        source: assistant.id,
        sourceHandle: 'text',
        target: image.id,
        targetHandle: 'prompt',
      },
    ];
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    const assistantCard = page.locator('.workflow-node.assistant');
    await expect(
      assistantCard.getByLabel('Model', { exact: true }),
    ).toHaveValue('auto');
    await expect(
      assistantCard.getByRole('option', { name: /Assistant Studio/ }),
    ).toBeDisabled();
    await runAll(page);
    await expect(page.getByLabel('Batch status')).toContainText('succeeded', {
      timeout: 25000,
    });
    const result = page.getByLabel('Assistant #1 result', { exact: true });
    await expect(result).toContainText('Improved prompt:');
    await expect(result).toContainText('Make it cinematic');
    await expect(
      page.getByAltText('Generated image 1', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Image Generator #1 prompt', { exact: true }),
    ).toHaveValue(await result.innerText());
    await page
      .getByRole('button', { name: 'Copy Assistant #1 result', exact: true })
      .click();
    await expect(
      assistantCard.getByText('Copied', { exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n/g,
        '\n',
      ),
    ).toBe(await result.innerText());
    await runAll(page);
    await expect(
      assistantCard.getByText('Cache hit', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Batch status')).toContainText('succeeded');
    await page
      .getByLabel('Text #1 value', { exact: true })
      .fill('A snowy mountain cabin');
    await expect(
      page.getByText('Stale · inputs changed', { exact: true }),
    ).toHaveCount(2);
    await page.getByLabel('Force rerun', { exact: true }).check();
    await runAll(page);
    await page
      .getByRole('button', { name: 'Cancel batch', exact: true })
      .click();
    await expect(page.getByLabel('Batch status')).toContainText('canceled');
    await page.reload();
    await expect(
      page.getByLabel('Assistant #1 result', { exact: true }),
    ).toContainText('Improved prompt:');
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
