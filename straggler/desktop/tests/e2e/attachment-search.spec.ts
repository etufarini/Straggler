import { expect, test } from '@playwright/test';

test('large attachments enter search mode, append request-only excerpts and keep clickable saved sources', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('straggler-fixture-normal')) return;
    localStorage.setItem(
      'straggler-fixture-normal',
      JSON.stringify([
        {
          id: '20000000-0000-4000-8000-000000000001',
          title: 'Research archive',
          titleCustomized: true,
          createdAt: 1,
          updatedAt: 1,
          model: null,
          messages: [],
          attachments: [
            {
              id: '30000000-0000-4000-8000-000000000001',
              name: 'archive.txt',
              extension: 'txt',
              size: 18035,
              text: 'Neutrino evidence from observations. ' + 'あ'.repeat(6000),
            },
          ],
        },
      ]),
    );
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Research archive', exact: true }).click();
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await expect(page.getByText('Search mode', { exact: true })).toBeVisible();
  await expect(page.locator('.attachments-section .file-row')).toContainText('Searched');
  await expect(
    page.getByText(
      'Too large for this chat’s context: Straggler searches these files for each message.',
    ),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Neutrino evidence');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Searched attachments · 1 passage from 1 file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  const request = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-request')!),
  );
  expect(request.messages.at(-1).content).toContain('[A1] archive.txt · section 1');
  expect(request.messages.at(-1).content.length).toBeLessThan(600);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('straggler-fixture-normal')!)[0],
  );
  expect(saved.messages[0].content).toBe('Neutrino evidence');
  expect(saved.attachments[0].text).toBe(
    'Neutrino evidence from observations. ' + 'あ'.repeat(6000),
  );
  expect(saved.messages[1].attachmentSources[0].name).toBe('archive.txt');
  await page.getByRole('button', { name: 'Attachment source 1: archive.txt · section 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('Neutrino evidence');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Research archive', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Attachment source 1: archive.txt · section 1' }),
  ).toBeVisible();
});

test('sidebar search finds attachment text without changing the chat title', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'straggler-fixture-normal',
      JSON.stringify([
        {
          id: '20000000-0000-4000-8000-000000000001',
          title: 'Quiet archive',
          createdAt: 1,
          updatedAt: 1,
          model: null,
          messages: [],
          attachments: [
            {
              id: '30000000-0000-4000-8000-000000000001',
              name: 'notes.txt',
              extension: 'txt',
              size: 20,
              text: 'Neutrino observations',
            },
          ],
        },
      ]),
    ),
  );
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Search chats', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search chats', exact: true }).fill('neutrino');
  await expect(
    page.getByRole('button', { name: 'Quiet archive Match in chat text', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
});
