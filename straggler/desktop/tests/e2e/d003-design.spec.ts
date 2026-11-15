import { expect, test } from '@playwright/test';
import { contrastRatio, settingsColorViolations } from '../designColors';

test('settings, including portaled lists and dialogs, contain no saturated blue', async ({
  page,
}) => {
  await page.goto('/?scenario=web-normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const section of [
    'Model settings',
    'Performance',
    'Server & port',
    'Saved configurations',
    'Folders',
    'llama.cpp',
    'Hugging Face',
    'Web search',
  ]) {
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: section, exact: true })
      .click();
    await expect(page.locator('body')).toHaveAttribute('data-area', 'settings');
    expect(await settingsColorViolations(page), section).toEqual([]);
    for (const select of await page.getByRole('combobox').all()) {
      if (await select.isDisabled()) continue;
      await select.click();
      await expect(page.locator('body > .ss-list')).toBeVisible();
      expect(await settingsColorViolations(page), `${section} listbox`).toEqual([]);
      await page.keyboard.press('Escape');
    }
  }
  await page.getByRole('button', { name: 'Folders', exact: true }).click();
  await page
    .locator('.folder-setting')
    .first()
    .getByRole('button', { name: 'Choose folder', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Choose folder' })).toBeVisible();
  expect(await settingsColorViolations(page), 'folder dialog').toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'llama.cpp', exact: true }).click();
  await page.getByRole('button', { name: 'Use bundled backend', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(await settingsColorViolations(page), 'backend confirmation').toEqual([]);
});

test('area tokens reach portals and reset across settings, projects, chat and temporary chat', async ({
  page,
}) => {
  await page.goto('/?scenario=web-normal');
  const accent = () =>
    page
      .locator('body')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--ui-accent-text').trim());
  await expect(page.locator('body')).toHaveAttribute('data-area', 'chat');
  expect(await accent()).toBe('#9cbcff');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await accent()).toBe('#8fe0d4');
  await page.getByRole('combobox', { name: 'Context size', exact: true }).click();
  await expect(page.locator('body > .ss-list')).toBeVisible();
  await expect(page.locator('.ss-option.is-active')).toHaveCSS(
    'background-color',
    /rgba\(95, 214, 200, 0\.10?2?\)/,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-area', 'chat');
  expect(await accent()).toBe('#9cbcff');
  await page.locator('[data-control-id="button-all-projects"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-area', 'project');
  expect(await accent()).toBe('#9cbcff');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-area', 'temporary');
  await expect(page.locator('.workspace')).toHaveClass(/is-temporary/);
});

test('page primary action changes the topbar hierarchy from explicit state', async ({ page }) => {
  await page.goto('/?scenario=web-normal');
  await expect(page.locator('.topbar')).not.toHaveClass(/has-page-primary/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('.configuration-heading .primary-button')).toBeEnabled();
  await expect(page.locator('.topbar')).toHaveClass(/has-page-primary/);
  await page.getByRole('button', { name: 'Web search', exact: true }).click();
  await expect(page.locator('.topbar')).not.toHaveClass(/has-page-primary/);
  await page.getByRole('textbox', { name: 'Mock search API key', exact: true }).fill('demo-key');
  await expect(page.locator('.topbar')).toHaveClass(/has-page-primary/);
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.topbar')).not.toHaveClass(/has-page-primary/);
});

test('tertiary text, teal primary, links and focus meet AA on the actual theme surfaces', async ({
  page,
}) => {
  await page.goto('/?scenario=web-normal');
  for (const area of ['chat', 'settings']) {
    if (area === 'settings')
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const palette = await page.locator('body').evaluate((node) => {
      const style = getComputedStyle(node);
      const value = (name: string) => style.getPropertyValue(name).trim();
      return {
        tertiary: value('--ui-text-3'),
        link: value('--ui-accent-text'),
        focus: value('--ui-focus'),
        surfaces: [
          '--ui-elev-0',
          '--ui-elev-1',
          '--ui-elev-2',
          '--ui-elev-3',
          '--ui-raised-2',
          '--ui-field',
          '--ui-code',
          '--ui-surface',
        ].map(value),
      };
    });
    for (const background of palette.surfaces) {
      expect(
        contrastRatio(palette.tertiary, background),
        `${area} tertiary on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette.link, background),
        `${area} link on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette.focus, background),
        `${area} focus on ${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
  const apply = page.getByRole('button', { name: 'Apply changes', exact: true });
  await expect(apply).toHaveCSS('color', 'rgb(255, 255, 255)');
  for (const background of ['#1a716b', '#1f8079'])
    expect(contrastRatio('#ffffff', background)).toBeGreaterThanOrEqual(4.5);
  await expect(apply).toHaveCSS(
    'background-image',
    'linear-gradient(rgb(26, 113, 107), rgb(26, 113, 107))',
  );
  await apply.hover();
  await expect(apply).toHaveCSS(
    'background-image',
    'linear-gradient(rgb(31, 128, 121), rgb(31, 128, 121))',
  );
});

test('stars stay out of both sidebars in every area and the orb shrinks after a message', async ({
  page,
}) => {
  await page.goto('/?scenario=web-normal');
  const background = (selector: string) =>
    page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundImage);
  for (const area of ['chat', 'settings', 'project', 'temporary']) {
    if (area === 'settings')
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    if (area === 'project') await page.locator('[data-control-id="button-all-projects"]').click();
    if (area === 'temporary') {
      await page.getByRole('button', { name: 'New chat', exact: true }).click();
      await page.getByRole('button', { name: 'Temporary', exact: true }).click();
    }
    await expect(page.locator('body')).toHaveAttribute('data-area', area);
    expect(await background('.sidebar')).not.toContain('.svg');
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    expect(await background('.sidebar')).not.toContain('.svg');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    expect((await background('.workspace')).includes('starfield.svg')).toBe(area !== 'temporary');
    expect((await background('.workspace')).includes('starfield-light.svg')).toBe(
      area !== 'temporary',
    );
  }
  await expect(page.locator('.presence-stage')).toHaveCSS('width', '224px');
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Resize the presence');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.presence-stage')).toHaveCSS('width', '128px');
  await expect(page.locator('.presence-stage canvas')).toHaveCSS('width', '128px');
  await page.getByRole('button', { name: 'Collapse assistant panel', exact: true }).click();
  await expect(page.locator('.presence-stage')).toHaveCSS('width', '48px');
});
