import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/domain/projects';
import type { Conversation } from '../../src/domain/types';
import { tabToNextControl } from './keyboard';

const ids = {
  research: '10000000-0000-4000-8000-000000000001',
  server: '10000000-0000-4000-8000-000000000002',
  product: '10000000-0000-4000-8000-000000000003',
  archived: '10000000-0000-4000-8000-000000000004',
  ownChat: '20000000-0000-4000-8000-000000000001',
  memberChat: '20000000-0000-4000-8000-000000000002',
  otherChat: '20000000-0000-4000-8000-000000000003',
};

function projects(): Project[] {
  const base = {
    description: '',
    instructions: '',
    starred: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    files: [],
  };
  return [
    {
      ...base,
      id: ids.research,
      name: 'Thesis research',
      description: 'Sources and chapter planning',
      instructions: 'Use the research project instructions.',
      starred: true,
      updatedAt: 40,
      files: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          name: 'notes.md',
          extension: 'md',
          size: 24,
          text: 'Included research notes.',
          included: true,
        },
        {
          id: '30000000-0000-4000-8000-000000000002',
          name: 'excluded.txt',
          extension: 'txt',
          size: 20,
          text: 'Excluded project text.',
          included: false,
        },
      ],
    },
    { ...base, id: ids.server, name: 'Home server setup', starred: true, updatedAt: 20 },
    { ...base, id: ids.product, name: 'Product launch brief', updatedAt: 30 },
    { ...base, id: ids.archived, name: 'Recipe collection', archived: true, updatedAt: 10 },
  ];
}

function chat(id: string, title: string, projectId?: string): Conversation {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 10,
    model: '/fixture/models/example.gguf',
    ...(projectId ? { projectId } : {}),
    messages: [
      {
        id: `${id.slice(0, -1)}4`,
        role: 'user',
        content: 'Earlier question',
        reasoning: '',
        status: 'complete',
      },
      {
        id: `${id.slice(0, -1)}5`,
        role: 'assistant',
        content: 'Earlier answer',
        reasoning: 'Earlier reasoning',
        status: 'complete',
      },
    ],
  };
}

function history(): Conversation[] {
  return [
    {
      ...chat(ids.ownChat, 'A chat with its own prompt'),
      options: { systemPrompt: 'Stored own instructions.', reasoning: null, effort: null },
    },
    chat(ids.memberChat, 'Existing research chat', ids.research),
    chat(ids.otherChat, 'Another research chat', ids.research),
  ];
}

function control(page: Page, id: string) {
  return page.locator(`[data-control-id="${id}"]`);
}

async function seed(
  page: Page,
  values: {
    projects?: Project[];
    history?: Conversation[];
    scenario?: 'normal' | 'cancel';
    flags?: Record<string, string>;
  } = {},
) {
  const scenario = values.scenario ?? 'normal';
  await page.addInitScript(
    ({ projectValues, chatValues, scenarioName, flags }) => {
      if (localStorage.getItem('mir-r001-test-seeded')) return;
      localStorage.setItem('mir-r001-test-seeded', 'true');
      localStorage.setItem(`mir-fixture-projects-${scenarioName}`, JSON.stringify(projectValues));
      localStorage.setItem(`mir-fixture-${scenarioName}`, JSON.stringify(chatValues));
      localStorage.setItem('mir-fixture-context-size', '16384');
      for (const [name, value] of Object.entries(flags)) localStorage.setItem(name, value);
    },
    {
      projectValues: values.projects ?? projects(),
      chatValues: values.history ?? history(),
      scenarioName: scenario,
      flags: values.flags ?? {},
    },
  );
  await page.goto(`/?scenario=${scenario}`);
  await expect(control(page, 'button-new-project')).toBeEnabled();
}

async function loadModel(page: Page) {
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('button', { name: 'Load model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Server log · Ready', exact: true })).toBeVisible();
}

async function openResearch(page: Page) {
  await control(page, 'button-project-thesis-research').click();
  await expect(page.getByRole('heading', { name: 'Thesis research', exact: true })).toBeVisible();
}

async function openOwnChat(page: Page) {
  await control(page, 'button-a-chat-with-its-own-prompt').click();
  await expect(page.getByText('Earlier answer', { exact: true })).toBeVisible();
}

