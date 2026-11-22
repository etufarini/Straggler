import { expect, test } from '@playwright/test';
import { settingsSection, manageConfigurations } from './settings';
import { selectValue } from './select';

const names = [
  'Overview',
  'Chat defaults',
  'System prompts',
  'Model settings',
  'llama.cpp',
  'Model files',
  'Cloud models',
  'Web search',
];

test('Overview opens first, summarizes known state without external requests and remembers navigation', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1420'))
      external.push(request.url());
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  await expect(nav.getByRole('button')).toHaveText(names);
  await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Model settings Stopped/ })).toContainText(
    'example.gguf',
  );
  await expect(page.getByRole('button', { name: /System prompts No presets yet/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Cloud models 0 of 3 services set up/ }),
  ).toBeAttached();
  await expect(
    page.getByRole('button', { name: /Web search Off until you add a key/ }),
  ).toBeAttached();
  expect(external).toEqual([]);
  await settingsSection(page, 'Model files');
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Model files', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('first setup explains missing model and backend through actionable Overview cards', async ({
  page,
}) => {
  await page.goto('/?scenario=empty');
  const attention = page.getByRole('region', { name: 'Needs attention', exact: true });
  await expect(attention).toBeVisible();
  await expect(page.getByRole('button', { name: /llama.cpp Unavailable/ })).toBeAttached();
  await attention.getByRole('button', { name: 'Select a llama.cpp build', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'llama.cpp', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Choose external build…', exact: true }),
  ).toBeVisible();
  await settingsSection(page, 'Model files');
  await expect(page.getByRole('heading', { name: 'Models folder', exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: /^Hugging Face token/ })).toBeAttached();
  await expect(
    page.getByRole('button', { name: 'Create models folder', exact: true }),
  ).toBeVisible();
});

