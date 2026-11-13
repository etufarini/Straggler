import { expect, test } from '@playwright/test';
import manifest from '../../packaging/llama-runtime.json' with { type: 'json' };

test('external backend reports its version and explicitly has no release date', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'llama.cpp', exact: true }).click();
  const summary = page.locator('.build-summary');
  await expect(summary).toContainText('0.9.0-fixture');
  await expect(summary).toContainText('b42');
  await expect(summary.locator('dd').last()).toHaveText('Not reported');
  await page.getByRole('button', { name: 'Use bundled backend', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Use bundled backend', exact: true })
    .click();
  await expect(summary).toContainText('Bundled backend');
  await expect(summary).toContainText(manifest.version);
  await expect(summary).toContainText(manifest.tag);
  await expect(summary.locator('dd').last()).toHaveText(manifest.releaseDate.split('T')[0]);
});