async function readProjects(page: Page, scenario = 'normal'): Promise<Project[]> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]'),
    `mir-fixture-projects-${scenario}`,
  );
}

async function readHistory(page: Page, scenario = 'normal'): Promise<Conversation[]> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]'),
    `mir-fixture-${scenario}`,
  );
}

async function lastRequest(page: Page): Promise<{
  conversationId: string;
  messages: { role: string; content: string }[];
}> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mir-fixture-request')!));
}

test('CHAT-01 and PROJ-02 create the first project with field validation and focus recovery', async ({
  page,
  browserName,
}) => {
  await seed(page, { projects: [], history: [] });
  await expect(
    page.getByText('Group chats that share instructions and files.', { exact: true }),
  ).toBeVisible();
  await control(page, 'button-all-projects').click();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  const create = control(page, 'button-create-first-project');
  await create.click();
  const name = control(page, 'input-project-name');
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await expect(name).toBeFocused();
  await control(page, 'button-create-project').click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const errorId = await name.getAttribute('aria-describedby');
  expect(errorId).toContain('name-error');
  await expect(dialog.getByRole('alert')).toHaveText('Enter a name for the project.');
  await name.fill('A'.repeat(80));
  await expect(name).toHaveValue('A'.repeat(80));
  const description = control(page, 'textarea-project-description');
  await description.fill('D'.repeat(200));
  await expect(dialog).toContainText('200 / 200');
  await control(page, 'button-create-project').focus();
  await tabToNextControl(page, browserName);
  await expect(name).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  await create.click();
  await name.fill('First project');
  await description.fill('Kept on this device');
  await control(page, 'button-create-project').click();
  await expect(page.getByRole('heading', { name: 'First project', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readProjects(page))[0]?.description)
    .toBe('Kept on this device');
  await expect(page.getByText('No chats yet.', { exact: false })).toBeVisible();
});

test('PROJ-04 rejects case-insensitive duplicate names including archived projects and edits details', async ({
  page,
}) => {
  await seed(page);
  await control(page, 'button-new-project').click();
  await control(page, 'input-project-name').fill('  RECIPE COLLECTION  ');
  await control(page, 'button-create-project').click();
  await expect(page.getByRole('dialog', { name: 'New project' })).toContainText('already exists');
  await expect(control(page, 'input-project-name')).toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Escape');
  await openResearch(page);
  await control(page, 'button-options-for-current-project').click();
  await control(page, 'button-edit-project-details').click();
  await control(page, 'input-project-name').fill('THESIS RESEARCH');
  await control(page, 'textarea-project-description').fill('Updated description');
  await control(page, 'button-save-project-details').click();
  await expect(page.getByRole('heading', { name: 'THESIS RESEARCH', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readProjects(page)).find((value) => value.id === ids.research)?.description,
    )
    .toBe('Updated description');
});

test('CHAT-02 and PROJ-01 support star, description search, sort and arrow-key tabs', async ({
  page,
}) => {
  await seed(page);
  await control(page, 'button-all-projects').click();
  await expect(page.getByRole('tab', { name: 'Active (3)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const cards = page.locator('.project-card-open');
  await expect(cards).toHaveText(['Thesis research', 'Product launch brief', 'Home server setup']);
  await control(page, 'select-sort-projects').selectOption('name');
  await expect(cards).toHaveText(['Home server setup', 'Product launch brief', 'Thesis research']);
  await control(page, 'button-star-product-launch-brief').click();
  await expect(control(page, 'button-project-product-launch-brief')).toBeVisible();
  await expect(control(page, 'button-star-product-launch-brief')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await control(page, 'input-search-projects').fill('chapter planning');
  await expect(cards).toHaveText(['Thesis research']);
  await control(page, 'input-search-projects').fill('no matching project');
  await expect(
    page.getByText('No projects match “no matching project”.', { exact: false }),
  ).toBeVisible();
  await control(page, 'button-clear-search').click();
  await expect(control(page, 'input-search-projects')).toBeFocused();
  await control(page, 'tab-active-projects').focus();
  await page.keyboard.press('ArrowRight');
  await expect(control(page, 'tab-archived-projects')).toBeFocused();
  await expect(control(page, 'tab-archived-projects')).toHaveAttribute('aria-selected', 'true');
  await expect(cards).toHaveText(['Recipe collection']);
  await page.keyboard.press('ArrowLeft');
  await expect(cards).toHaveCount(3);
  await page.reload();
  await expect(control(page, 'button-project-product-launch-brief')).toBeVisible();
});

test('PROJ-03 and PROJ-05 include files across thresholds, block without truncation and preserve recovery draft', async ({
  page,
}) => {
  const values = projects();
  values[0].files.push(
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'large.txt',
      extension: 'txt',
      size: 38000,
      text: 'x'.repeat(38000),
      included: false,
    },
    {
      id: '30000000-0000-4000-8000-000000000004',
      name: 'extra.txt',
      extension: 'txt',
      size: 16000,
      text: 'y'.repeat(16000),
      included: false,
    },
  );
  await seed(page, { projects: values });
  await loadModel(page);
  await openResearch(page);
  const draft = control(page, 'textarea-start-chat');
  await draft.fill('Keep this first message through recovery');
  await expect(control(page, 'button-start-chat')).toBeEnabled();
  await control(page, 'switch-include-large-txt').click();
  await expect(page.getByText('Close to the limit', { exact: true })).toBeVisible();
  await control(page, 'switch-include-extra-txt').click();
  await expect(control(page, 'button-start-chat')).toBeDisabled();
  await expect(
    page.getByText('This project does not fit in the context window', { exact: true }),
  ).toBeVisible();
  await expect(control(page, 'meter-project-context')).toHaveAttribute(
    'aria-valuetext',
    /over the limit/,
  );
  expect(await page.evaluate(() => localStorage.getItem('mir-fixture-request'))).toBeNull();
  await control(page, 'button-review-files').click();
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeFocused();
  await expect(draft).toHaveValue('Keep this first message through recovery');
  await control(page, 'button-change-context-size').click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Model settings', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(draft).toHaveValue('Keep this first message through recovery');
  await control(page, 'switch-include-extra-txt').click();
  await expect(control(page, 'button-start-chat')).toBeEnabled();
  await expect(control(page, 'switch-include-extra-txt')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await openResearch(page);
  await expect(control(page, 'switch-include-large-txt')).toHaveAttribute('aria-checked', 'true');
  await expect(control(page, 'switch-include-extra-txt')).toHaveAttribute('aria-checked', 'false');
});

test('PROJ-03 starts a member chat with stable project prefix and sidebar New chat stays outside', async ({
  page,
}) => {
  await seed(page);
  await loadModel(page);
  await openResearch(page);
  await control(page, 'textarea-start-chat').fill('First project question');
  await control(page, 'button-start-chat').click();
  await expect(control(page, 'button-crumb-project')).toHaveText('Thesis research');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  const first = await lastRequest(page);
  expect(first.messages[0]).toEqual({
    role: 'system',
    content:
      'Use the research project instructions.\n\n--- BEGIN ATTACHMENT "notes.md" ---\nIncluded research notes.\n--- END ATTACHMENT "notes.md" ---',
  });
  expect(first.messages[1]).toEqual({ role: 'user', content: 'First project question' });
  expect(JSON.stringify(first)).not.toContain('Excluded project text');
  await expect
    .poll(
      async () =>
        (await readHistory(page)).find((value) => value.id === first.conversationId)?.projectId,
    )
    .toBe(ids.research);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Second project question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  expect((await lastRequest(page)).messages[0]).toEqual(first.messages[0]);
  await control(page, 'button-new-chat').click();
  await expect(control(page, 'button-crumb-project')).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Outside project question');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  expect((await lastRequest(page)).messages[0]).toEqual({
    role: 'user',
    content: 'Outside project question',
  });
});

test('CHAT-20 moves with the own-prompt warning, preserves exports and supports remove and Undo', async ({
  page,
}) => {
  await seed(page);
  await openOwnChat(page);
  const trigger = control(page, 'button-options-for-a-chat-with-its-own-prompt');
  await trigger.click();
  await control(page, 'button-move-to-project').click();
  const dialog = page.getByRole('dialog', { name: 'Move “A chat with its own prompt”' });
  await expect(control(page, 'input-find-project')).toBeFocused();
  await control(page, 'input-find-project').fill('Thesis');
  const list = page.getByRole('listbox', { name: 'Active projects' });
  await list.focus();
  await page.keyboard.press('ArrowDown');
  await expect(control(page, 'option-project-thesis-research')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog).toContainText('This chat has its own system prompt');
  await expect(dialog).toContainText('Your prompt is kept with the chat and returns');
  await expect(control(page, 'button-confirm-move')).toHaveText('Move to Thesis research');
  await control(page, 'button-confirm-move').click();
  await expect(control(page, 'button-crumb-project')).toBeVisible();
  for (const exportControl of ['button-export-chat', 'button-export-with-reasoning']) {
    await trigger.click();
    await control(page, exportControl).click();
    const exported = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mir-fixture-export')!),
    );
    expect(exported.version).toBe(1);
    expect(exported.conversation.messages[0]).toEqual({
      role: 'system',
      content: 'Use the research project instructions.',
    });
    expect(JSON.stringify(exported)).not.toContain('Stored own instructions.');
    expect(JSON.stringify(exported)).not.toContain('Included research notes.');
  }
  await trigger.click();
  await control(page, 'button-move-to-project').click();
  await expect(control(page, 'option-project-thesis-research')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await control(page, 'button-remove-from-project').click();
  await expect(control(page, 'button-crumb-project')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await readHistory(page)).find((value) => value.id === ids.ownChat)?.ownSystemPrompt,
    )
    .toBe('Stored own instructions.');
  await trigger.click();
  await control(page, 'button-export-chat').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('mir-fixture-export')!).conversation.messages[0],
    ),
  ).toEqual({ role: 'system', content: 'Stored own instructions.' });
  await control(page, 'button-undo').click();
  await expect(control(page, 'button-crumb-project')).toBeVisible();
  await page.reload();
  await control(page, 'button-chat-a-chat-with-its-own-prompt').click();
  await expect(control(page, 'button-crumb-project')).toBeVisible();
});

