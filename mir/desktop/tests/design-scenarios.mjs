import { expect } from '@playwright/test';

export const reviewScreens = [
  'CHAT-01',
  'CHAT-02',
  'SERVER-01',
  'DIALOG-02',
  'CHAT-03',
  'CHAT-04',
  'CHAT-05',
  'CHAT-06',
  'CHAT-07',
  'CHAT-08',
  'MODEL-01',
  'SET-01',
  'SET-01B',
  'SET-02',
  'SET-02B',
  'SET-03',
  'SET-03B',
  'DIALOG-03',
  'DIALOG-04',
  'SET-04',
  'DIALOG-01',
  'STATE-01',
  'SET-05',
  'FOLDER-01',
  'SET-06',
  'BUILD-01',
];

export async function prepareDesignScreen(page, screen) {
  const scenarios = {
    'CHAT-01': 'empty',
    'CHAT-03': 'cancel',
    'CHAT-04': 'cancel',
    'CHAT-05': 'interrupted',
    'CHAT-06': 'save-error',
    'CHAT-07': 'model-error',
    'SET-02': 'multiple',
    'SET-02B': 'unknown-memory',
    'SET-03B': 'occupied',
    'DIALOG-03': 'occupied',
    'DIALOG-04': 'occupied',
    'BUILD-01': 'build-error',
  };
  await page.goto(
    `http://127.0.0.1:1420/${screen === 'CHAT-08' ? '' : `?scenario=${scenarios[screen] || 'normal'}`}`,
  );
  const button = (name) => page.getByRole('button', { name, exact: true });
  if (screen === 'CHAT-01') await button('Back to chat').click();
  const conversationScreens = [
    'CHAT-02',
    'SERVER-01',
    'DIALOG-02',
    'CHAT-03',
    'CHAT-04',
    'CHAT-05',
    'CHAT-06',
    'CHAT-07',
  ];
  if (conversationScreens.includes(screen)) {
    await button('Launch server').click();
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Explain how local chat works.');
    await button('Send message').click();
    await page.locator('.message.assistant').waitFor();
    if (['CHAT-03', 'CHAT-04'].includes(screen)) {
      await expect(button('Stop response')).toBeVisible();
      if (screen === 'CHAT-04') {
        await button('Stop response').click();
        await expect(button('Stop response')).toHaveCount(0);
      }
    } else await expect(button('Stop response')).toHaveCount(0);
  }
  if (screen === 'SERVER-01') await page.getByRole('button', { name: /Server log/ }).click();
  if (screen === 'DIALOG-02') await button('Stop server').click();
  if (screen === 'MODEL-01') await button('Choose model').click();
  const sections = {
    'SET-01': 'Model settings',
    'SET-01B': 'Model settings',
    'SET-02': 'Performance',
    'SET-02B': 'Performance',
    'SET-03': 'Server & port',
    'SET-03B': 'Server & port',
    'DIALOG-03': 'Server & port',
    'DIALOG-04': 'Server & port',
    'SET-04': 'Saved configurations',
    'DIALOG-01': 'Saved configurations',
    'STATE-01': 'Saved configurations',
    'SET-05': 'Folders',
    'FOLDER-01': 'Folders',
    'SET-06': 'llama.cpp',
    'BUILD-01': 'llama.cpp',
  };
  if (sections[screen]) {
    await button('Settings').click();
    await button(sections[screen]).click();
  }
  if (screen === 'SET-01B') {
    await page.getByText('Fine-tune reply style', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Seed', exact: true }).scrollIntoViewIfNeeded();
  }
  if (screen === 'SET-02') {
    await button('Collapse sidebar').click();
    await page.getByText('Advanced: several devices', { exact: true }).click();
  }
  if (['DIALOG-03', 'DIALOG-04'].includes(screen)) {
    await button('Close programs using it').click();
    if (screen === 'DIALOG-04') {
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Close programs', exact: true })
        .click();
      await button('Force quit…').click();
    }
  }
  if (['SET-04', 'DIALOG-01', 'STATE-01'].includes(screen)) {
    await page
      .getByRole('textbox', { name: 'New configuration name', exact: true })
      .fill('Design example');
    await button('Save as new configuration').click();
    await expect(page.getByText('Configuration saved.', { exact: true })).toBeVisible();
    if (screen === 'DIALOG-01') await button('Delete configuration').click();
    if (screen === 'STATE-01') {
      await button('Launch server').click();
      await button('Settings').click();
      await button('Model settings').click();
      await page.getByRole('textbox', { name: 'Custom size (tokens)', exact: true }).fill('8192');
      await page.locator('.settings-page').evaluate((element) => {
        element.scrollTop = 0;
      });
    }
  }
  if (screen === 'FOLDER-01') {
    await page
      .locator('.folder-setting')
      .filter({ hasText: 'Models folder' })
      .getByRole('button', { name: 'Choose folder' })
      .click();
    await page.getByRole('checkbox', { name: 'Show hidden folders' }).check();
    await expect(page.getByRole('button', { name: '.hidden' })).toBeVisible();
  }
  if (screen === 'BUILD-01') {
    await button('Install or change build').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Build llama.cpp', exact: true })
      .click();
    await expect(page.getByText('llama.cpp build failed', { exact: true })).toBeVisible();
  }
  await page.locator('.app-shell').waitFor();
}
