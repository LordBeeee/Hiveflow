import { expect, type Page } from '@playwright/test';
export async function runAll(page: Page) {
  await page.getByRole('button', { name: 'Run all', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Review estimated cost',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Confirm run', exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
