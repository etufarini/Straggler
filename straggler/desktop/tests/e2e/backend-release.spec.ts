import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import backendManifest from '../../packaging/llama-runtime.json' with { type: 'json' };

async function openBackend(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'llama.cpp', exact: true }).click();
}

test('only opening llama.cpp requests a release date and reports the verified publication', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  expect(
    await page.evaluate(() => localStorage.getItem('straggler-fixture-release-requests')),
  ).toBeNull();
  await openBackend(page);
  await expect(page.locator('.build-version time')).toHaveText('2026-10-04');
  await expect(page.locator('.build-version time')).toHaveAttribute('datetime', '2026-10-04');
  await expect(page.getByText('Published on GitHub · b42', { exact: true })).toBeVisible();
});

test('pending release lookups do not block settings navigation or server startup', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-release-paused', 'true'));
  await openBackend(page);
  await expect(page.getByText('Checking GitHub…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Context size', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.getByRole('button', { name: /^Choose model · / }).click();
  await page.getByRole('button', { name: 'Use model', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-release-paused'));
  await openBackend(page);
  await expect(page.locator('.build-version time')).toHaveText('2026-10-04');
});

for (const [status, explanation] of [
  ['commitMismatch', 'No release matches this build’s commit'],
  ['unidentified', 'Can’t verify the release date: build identity unavailable'],
]) {
  test(`external release lookup explains ${status} without showing a date`, async ({ page }) => {
    await page.goto('/?scenario=normal');
    await page.evaluate(
      (value) => localStorage.setItem('straggler-fixture-release-status', value),
      status,
    );
    await openBackend(page);
    await expect(page.getByText(explanation, { exact: true })).toBeVisible();
    await expect(page.locator('.build-version time')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose external build…' })).toBeEnabled();
  });
}

test('network failures offer an explicit retry without losing backend settings', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-release-error', 'true'));
  await openBackend(page);
  await expect(page.getByText('Release date unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/fixture network unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose external build…' })).toBeEnabled();
  await expect(page.locator('.build-summary')).toContainText('/fixture/llama.cpp');
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-release-error'));
  await page.getByRole('button', { name: 'Retry lookup', exact: true }).click();
  await expect(page.locator('.build-version time')).toHaveText('2026-10-04');
});

test('switching to bundled metadata ignores an outstanding external lookup', async ({ page }) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-release-paused', 'true'));
  await openBackend(page);
  await expect(page.getByText('Checking GitHub…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use bundled version', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Use bundled version', exact: true })
    .click();
  await expect(page.locator('.build-summary')).toContainText('Bundled backend');
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-release-paused'));
  await expect(page.locator('.build-version')).toContainText(
    backendManifest.releaseDate.split('T')[0],
  );
  await expect(page.getByText('Published on GitHub · b42', { exact: true })).toHaveCount(0);
  await expect(page.locator('.build-version time')).toHaveCount(0);
});
