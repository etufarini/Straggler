import { expect, test } from '@playwright/test';

test('memory summary uses actual context and opens the context setting', async ({ page }) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: /^Choose model · / }).click();
  await expect(page.locator('.model-list')).toContainText('Memory unknown');
  await expect(
    page.getByText('Estimate from the file size and detected memory;', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load model', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');
  await page.locator('.local-badge').click();
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await expect(memory).toContainText('4,096');
  await expect(memory).toContainText('Layers on the GPU');
  await memory.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Context size', exact: true })).toBeFocused();
});
