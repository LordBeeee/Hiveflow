import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { libraryItemSchema } from '@hiveflow/shared';

const spaceIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const items = Array.from({ length: 25 }, (_, index) => {
  const kind = (['image', 'video', 'audio'] as const)[index % 3];
  return libraryItemSchema.parse({
    spaceName: index % 2 ? 'Product photography' : 'Summer campaign',
    asset: {
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      spaceId: spaceIds[index % 2],
      kind,
      url: `/api/assets/aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      mime: { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' }[
        kind
      ],
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      createdAt: '2026-11-20T02:00:00Z',
      ...(kind === 'audio'
        ? { width: null, height: null, durationMs: 1000 }
        : { width: 320, height: 180 }),
    },
  });
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const wav = Buffer.alloc(16044);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(16000, 40);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/spaces')
      return route.fulfill({
        json: spaceIds.map((id, index) => ({
          id,
          name: index ? 'Product photography' : 'Summer campaign',
          version: 1,
          createdAt: '2026-11-20T02:00:00Z',
          updatedAt: '2026-11-20T02:00:00Z',
        })),
      });
    if (url.pathname === '/api/assets') {
      const filtered = items.filter(
        (item) =>
          (!url.searchParams.get('kind') ||
            item.asset.kind === url.searchParams.get('kind')) &&
          (!url.searchParams.get('spaceId') ||
            item.asset.spaceId === url.searchParams.get('spaceId')),
      );
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return route.fulfill({
        json: {
          items: filtered.slice(offset, offset + 24),
          total: filtered.length,
          offset,
          limit: 24,
        },
      });
    }
    const item = items.find((item) => url.pathname.endsWith(item.asset.id));
    if (!item) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: item.asset.mime,
      headers: {
        'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="library-fixture.${item.asset.kind === 'image' ? 'png' : item.asset.kind === 'video' ? 'mp4' : 'wav'}"`,
      },
      body:
        item.asset.kind === 'image'
          ? png
          : item.asset.kind === 'video'
            ? readFileSync('../api/assets/mock-video.mp4')
            : wav,
    });
  });
});

test('Library replaces sidebar search, paginates, filters and previews playable media', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/spaces');
  await expect(
    page.getByRole('button', { name: 'Search spaces', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Search spaces' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByRole('link', { name: 'Library', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.library-card')).toHaveCount(24);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(9);
  await page
    .getByRole('combobox', { name: 'Filter by Space' })
    .selectOption(spaceIds[0]);
  await expect(page.locator('.library-card')).toHaveCount(5);
  const card = page.locator('.library-card').first();
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Image preview' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Open source Space' }),
  ).toHaveAttribute('href', `/spaces/${spaceIds[0]}`);
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Download' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('library-fixture.png');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
  await page
    .getByRole('combobox', { name: 'Filter by Space' })
    .selectOption('');
  for (const [tab, tag] of [
    ['Videos', 'video'],
    ['Audio', 'audio'],
  ]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.locator('.library-card').first().click();
    const media = page.locator(`dialog ${tag}`);
    await expect
      .poll(() => media.evaluate((el) => (el as HTMLMediaElement).readyState))
      .toBeGreaterThanOrEqual(2);
    await media.evaluate((el) => (el as HTMLMediaElement).play());
    await expect
      .poll(() => media.evaluate((el) => (el as HTMLMediaElement).currentTime))
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.screenshot({ path: 'test-results/library-desktop.png' });
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/library-mobile.png' });
  await page.locator('.library-card').first().click();
  await expect(
    page.getByRole('button', { name: 'Close preview' }),
  ).toBeInViewport();
  await page.screenshot({ path: 'test-results/library-preview-mobile.png' });
  expect(errors).toEqual([]);
});

test('Library shows empty and error states and supports retry', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/assets?*', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { message: 'Library temporarily unavailable' },
        })
      : route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 24 } }),
  );
  await page.goto('/library');
  await expect(page.getByRole('alert')).toContainText(
    'Library temporarily unavailable',
  );
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Your library starts here.')).toBeVisible();
  await page.getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(page.getByText('No matching media yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});
