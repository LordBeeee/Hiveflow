import { test, expect, type Page } from '@playwright/test';
import { creationHistorySchema, nodeRegistry } from '@hiveflow/shared';

// The isolated harness uses production adapters with offline HTTP responses only and uses a disposable database schema.
const api = process.env.CREATIONS_TEST_API;
test.skip(
  !api,
  'Start smoke-creations.mjs --serve and set CREATIONS_TEST_API.',
);
async function chooseModel(page: Page, id: string) {
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  const picker = page.getByRole('dialog');
  const search = picker.getByRole('textbox', { name: 'Search models' });
  await expect(search).toBeFocused();
  await search.fill(id);
  await picker
    .locator('.model-picker-card')
    .filter({
      has: page
        .locator('.model-picker-description')
        .filter({ hasText: new RegExp(`^${id}$`) }),
    })
    .click();
  await expect(picker).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Choose model', exact: true }),
  ).toBeFocused();
}

test('blank and legacy Auto selections require an explicit model without losing drafts', async ({
  page,
  request,
}) => {
  const tools = [
    {
      kind: 'image',
      type: 'image_generator',
      model: 'bytedance-seed/seedream-4.5',
    },
    { kind: 'video', type: 'video_generator', model: 'seedance-2-0' },
    { kind: 'audio', type: 'voiceover', model: 'elevenlabs/eleven-v4' },
  ] as const;
  await page.addInitScript(
    (drafts) => {
      for (const draft of drafts)
        localStorage.setItem(
          `creation-draft:${draft.kind}`,
          JSON.stringify({ params: draft.params }),
        );
    },
    tools.map((tool) => ({
      kind: tool.kind,
      params: {
        ...nodeRegistry[tool.type].defaultParams,
        model: 'auto',
        [tool.kind === 'audio' ? 'script' : 'prompt']: 'Keep my existing draft',
      },
    })),
  );
  for (const tool of tools) {
    await page.goto(`/create/${tool.kind}`);
    const field = page.getByLabel(tool.kind === 'audio' ? 'Script' : 'Prompt', {
      exact: true,
    });
    await expect(field).toHaveValue('Keep my existing draft');
    const generate = page.getByRole('button', {
      name: `Generate ${tool.kind === 'audio' ? 'voice' : tool.kind}`,
      exact: true,
    });
    await expect(generate).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Choose model', exact: true }),
    ).toContainText('Choose a model');
    await page
      .getByRole('button', { name: 'Choose model', exact: true })
      .click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /Automatic/ }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await chooseModel(page, tool.model);
    await expect(generate).toBeEnabled();
    await expect(field).toHaveValue('Keep my existing draft');
  }
  const graph = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [],
    nodes: [
      {
        id: crypto.randomUUID(),
        type: 'image_generator',
        position: { x: 0, y: 0 },
        params: {
          ...nodeRegistry.image_generator.defaultParams,
          prompt: 'Preserve this workflow',
        },
      },
    ],
  };
  const response = await request.post('/api/spaces', {
    data: { name: 'Explicit model selection check', graph },
  });
  expect(response.ok()).toBe(true);
  const space = await response.json();
  try {
    await page.goto(`/spaces/${space.id}`);
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
    await expect(
      page.getByRole('button', { name: 'Run Image Generator #1', exact: true }),
    ).toBeDisabled();
    const batch = await request.post(`/api/spaces/${space.id}/run`, {
      data: {},
    });
    expect(batch.status()).toBe(422);
    expect(
      await (await request.get(`/api/spaces/${space.id}/runs`)).json(),
    ).toEqual([]);
    const saved = await (await request.get(`/api/spaces/${space.id}`)).json();
    saved.graph.nodes[0].params.model = 'auto';
    expect(
      (
        await request.patch(`/api/spaces/${space.id}`, {
          data: { graph: saved.graph, version: saved.version },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
    await expect(
      page.getByRole('button', { name: 'Run Image Generator #1', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel('Image Generator #1 prompt', { exact: true }),
    ).toHaveValue('Preserve this workflow');
  } finally {
    await request.delete(`/api/spaces/${space.id}`);
  }
});

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
  await chooseModel(page, 'bytedance-seed/seedream-4.5');
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
  await chooseModel(page, 'elevenlabs/eleven-v4');
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
  await chooseModel(page, 'seedance-2-0');
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
