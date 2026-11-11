import { tabToNextControl } from './keyboard';
import { expect, test } from '@playwright/test';

test('conversation menu supports keyboard navigation, dismissal and Delete parity', async ({
  page,
  browserName,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('button', { name: 'Load model', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A conversation');
  await page.getByRole('button', { name: 'Send message' }).click();
  const trigger = page.getByRole('button', { name: 'Options for A conversation' });
  await expect(trigger).toHaveCSS('opacity', '1');
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press('Space');
  const items = page.getByRole('menuitem');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await tabToNextControl(page, browserName);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await trigger.click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toContainText('Delete conversation?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Delete A conversation' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete conversation', exact: true })
    .click();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
});
