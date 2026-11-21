import { expect, test } from '@playwright/test';

test('one picker filters local and cloud models without network and restores download focus @platform', async ({
  page,
}) => {
  await page.goto('/?scenario=cloud-ready');
  await page.getByRole('button', { name: /^Choose model ·/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Models', exact: true });
  const search = dialog.getByRole('textbox', { name: 'Search models', exact: true });
  await expect(search).toBeFocused();
  await expect(dialog.locator('[data-in-use="true"]')).toBeInViewport();
  await expect(dialog.getByRole('group', { name: 'On this computer', exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('group', { name: 'Cloud · OpenRouter', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Use model', exact: true })).toHaveCount(1);
  await expect(dialog.locator('.model-consequence')).toHaveText('Already in use.');
  await search.fill('OPENROUTER');
  await expect(dialog.getByRole('group', { name: 'On this computer', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.model-option')).toHaveCount(1);
  await search.fill('example.gguf');
  await expect(dialog.locator('.model-group.is-cloud')).toHaveCount(0);
  await expect(dialog.locator('.model-option')).toHaveCount(1);
  await search.fill('no such model');
  await expect(dialog.getByRole('status')).toHaveText('No models match ‘no such model’');
  expect(
    await page.evaluate(() => localStorage.getItem('straggler-fixture-cloud-requests')),
  ).toBeNull();
  await search.fill('');
  await dialog.getByRole('button', { name: 'Download models…', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Download models', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Back to models', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Download models…', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Choose model ·/ })).toBeFocused();
});

test('local activation and in-use choices preserve controls, selection notes and destination labels', async ({
  page,
}) => {
  await page.goto('/?scenario=cloud-ready');
  await page.getByRole('button', { name: /^Choose model ·/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Models', exact: true });
  await dialog
    .getByRole('group', { name: 'On this computer', exact: true })
    .getByRole('button', { name: /example.gguf/ })
    .click();
  await expect(dialog.locator('.model-consequence')).toContainText('Estimate');
  await dialog.getByRole('button', { name: 'Use model', exact: true }).click();
  await expect(page.locator('.local-badge')).toContainText('Ready');
  await expect(page.locator('.model-switch small')).toHaveText(
    'On this computer · Custom settings',
  );
  await page.getByRole('button', { name: /^Choose model ·/ }).click();
  await expect(dialog.locator('.model-consequence')).toHaveText('Already in use.');
  await expect(dialog.getByRole('button', { name: 'Stop server', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A local question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByRole('img', { name: 'Generated on this computer', exact: true }),
  ).toBeVisible();
});

test('settings destination groups retain accessible names and the approved order', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  expect(
    await nav
      .getByRole('group')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-label'))),
  ).toEqual(['All models', 'On this computer', 'Cloud and web']);
  await expect(
    nav.getByRole('group', { name: 'All models', exact: true }).getByRole('button'),
  ).toHaveText(['System prompts']);
  await expect(
    nav.getByRole('group', { name: 'On this computer', exact: true }).getByRole('button'),
  ).toHaveText([
    'Model settings',
    'Performance',
    'Server & port',
    'Saved configurations',
    'Folders',
    'llama.cpp',
    'Hugging Face',
  ]);
});