test('one model draft retains changed-field notes, load review and configuration confirmations', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await manageConfigurations(page);
  const dialog = page.getByRole('dialog', { name: 'Manage configurations', exact: true });
  await dialog
    .getByRole('textbox', { name: 'New configuration name', exact: true })
    .fill('Review setup');
  await dialog.getByRole('button', { name: 'Save as new configuration', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Configuration saved.');
  await settingsSection(page, 'Model settings');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(1);
  const threads = page.getByRole('textbox', { name: 'CPU threads', exact: true });
  await threads.fill('3');
  await expect(page.locator('#setting-threads')).toContainText('Changed · was auto');
  await expect(page.getByRole('img', { name: 'Unapplied changes', exact: true })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Port', exact: true })).toBeAttached();
  await selectValue(
    page.getByRole('combobox', { name: 'Configuration', exact: true }),
    'Review setup',
  );
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Replaces your unapplied changes.');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(threads).toHaveValue('3');
  await selectValue(
    page.getByRole('combobox', { name: 'Configuration', exact: true }),
    'Review setup',
  );
  await confirm.getByRole('button', { name: 'Load configuration', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Stopped');
  await expect(
    page.getByText('Configuration loaded for review. The server was not started.', { exact: true }),
  ).toBeVisible();
  await expect(threads).toHaveValue('');
  await manageConfigurations(page);
  await dialog.getByRole('button', { name: 'Save to selected', exact: true }).click();
  await expect(confirm).toContainText('Replace “Review setup”');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete configuration', exact: true }).click();
  await expect(confirm).toContainText('Your current settings and chats won’t change.');
  await confirm.getByRole('button', { name: 'Delete configuration', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Configuration', exact: true })).toHaveText(
    'Choose a configuration',
  );
});

test('free ports hide stop actions and occupied port navigation focuses inside the fields viewport', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Model settings');
  await expect(
    page.getByRole('button', { name: 'Close programs using it', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Force quit', exact: true })).toHaveCount(0);
  await page.goto('/?scenario=occupied');
  await page.getByRole('button', { name: /Port 9931 is in use · Review server settings/ }).click();
  const port = page.getByRole('textbox', { name: 'Port', exact: true });
  await expect(port).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Close programs using it', exact: true }),
  ).toBeVisible();
  const rect = await port.boundingBox();
  const header = await page.locator('.settings-section-heading').boundingBox();
  const viewport = await page.locator('.settings-section').boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(rect!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
  await expect(page.getByRole('link', { name: 'Server', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  const memory = page.getByRole('link', { name: 'Memory', exact: true });
  await memory.focus();
  await memory.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Context size', exact: true })).toBeFocused();
  await expect(memory).toHaveAttribute('aria-current', 'location');
  await page.locator('.settings-section').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole('link', { name: 'Server', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
});

test('settings fields scroll by keyboard below a stable header at the minimum window size @platform', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  const viewport = page.getByRole('region', { name: 'Chat defaults', exact: true });
  const header = page.locator('.settings-section-heading');
  const headerBounds = await header.boundingBox();
  await viewport.focus();
  await viewport.press('End');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  expect(await header.boundingBox()).toEqual(headerBounds);
  const viewportBounds = await viewport.boundingBox();
  expect(viewportBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
  expect(await page.locator('.settings-page').evaluate((element) => element.scrollTop)).toBe(0);
  const lastField = page.getByRole('textbox', { name: 'Longest reply (tokens)', exact: true });
  await lastField.focus();
  await expect(lastField).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('textbox', { name: 'Seed', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Seed', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await settingsSection(page, 'Model settings');
  await settingsSection(page, 'Chat defaults');
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByRole('heading', { name: 'System prompt', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await settingsSection(page, 'Model settings');
  const threads = page.getByRole('textbox', { name: 'CPU threads', exact: true });
  await threads.fill('3');
  await expect(threads).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeInViewport({
    ratio: 1,
  });
});

test('service provenance is separate from setup and field errors retain linked help and an icon', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Cloud models');
  await expect(page.locator('.cloud-provider[title="Tested with Straggler"]')).toHaveCount(3);
  await expect(page.locator('.cloud-provider > summary .status-chip')).toHaveText([
    'Not set up',
    'Not set up',
    'Not set up',
  ]);
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(0);
  await settingsSection(page, 'Model settings');
  const threads = page.getByRole('textbox', { name: 'CPU threads', exact: true });
  await threads.fill('0');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(threads).toHaveAttribute('aria-invalid', 'true');
  const ids = (await threads.getAttribute('aria-describedby'))!.split(' ');
  expect(ids).toHaveLength(2);
  await expect(page.locator(`[id=${JSON.stringify(ids[0])}]`)).toContainText('Auto or a number');
  await expect(page.locator(`[id=${JSON.stringify(ids[1])}] svg`)).toBeVisible();
});

test('configuration storage failure remains visible inside management and retry keeps the edited name', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await manageConfigurations(page);
  const dialog = page.getByRole('dialog', { name: 'Manage configurations', exact: true });
  const name = dialog.getByRole('textbox', { name: 'New configuration name', exact: true });
  await name.fill('Keep my edits');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-profile-write-error', 'true'));
  await dialog.getByRole('button', { name: 'Save as new configuration', exact: true }).click();
  const failure = dialog.getByRole('alert');
  await expect(failure).toContainText('Couldn’t update configurations');
  await failure.getByText('Technical details', { exact: true }).click();
  await expect(failure.locator('pre')).toHaveText('Configuration folder is not writable.');
  await expect(name).toHaveValue('Keep my edits');
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-profile-write-error'));
  await dialog.getByRole('button', { name: 'Save as new configuration', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Configuration saved.');
});

test('workspace feedback shares the composer width when the assistant panel expands or collapses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=oom-startup');
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  const feedback = page.locator('.chat-main > .workspace-feedback .feedback');
  await expect(feedback).toContainText('Not enough memory');
  const expand = page.getByRole('button', { name: 'Expand assistant panel', exact: true });
  if (await expand.isVisible()) await expand.click();
  for (const expanded of [true, false]) {
    if (!expanded)
      await page.getByRole('button', { name: 'Collapse assistant panel', exact: true }).click();
    const warning = (await feedback.boundingBox())!;
    const composer = (await page.locator('.composer').boundingBox())!;
    expect(Math.abs(warning.x - composer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(warning.width - composer.width)).toBeLessThanOrEqual(1);
  }
});
