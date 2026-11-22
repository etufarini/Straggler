import { expect, test } from '@playwright/test';
import { selectValue } from './select';

test('presets are copied into chat, can be saved from the prompt editor and round trip through preview', async ({
  page,
}) => {
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'System prompts', exact: true }).click();
  await expect(
    page.getByText('Save prompts you use often and reuse them in any chat.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New preset', exact: true });
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Clear answers');
  await editor
    .getByRole('textbox', { name: 'Description (optional)', exact: true })
    .fill('For everyday questions');
  await editor
    .getByRole('textbox', { name: 'System prompt', exact: true })
    .fill('Be clear and cite sources.');
  await editor.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByRole('heading', { name: 'Clear answers' })).toBeVisible();
  await page.getByRole('button', { name: 'Export all…' }).click();
  const exported = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-export')!),
  );
  expect(exported).toEqual({
    format: 'straggler.system-prompts',
    version: 1,
    presets: [
      {
        name: 'Clear answers',
        description: 'For everyday questions',
        prompt: 'Be clear and cite sources.',
      },
    ],
  });
  await page.evaluate(
    (values) => localStorage.setItem('straggler-fixture-preset-import', JSON.stringify(values)),
    exported.presets,
  );
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Import system prompts' });
  await expect(preview.getByText('Be clear and cite sources.', { exact: true })).toBeVisible();
  await expect(preview.getByRole('combobox')).toHaveText('Keep both');
  await preview.getByRole('button', { name: 'Import selected' }).click();
  await expect(page.getByRole('heading', { name: 'Clear answers (2)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await page.getByRole('button', { name: /^Choose model · / }).click();
  await page.getByRole('button', { name: 'Use model', exact: true }).click();
  await page.getByRole('button', { name: 'System prompt', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'System prompt', exact: true });
  await prompt.getByRole('radio', { name: 'This chat Custom text' }).check();
  const presets = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-presets')!),
  );
  await selectValue(prompt.getByRole('combobox', { name: 'Preset', exact: true }), presets[0].id);
  await expect(prompt.getByRole('textbox')).toHaveValue('Be clear and cite sources.');
  await expect(prompt.getByText('From preset ‘Clear answers’', { exact: true })).toBeVisible();
  await prompt.getByRole('textbox').fill('Edited instructions.');
  await expect(prompt.getByText('Edited from ‘Clear answers’', { exact: true })).toBeVisible();
  await prompt.getByRole('button', { name: 'Apply to this chat' }).click();
  await page.getByRole('button', { name: 'System prompt', exact: true }).click();
  await expect(prompt.getByRole('textbox')).toHaveValue('Edited instructions.');
  await prompt.getByRole('button', { name: 'Save as preset…' }).click();
  await page
    .getByRole('dialog', { name: 'New preset' })
    .getByRole('button', { name: 'Save preset' })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('straggler-fixture-presets')!),
  );
  expect(saved.map((preset: { prompt: string }) => preset.prompt)).toContain(
    'Edited instructions.',
  );
});

test('storage failure preserves edits and deleting a preset requires confirmation', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'straggler-fixture-presets',
      JSON.stringify([
        {
          id: '10000000-0000-4000-8000-000000000001',
          name: 'Keep',
          description: '',
          prompt: 'Keep instructions.',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
  );
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'System prompts', exact: true }).click();
  await page.getByRole('button', { name: 'Options for Keep', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit preset' });
  await editor.getByRole('textbox', { name: 'System prompt', exact: true }).fill('Unsaved edit');
  await page.evaluate(() => localStorage.setItem('straggler-fixture-presets-write-error', 'true'));
  await editor.getByRole('button', { name: 'Save preset' }).click();
  await expect(editor.getByRole('alert')).toContainText('Disk is full');
  await expect(editor.getByRole('textbox', { name: 'System prompt', exact: true })).toHaveValue(
    'Unsaved edit',
  );
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => localStorage.removeItem('straggler-fixture-presets-write-error'));
  await page.getByRole('button', { name: 'Options for Keep', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('keep their copied instructions');
  await page.getByRole('button', { name: 'Delete preset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep', exact: true })).toHaveCount(0);
});