test('CHAT-21 edits shared instructions from the chip and exports the current prompt', async ({
  page,
  browserName,
}) => {
  await seed(page);
  await control(page, 'button-chat-existing-research-chat').click();
  const chip = control(page, 'button-system-prompt');
  await expect(chip).toContainText('Project instructions');
  await chip.click();
  const editor = page.getByRole('dialog', { name: 'System prompt: Project instructions' });
  await expect(editor).toContainText('Changes apply to all 2 chats');
  const instructions = control(page, 'textarea-project-instructions');
  await instructions.fill('Updated shared instructions.');
  await expect(editor).toContainText('≈');
  await control(page, 'button-save-instructions-for-chats').focus();
  await tabToNextControl(page, browserName);
  await expect(control(page, 'button-close-project-instructions')).toBeFocused();
  await control(page, 'button-save-instructions-for-chats').click();
  await expect(editor).toHaveCount(0);
  await expect(chip).toBeFocused();
  await control(page, 'button-options-for-existing-research-chat').click();
  await control(page, 'button-export-chat').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('mir-fixture-export')!).conversation.messages[0],
    ),
  ).toEqual({ role: 'system', content: 'Updated shared instructions.' });
  await chip.click();
  await control(page, 'button-open-project-from-prompt').click();
  await expect(page.getByRole('heading', { name: 'Thesis research', exact: true })).toBeVisible();
  await expect(page.getByText('Updated shared instructions.', { exact: true })).toBeVisible();
});

