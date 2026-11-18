import { expect, test } from '@playwright/test';

test('search folds accents, rename restores focus, and stars survive reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('r002-seeded')) return;
    localStorage.setItem('r002-seeded', 'true');
    localStorage.setItem(
      'straggler-fixture-normal',
      JSON.stringify([
        {
          id: '20000000-0000-4000-8000-000000000001',
          title: 'Café plans',
          createdAt: 1,
          updatedAt: 2,
          model: null,
          messages: [],
        },
        {
          id: '20000000-0000-4000-8000-000000000002',
          title: 'Other chat',
          createdAt: 1,
          updatedAt: 1,
          model: null,
          messages: [],
        },
      ]),
    );
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Options for Café plans' }).click();
  await page.getByRole('menuitem', { name: 'Star', exact: true }).click();
  await expect(page.locator('.sidebar')).toContainText('STARRED');
  await page.reload();
  await expect(page.locator('.chat-star')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('textbox', { name: 'Search chats', exact: true });
  await expect(search).toBeFocused();
  await search.fill('CAFE');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await expect(page.locator('.conversation-row mark')).toHaveText('Café');
  await search.fill('absent');
  await expect(page.getByText('No chats match ‘absent’')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Options for Café plans' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Chat title' });
  await expect(title).toBeFocused();
  await title.fill('Renamed chat');
  await title.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Starred Renamed chat', exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Starred Renamed chat', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Options for Renamed chat' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await title.fill('Cancelled');
  await title.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Starred Renamed chat', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Options for Renamed chat' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await title.fill('x'.repeat(81));
  await title.press('Enter');
  await expect(
    page.getByText('Chat titles must contain between 1 and 80 characters.', { exact: true }),
  ).toBeVisible();
  await title.fill('Kept after failure');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-fail-next-save', 'true'));
  await title.press('Enter');
  await expect(title).toHaveValue('Kept after failure');
  await expect(page.locator('.chat-rename [role="alert"]')).toHaveText('Disk is full');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('straggler-fixture-normal')!).find((chat: { id: string }) =>
          chat.id.endsWith('001'),
        ).title,
    ),
  ).toBe('Renamed chat');
  await title.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Starred Kept after failure', exact: true }),
  ).toBeFocused();
});
