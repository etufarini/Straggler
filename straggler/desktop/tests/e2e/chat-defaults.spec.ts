import { expect, test } from '@playwright/test';
import { selectValue } from './select';
import type { Page } from '@playwright/test';

async function saved(page: Page, scenario = 'normal') {
  return page.evaluate(
    (scenario) =>
      JSON.parse(localStorage.getItem(`straggler-fixture-chat-defaults-${scenario}`) || '{}'),
    scenario,
  );
}

async function defaults(page: Page, scenario = 'normal') {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chat defaults', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

test('chat defaults auto-save choices, debounce text, reject invalid values and preserve a server draft', async ({
  page,
}) => {
  await defaults(page);
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reply style' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Custom size (tokens)', exact: true }).fill('8192');
  await page.getByRole('button', { name: 'Chat defaults', exact: true }).click();
  await selectValue(page.getByRole('combobox', { name: 'Reply style' }), 'focused');
  await expect.poll(async () => (await saved(page)).temperature).toBe('0.6');
  await page.getByText('Fine-tune reply style', { exact: true }).click();
  const temperature = page.getByRole('textbox', { name: 'Temperature', exact: true });
  await temperature.fill('0.8');
  await expect.poll(async () => (await saved(page)).temperature).toBe('0.8');
  await temperature.fill('invalid');
  await temperature.blur();
  await expect(temperature).toHaveAttribute('aria-invalid', 'true');
  await expect(temperature).toHaveValue('invalid');
  expect((await saved(page)).temperature).toBe('0.8');
  await expect(page.getByText('Restart required', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Custom size (tokens)', exact: true }),
  ).toHaveValue('8192');
  expect(
    await page.evaluate(async () => {
      const modulePath = '/src/services/desktop.ts';
      const service = await import(modulePath);
      return (await service.invoke('configuration')).settings.context;
    }),
  ).toBe('auto');
});

test('scope notes share the native provider contract and errors replace the note after the help', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'straggler-fixture-cloud-normal',
      JSON.stringify([
        {
          id: 'deepseek',
          name: 'DeepSeek',
          kind: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          saved: true,
          keyError: null,
          models: [],
          shown: [],
        },
        {
          id: 'openrouter',
          name: 'OpenRouter',
          kind: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          saved: true,
          keyError: null,
          models: [],
          shown: [],
        },
      ]),
    ),
  );
  await defaults(page);
  await page.getByText('Fine-tune reply style', { exact: true }).click();
  const topK = page.getByRole('textbox', { name: 'Top-K', exact: true });
  const field = topK.locator('..');
  await expect(field.locator('.field-scope')).toHaveText('Not sent to DeepSeek');
  expect(
    await topK.evaluate((input) =>
      input
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id)!.textContent),
    ),
  ).toEqual(['Keeps only this many of the most likely words.', 'Not sent to DeepSeek']);
  await topK.fill('-2');
  await topK.blur();
  await expect(topK).toHaveAttribute('aria-invalid', 'true');
  await expect(field.locator('.field-scope')).toHaveCount(0);
  const description = await topK.evaluate((input) =>
    input
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!.textContent),
  );
  expect(description[0]).toBe('Keeps only this many of the most likely words.');
  expect(description[1]).toContain('Invalid STRAGGLER_TOP_K');
  await expect(page.locator('.scope-note')).toContainText(
    'DeepSeek ignores temperature and penalties while thinking.',
  );
});

test('storage failure keeps the edited default and its technical details until an explicit retry', async ({
  page,
}) => {
  await defaults(page);
  await page.evaluate(() =>
    localStorage.setItem('straggler-fixture-chat-defaults-save-error', 'true'),
  );
  const prompt = page.getByRole('textbox', { name: 'Default system prompt', exact: true });
  await prompt.fill('Keep this edited default');
  await prompt.blur();
  const feedback = page.getByRole('alert').filter({ hasText: 'Couldn’t save your chat defaults.' });
  await expect(feedback).toBeVisible();
  await expect(prompt).toHaveValue('Keep this edited default');
  await feedback.getByText('Technical details', { exact: true }).click();
  await expect(feedback.locator('pre')).toContainText('read-only');
  expect((await saved(page)).chat_system_prompt).toBeUndefined();
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-chat-defaults-save-error'));
  await prompt.focus();
  await prompt.blur();
  await expect
    .poll(async () => (await saved(page)).chat_system_prompt)
    .toBe('Keep this edited default');
});

test('cloud reasoning inherits On without inheriting the local default effort', async ({
  page,
}) => {
  await defaults(page, 'cloud-ready');
  await page.getByRole('radio', { name: 'On', exact: true }).check();
  await expect.poll(async () => (await saved(page, 'cloud-ready')).chat_reasoning).toBe('on');
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toContainText('On');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Use the saved reasoning default');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  const options = await page.evaluate(
    () => JSON.parse(localStorage.getItem('straggler-fixture-request')!).options,
  );
  expect(options.reasoning).toBe('on');
  expect(options.effort).toBe('auto');
});

test('composer shows the real attachment count and native drag highlight without moving focus', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await page.evaluate(() =>
    localStorage.setItem(
      'straggler-fixture-attachment-paths',
      JSON.stringify(['/fixture/notes.txt', '/fixture/brief.md']),
    ),
  );
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  const attach = page.getByRole('button', { name: 'Attach files, 2 attached', exact: true });
  await expect(attach).toHaveText('Attach · 2');
  for (const width of [1440, 760]) {
    await page.setViewportSize({ width, height: 820 });
    await expect
      .poll(() =>
        attach.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const label = button.querySelector('span')!.getBoundingClientRect();
          return label.left >= bounds.left && label.right <= bounds.right;
        }),
      )
      .toBe(true);
  }
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('straggler-fixture-drag-drop', {
        detail: { type: 'enter', paths: ['/fixture/more.txt'], position: { x: 500, y: 500 } },
      }),
    ),
  );
  await expect(page.locator('.composer')).toHaveClass(/is-dragover/);
  await expect(page.locator('.composer-drop-overlay')).toHaveText('Drop to attach');
  await expect(page.locator('.composer-drop-overlay')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('straggler-fixture-drag-drop', { detail: { type: 'leave' } }),
    ),
  );
  await expect(page.locator('.composer')).not.toHaveClass(/is-dragover/);
});
