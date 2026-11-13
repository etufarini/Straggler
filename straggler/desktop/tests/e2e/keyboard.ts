import type { Page } from '@playwright/test';

export async function tabToNextControl(page: Page, browserName: string) {
  // macOS WebKit follows the platform setting that limits bare Tab to fields.
  // Option-Tab traverses clickable controls without changing user preferences.
  const key = process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(key);
}
