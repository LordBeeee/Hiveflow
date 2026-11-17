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
    await expect(picker.getByRole('option')).toHaveCount(1);
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
    ).toHaveCount(0);
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
      picker.getByRole('option', { name: 'Text', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(
      picker.getByRole('option', { name: 'Image Generator', exact: true }),
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