test('CHAT-20 creates a destination when no projects exist and warns about an explicitly empty own prompt', async ({
  page,
}) => {
  const own = history()[0];
  own.options = { systemPrompt: '', reasoning: null, effort: null };
  await seed(page, { projects: [], history: [own] });
  await openOwnChat(page);
  await control(page, 'button-options-for-a-chat-with-its-own-prompt').click();
  await control(page, 'button-move-to-project').click();
  await expect(page.getByRole('dialog')).toContainText('There are no active projects yet.');
  await control(page, 'button-new-project-for-chat').click();
  await control(page, 'input-project-name').fill('A new destination');
  await expect(page.getByRole('dialog', { name: 'New project', exact: true })).toContainText(
    'This chat has its own system prompt',
  );
  await control(page, 'button-create-project').click();
  await expect(page.getByRole('heading', { name: 'A new destination', exact: true })).toBeVisible();
  const storedProjects = await readProjects(page);
  await expect.poll(async () => (await readHistory(page))[0].projectId).toBe(storedProjects[0].id);
  expect((await readHistory(page))[0].ownSystemPrompt).toBe('');
  await control(page, 'button-open-a-chat-with-its-own-prompt').click();
  await control(page, 'button-options-for-a-chat-with-its-own-prompt').click();
  await control(page, 'button-remove-from-project').click();
  await control(page, 'button-options-for-a-chat-with-its-own-prompt').click();
  await control(page, 'button-export-chat').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('mir-fixture-export')!).conversation.messages[0].role,
    ),
  ).toBe('user');
});

