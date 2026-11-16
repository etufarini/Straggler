import { expect, test, type Page } from '@playwright/test';

async function geometry(page: Page) {
  return page.locator('.presence-stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const panelTop = canvas.closest('.presence')!.getBoundingClientRect().top;
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top - panelTop,
      captionTop:
        document.querySelector('.presence-caption')!.getBoundingClientRect().top - panelTop,
      pixels: canvas.width,
      pixelHeight: canvas.height,
    };
  });
}

for (const viewport of [
  { width: 1200, height: 820 },
  { width: 760, height: 620 },
]) {
  test.describe(`fixed presence at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, deviceScaleFactor: 3 });

    for (const scenario of ['normal', 'cancel', 'interrupted']) {
      test(`keeps size, position and resolution through ${scenario}`, async ({ page }) => {
        await page.goto(`/?scenario=${scenario}`);
        await page.getByRole('button', { name: 'Launch server', exact: true }).click();
        await expect(page.locator('.assistant-presence')).toHaveAttribute('data-state', 'ready');
        const expand = page.getByRole('button', { name: 'Expand assistant panel', exact: true });
        const collapse = page.getByRole('button', {
          name: 'Collapse assistant panel',
          exact: true,
        });
        if (await expand.isVisible()) await expand.click();
        await expect
          .poll(() => geometry(page))
          .toMatchObject({
            width: 224,
            height: 224,
            pixels: 672,
            pixelHeight: 672,
          });
        const before = await geometry(page);
        if (viewport.width < 1100) await collapse.click();
        await page
          .getByRole('textbox', { name: 'Message', exact: true })
          .fill('Keep the orb steady');
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        if (viewport.width < 1100) await expand.click();
        await expect(page.locator('.message.user')).toHaveCount(1);
        if (scenario === 'cancel') {
          await expect(page.locator('.assistant-presence')).toHaveAttribute(
            'data-state',
            'generating',
          );
          await expect.poll(() => geometry(page)).toEqual(before);
          if (viewport.width < 1100) await collapse.click();
          await page.getByRole('button', { name: 'Stop response', exact: true }).click();
          if (viewport.width < 1100) await expand.click();
        }
        const state =
          scenario === 'cancel' ? 'stopped' : scenario === 'interrupted' ? 'error' : 'ready';
        await expect(page.locator('.assistant-presence')).toHaveAttribute('data-state', state);
        await expect.poll(() => geometry(page)).toEqual(before);
        await page
          .getByRole('button', { name: 'Choose files', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole('button', { name: 'Choose files', exact: true }),
        ).toBeInViewport();
        await page.locator('.presence').evaluate((panel) => {
          panel.scrollTop = 0;
        });
        await collapse.click();
        await expect
          .poll(() => geometry(page))
          .toMatchObject({
            width: 48,
            height: 48,
            pixels: 144,
            pixelHeight: 144,
          });
      });
    }
  });
}
