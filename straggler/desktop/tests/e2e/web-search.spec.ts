import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const chip = (page: Page) => page.getByRole('button', { name: 'Web search', exact: true });
async function ready(page: Page, scenario = 'web-normal') {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveAttribute(
    'placeholder',
    'Message your local model…',
  );
}
async function enable(page: Page) {
  await chip(page).click();
  const acknowledgement = page.getByRole('button', { name: 'Got it', exact: true });
  if (await acknowledgement.isVisible()) await acknowledgement.click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
}

test('search defaults off across startup, key saving, send, new chat, switching and reopen', async ({
  page,
}) => {
  await ready(page, 'web-no-key');
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await chip(page).click();
  await expect(page.getByRole('dialog', { name: 'Web search', exact: true })).toContainText(
    'needs a Mock search API key',
  );
  await page.keyboard.press('Escape');
  await expect(chip(page)).toBeFocused();
  await chip(page).click();
  await page.getByRole('button', { name: 'Add API key', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Mock search API key', exact: true })
    .fill('demo-secret-never-stored');
  await page.getByRole('button', { name: 'Save and verify', exact: true }).click();
  await expect(
    page.getByText('Key verified and saved in the system keychain.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await send(page, 'First ordinary local question');
  await expect(page.locator('.message.assistant .web-search-activity')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('straggler-fixture-request')!).webSearch,
    ),
  ).toBe(false);
  await enable(page);
  await send(page, 'One web question');
  await expect(page.locator('.web-search-activity')).toHaveCount(1);
  await enable(page);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await enable(page);
  await page.getByRole('button', { name: 'First ordinary local question', exact: true }).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('demo-secret-never-stored');
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-ui-preferences')!),
  );
  expect(preferences.webSearchNoticeSeen).toBe(true);
  expect(preferences).not.toHaveProperty('webSearchOn');
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-web-no-key')!),
  );
  expect(history[0]).not.toHaveProperty('webSearchOn');
  expect(history[0].options ?? {}).not.toHaveProperty('webSearch');
  await page.reload();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
});

test('only enabled messages search; citations, external links and normalized sources are preserved', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const calls: unknown[] = [];
    window.addEventListener('straggler-fixture-web-request', (event) =>
      calls.push((event as CustomEvent).detail),
    );
    Object.assign(window, { webCalls: calls });
  });
  await send(page, 'Local first');
  expect(
    await page.evaluate(() => (window as unknown as { webCalls: unknown[] }).webCalls),
  ).toEqual([]);
  await enable(page);
  await send(page, 'Current example');
  const response = page.locator('.message.assistant').last();
  await expect(response.locator('.web-citation')).toHaveCount(2);
  await expect(response.locator('.markdown')).toContainText('[99]');
  await expect(response.locator('code')).toContainText('[1]');
  await expect(response.getByRole('region', { name: 'Sources', exact: true })).toContainText(
    'Simulated source: overview',
  );
  await expect(page.getByRole('region', { name: 'Latest response sources' })).toContainText(
    'Simulated source: reference',
  );
  await page.evaluate(() =>
    window.addEventListener('straggler-fixture-external-url', (event) =>
      Object.assign(window, { openedSource: (event as CustomEvent).detail }),
    ),
  );
  await response.getByRole('link', { name: /Source 1:/ }).click();
  expect(
    await page.evaluate(() => (window as unknown as { openedSource: string }).openedSource),
  ).toBe('https://example.org/overview');
  await send(page, 'Local again');
  expect(
    await page.evaluate(() => (window as unknown as { webCalls: unknown[] }).webCalls),
  ).toHaveLength(1);
  await expect(page.getByRole('region', { name: 'Latest response sources' })).toContainText(
    'Web search sources appear here.',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Local first', exact: true }).click();
  await expect(page.locator('.message.assistant .web-citation')).toHaveCount(2);
});

for (const [scenario, error] of [
  ['web-offline', "You're offline"],
  ['web-invalid', "Mock search didn't accept the API key"],
  ['web-exhausted', "This month’s Mock search credits are used up"],
]) {
  test(`${scenario}: the local response continues and search resets`, async ({ page }) => {
    await ready(page, scenario);
    await enable(page);
    await send(page, 'Recent information');
    await expect(page.locator('.message.assistant .feedback')).toContainText(error);
    await expect(page.locator('.message.assistant .markdown')).toContainText('local');
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  });
}

test('fallback and quota settings remain explicit and persist only preferences', async ({
  page,
}) => {
  await ready(page, 'web-no-tools');
  await enable(page);
  await send(page, 'Fallback query');
  await page.locator('.web-search-activity summary').click();
  await expect(page.locator('.web-search-activity')).toContainText("This model can't call tools");
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await chip(page).click();
  await page.getByRole('radio', { name: '5', exact: true }).check();
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-ui-preferences')!),
  );
  expect(preferences.webSearchMaxSearches).toBe(5);
  await page
    .getByRole('textbox', { name: 'Mock search API key', exact: true })
    .fill('rejected-secret');
  await page.getByRole('button', { name: 'Save and verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText("didn't accept");
  await expect(
    page.getByText('A key is stored in the system keychain.', { exact: true }),
  ).toBeVisible();
});

test('temporary chat permits search without browser conversation persistence', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Temporary chat' })).toBeVisible();
  await enable(page);
  await send(page, 'Private temporary query');
  await expect(page.locator('.message-sources')).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('Private temporary query');
});

test('low quota is visible with an accessible usage meter', async ({ page }) => {
  await ready(page, 'web-low');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await chip(page).click();
  await expect(page.getByRole('meter', { name: 'Credits used this month' })).toHaveAttribute(
    'value',
    '850',
  );
  await expect(
    page.getByText('80% of this month’s credits used.', { exact: true }),
  ).toBeVisible();
});

test('web search and send controls remain inside a small desktop composer', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 620 });
  await ready(page);
  const composer = await page.locator('.composer').boundingBox();
  const web = await chip(page).boundingBox();
  const sendButton = await page
    .getByRole('button', { name: 'Send message', exact: true })
    .boundingBox();
  expect(web!.x).toBeGreaterThanOrEqual(composer!.x);
  expect(web!.x + web!.width).toBeLessThanOrEqual(composer!.x + composer!.width);
  expect(sendButton!.x + sendButton!.width).toBeLessThanOrEqual(composer!.x + composer!.width);
  await enable(page);
  await send(page, 'Small window web query');
  await expect(page.locator('.message-sources')).toBeVisible();
});