test('DIALOG-08 archives read-only projects, restores them and offers Undo', async ({ page }) => {
  await seed(page);
  await loadModel(page);
  await openResearch(page);
  await control(page, 'button-options-for-current-project').click();
  await control(page, 'button-archive-project-menu').click();
  await expect(page.getByRole('alertdialog')).toContainText('Its 2 chats stay readable');
  await control(page, 'button-archive-project').click();
  await expect(page.getByText('This project is archived', { exact: true })).toBeVisible();
  await expect(control(page, 'button-project-thesis-research')).toHaveCount(0);
  await expect(control(page, 'textarea-start-chat')).toBeDisabled();
  await expect(control(page, 'switch-include-notes-md')).toBeDisabled();
  await expect(control(page, 'button-edit-instructions')).toHaveCount(0);
  await control(page, 'button-open-existing-research-chat').click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await control(page, 'button-system-prompt').click();
  await expect(control(page, 'textarea-project-instructions')).toHaveAttribute('readonly', '');
  await expect(control(page, 'button-save-instructions-for-chats')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await control(page, 'button-restore-from-chat').click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  await control(page, 'button-undo').click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await control(page, 'button-all-projects').click();
  await control(page, 'tab-archived-projects').click();
  await control(page, 'button-options-for-project-thesis-research').click();
  await expect(control(page, 'button-delete-project-menu')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await control(page, 'button-restore-project-menu').click();
  await control(page, 'tab-active-projects').click();
  await expect(control(page, 'button-open-project-thesis-research')).toBeVisible();
});

test('DIALOG-07 keeps chats by default and restores their own prompts without exporting files', async ({
  page,
}) => {
  const chats = history();
  chats[1].ownSystemPrompt = 'Member own prompt';
  await seed(page, { history: chats });
  await openResearch(page);
  await control(page, 'button-options-for-current-project').click();
  await control(page, 'button-delete-project-menu').click();
  await expect(control(page, 'checkbox-also-delete-chats')).not.toBeChecked();
  await expect(control(page, 'button-delete-project')).toHaveText('Delete project');
  await control(page, 'button-delete-project').click();
  await expect
    .poll(async () => (await readProjects(page)).some((value) => value.id === ids.research))
    .toBe(false);
  await expect
    .poll(
      async () => (await readHistory(page)).find((value) => value.id === ids.memberChat)?.projectId,
    )
    .toBeNull();
  await control(page, 'button-existing-research-chat').click();
  await expect(control(page, 'button-crumb-project')).toHaveCount(0);
  await control(page, 'button-options-for-existing-research-chat').click();
  await control(page, 'button-export-chat').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('mir-fixture-export')!).conversation.messages[0],
    ),
  ).toEqual({ role: 'system', content: 'Member own prompt' });
  await expect(control(page, 'button-undo')).toHaveCount(0);
});

test('DIALOG-07 deletes member chats only after selecting the explicit destructive option', async ({
  page,
}) => {
  await seed(page);
  await openResearch(page);
  await control(page, 'button-options-for-current-project').click();
  await control(page, 'button-delete-project-menu').click();
  await control(page, 'checkbox-also-delete-chats').check();
  await expect(control(page, 'button-delete-project')).toHaveText('Delete project and 2 chats');
  await control(page, 'button-delete-project').click();
  await expect
    .poll(async () => (await readHistory(page)).map((value) => value.id))
    .toEqual([ids.ownChat]);
  await expect(control(page, 'button-chat-existing-research-chat')).toHaveCount(0);
});

