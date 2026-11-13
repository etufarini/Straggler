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
  'CHAT-09',
  'CHAT-10',
  'CHAT-12',
  'CHAT-13',
  'CHAT-15',
  'CHAT-16',
  'CHAT-17',
  'CHAT-18',
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
  'CHAT-11',
  'SET-01C',
  'SET-01D',
  'SET-02C',
  'SET-02D',
  'FOLDER-02',
  'BUILD-02',
  'BUILD-03',
  'BUILD-04',
  'STATE-02',
  'STATE-03',
  'DIALOG-05',
];

export async function prepareDesignScreen(page, screen, baseUrl = 'http://127.0.0.1:1420') {
  const derived = {
    'SET-01C': 'SET-01B',
    'SET-01D': 'SET-01B',
    'SET-02C': 'SET-02',
    'SET-02D': 'SET-02B',
    'FOLDER-02': 'FOLDER-01',
    'BUILD-02': 'SET-06',
    'BUILD-03': 'SET-06',
    'BUILD-04': 'BUILD-01',
    'STATE-02': 'STATE-01',
    'STATE-03': 'SET-04',
    'DIALOG-05': 'SET-04',
  };
  if (derived[screen]) {
    await prepareDesignScreen(page, derived[screen], baseUrl);
    const button = (name) => page.getByRole('button', { name, exact: true });
    if (['SET-01C', 'SET-02D', 'BUILD-04'].includes(screen)) {
      await page.locator('.settings-page').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }
    if (screen === 'SET-01D')
      await page
        .locator('.sampling-details')
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    if (screen === 'SET-02C')
      await page
        .getByText('Advanced: several devices', { exact: true })
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    if (screen === 'FOLDER-02') {
      await button('.hidden').click();
      await expect(page.getByRole('textbox', { name: 'Folder path' })).toHaveValue(
        '/fixture/.hidden',
      );
    }
    if (['BUILD-02', 'BUILD-03'].includes(screen)) {
      await button('Use bundled backend').click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      if (screen === 'BUILD-03') {
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Use bundled backend', exact: true })
          .click();
        await expect(page.getByText('Build status: ready', { exact: true })).toBeVisible();
      }
    }
    if (screen === 'STATE-02') {
      await button('Apply changes').click();
      await expect(page.getByText('Settings applied.', { exact: true })).toBeVisible();
    }
    if (screen === 'STATE-03') {
      await button('Launch server').click();
      await button('Settings').click();
      await button('Model settings').click();
    }
    if (screen === 'DIALOG-05') await button('Save to selected').click();
    return;
  }

  const scenarios = {
    'CHAT-01': 'empty',
    'CHAT-03': 'cancel',
    'CHAT-04': 'cancel',
    'CHAT-05': 'interrupted',
    'CHAT-06': 'save-error',
    'CHAT-07': 'model-error',
    'CHAT-09': 'no-metrics',
    'CHAT-11': 'history-error',
    'SET-02': 'multiple',
    'SET-02B': 'unknown-memory',
    'SET-03B': 'occupied',
    'DIALOG-03': 'occupied',
    'DIALOG-04': 'occupied',
    'BUILD-01': 'backend-error',
  };
  await page.goto(
    `${baseUrl}/${screen === 'CHAT-08' ? '' : `?scenario=${scenarios[screen] || 'normal'}`}`,
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
    'CHAT-09',
    'CHAT-12',
    'CHAT-13',
    'CHAT-15',
    'CHAT-16',
    'CHAT-17',
    'CHAT-18',
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
  if (screen === 'CHAT-10') {
    await button('Launch server').click();
    await expect(page.locator('.local-badge')).toHaveText('Ready');
    await button('Reasoning').click();
  }
  if (screen === 'CHAT-09') await button('Context').click();
  if (screen === 'CHAT-12') await button('Edit message').click();
  if (screen === 'CHAT-13') await button('Edit response').click();
  if (screen === 'CHAT-15') {
    const expand = button('Expand assistant panel');
    if (await expand.isVisible()) await expand.click();
    await page.evaluate(() =>
      localStorage.setItem(
        'straggler-fixture-attachment-paths',
        JSON.stringify([
          '/fixture/meeting-notes.txt',
          '/fixture/readme.md',
          '/fixture/project-brief.docx',
          '/fixture/budget.xlsx',
          '/fixture/legacy.ppt',
        ]),
      ),
    );
    await button('Choose files').click();
    await expect(page.locator('.file-row')).toHaveCount(5);
    await expect(button('Choose files')).toBeEnabled();
    await page.evaluate(() => {
      localStorage.setItem('straggler-fixture-reading-paused', 'true');
      localStorage.setItem(
        'straggler-fixture-attachment-paths',
        '["/fixture/kickoff-slides.pptx"]',
      );
    });
    await button('Choose files').click();
    await expect(page.getByText('Reading text…', { exact: true })).toBeVisible();
  }
  if (screen === 'CHAT-16') {
    const expand = button('Expand assistant panel');
    if (await expand.isVisible()) await expand.click();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('straggler-fixture-drag-drop', {
          detail: {
            type: 'enter',
            paths: ['/fixture/notes.txt', '/fixture/brief.docx'],
            position: { x: 900, y: 600 },
          },
        }),
      ),
    );
    await expect(page.locator('.dropzone')).toHaveClass(/is-dragover/);
  }
  if (screen === 'CHAT-17') await button('Options for Explain how local chat works.').click();
  if (screen === 'CHAT-18') {
    await page.evaluate(() => localStorage.setItem('straggler-fixture-import-error', 'true'));
    await button('Import conversation').click();
    await expect(page.getByText('Import failed', { exact: true })).toBeVisible();
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
    await button('Use bundled backend').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Use bundled backend', exact: true })
      .click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
      'The action could not be completed',
    );
  }
  await page.locator('.app-shell').waitFor();
}
