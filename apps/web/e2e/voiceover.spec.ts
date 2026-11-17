import { test, expect } from '@playwright/test';
import { nodeRegistry } from '@hiveflow/shared';
test('Voiceover model coercion, script-writer workflow, audio playback, cache, stale and cancel', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.goto('/');
    await page.getByLabel('New space name').fill(`E2E voiceover ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a node' });
    await picker.getByRole('button', { name: 'Audio', exact: true }).click();
    await expect(
      picker.getByRole('option', { name: 'Voiceover', exact: true }),
    ).toHaveCount(1);
    await picker.getByRole('combobox', { name: 'Search nodes' }).fill('voice');
    await page.keyboard.press('Enter');
    const card = page.locator('.workflow-node.voiceover');
    await expect(
      card.getByRole('option', { name: 'bright', exact: true }),
    ).toHaveCount(1);
    await card.getByLabel('Model', { exact: true }).selectOption('auto');
    await page
      .getByLabel('Voiceover #1 voice', { exact: true })
      .selectOption('bright');
    await page
      .getByLabel('Voiceover #1 language', { exact: true })
      .selectOption('vi');
    await page.getByLabel('Voiceover #1 speed', { exact: true }).fill('1.5');
    await card
      .getByLabel('Model', { exact: true })
      .selectOption('mock-tts-narration');
    await expect(
      page.getByLabel('Voiceover #1 voice', { exact: true }),
    ).toHaveValue('narrator');
    await expect(
      page.getByLabel('Voiceover #1 language', { exact: true }),
    ).toHaveValue('en');
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toHaveValue('1.25');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card.getByLabel('Model', { exact: true })).toHaveValue('auto');
    await expect(
      page.getByLabel('Voiceover #1 voice', { exact: true }),
    ).toHaveValue('bright');
    await expect(
      page.getByLabel('Voiceover #1 language', { exact: true }),
    ).toHaveValue('vi');
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toHaveValue('1.5');
    await expect(
      card.getByRole('option', { name: /Voice Studio/ }),
    ).toBeDisabled();
    await page
      .getByLabel('Voiceover #1 script', { exact: true })
      .fill('Preserved local script');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    const text = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'text',
    );
    const voice = space.graph.nodes.find(
      (node: { type: string }) => node.type === 'voiceover',
    );
    text.position = { x: 60, y: 190 };
    text.params.value = 'A quiet lake at sunrise. Breathe deeply.';
    voice.position = { x: 950, y: 90 };
    const assistant = {
      id: crypto.randomUUID(),
      type: 'assistant',
      position: { x: 490, y: 90 },
      params: {
        ...nodeRegistry.assistant.defaultParams,
        message: 'Write a short narration',
        preset: 'script_writer',
      },
    };
    space.graph.nodes = [text, assistant, voice];
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
        target: voice.id,
        targetHandle: 'script',
      },
    ];
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { graph: space.graph, version: space.version },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await expect(
      page.getByLabel('Voiceover #1 script', { exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByText('Script from Assistant #1 · local script overridden'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await expect(page.getByLabel('Batch status')).toContainText('succeeded', {
      timeout: 25000,
    });
    await expect(
      page.getByLabel('Assistant #1 result', { exact: true }),
    ).toContainText('Narration script:');
    const audio = card.locator('audio');
    await expect(audio).toHaveCount(1);
    await expect
      .poll(() =>
        audio.evaluate((element: HTMLAudioElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await audio.evaluate((element: HTMLAudioElement) => element.duration),
    ).toBeGreaterThan(0);
    await audio.evaluate((element: HTMLAudioElement) => {
      element.muted = true;
      return element.play();
    });
    await expect
      .poll(() =>
        audio.evaluate((element: HTMLAudioElement) => element.currentTime),
      )
      .toBeGreaterThan(0.05);
    await audio.evaluate((element: HTMLAudioElement) => element.pause());
    await expect(
      page.getByLabel('Voiceover #1 duration', { exact: true }),
    ).toContainText('Duration 0:');
    await expect(
      page.getByLabel('Voiceover #1 script', { exact: true }),
    ).toHaveValue(
      await page.getByLabel('Assistant #1 result', { exact: true }).innerText(),
    );
    const original = await audio.getAttribute('src');
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await expect(card.getByText('Cache hit', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Batch status')).toContainText('succeeded');
    expect(await audio.getAttribute('src')).toBe(original);
    await page
      .getByLabel('Text #1 value', { exact: true })
      .fill('A new sunrise over the lake');
    await expect(
      page.getByText('Stale · inputs changed', { exact: true }),
    ).toHaveCount(2);
    await page.getByLabel('Force rerun', { exact: true }).check();
    await page.getByRole('button', { name: 'Run all', exact: true }).click();
    await page
      .getByRole('button', { name: 'Cancel batch', exact: true })
      .click();
    await expect(page.getByLabel('Batch status')).toContainText('canceled');
    await page.reload();
    await expect(card.locator('audio')).toHaveAttribute('src', original!);
    // Disconnecting restores the preserved editable local script.
    const saved = await (await request.get(`/api/spaces/${id}`)).json();
    saved.graph.edges = saved.graph.edges.filter(
      (edge: { target: string }) => edge.target !== voice.id,
    );
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { graph: saved.graph, version: saved.version },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByLabel('Voiceover #1 script', { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel('Voiceover #1 script', { exact: true }),
    ).toHaveValue('Preserved local script');
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