test('PROJ-03 adds supported text, removes files with Undo and keeps errors explicit', async ({
  page,
}) => {
  await seed(page);
  await openResearch(page);
  await page.evaluate(() =>
    localStorage.setItem('mir-fixture-attachment-paths', JSON.stringify(['/fixture/report.pdf'])),
  );
  await page.evaluate(() => localStorage.setItem('mir-fixture-reading-paused', 'true'));
  await control(page, 'button-add-project-files').click();
  const reading = page
    .getByRole('list', { name: 'Project files' })
    .locator('li')
    .filter({ hasText: 'report.pdf' });
  await expect(reading.getByRole('status')).toHaveText('Reading text…');
  await expect(
    reading.getByRole('button', { name: 'Remove report.pdf from the project' }),
  ).toBeDisabled();
  await page.evaluate(() => localStorage.removeItem('mir-fixture-reading-paused'));
  await expect(reading.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText('report.pdf');
  await control(page, 'button-remove-file-report-pdf').click();
  await expect(page.getByRole('list', { name: 'Project files' })).not.toContainText('report.pdf');
  await control(page, 'button-undo').click();
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText('report.pdf');
  await page.evaluate(() =>
    localStorage.setItem('mir-fixture-attachment-paths', JSON.stringify(['/fixture/image.png'])),
  );
  await control(page, 'button-add-project-files').click();
  const failure = page
    .getByRole('alert')
    .filter({ hasText: 'Project data could not be saved or loaded' });
  await expect(failure).toContainText('This file type is not supported.');
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText('report.pdf');
  const failedRow = page
    .getByRole('list', { name: 'Project files' })
    .locator('li')
    .filter({ hasText: 'image.png' });
  await expect(failedRow.getByRole('alert')).toHaveText('This file type is not supported.');
  await failedRow.getByRole('button', { name: 'Remove image.png from the project' }).click();
  await expect(failedRow).toHaveCount(0);
  expect(
    (await readProjects(page))
      .find((value) => value.id === ids.research)
      ?.files.map((file) => file.name),
  ).not.toContain('image.png');
  await page.getByRole('button', { name: 'Retry loading projects', exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText('report.pdf');
});

test('PROJ-03 routes native file drops to the visible project without altering the hidden chat', async ({
  page,
}) => {
  await seed(page);
  await openOwnChat(page);
  await openResearch(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('mir-fixture-drag-drop', {
        detail: {
          type: 'drop',
          paths: ['/fixture/project-only.docx'],
          position: { x: 800, y: 500 },
        },
      }),
    ),
  );
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText(
    'project-only.docx',
  );
  expect(
    (await readHistory(page)).find((value) => value.id === ids.ownChat)?.attachments ?? [],
  ).toEqual([]);
  expect(
    (await readProjects(page)).find((value) => value.id === ids.research)?.files.at(-1)?.text,
  ).toBe('Extracted fixture text from project-only.docx.');
});

test('Q1 permits unknown capacity, restores rejected drafts and retries without duplicating a turn', async ({
  page,
}) => {
  await seed(page, {
    history: [],
    flags: {
      'mir-fixture-context-unavailable': 'true',
      'mir-fixture-tokenize-unavailable': 'true',
      'mir-fixture-context-rejection': 'true',
    },
  });
  await loadModel(page);
  await openResearch(page);
  await expect(page.getByText('Capacity unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.project-capacity')).toContainText('≈');
  await expect(control(page, 'meter-project-context')).toHaveCount(0);
  await control(page, 'textarea-start-chat').fill('Do not lose my rejected draft');
  await expect(control(page, 'button-start-chat')).toBeEnabled();
  await control(page, 'button-start-chat').click();
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(draft).toHaveValue('Do not lose my rejected draft');
  await expect(page.getByRole('button', { name: 'Review files', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Change context size in Settings', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('mir-fixture-context-rejection'));
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  const request = await lastRequest(page);
  expect(request.messages.filter((message) => message.role === 'user')).toEqual([
    { role: 'user', content: 'Do not lose my rejected draft' },
  ]);
  expect(request.messages[0].content).toContain('Included research notes.');
});

test('Q2 preserves the sent prefix while shared edits apply next turn and only lifecycle mutations wait', async ({
  page,
}) => {
  await seed(page, { scenario: 'cancel' });
  await loadModel(page);
  await control(page, 'button-chat-existing-research-chat').click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Generate with the old shared prefix');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
  const first = await lastRequest(page);
  await control(page, 'button-options-for-existing-research-chat').click();
  await expect(control(page, 'button-move-to-project')).toHaveAttribute('aria-disabled', 'true');
  await expect(control(page, 'button-remove-from-project')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('menu')).toContainText(
    'Available when the current response finishes or is stopped',
  );
  await page.keyboard.press('Escape');
  await control(page, 'button-options-for-another-research-chat').click();
  await expect(control(page, 'button-move-to-project')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await control(page, 'button-move-to-project').click();
  await control(page, 'option-project-home-server-setup').click();
  await control(page, 'button-confirm-move').click();
  await expect
    .poll(
      async () =>
        (await readHistory(page, 'cancel')).find((value) => value.id === ids.otherChat)?.projectId,
    )
    .toBe(ids.server);
  await control(page, 'button-system-prompt').click();
  await expect(
    page.getByRole('dialog', { name: 'System prompt: Project instructions' }),
  ).toContainText('Changes apply from the next message.');
  await control(page, 'textarea-project-instructions').fill(
    'New shared instructions for the next request.',
  );
  await control(page, 'button-save-instructions-for-chats').click();
  expect((await lastRequest(page)).messages).toEqual(first.messages);
  await control(page, 'button-crumb-project').click();
  await control(page, 'button-options-for-current-project').click();
  await expect(control(page, 'button-archive-project-menu')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(control(page, 'button-delete-project-menu')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(control(page, 'button-edit-project-details')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(control(page, 'button-star-project-menu')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(control(page, 'switch-include-notes-md')).toBeEnabled();
  await control(page, 'switch-include-notes-md').click();
  await expect(control(page, 'switch-include-notes-md')).toHaveAttribute('aria-checked', 'false');
  expect((await lastRequest(page)).messages).toEqual(first.messages);
  await control(page, 'button-chat-existing-research-chat').click();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use the updated project');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
  expect((await lastRequest(page)).messages[0]).toEqual({
    role: 'system',
    content: 'New shared instructions for the next request.',
  });
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
});

test('failed project saves preserve the instructions editor for an explicit retry', async ({
  page,
}) => {
  await seed(page);
  await openResearch(page);
  await control(page, 'button-edit-instructions').click();
  await control(page, 'textarea-edit-project-instructions').fill(
    'Keep this unsaved instruction edit',
  );
  await page.evaluate(() => localStorage.setItem('mir-fixture-project-save-error', 'true'));
  await control(page, 'button-save-instructions').click();
  await expect(
    page.getByRole('dialog', { name: 'Project instructions', exact: true }),
  ).toBeVisible();
  await expect(control(page, 'textarea-edit-project-instructions')).toHaveValue(
    'Keep this unsaved instruction edit',
  );
  await expect(
    page.getByRole('dialog', { name: 'Project instructions', exact: true }).getByRole('alert'),
  ).toContainText('Project storage is not writable.');
  await page.evaluate(() => localStorage.removeItem('mir-fixture-project-save-error'));
  await control(page, 'button-save-instructions').click();
  await expect(page.getByRole('dialog', { name: 'Project instructions', exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(
      async () =>
        (await readProjects(page)).find((value) => value.id === ids.research)?.instructions,
    )
    .toBe('Keep this unsaved instruction edit');
});

test('archived member chats cannot change Reasoning or write request options', async ({ page }) => {
  const values = projects();
  values[0].archived = true;
  await seed(page, { projects: values });
  await loadModel(page);
  await control(page, 'button-chat-existing-research-chat').click();
  const before = await readHistory(page);
  const reasoning = page.getByRole('button', { name: 'Reasoning', exact: true });
  await expect(reasoning).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await reasoning.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Reasoning', exact: true })).toHaveCount(0);
  expect(await readHistory(page)).toEqual(before);
  await expect(page.getByText('Conversation could not be saved', { exact: true })).toHaveCount(0);
});

for (const source of ['All projects', 'Project detail'] as const) {
  test(`import from ${source} preserves canceled/error views and opens a successful outside-project chat`, async ({
    page,
  }) => {
    await seed(page);
    if (source === 'All projects') await control(page, 'button-all-projects').click();
    else await openResearch(page);
    const heading = page.getByRole('heading', {
      name: source === 'All projects' ? 'Projects' : 'Thesis research',
      exact: true,
    });
    const importAction = page.getByRole('button', { name: 'Import conversation', exact: true });
    const initialHistory = await readHistory(page);
    await page.evaluate(() => localStorage.setItem('mir-fixture-import-path', 'cancel'));
    await importAction.click();
    await expect(importAction).toBeEnabled();
    await expect(heading).toBeVisible();
    expect(await readHistory(page)).toEqual(initialHistory);
    await page.evaluate(() => {
      localStorage.removeItem('mir-fixture-import-path');
      localStorage.setItem('mir-fixture-import-error', 'true');
    });
    await importAction.click();
    const failure = page.getByRole('alert').filter({ hasText: 'Import failed' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('import.json');
    await expect(failure).toContainText('unsupported role');
    await expect(
      failure.getByRole('button', { name: 'Choose another file', exact: true }),
    ).toBeVisible();
    await expect(heading).toBeVisible();
    expect(await readHistory(page)).toEqual(initialHistory);
    await page.evaluate(() => localStorage.removeItem('mir-fixture-import-error'));
    await failure.getByRole('button', { name: 'Choose another file', exact: true }).click();
    await expect(page.locator('.message.user')).toContainText('Imported question');
    await expect(page.locator('.message.assistant')).toContainText('Imported answer');
    await expect(heading).toHaveCount(0);
    await expect(control(page, 'button-crumb-project')).toHaveCount(0);
    await expect(failure).toHaveCount(0);
    const saved = await readHistory(page);
    expect(saved).toHaveLength(initialHistory.length + 1);
    const imported = saved.find(
      (value) => !initialHistory.some((original) => original.id === value.id),
    );
    expect(imported?.messages[0].content).toBe('Imported question');
    expect(imported?.projectId ?? null).toBeNull();
  });
}

for (const deleteChats of [false, true]) {
  test(`deleting a project ${deleteChats ? 'deletes' : 'keeps'} its unsaved first chat after full-request preflight blocks`, async ({
    page,
  }) => {
    await seed(page, { history: [], flags: { 'mir-fixture-prompt-tokens': '20000' } });
    await loadModel(page);
    await openResearch(page);
    const draftText = 'Preserve this unsaved first project message';
    await control(page, 'textarea-start-chat').fill(draftText);
    await expect(control(page, 'button-start-chat')).toBeEnabled();
    await control(page, 'button-start-chat').click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      draftText,
    );
    await expect(page.getByRole('alert')).toContainText('exceed the 16,384-token context');
    expect(await page.evaluate(() => localStorage.getItem('mir-fixture-request'))).toBeNull();
    expect(await readHistory(page)).toEqual([]);
    await control(page, 'button-crumb-project').click();
    await control(page, 'button-options-for-current-project').click();
    await control(page, 'button-delete-project-menu').click();
    await expect(control(page, 'checkbox-also-delete-chats')).not.toBeChecked();
    await expect(page.getByRole('alertdialog')).toContainText('Also delete its 1 chats');
    if (deleteChats) await control(page, 'checkbox-also-delete-chats').check();
    await control(page, 'button-delete-project').click();
    await expect
      .poll(async () => (await readProjects(page)).some((value) => value.id === ids.research))
      .toBe(false);
    if (deleteChats) {
      await expect.poll(() => readHistory(page)).toEqual([]);
      await control(page, 'button-new-chat').click();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
      await expect(control(page, 'button-new-conversation')).toHaveCount(0);
    } else {
      await expect.poll(async () => (await readHistory(page)).length).toBe(1);
      const kept = (await readHistory(page))[0];
      expect(kept.projectId).toBeNull();
      expect(kept.messages).toEqual([]);
      await control(page, 'button-new-conversation').click();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
        draftText,
      );
      await expect(control(page, 'button-crumb-project')).toHaveCount(0);
    }
  });
}
