import { test, expect } from '@playwright/test';
test('model availability, capability coercion, options, undo and retired-model recovery', async ({
  page,
  request,
}) => {
  let id: string | undefined;
  try {
    await page.goto('/spaces');
    await page
      .getByLabel('New space name')
      .fill(`E2E model catalog ${Date.now()}`);
    await page.getByRole('button', { name: 'New space', exact: true }).click();
    await expect(page).toHaveURL(/\/spaces\/[a-f0-9-]+$/);
    id = new URL(page.url()).pathname.split('/').pop();
    const model = page.getByLabel('Model', { exact: true });
    await expect(
      model.getByRole('option', { name: 'Mock Image Compact', exact: true }),
    ).toHaveCount(1);
    await expect(
      model.getByRole('option', { name: /Image Studio/ }),
    ).toBeDisabled();
    await page
      .getByLabel('Image Generator #1 prompt', { exact: true })
      .fill('Model capability test');
    for (let count = 0; count < 3; count++)
      await page.getByRole('button', { name: 'Increase image count' }).click();
    await page.getByLabel('Aspect ratio', { exact: true }).selectOption('3:4');
    await page.getByLabel('Resolution', { exact: true }).selectOption('4K');
    await model.selectOption('mock-image-compact');
    await expect(page.getByLabel('Aspect ratio', { exact: true })).toHaveValue(
      '1:1',
    );
    await expect(page.getByLabel('Resolution', { exact: true })).toHaveValue(
      '1K',
    );
    await expect(page.getByLabel('Image count', { exact: true })).toContainText(
      'x1',
    );
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(model).toHaveValue('auto');
    await expect(page.getByLabel('Aspect ratio', { exact: true })).toHaveValue(
      '3:4',
    );
    await expect(page.getByLabel('Resolution', { exact: true })).toHaveValue(
      '4K',
    );
    await expect(page.getByLabel('Image count', { exact: true })).toContainText(
      'x4',
    );
    await model.selectOption('mock-image-compact');
    await page.getByText('Advanced', { exact: true }).click();
    await expect(page.getByLabel('Quality', { exact: true })).toHaveValue(
      'standard',
    );
    await page.getByLabel('Quality', { exact: true }).selectOption('draft');
    await page
      .getByRole('button', { name: 'Run Image Generator #1', exact: true })
      .click();
    await expect(
      page.getByAltText('Generated image 1', { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText('Generated with mock-image-compact', { exact: true }),
    ).toBeVisible();
    const space = await (await request.get(`/api/spaces/${id}`)).json();
    space.graph.nodes.find(
      (node: { type: string }) => node.type === 'image_generator',
    ).params.model = 'retired-saved-model';
    expect(
      (
        await request.patch(`/api/spaces/${id}`, {
          data: { version: space.version, graph: space.graph },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByText(
        'This model is unknown or removed. Please choose another model.',
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Run Image Generator #1', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Retry Image Generator #1',
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    if (id) await request.delete(`/api/spaces/${id}`);
  }
});
