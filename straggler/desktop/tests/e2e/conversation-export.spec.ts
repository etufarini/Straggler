import { expect, test } from '@playwright/test';

test('both exports open save directly, cancellation is silent and write errors use storage feedback', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('button', { name: 'Load model', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A chat to export');
  await page.getByRole('button', { name: 'Send message' }).click();
  const menu = page.getByRole('button', { name: 'Options for A chat to export' });
  await expect(menu).toBeEnabled();
  await menu.click();
  await page.getByRole('menuitem', { name: 'Export chat…', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Conversation exported.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('straggler-fixture-save-name'))).toBe(
    'A chat to export.json',
  );
  let data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-export')!),
  );
  expect(data.includesReasoning).toBe(false);
  expect(data.conversation.messages[1].reasoning_content).toBeUndefined();
  await menu.click();
  await page.getByRole('menuitem', { name: 'Export with reasoning…' }).click();
  data = await page.evaluate(() => JSON.parse(localStorage.getItem('straggler-fixture-export')!));
  expect(data.conversation.messages[1].reasoning_content).toBe('Example reasoning text.');
  await page.evaluate(() => {
    localStorage.setItem('straggler-fixture-save-path', 'cancel');
    localStorage.removeItem('straggler-fixture-export');
  });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Export chat…', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('straggler-fixture-export'))).toBeNull();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.removeItem('straggler-fixture-save-path');
    localStorage.setItem('straggler-fixture-write-error', 'true');
  });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Export chat…', exact: true }).click();
  await expect(page.locator('.composer-wrap').getByRole('alert')).toContainText('Export failed');
});

test('reasoning export stays focusable but unavailable with an explanation when no reasoning exists', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const id = crypto.randomUUID();
    localStorage.setItem(
      'straggler-fixture-normal',
      JSON.stringify([
        {
          id,
          title: 'Without reasoning',
          createdAt: 1,
          updatedAt: 1,
          model: null,
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: 'Question',
              reasoning: '',
              status: 'complete',
            },
          ],
        },
      ]),
    );
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Options for Without reasoning' }).click();
  const item = page.getByRole('menuitem', { name: 'Export with reasoning…' });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByText('This conversation contains no reasoning.', { exact: true }),
  ).toBeVisible();
});
