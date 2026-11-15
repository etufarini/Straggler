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
