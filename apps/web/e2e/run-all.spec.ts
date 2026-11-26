import { runAll } from './helpers';
import { test, expect } from '@playwright/test';

test.skip(
  !process.env.CREATIONS_TEST_API,
  'Start the isolated offline API harness and set CREATIONS_TEST_API.',
);

test('create Space, connect Text, Run all, cache, stale and cancel', async ({
  page,
  request,
}) => {
  let spaceId: string | undefined;
  try {
    await page.goto('/spaces');
    await page.getByLabel('New space name').fill(`E2E execution ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    spaceId = new URL(page.url()).pathname.split('/').pop();
    await page
      .getByLabel('Text #1 value', { exact: true })
      .fill('A cabin beside a quiet lake at sunrise');
    const from = await page
      .getByLabel('Text #1 text output', { exact: true })
      .boundingBox();
    const to = await page
      .getByLabel('Image Generator #1 prompt input', { exact: true })
      .boundingBox();
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(
      page.getByText('Prompt from Text #1 · local prompt overridden'),
    ).toBeVisible();
    await runAll(page);
    await expect(page.getByLabel('Batch status')).toContainText('succeeded', {
      timeout: 25000,
    });
    await expect(
      page.getByAltText('Generated image 1', { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByAltText('Generated image 1')
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    ).toBe(true);
    await runAll(page);
    await expect(page.getByText('Cache hit', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByLabel('Batch status')).toContainText('succeeded');
    await page
      .getByLabel('Text #1 value', { exact: true })
      .fill('A snowy cabin under the northern lights');
    await expect(
      page.getByText('Stale · inputs changed', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Force rerun', { exact: true }).check();
    await runAll(page);
    await page
      .getByRole('button', { name: 'Cancel batch', exact: true })
      .click();
    await expect(page.getByLabel('Batch status')).toContainText('canceled');
  } finally {
    // This fixture is generated solely by this test.
    if (spaceId) await request.delete(`/api/spaces/${spaceId}`);
  }
});
