import { loadSelectedConfiguration, manageConfigurations, settingsSection } from './settings';
import { expect, test } from '@playwright/test';
import { selectValue } from './select';

test('template suggestion needs activation and picker cancellation preserves selections', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'straggler-fixture-template-candidate',
      '/fixture/models/chat_template.jinja',
    );
    localStorage.setItem('straggler-fixture-template-choice', 'cancel');
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  const template = page.getByRole('combobox', { name: 'Chat template', exact: true });
  await expect(template).toHaveText('Default');
  await selectValue(template, 'custom');
  await expect(template).toHaveText('Default');
  await page.getByRole('button', { name: 'Use this file', exact: true }).click();
  await expect(template).toHaveText('Custom file…');
  await expect(page.locator('summary').filter({ hasText: 'chat_template.jinja' })).toBeVisible();
  await page.getByRole('button', { name: 'Change template…' }).click();
  await expect(page.locator('summary').filter({ hasText: 'chat_template.jinja' })).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem('straggler-fixture-template-choice', '/fixture/elsewhere/patched.j2'),
  );
  await page.getByRole('button', { name: 'Change template…' }).click();
  await page.getByText('patched.j2', { exact: true }).click();
  await expect(
    page.locator('code').filter({ hasText: '/fixture/elsewhere/patched.j2' }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.setItem('straggler-fixture-template-choice', 'error'));
  await page.getByRole('button', { name: 'Change template…' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot read the selected model file.');
  await expect(page.getByText('patched.j2', { exact: true })).toBeVisible();
  await selectValue(template, 'default');
  await expect(template).toHaveText('Default');
  await expect(page.getByText('patched.j2', { exact: true })).toHaveCount(0);
});

test('template and MTP are restored together by profiles and require restart when changed', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  await selectValue(page.getByRole('combobox', { name: 'Chat template', exact: true }), 'custom');
  await settingsSection(page, 'Model settings');
  const mtp = page.getByRole('combobox', { name: 'Multi-token prediction (MTP)', exact: true });
  await page.evaluate(() => localStorage.setItem('straggler-fixture-mtp-choice', 'cancel'));
  await selectValue(mtp, 'file');
  await expect(mtp).toHaveText('Off');
  await selectValue(mtp, 'model');
  await expect(mtp).toHaveText("Use model's MTP");
  await selectValue(mtp, 'file');
  await expect(mtp).toHaveText("Use model's MTP");
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-mtp-choice'));
  await selectValue(mtp, 'file');
  await expect(page.getByText('mtp.gguf', { exact: true })).toBeVisible();
  await manageConfigurations(page);
  await page
    .getByRole('textbox', { name: 'New configuration name', exact: true })
    .fill('MTP setup');
  await page.getByRole('button', { name: 'Save as new configuration', exact: true }).click();
  await expect(page.getByText('Configuration saved.', { exact: true })).toBeVisible();
  await settingsSection(page, 'Model settings');
  await selectValue(mtp, 'off');
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await manageConfigurations(page);
  await loadSelectedConfiguration(page);
  await expect(page.getByRole('alertdialog')).toContainText('Replaces your unapplied changes.');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Load configuration', exact: true })
    .click();
  await expect(page.locator('.local-badge')).toHaveText('Stopped');
  await settingsSection(page, 'Model settings');
  await expect(mtp).toHaveText('Use external MTP file…');
  await settingsSection(page, 'Model settings');
  await expect(page.getByText('custom.jinja', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await page.getByRole('button', { name: /^Choose model · / }).click();
  await page.getByRole('button', { name: 'Use model', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  await selectValue(mtp, 'off');
  await expect(
    page
      .getByRole('region', { name: 'Settings', exact: true })
      .getByText('Restart required', { exact: true }),
  ).toBeVisible();
});

test('changing the model clears its template and MTP choices', async ({ page }) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  await selectValue(page.getByRole('combobox', { name: 'Chat template', exact: true }), 'custom');
  await settingsSection(page, 'Model settings');
  await selectValue(
    page.getByRole('combobox', { name: 'Multi-token prediction (MTP)', exact: true }),
    'file',
  );
  await settingsSection(page, 'Model settings');
  await selectValue(page.getByRole('combobox', { name: 'Model', exact: true }), '');
  await expect(page.getByRole('combobox', { name: 'Chat template', exact: true })).toHaveText(
    'Default',
  );
  await expect(page.getByText('Chat template and MTP reset for the selected model.')).toBeVisible();
  await settingsSection(page, 'Model settings');
  await expect(
    page.getByRole('combobox', { name: 'Multi-token prediction (MTP)', exact: true }),
  ).toHaveText('Off');
  await expect(page.getByText('mtp.gguf', { exact: true })).toHaveCount(0);
});

test('unsupported options and native overrides explain why activation is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('straggler-fixture-unsupported-model-options', 'true'),
  );
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  await expect(
    page.getByText('This backend does not advertise custom chat template support.'),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Chat template', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Custom file…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await settingsSection(page, 'Model settings');
  await expect(page.getByText('This backend does not advertise MTP support.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Multi-token prediction (MTP)', exact: true }).click();
  await expect(page.getByRole('option', { name: "Use model's MTP" })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    localStorage.setItem('straggler-fixture-template-override', 'LLAMA_ARG_CHAT_TEMPLATE');
    localStorage.setItem('straggler-fixture-mtp-override', 'LLAMA_ARG_SPEC_TYPE');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Chat defaults');
  await settingsSection(page, 'Model settings');
  await expect(page.getByRole('combobox', { name: 'Chat template', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Native environment overrides this setting: LLAMA_ARG_CHAT_TEMPLATE.'),
  ).toBeVisible();
  await settingsSection(page, 'Model settings');
  await expect(
    page.getByRole('combobox', { name: 'Multi-token prediction (MTP)', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('Native environment overrides this setting: LLAMA_ARG_SPEC_TYPE.'),
  ).toBeVisible();
});
