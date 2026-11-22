import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { selectValue } from './select';

export async function settingsSection(page: Page, label: string) {
  const dialog = page.getByRole('dialog', { name: 'Manage configurations', exact: true });
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections', exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();
}

export async function manageConfigurations(page: Page) {
  await settingsSection(page, 'Model settings');
  await page.getByRole('button', { name: 'Manage configurations…', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Manage configurations', exact: true }),
  ).toBeVisible();
}

// Load through the same menu used in the product; the dialog selection is only for management.
export async function loadSelectedConfiguration(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Manage configurations', exact: true });
  const name = await dialog
    .getByRole('combobox', { name: 'Configuration', exact: true })
    .innerText();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await selectValue(
    page.getByRole('combobox', { name: 'Configuration', exact: true }),
    name.trim(),
  );
}
