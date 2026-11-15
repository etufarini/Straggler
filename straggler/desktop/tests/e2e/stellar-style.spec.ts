import { expect, test } from '@playwright/test';

test('stellar layers load locally at normal and compact window sizes', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', (request) => failures.push(request.url()));
  await page.goto('/?scenario=normal');
  for (const width of [1200, 760]) {
    await page.setViewportSize({ width, height: 820 });
    const layers = await page
      .locator('.sidebar, .workspace, .presence')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundImage));
    expect(layers).toHaveLength(3);
    expect(layers[0]).not.toContain('.svg');
    expect(layers[1]).toContain('starfield.svg');
    expect(layers[2]).toContain('starfield.svg');
    expect(layers[1]).toContain('starfield-light.svg');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  for (const asset of ['starfield.svg', 'starfield-light.svg']) {
    const response = await page.request.get(`/src/assets/${asset}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('<svg');
  }
  expect(failures).toEqual([]);
});

test('stellar decoration stays static with reduced motion and preserves the palette', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=normal');
  const theme = await page.locator('.workspace').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.getPropertyValue('--ui-background').trim(),
      surface: style.getPropertyValue('--ui-surface').trim(),
      animation: style.animationName,
    };
  });
  expect(theme).toEqual({ background: '#141d3d', surface: '#10182f', animation: 'none' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to chat' })).toBeVisible();
});
