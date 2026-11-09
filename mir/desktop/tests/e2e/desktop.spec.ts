import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function mockDesktop(page: Page, mode = 'normal') {
  await page.addInitScript((value) => {
    if (!new URLSearchParams(location.search).has('scenario'))
      history.replaceState(null, '', `/?scenario=${value}`);
  }, mode);
}

async function loadModel(page: Page) {
  await page.getByRole('button', { name: /^Models/ }).click();
  await page.getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByText('Running on your device')).toBeVisible();
}

test('browser preview reports that native services are unavailable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('This is the interface preview.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('model selection, Markdown, persistence, reopening and confirmed deletion', async ({
  page,
}) => {
  await mockDesktop(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracker.png')) requests.push(request.url());
  });
  await page.goto('/');
  await loadModel(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Explain local inference');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.markdown strong')).toHaveText('local');
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  await expect(page.locator('.markdown pre')).toContainText('echo hello');
  await expect(page.locator('.markdown script')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Explain local inference', exact: true }).click();
  await expect(page.locator('.markdown strong')).toHaveText('local');
  await page.getByRole('button', { name: 'Delete Explain local inference' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Explain local inference', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete Explain local inference' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('What’s on your mind?')).toBeVisible();
});

test('cancel keeps partial response and permits the next conversation', async ({ page }) => {
  await mockDesktop(page, 'cancel');
  await page.goto('/');
  await loadModel(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Write something');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.markdown strong')).toHaveText('local');
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByText('Response stopped', { exact: true })).toBeVisible();
  await expect(page.locator('.markdown strong')).toHaveText('local');
  await expect(page.getByRole('button', { name: /New chat/ })).toBeEnabled();
});

test('storage failure preserves input in conversation and can be retried', async ({ page }) => {
  await mockDesktop(page, 'save-error');
  await page.goto('/');
  await loadModel(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message.user')).toContainText('Keep this question');
  await expect(page.getByRole('alert').filter({ hasText: 'Conversation not saved' })).toContainText(
    'Disk is full',
  );
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Keep this question', exact: true }).click();
  await expect(page.locator('.message.user')).toContainText('Keep this question');
});

test('unsupported chat is reported and leaves the conversation usable', async ({ page }) => {
  await mockDesktop(page, 'model-error');
  await page.goto('/');
  await loadModel(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Unsupported chat template');
  await expect(
    page.getByText('Response failed · partial text kept', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
});

test('small desktop window keeps model and chat controls accessible', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeInViewport();
  await loadModel(page);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty setup gives a usable message and keeps launch disabled', async ({ page }) => {
  await mockDesktop(page, 'empty');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install / change build' })).toBeVisible();
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByText('No GGUF models found', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Launch server', exact: true }).last(),
  ).toBeDisabled();
});

test('settings retain generation and performance values through profile operations', async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: /^Seed/ }).fill('42');
  await page.getByRole('textbox', { name: /^Maximum output tokens/ }).fill('512');
  await page.getByRole('combobox', { name: 'Sampling preset' }).selectOption('focused');
  await expect(page.getByRole('textbox', { name: /^Seed/ })).toHaveValue('42');
  await expect(page.getByRole('textbox', { name: /^Maximum output tokens/ })).toHaveValue('512');
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await page.getByRole('combobox', { name: /^Device/ }).selectOption('none');
  await expect(page.getByRole('textbox', { name: 'GPU layers', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: /^CPU threads/ }).fill('3');
  await page.getByRole('button', { name: 'Saved configurations', exact: true }).click();
  await page.getByRole('textbox', { name: 'New configuration name', exact: true }).fill('Writing');
  await page.getByRole('button', { name: 'Save as new configuration', exact: true }).click();
  await expect(page.getByText('Configuration saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await page.getByRole('textbox', { name: /^CPU threads/ }).fill('4');
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Saved configurations', exact: true }).click();
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click();
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^CPU threads/ })).toHaveValue('3');
  await expect(page.locator('.local-badge')).toHaveText('Stopped');
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Seed/ })).toHaveValue('42');
  await expect(page.getByRole('combobox', { name: 'Sampling preset' })).toHaveValue('focused');
});

test('folder selection separates browsing, hidden directories, cancel and confirmation', async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Folders', exact: true }).click();
  await page.getByRole('button', { name: 'Choose folder', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Choose folder' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show hidden folders' }).check();
  await expect(page.getByRole('button', { name: '.hidden', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Folder path' }).fill('/fixture/new models');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.folder-setting').last().locator('code')).toHaveText(
    '/fixture/models',
  );
  await page.getByRole('button', { name: 'Choose folder', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Folder path' }).fill('/fixture/new models');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Use this folder', exact: true }).click();
  await expect(page.locator('.folder-setting').last().locator('code')).toHaveText(
    '/fixture/new models',
  );
});

test('invalid settings preserve the draft and display validation feedback', async ({ page }) => {
  await mockDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await page.getByRole('textbox', { name: /^CPU threads/ }).fill('0');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CPU threads must be positive');
  await expect(page.getByRole('textbox', { name: /^CPU threads/ })).toHaveValue('0');
});

test('hardware scenarios preserve generic controls and unknown memory', async ({ page }) => {
  for (const scenario of ['cpu', 'multiple', 'unknown-memory']) {
    await page.goto(`/?scenario=${scenario}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await expect(page.getByText('Auto uses llama.cpp defaults.', { exact: false })).toBeVisible();
    if (scenario === 'multiple') {
      await expect(page.getByText('Advanced device settings', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText('Advanced device settings', { exact: true })).toHaveCount(0);
    }
    if (scenario === 'unknown-memory')
      await expect(page.getByText('Available RAM: Unavailable')).toBeVisible();
  }
});

test('occupying listeners require separate normal and force confirmations', async ({ page }) => {
  await page.goto('/?scenario=occupied');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Server & port', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Force stop process…', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Stop process using port', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('SIGTERM');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Force stop process…', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Stop process using port', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Force stop process…', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('SIGKILL');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Port 9931: FREE')).toBeVisible();
});
