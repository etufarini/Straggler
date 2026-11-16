import { expect, test } from '@playwright/test';

test('the single-line brand stays centered and welcome copy follows chat privacy', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await expect(page.locator('.brand-name')).toHaveText('Straggler');
  await expect(page.locator('.brand small')).toHaveCount(0);
  const centers = await page.locator('.brand').evaluate((brand) =>
    ['.brand-name', '.brand-symbol', '.sidebar-toggle'].map((selector) => {
      const rect = brand.querySelector(selector)!.getBoundingClientRect();
      return rect.top + rect.height / 2;
    }),
  );
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  await expect(page.locator('.welcome p')).toHaveText('Powered by a model on this computer.');
  await expect(page.locator('.welcome br')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('.brand-name')).toBeHidden();
  const compactCenters = await page.locator('.brand').evaluate((brand) =>
    ['.brand-symbol', '.sidebar-toggle'].map((selector) => {
      const rect = brand.querySelector(selector)!.getBoundingClientRect();
      return rect.left + rect.width / 2;
    }),
  );
  expect(Math.abs(compactCenters[0] - compactCenters[1])).toBeLessThan(1);
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  await expect(page.locator('.welcome p')).toHaveText(
    'Not saved. Leaving erases this chat unless you save it.',
  );
  await expect(page.locator('.welcome br')).toHaveCount(0);
});

test('sampling shares its default hint while retaining each field description', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.settings-heading p')).toHaveCount(0);
  const gap = await page
    .locator('.settings-layout')
    .evaluate(
      (layout) =>
        layout.getBoundingClientRect().top -
        document.querySelector('.settings-heading h1')!.getBoundingClientRect().bottom,
    );
  expect(gap).toBeGreaterThanOrEqual(24);
  expect(gap).toBeLessThanOrEqual(32);
  await page.getByText('Fine-tune reply style', { exact: true }).click();
  const group = page.locator('.sampling-details');
  await expect(group.locator('summary + .field-help')).toHaveText(
    'Leave a field empty to use the llama.cpp default.',
  );
  await expect(
    group.getByText('Leave a field empty to use the llama.cpp default.', { exact: true }),
  ).toHaveCount(1);
  const descriptions = await group.locator('input').evaluateAll((inputs) =>
    inputs.map((input) => {
      const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
      return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    }),
  );
  expect(descriptions).toHaveLength(7);
  for (const description of descriptions) {
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toContain('llama.cpp default');
  }
});
