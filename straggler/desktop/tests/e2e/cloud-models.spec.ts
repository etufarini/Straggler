import { expect, test } from '@playwright/test';

async function requests(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-cloud-requests') || '[]'),
  );
}

test('setup verifies explicitly, rejected replacement preserves the key and only visible models can be selected', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  expect(await requests(page)).toEqual([]);
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Cloud models', exact: true }).click();
  const provider = page
    .locator('.cloud-provider')
    .filter({ has: page.getByText('OpenRouter', { exact: true }) });
  await provider.locator('summary').click();
  await provider.getByLabel('OpenRouter API key').fill('fixture-key');
  expect(await requests(page)).toEqual([]);
  await provider.getByRole('button', { name: 'Save and verify' }).click();
  await expect(provider.getByText('Key verified and saved in the system keychain.')).toBeVisible();
  await provider.getByLabel('OpenRouter API key').fill('rejected-fixture');
  await provider.getByRole('button', { name: 'Save and verify' }).click();
  await expect(page.getByRole('alert')).toContainText('previous key was kept');
  await provider.getByRole('checkbox', { name: /Example cloud model/ }).check();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await page.getByRole('button', { name: /^Choose model ·/ }).click();
  await expect(page.getByRole('group', { name: 'Cloud · OpenRouter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Example cloud model/ }).click();
  await expect(page.locator('.model-consequence')).toHaveText(
    'Stops the local server and frees its memory.',
  );
  await page.getByRole('button', { name: 'Use model', exact: true }).click();
  await expect(page.getByText('Cloud · OpenRouter', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop server', exact: true })).toHaveCount(0);
  expect((await requests(page)).every((call: { method: string }) => call.method === 'GET')).toBe(
    true,
  );
});

test('first send requires Continue, Cancel keeps the draft, cloud works without a local server and consent persists', async ({
  page,
}) => {
  await page.goto('/?scenario=cloud-ready');
  await expect(page.getByText('Choose a model to get started', { exact: true })).toHaveCount(0);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep this draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const notice = page.getByRole('dialog', { name: 'Send this chat to OpenRouter?' });
  await expect(notice).toBeVisible();
  expect(await requests(page)).toEqual([]);
  await notice.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer).toHaveText('Keep this draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await notice.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('An answer from the selected cloud fixture.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  expect(await requests(page)).toHaveLength(1);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('straggler-fixture-cloud-ready')!)[0],
  );
  expect(saved.messages[1].cloud).toEqual({ providerId: 'openrouter', name: 'OpenRouter' });
  await page.reload();
  await composer.fill('A second question');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy response' }).last()).toBeVisible();
  expect(await requests(page)).toHaveLength(2);
});

test('unknown capabilities show Default and cancellation preserves cloud partial text', async ({
  page,
}) => {
  await page.goto('/?scenario=cloud-unknown');
  await expect(page.getByRole('button', { name: /Reasoning/ })).toContainText('Default');
  await expect(page.getByRole('button', { name: /Reasoning/ })).toBeDisabled();
  await page.goto('/?scenario=cloud-cancel');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A question');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('An answer from the selected cloud fixture.')).toBeVisible();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('straggler-fixture-cloud-cancel')!)[0],
  );
  expect(saved.messages[1].status).toBe('stopped');
  expect(saved.messages[1].content).toContain('cloud fixture');
});

test('temporary cloud chat declares its destination and keeps messages out of saved history', async ({
  page,
}) => {
  await page.goto('/?scenario=cloud-ready');
  await page.getByRole('button', { name: 'Temporary', exact: true }).click();
  await expect(
    page.getByText('Not saved on this computer. Messages are still sent to OpenRouter.'),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Only in memory');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('straggler-fixture-cloud-ready')),
  ).toBeNull();
  await expect(page.locator('.composer-note')).toContainText(
    'Sent to OpenRouter · Not saved on this computer',
  );
});

test('cloud failures keep partial text and report credit exhaustion', async ({ page }) => {
  await page.goto('/?scenario=cloud-error');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A question');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no credit left');
  await expect(page.getByText('An answer from the selected cloud fixture.')).toBeVisible();
});
