import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { selectValue } from './select';

async function openHub(page: Page) {
  await page.getByRole('button', { name: /^Choose model · / }).click();
  await page.getByRole('button', { name: 'Download models…', exact: true }).click();
}
async function openRepository(page: Page, query = 'fixture-publisher/example-GGUF') {
  await page.getByRole('textbox', { name: 'Search Hugging Face', exact: true }).fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Model version' })).toBeVisible();
}

test('Hub network actions are explicit; pause, resume and verified completion update local models', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => {
    const actions: string[] = [];
    window.addEventListener('straggler-fixture-hf-request', (event) =>
      actions.push((event as CustomEvent<string>).detail),
    );
    Object.assign(window, { hubActions: actions });
  });
  await openHub(page);
  await page.getByRole('textbox', { name: 'Search Hugging Face', exact: true }).fill('example');
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(() => (window as unknown as { hubActions: string[] }).hubActions),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: /fixture-publisher\/example-GGUF/ }).click();
  await expect(page.getByRole('group', { name: 'Model version' })).toBeVisible();
  await expect(
    page.getByText('Estimate from the file size and detected memory;', { exact: false }),
  ).toBeVisible();
  const projector = page.getByRole('combobox', {
    name: 'Vision projector (optional)',
    exact: true,
  });
  await projector.click();
  await projector.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Models', exact: true })).toBeVisible();
  await selectValue(projector, 'mmproj.gguf');
  await page.getByRole('button', { name: 'Download selected files' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const downloads = page.getByRole('region', { name: 'Model downloads' });
  await expect(downloads).toContainText('paused');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(downloads).toContainText('SHA-256 verified. Available on this computer.');
  await page.getByRole('button', { name: 'Back to models', exact: true }).click();
  await expect(page.locator('.model-option')).toContainText(['example.gguf', 'model.gguf']);
  expect(
    await page.evaluate(() => (window as unknown as { hubActions: string[] }).hubActions),
  ).toEqual(['search', 'repository', 'download', 'resume']);
});

test('optional token stays out of browser storage and gated access is retried explicitly', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await openHub(page);
  await openRepository(page, 'fixture-publisher/gated-GGUF');
  await page.getByRole('button', { name: 'Download selected files' }).click();
  await expect(page.getByRole('alert')).toContainText('access is restricted');
  await page.getByRole('button', { name: 'Open token settings', exact: true }).first().click();
  const token = page.getByRole('textbox', { name: /^Hugging Face token/ });
  await token.fill('hf_private_fixture');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(token).toHaveValue('');
  await expect(
    page.getByText('Token saved in the system keychain.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'hf_private_fixture',
  );
  await page.evaluate(() => localStorage.setItem('straggler-fixture-hf-license-accepted', 'true'));
  await openHub(page);
  await page.getByRole('button', { name: 'Retry access', exact: true }).click();
  await page.getByRole('button', { name: 'Download selected files' }).click();
  await expect(page.getByRole('region', { name: 'Model downloads' })).toContainText('completed');
});

test('models folder is created only on request and native-picker cancellation preserves it', async ({
  page,
}) => {
  await page.goto('/?scenario=empty');
  await page.getByRole('button', { name: 'Folders', exact: true }).click();
  const folder = page.locator('.folder-setting').last();
  await expect(folder.locator(':scope > code')).toHaveText('Not configured');
  await page.getByRole('button', { name: 'Create models folder', exact: true }).click();
  await expect(folder.locator(':scope > code')).toHaveText(
    '/fixture/app-data/io.github.etufarini.straggler/models',
  );
  await page.evaluate(() =>
    localStorage.setItem('straggler-fixture-models-folder-choice', 'cancel'),
  );
  await page.getByRole('button', { name: 'Choose existing folder', exact: true }).click();
  await expect(folder.locator(':scope > code')).toHaveText(
    '/fixture/app-data/io.github.etufarini.straggler/models',
  );
  await page.evaluate(() =>
    localStorage.setItem('straggler-fixture-models-folder-choice', '/fixture/.hidden models'),
  );
  await page.getByRole('button', { name: 'Choose existing folder', exact: true }).click();
  await expect(folder.locator(':scope > code')).toHaveText('/fixture/.hidden models');
});

test('disk-space feedback blocks starting a download without blocking server controls', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-hf-low-disk', 'true'));
  await openHub(page);
  await openRepository(page);
  await expect(page.getByRole('alert')).toHaveText(
    'Not enough disk space. Free up space or choose another models folder.',
  );
  await expect(page.getByRole('button', { name: 'Download selected files' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Launch server', exact: true })).toBeEnabled();
});

test('multipart selection and interrupted downloads retain an explicit Resume or Cancel action', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await openHub(page);
  await openRepository(page);
  await page.getByRole('radio', { name: /split-00001-of-00002/ }).check();
  await page.evaluate(() => localStorage.setItem('straggler-fixture-hf-interrupted', 'true'));
  await page.getByRole('button', { name: 'Download selected files' }).click();
  const downloads = page.getByRole('region', { name: 'Model downloads' });
  await expect(downloads).toContainText('2 files');
  await expect(downloads.getByRole('alert')).toContainText('interrupted');
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-hf-interrupted'));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await expect(downloads).toHaveCount(0);
});
