import { test, expect } from '@playwright/test';
test('keyboard picker inserts and undoes one node, filters categories and traps focus', async ({
  page,
  request,
}) => {
  let spaceId: string | undefined;
  try {
    await page.goto('/');
    await page.getByLabel('New space name').fill(`E2E picker ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    spaceId = new URL(page.url()).pathname.split('/').pop();
    await expect(
      page.getByLabel('Text #1 value', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('n');
    const picker = page.getByRole('dialog', { name: 'Add a node' });
    const search = picker.getByRole('combobox', { name: 'Search nodes' });
    await expect(search).toBeFocused();
    await search.fill('tex');
    await expect(picker.getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(picker).not.toBeVisible();
    await expect(page.getByLabel('Text #2 value', { exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole('button', { name: 'Add node', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Text #2 value', { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel('Text #1 value', { exact: true })).toHaveCount(
      1,
    );
    await page.getByLabel('Text #1 value', { exact: true }).focus();
    await page.keyboard.press('n');
    await expect(picker).not.toBeVisible();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await expect(
      picker.getByRole('button', { name: 'Video', exact: true }),
    ).toHaveCount(1);
    await picker.getByRole('button', { name: 'Image', exact: true }).click();
    await expect(picker.getByRole('option')).toHaveCount(2);
    await search.fill('text');
    await expect(
      picker.getByText('No nodes match "text"', { exact: true }),
    ).toBeVisible();
    await search.fill('');
    await picker.getByRole('button', { name: 'All', exact: true }).click();
    await page.keyboard.press('ArrowUp');
    await expect(
      picker.getByRole('option', { name: 'Voiceover', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(
      picker.getByRole('option', { name: 'Assistant', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(
      picker.getByRole('button', { name: 'Text', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add node', exact: true }),
    ).toBeFocused();
  } finally {
    if (spaceId) await request.delete(`/api/spaces/${spaceId}`);
  }
});
test('dropping an input on empty canvas filters compatible nodes and inserts an atomic connection', async ({
  page,
  request,
}) => {
  let spaceId: string | undefined;
  try {
    await page.goto('/');
    await page
      .getByLabel('New space name')
      .fill(`E2E edge picker ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    spaceId = new URL(page.url()).pathname.split('/').pop();
    const from = page.getByLabel('Image Generator #1 prompt input', {
      exact: true,
    });
    await expect(from).toBeVisible();
    const bounds = (await from.boundingBox())!;
    const point = { x: 1110, y: 615 };
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(point.x, point.y, { steps: 15 });
    await page.mouse.up();
    const picker = page.getByRole('dialog', { name: 'Add a node' });
    await expect(
      picker.getByRole('combobox', { name: 'Search nodes' }),
    ).toBeFocused();
    await expect(
      picker.getByText('COMPATIBLE NODES', { exact: true }),
    ).toBeVisible();
    await expect(picker.getByRole('option')).toHaveCount(2);
    await picker.getByRole('option', { name: 'Text', exact: true }).click();
    await expect(page.getByLabel('Text #2 value', { exact: true })).toHaveCount(
      1,
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const nodeBounds = (await page
      .locator('.react-flow__node')
      .filter({ has: page.getByLabel('Text #2 value', { exact: true }) })
      .boundingBox())!;
    expect(nodeBounds.x).toBeCloseTo(point.x, 0);
    expect(nodeBounds.y).toBeCloseTo(point.y, 0);
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Text #2 value', { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  } finally {
    if (spaceId) await request.delete(`/api/spaces/${spaceId}`);
  }
});
