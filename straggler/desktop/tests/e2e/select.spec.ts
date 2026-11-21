import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
});

test(
  'keyboard navigation keeps focus, cancels with Escape and commits with Enter or Tab',
  { tag: '@platform' },
  async ({ page }) => {
    const context = page.getByRole('combobox', { name: 'Context size', exact: true });
    const original = await context.textContent();
    await context.focus();
    await context.press('End');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(context).toBeFocused();
    let activeId = await context.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id=${JSON.stringify(activeId)}]`)).toHaveText('Custom');
    await context.press('Escape');
    await expect(context).toHaveText(original!);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await context.press('Home');
    await context.press('ArrowDown');
    await context.press('Enter');
    await expect(context).toHaveText('Largest the model supports');
    await expect(
      page.getByRole('textbox', { name: 'Custom size (tokens)', exact: true }),
    ).toHaveValue('0');
    await context.press('Home');
    await context.press('PageDown');
    activeId = await context.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id=${JSON.stringify(activeId)}]`)).toHaveText('256K');
    await context.press('PageUp');
    await context.press('ArrowDown');
    await context.press('ArrowDown');
    await context.press('Tab');
    await expect(context).toHaveText('4K');
    await expect(context).not.toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  },
);

test('typeahead cycles repeated initials and selects a full prefix', async ({ page }) => {
  await page.getByRole('button', { name: 'Chat defaults', exact: true }).click();
  const style = page.getByRole('combobox', { name: 'Reply style', exact: true });
  await style.focus();
  await style.press('m');
  await style.press('i');
  await style.press('n');
  await style.press('Enter');
  await expect(style).toHaveText('Min-P');
  await style.press('Escape');
  await style.press('f');
  await style.press('Enter');
  await expect(style).toHaveText('Focused');
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  const context = page.getByRole('combobox', { name: 'Context size', exact: true });
  await context.press('Home');
  await context.press('2');
  await context.press('2');
  await context.press('Enter');
  await expect(context).toHaveText('256K');
});

test('clicking outside or resizing dismisses without applying a pending value', async ({
  page,
}) => {
  const context = page.getByRole('combobox', { name: 'Context size', exact: true });
  const original = await context.textContent();
  await context.press('End');
  await page.getByRole('heading', { name: 'Model settings', exact: true }).click();
  await expect(context).toHaveAttribute('aria-expanded', 'false');
  await expect(context).toHaveText(original!);
  await context.click();
  await page.setViewportSize({ width: 960, height: 720 });
  await expect(context).toHaveAttribute('aria-expanded', 'false');
});

test('popup fits above a low control in a compact window and keeps the label actionable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 560 });
  const context = page.getByRole('combobox', { name: 'Context size', exact: true });
  await context.scrollIntoViewIfNeeded();
  await page.getByText('Context size', { exact: true }).click();
  await expect(context).toBeFocused();
  if ((await context.getAttribute('aria-expanded')) === 'true') await context.press('Escape');
  await context.press('End');
  const popup = page.getByRole('listbox');
  await expect(popup).toBeVisible();
  const popupBox = await popup.boundingBox();
  const controlBox = await context.boundingBox();
  expect(popupBox!.y).toBeGreaterThanOrEqual(0);
  expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(560);
  expect(popupBox!.y + popupBox!.height).toBeLessThan(controlBox!.y);
});

test('disabled controls stay unavailable and no native select remains', async ({ page }) => {
  await expect(page.locator('select')).toHaveCount(0);
  const effort = page.getByRole('combobox', { name: 'Default effort for this model', exact: true });
  await expect(effort).toBeDisabled();
  await effort.dispatchEvent('click');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
