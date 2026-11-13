import type { Locator } from '@playwright/test';

export async function selectValue(combobox: Locator, value: string) {
  await combobox.click();
  const listId = await combobox.getAttribute('aria-controls');
  await combobox
    .page()
    .locator(`[id=${JSON.stringify(listId)}] [data-value=${JSON.stringify(value)}]`)
    .click();
}
