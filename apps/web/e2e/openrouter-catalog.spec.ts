import { test, expect } from '@playwright/test';
import { type AvailableModel } from '@hiveflow/shared';
test('chosen catalog exposes constrained image settings and correct speech controls without paid calls', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.route('**/api/models*', async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as AvailableModel[];
      for (const row of rows)
        if (row.provider === 'openrouter' && row.status !== 'removed')
          row.available = true;
      await route.fulfill({ response, json: rows });
    });
    await page.goto('/');
    await page
      .getByLabel('New space name')
      .fill(`E2E chosen catalog ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    const card = page.locator('.workflow-node.image_generator');
    const model = card.getByLabel('Model', { exact: true });
    await model.selectOption('bytedance-seed/seedream-5-0-lite');
    await expect(card.getByLabel('Resolution', { exact: true })).toHaveValue(
      '2K',
    );
    await model.selectOption('bytedance-seed/seedream-5-0-pro');
    await expect(
      card.getByRole('button', { name: 'Increase image count' }),
    ).toBeDisabled();
    await card.getByLabel('Resolution', { exact: true }).selectOption('1.5K');
    await card.getByLabel('Aspect ratio', { exact: true }).selectOption('21:9');
    await model.selectOption('google/gemini-3.1-flash-image');
    await card.getByLabel('Resolution', { exact: true }).selectOption('512');
    await model.selectOption('openai/gpt-image-2.5-flare');
    await expect(card.getByLabel('Resolution', { exact: true })).toBeDisabled();
    await expect(card.getByLabel('Resolution', { exact: true })).toContainText(
      'Provider default',
    );
    await card.getByText('Advanced', { exact: true }).click();
    await card.getByLabel('Quality', { exact: true }).selectOption('max');
    await expect(
      model.locator('option[value="openai/gpt-image-1"]'),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add a node' })
      .getByRole('combobox', { name: 'Search nodes' })
      .fill('voiceover');
    await page.keyboard.press('Enter');
    const voice = page.locator('.workflow-node.voiceover');
    await voice
      .getByLabel('Model', { exact: true })
      .selectOption('elevenlabs/eleven-v4');
    await expect(
      page.getByLabel('Voiceover #1 voice', { exact: true }),
    ).toHaveValue('george');
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toBeDisabled();
    await voice
      .getByLabel('Model', { exact: true })
      .selectOption('elevenlabs/eleven-flash-v2.5');
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toHaveAttribute('min', '0.7');
    await page.getByLabel('Voiceover #1 speed', { exact: true }).fill('0.7');
    await voice
      .getByLabel('Model', { exact: true })
      .selectOption('elevenlabs/eleven-turbo-v2');
    await expect(
      page.getByLabel('Voiceover #1 language', { exact: true }),
    ).toHaveValue('en');
    await voice
      .getByLabel('Model', { exact: true })
      .selectOption('google/gemini-3.8-flash-tts');
    await expect(
      page.getByLabel('Voiceover #1 voice', { exact: true }),
    ).toHaveValue('Zephyr');
    await expect(
      page.getByLabel('Voiceover #1 speed', { exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
