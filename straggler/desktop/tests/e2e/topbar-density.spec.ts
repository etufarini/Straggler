import { expect, test, type Page } from '@playwright/test';
import { tabToNextControl } from './keyboard';

const longModel =
  'example-with-a-long-model-name-and-context-configuration-for-layout-validation.gguf';

async function prepare(page: Page, model: string, temporary: boolean) {
  await page.addInitScript((model) => {
    localStorage.setItem('straggler-fixture-model', model ? `/fixture/models/${model}` : '');
  }, model);
  await page.goto('/?scenario=normal');
  await expect(page.locator('.model-name')).toHaveText(model || 'Choose a local model');
  if (temporary) await page.getByRole('button', { name: 'Temporary', exact: true }).click();
}

async function inspectControls(page: Page) {
  await expect
    .poll(() =>
      page.locator('.topbar').evaluate((bar) => {
        const bounds = bar.getBoundingClientRect();
        const buttons = [...bar.querySelectorAll('.model-switch, .header-controls > button')];
        const boxes = buttons.map((node) => node.getBoundingClientRect());
        const inside = (box: DOMRect, container: DOMRect) =>
          box.left >= container.left &&
          box.right <= container.right &&
          box.top >= container.top &&
          box.bottom <= container.bottom;
        return {
          outside: boxes.some((box) => !inside(box, bounds)),
          overlaps: boxes.some((a, index) =>
            boxes
              .slice(index + 1)
              .some(
                (b) =>
                  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
                  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top),
              ),
          ),
          clippedIcons: buttons.some((button) =>
            [...button.querySelectorAll('svg')].some(
              (icon) => !inside(icon.getBoundingClientRect(), button.getBoundingClientRect()),
            ),
          ),
        };
      }),
    )
    .toEqual({ outside: false, overlaps: false, clippedIcons: false });
}

async function geometry(page: Page) {
  return page.evaluate(() => ({
    height: document.querySelector('.topbar')!.getBoundingClientRect().height,
    noticeTop: document.querySelector('.notice')!.getBoundingClientRect().top,
    panelTop: document.querySelector('.presence')!.getBoundingClientRect().top,
    orbTop: document.querySelector('.presence-stage canvas')!.getBoundingClientRect().top,
  }));
}

// Exercise long/missing names, a short window, ordinary and temporary chats,
// and full/icon controls without repeating the same lifecycle at every size.
for (const { viewport, model, temporary } of [
  { viewport: { width: 760, height: 620 }, model: 'example.gguf', temporary: false },
  { viewport: { width: 760, height: 620 }, model: longModel, temporary: true },
  { viewport: { width: 820, height: 620 }, model: '', temporary: true },
  { viewport: { width: 960, height: 820 }, model: longModel, temporary: false },
  { viewport: { width: 1200, height: 820 }, model: 'example.gguf', temporary: true },
  { viewport: { width: 1600, height: 1000 }, model: 'example.gguf', temporary: false },
]) {
  test(`top bar ${viewport.width}px, ${model || 'no model'}, temporary ${temporary}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepare(page, model, temporary);
    await inspectControls(page);
    if (model === 'example.gguf' && viewport.width >= 1200)
      await expect(page.getByRole('button', { name: 'Temporary', exact: true })).toHaveAttribute(
        'data-density',
        'full',
      );
    const stopped = await geometry(page);
    const modelButton = page.getByRole('button', { name: /^Choose model · / });
    await expect(modelButton).toHaveAttribute('title', model || 'Choose a local model');
    await expect(modelButton).toHaveAccessibleName(
      `Choose model · ${model || 'Choose a local model'}`,
    );
    if (model === longModel) {
      const name = page.locator('.model-name');
      await expect(name).toHaveCSS('text-overflow', 'ellipsis');
      if (viewport.width <= 960)
        expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    }
    if (!model) {
      // Without a model, sending remains unavailable; do not fabricate a running server.
      await expect(page.getByRole('button', { name: 'Launch server', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
      return;
    }
    await page.getByRole('button', { name: 'Launch server', exact: true }).click();
    await expect(page.locator('.local-badge')).toHaveText('Ready');
    await inspectControls(page);
    const before = await geometry(page);
    expect(before).toEqual(stopped);
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Keep the top bar steady');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.assistant .markdown')).toContainText('local answer');
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    await inspectControls(page);
    expect(await geometry(page)).toEqual(before);
    await expect(page.getByRole('button', { name: 'Temporary', exact: true })).toHaveCount(
      temporary ? 1 : 0,
    );
    await page.getByRole('button', { name: 'Stop server', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Stop server', exact: true })
      .click();
    await expect(page.locator('.local-badge')).toHaveText('Stopped');
    await inspectControls(page);
    expect(await geometry(page)).toEqual(stopped);
  });
}

test(
  'compact Temporary keeps its accessible state, tooltip and keyboard focus',
  { tag: '@platform' },
  async ({ page, browserName }) => {
    await page.setViewportSize({ width: 760, height: 620 });
    await prepare(page, 'example-with-a-long-model-name-for-keyboard-validation.gguf', false);
    const temporary = page.getByRole('button', { name: 'Temporary', exact: true });
    await expect(temporary).toHaveAttribute('data-density', 'icon');
    await expect(temporary).toHaveAttribute('aria-pressed', 'false');
    await expect(temporary).toHaveAttribute('title', 'Open temporary chat (Ctrl/⌘ + Shift + N)');
    const bounds = (await temporary.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(30);
    expect(bounds.height).toBeGreaterThanOrEqual(30);
    await page.getByRole('button', { name: /^Choose model · / }).focus();
    await tabToNextControl(page, browserName);
    await expect(temporary).toBeFocused();
    await expect(temporary).toHaveCSS('outline-style', 'solid');
    expect(
      parseFloat(await temporary.evaluate((node) => getComputedStyle(node).outlineWidth)),
    ).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(temporary).toHaveAttribute('aria-pressed', 'true');
    await expect(temporary).toHaveAttribute('aria-disabled', 'true');
    await expect(temporary).toHaveAttribute('data-density', 'icon');
    await expect(temporary).toHaveAttribute('title', 'Temporary · not saved (Ctrl/⌘ + Shift + N)');
    await page.getByRole('button', { name: /^Choose model · / }).focus();
    await tabToNextControl(page, browserName);
    await expect(temporary).toBeFocused();
    expect(
      parseFloat(await temporary.evaluate((node) => getComputedStyle(node).outlineWidth)),
    ).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('.workspace')).toHaveClass(/is-temporary/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save chat', exact: true })).toBeVisible();
  },
);

test('density follows measured space with 16px hysteresis, independently of viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await prepare(page, 'example.gguf', false);
  const temporary = page.getByRole('button', { name: 'Temporary', exact: true });
  await expect(temporary).toHaveAttribute('data-density', 'full');
  const threshold = await page.locator('.topbar').evaluate((bar) => {
    const style = getComputedStyle(bar);
    return (
      bar.querySelector('.model-switch')!.getBoundingClientRect().width +
      bar.querySelector('.header-controls')!.getBoundingClientRect().width +
      parseFloat(style.columnGap) +
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight)
    );
  });
  const narrow = Math.floor(threshold) - 1;
  for (const [width, density] of [
    [narrow, 'icon'],
    [narrow + 8, 'icon'],
    [narrow + 20, 'full'],
  ] as const) {
    await page.locator('.topbar').evaluate((bar, width) => {
      bar.style.width = `${width}px`;
    }, width);
    await expect(temporary).toHaveAttribute('data-density', density);
    await inspectControls(page);
  }
});
