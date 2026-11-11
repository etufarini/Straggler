import { expect, test } from '@playwright/test';

test('Import is reachable with empty history, creates a new top conversation and never merges', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  const action = page.getByRole('button', { name: 'Import conversation', exact: true });
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page.locator('.message.user')).toContainText('Imported question');
  await expect(page.locator('.message.assistant')).toContainText('Imported answer');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await action.click();
  await expect(page.locator('.conversation-row')).toHaveCount(2);
  const ids = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mir-fixture-normal')!).map((chat: { id: string }) => chat.id),
  );
  expect(new Set(ids).size).toBe(2);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(action).toBeVisible();
});

test('CHAT-18 shows the failed filename, explanation, details and Choose another file without writes', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('mir-fixture-import-error', 'true'));
  await page.getByRole('button', { name: 'Import conversation', exact: true }).click();
  const feedback = page.locator('.composer-wrap').getByRole('alert');
  await expect(feedback).toContainText('Import failed');
  await expect(feedback).toContainText('import.json');
  await expect(feedback).toContainText('unsupported role');
  await expect(feedback.getByText('Technical details', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mir-fixture-normal'))).toBeNull();
  await page.evaluate(() => localStorage.removeItem('mir-fixture-import-error'));
  await feedback.getByRole('button', { name: 'Choose another file' }).click();
  await expect(page.locator('.message.user')).toContainText('Imported question');
  await expect(page.getByText('Import failed', { exact: true })).toHaveCount(0);
});

test('canceling import leaves history empty, and a failed create does not open a new chat', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('mir-fixture-import-path', 'cancel'));
  await page.getByRole('button', { name: 'Import conversation', exact: true }).click();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.removeItem('mir-fixture-import-path');
    localStorage.setItem('mir-fixture-fail-next-save', 'true');
  });
  await page.getByRole('button', { name: 'Import conversation', exact: true }).click();
  await expect(page.getByText('Import failed', { exact: true })).toBeVisible();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mir-fixture-normal'))).toBeNull();
});
