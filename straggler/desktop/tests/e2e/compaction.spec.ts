import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seed(page: Page, scenario = 'normal', large = false) {
  await page.addInitScript(
    ({ scenario, large }) => {
      const key = `straggler-fixture-${scenario}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: '40000000-0000-4000-8000-000000000001',
            title: 'Compact me',
            titleCustomized: true,
            createdAt: 1,
            updatedAt: 1,
            model: null,
            messages: Array.from({ length: 8 }, (_, index) => ({
              id: `40000000-0000-4000-8000-00000000001${index}`,
              role: index % 2 ? 'assistant' : 'user',
              content:
                `Turn ${index}. ` +
                (large ? 'Context facts. '.repeat(160) : 'Keep these decisions.'),
              reasoning: index % 2 ? 'Private reasoning omitted' : '',
              status: 'complete',
            })),
          },
        ]),
      );
    },
    { scenario, large },
  );
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Compact me', exact: true }).click();
  if (scenario === 'normal')
    await page.getByRole('button', { name: 'Launch server', exact: true }).click();
}
async function saved(page: Page, scenario = 'normal') {
  return page.evaluate(
    (scenario) => JSON.parse(localStorage.getItem(`straggler-fixture-${scenario}`)!)[0],
    scenario,
  );
}
async function menuCompact(page: Page) {
  await page.getByRole('button', { name: 'Options for Compact me', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compact chat', exact: true }).click();
}

test('manual compaction preserves originals, supports editing/removal and branches on either side', async ({
  page,
}) => {
  await seed(page);
  const original = await saved(page);
  await menuCompact(page);
  await expect(page.locator('.chat-summary')).toBeVisible();
  const compacted = await saved(page);
  expect(compacted.messages).toEqual(original.messages);
  expect(compacted.summary.text).toContain('Goals and decisions retained.');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Unsent draft while editing.');
  await page.getByRole('button', { name: 'Summary options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit summary', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Edit summary', exact: true })
    .fill('Edited **summary**.');
  await page.getByRole('button', { name: 'Save summary', exact: true }).click();
  await expect.poll(async () => (await saved(page)).summary.text).toBe('Edited **summary**.');
  await expect(page.getByRole('button', { name: 'Summary options', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveText(
    'Unsent draft while editing.',
  );
  await page.getByRole('button', { name: 'Branch in new chat' }).nth(1).click();
  await expect(page.locator('.chat-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Compact me', exact: true }).click();
  await page.getByRole('button', { name: 'Branch in new chat' }).first().click();
  await expect(page.locator('.chat-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compact me', exact: true }).click();
  await page.getByRole('button', { name: 'Summary options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove summary', exact: true }).click();
  await expect(page.locator('.chat-summary')).toHaveCount(0);
  expect((await saved(page)).messages).toEqual(original.messages);
  await expect(page.getByRole('button', { name: 'Context', exact: true })).toBeFocused();
});

test('Context compaction removes the summary after an earlier response is edited', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await page.getByRole('button', { name: 'Compact chat', exact: true }).click();
  await expect(page.locator('.chat-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Edit response', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'Edit response', exact: true })
    .fill('Changed earlier response.');
  await page.getByRole('button', { name: 'Save response', exact: true }).click();
  await expect(page.locator('.chat-summary')).toHaveCount(0);
  await expect(
    page.getByText('Summary removed because earlier messages changed.', { exact: true }),
  ).toBeVisible();
});

test('cloud compaction requires consent and Stop keeps the prior chat unchanged', async ({
  page,
}) => {
  await seed(page, 'cloud-cancel');
  const original = await saved(page, 'cloud-cancel');
  await menuCompact(page);
  await expect(page.getByRole('dialog', { name: 'Send this chat to OpenRouter?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('straggler-fixture-cloud-requests') || '[]').some(
          (call: { method: string }) => call.method === 'POST',
        ),
      ),
    )
    .toBe(true);
  await expect(page.getByText('Summarizing earlier messages…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  expect(await saved(page, 'cloud-cancel')).toEqual(original);
  await expect(page.locator('.chat-summary')).toHaveCount(0);
});

test('full context compacts in bounded blocks and continues the preserved draft', async ({
  page,
}) => {
  await seed(page, 'normal', true);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Continue with this exact draft.');
  await page.getByRole('button', { name: 'Compact and continue', exact: true }).click();
  await expect(page.locator('.chat-summary')).toBeVisible();
  await expect(page.locator('.assistant .markdown').last()).toContainText('local answer');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  const chat = await saved(page);
  expect(chat.messages.at(-2).content).toBe('Continue with this exact draft.');
  expect(chat.messages).toHaveLength(10);
  const request = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-request')!),
  );
  expect(request.messages.map((turn: { content: string }) => turn.content).join('\n')).toContain(
    'Goals and decisions retained.',
  );
  expect(
    request.messages.map((turn: { content: string }) => turn.content).join('\n'),
  ).not.toContain('Turn 0.');
});

test('cloud summary generation uses the active destination without search or reasoning history', async ({
  page,
}) => {
  await seed(page, 'cloud-ready');
  await menuCompact(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.chat-summary')).toBeVisible();
  const chat = await saved(page, 'cloud-ready');
  expect(chat.summary.model).toBe('openrouter/example');
  const request = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-request')!),
  );
  expect(request.cloud.providerId).toBe('openrouter');
  expect(request.webSearch).toBe(false);
  expect(request.maxOutputTokens).toBeGreaterThan(0);
  expect(JSON.stringify(request.messages)).not.toContain('Private reasoning omitted');
});

test('summary storage failure preserves the previous chat and reports the failed commit', async ({
  page,
}) => {
  await seed(page);
  const original = await saved(page);
  await page.evaluate(() => localStorage.setItem('straggler-fixture-fail-next-save', 'true'));
  await menuCompact(page);
  await expect(page.getByText('Couldn’t compact the chat', { exact: true })).toBeVisible();
  expect(await saved(page)).toEqual(original);
  await expect(page.locator('.chat-summary')).toHaveCount(0);
});

test('temporary cloud compaction keeps saved history unchanged', async ({ page }) => {
  await seed(page, 'cloud-ready');
  const original = await saved(page, 'cloud-ready');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  for (let index = 0; index < 2; index++) {
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill(`Temporary question ${index}`);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    if (index === 0)
      await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copy response' })).toHaveCount(index + 1);
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await page.getByRole('button', { name: 'Compact chat', exact: true }).click();
  await expect(page.locator('.chat-summary')).toBeVisible();
  expect(await saved(page, 'cloud-ready')).toEqual(original);
  await expect(page.locator('.chat-summary')).toContainText(
    'Original messages stay in this temporary chat.',
  );
});

test('75 percent warning is dismissed only for the current session', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('straggler-fixture-context-size', '5600'));
  await seed(page, 'normal', true);
  const warning = page.getByText('This chat is getting long. Compact it to keep going.', {
    exact: true,
  });
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Compact me', exact: true }).click();
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await expect(warning).toBeVisible();
});
