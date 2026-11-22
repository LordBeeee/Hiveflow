import { test, expect } from '@playwright/test';
import { creationHistorySchema } from '@hiveflow/shared';

// The isolated harness registers mocks only and uses a disposable database schema.
const api = process.env.CREATIONS_TEST_API;
test.skip(
  !api,
  'Start smoke-creations.mjs --serve and set CREATIONS_TEST_API.',
);
test('tool links open forms without creating Spaces; image upload, generation, history and Library work', async ({
  page,
}) => {
  const errors: string[] = [];
  const spaceWrites: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (
      req.method() === 'POST' &&
      new URL(req.url()).pathname === '/api/spaces'
    )
      spaceWrites.push(req.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Create image', exact: true }).click();
  await expect(page).toHaveURL(/\/create\/image$/);
  await expect(
    page.getByRole('heading', { name: 'Create image', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.react-flow')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Image', exact: true }).first(),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('button', { name: 'Generate image', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption('mock-image');
  await page
    .getByLabel('Prompt', { exact: true })
    .fill(`Image E2E ${Date.now()}: a cabin by a lake`);
  await page
    .getByLabel('Reference images', { exact: true })
    .setInputFiles('public/brand/hiveflow-icon-transparent.png');
  await expect(page.locator('.creation-reference-list img')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Generate image', exact: true }),
  ).toBeEnabled();
  const imageResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/creations/image/runs',
  );
  await page
    .getByRole('button', { name: 'Generate image', exact: true })
    .click();
  const imageRunId = (await (await imageResponse).json()).runId;
  await expect
    .poll(async () => {
      const history = creationHistorySchema.parse(
        await (await page.request.get(`${api}/creations/image/runs`)).json(),
      );
      return history.runs.find((run) => run.runId === imageRunId)?.status;
    })
    .toBe('succeeded');
  await expect(page.locator('.creation-history-item.selected')).toContainText(
    'succeeded',
  );
  await expect(page.locator('.creation-history-item').first()).toContainText(
    'Image E2E',
  );
  await expect(page.getByAltText('Generated image')).toBeVisible({
    timeout: 15000,
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({ path: 'test-results/creation-image-desktop.png' });
  await page.reload();
  await expect(page.getByAltText('Generated image')).toBeVisible();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue(
    /Image E2E/,
  );
  await page.getByRole('button', { name: 'Use selected settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings restored');
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/creation-image-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Create something new' }).click();
  await page
    .locator('#workspace-popover')
    .getByRole('link', { name: 'Voice', exact: true })
    .click();
  await expect(page).toHaveURL(/\/create\/audio$/);
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption('mock-tts');
  await page
    .getByLabel('Script', { exact: true })
    .fill(`Voice E2E ${Date.now()}: welcome to the studio.`);
  await expect(
    page.getByRole('button', { name: 'Generate voice', exact: true }),
  ).toBeEnabled();
  const voiceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/creations/audio/runs',
  );
  await page
    .getByRole('button', { name: 'Generate voice', exact: true })
    .click();
  const voiceRunId = (await (await voiceResponse).json()).runId;
  await expect
    .poll(async () => {
      const history = creationHistorySchema.parse(
        await (await page.request.get(`${api}/creations/audio/runs`)).json(),
      );
      return history.runs.find((run) => run.runId === voiceRunId)?.status;
    })
    .toBe('succeeded');
  await expect(page.locator('.creation-history-item.selected')).toContainText(
    'succeeded',
  );
  await expect(page.locator('.creation-history-item').first()).toContainText(
    'Voice E2E',
  );
  const audio = page.locator('.creation-output audio');
  await expect(audio).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLMediaElement).readyState))
    .toBeGreaterThanOrEqual(2);
  await audio.evaluate((el) => (el as HTMLMediaElement).play());
  await expect
    .poll(() => audio.evaluate((el) => (el as HTMLMediaElement).currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-card')).not.toHaveCount(0);
  await page.locator('.library-card').first().click();
  await expect(page.getByRole('link', { name: /Open .* tool/ })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open source Space' }),
  ).toHaveCount(0);
  expect(spaceWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test('standalone video generates a playable result and never navigates to a canvas', async ({
  page,
}) => {
  await page.goto('/create/video');
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption('mock-video');
  await page
    .getByLabel('Prompt', { exact: true })
    .fill(`Video E2E ${Date.now()}: a slow pan across a quiet lake`);
  await expect(page.getByLabel('End image', { exact: true })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Generate video', exact: true }),
  ).toBeEnabled();
  const videoResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/creations/video/runs',
  );
  await page
    .getByRole('button', { name: 'Generate video', exact: true })
    .click();
  const videoRunId = (await (await videoResponse).json()).runId;
  await expect
    .poll(async () => {
      const history = creationHistorySchema.parse(
        await (await page.request.get(`${api}/creations/video/runs`)).json(),
      );
      return history.runs.find((run) => run.runId === videoRunId)?.status;
    })
    .toBe('succeeded');
  await expect(page.locator('.creation-history-item.selected')).toContainText(
    'succeeded',
  );
  await expect(page.locator('.creation-history-item').first()).toContainText(
    'Video E2E',
  );
  const video = page.locator('.creation-output video');
  await expect(video).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLMediaElement).readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((el) => (el as HTMLMediaElement).play());
  await expect
    .poll(() => video.evaluate((el) => (el as HTMLMediaElement).currentTime))
    .toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/create\/video$/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/creation-video-desktop.png',
    fullPage: true,
  });
  const response = await page.request.get(`${api}/creations/video/runs`);
  expect(
    creationHistorySchema.parse(await response.json()).runs[0].status,
  ).toBe('succeeded');
});
