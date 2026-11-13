import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function ready(page: Page, scenario = 'normal') {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  await expect(page.locator('.temp-status')).toHaveText('Temporary · not saved');
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.assistant .markdown')).toContainText('local answer');
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
}

test('temporary messages, attachments and drafts never write browser storage or history', async ({
  page,
}) => {
  await ready(page);
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await expect(page.locator('.file-name')).toHaveText('meeting-notes.txt');
  await expect(page.getByRole('button', { name: 'Download meeting-notes.txt' })).toBeDisabled();
  await send(page, 'Only in memory');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('An unsent private draft');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.locator('.workspace')).toHaveClass(/is-temporary/);
  expect(
    await page.locator('.workspace').evaluate((node) => getComputedStyle(node).backgroundImage),
  ).not.toContain('.svg');
  await page.reload();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
});

test('Save chat converts memory to an ordinary chat and retains attachments across reopening', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await expect(page.locator('.file-name')).toHaveText('meeting-notes.txt');
  await send(page, 'Keep this conversation');
  await page.getByRole('button', { name: 'Save chat', exact: true }).click();
  await expect(page.locator('.temp-status')).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.reload();
  await page.locator('.conversation-row > button').first().click();
  await expect(page.locator('.user .markdown')).toHaveText('Keep this conversation');
  await expect(page.locator('.file-name')).toHaveText('meeting-notes.txt');
});

test('leaving a draft for Settings or another chat requires confirmation and Cancel keeps it', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Private draft');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Erase this temporary chat?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Private draft',
  );
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await dialog.getByRole('button', { name: 'Erase and leave', exact: true }).click();
  await expect(page.locator('.temp-status')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await expect(page.locator('.conversation-row')).toHaveCount(0);
});

test('shortcut and native-shaped close event use temporary confirmation even during a response', async ({
  page,
}) => {
  await ready(page, 'cancel');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Partial private response');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('straggler-fixture-close')));
  const dialog = page.getByRole('alertdialog', { name: 'Quit and erase this temporary chat?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Control+Shift+N');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Erase and leave', exact: true })
    .click();
  await expect(page.locator('.temp-status')).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(0);
});

test('failed Save chat keeps the temporary content and allows an explicit retry', async ({
  page,
}) => {
  await ready(page);
  await send(page, 'Keep memory on failure');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-fail-next-save', 'true'));
  await page.getByRole('button', { name: 'Save chat', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Disk is full');
  await expect(page.locator('.temp-status')).toBeVisible();
  await expect(page.locator('.user .markdown')).toHaveText('Keep memory on failure');
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save chat', exact: true }).click();
  await expect(page.locator('.temp-status')).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(1);
});
