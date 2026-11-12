import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { prepareDesignScreen } from './design-scenarios.mjs';

const dossier = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/new-design/mir-ui-design.html',
);

const executeFile = promisify(execFile);

// Resolve byte boundaries first so no read can spill into the embedded image block.
async function readFixtureState(screen) {
  const templateMarker = `<template id="proposal-${screen}">`;
  const { stdout } = await executeFile('grep', [
    '-b',
    '-o',
    '-F',
    '-e',
    templateMarker,
    '-e',
    '</template>',
    dossier,
  ]);
  const boundaries = stdout.trim().split('\n');
  const startIndex = boundaries.findIndex((line) => line.endsWith(`:${templateMarker}`));
  const start = Number(boundaries[startIndex]?.split(':')[0]);
  const end = Number(boundaries[startIndex + 1]?.split(':')[0]);
  if (
    startIndex < 0 ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end <= start
  ) {
    throw new Error(`R001 template boundaries are missing for ${screen}.`);
  }
  const file = await open(dossier, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    if (bytesRead !== buffer.length) throw new Error(`R001 template is incomplete for ${screen}.`);
    const fixture = /<script\b[^>]*data-r001-state[^>]*>([\s\S]*?)<\/script>/.exec(
      buffer.toString('utf8'),
    );
    if (!fixture) throw new Error(`R001 fixture state is missing for ${screen}.`);
    return JSON.parse(fixture[1]);
  } finally {
    await file.close();
  }
}

function fixtureId(value) {
  const hex = createHash('sha256').update(`mir-r001:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function extractedFixtureText(file) {
  const line = `Simulated extracted text from ${file.name}. This is a local interface fixture.\n`;
  const length = file.tokens * 4;
  return line.repeat(Math.ceil(length / line.length)).slice(0, length);
}

function materializeState(state, now, excludeStaticChat) {
  const projects = state.projects.map((project) => ({
    id: fixtureId(project.id),
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    starred: project.starred,
    archived: project.archived,
    createdAt: now - (project.updated + 1440) * 60000,
    updatedAt: now - project.updated * 60000,
    files: project.files.map((file) => {
      const text = extractedFixtureText(file);
      return {
        id: fixtureId(file.id),
        name: file.name,
        extension: file.name.split('.').at(-1),
        size: Buffer.byteLength(text),
        text,
        included: file.included,
      };
    }),
  }));
  const conversations = state.chats
    .filter((chat) => !excludeStaticChat || !chat.static)
    .map((chat) => ({
      id: fixtureId(chat.id),
      title: chat.title,
      model: '/fixture/models/example.gguf',
      projectId: chat.projectId ? fixtureId(chat.projectId) : null,
      ownSystemPrompt: chat.ownPrompt,
      options: { systemPrompt: chat.ownPrompt, reasoning: 'auto', effort: 'auto' },
      createdAt: now - (chat.updated + 60) * 60000,
      updatedAt: now - chat.updated * 60000,
      messages: chat.messages.map((message, index) => ({
        id: fixtureId(`${chat.id}-message-${index}`),
        role: message.role,
        content: message.text,
        reasoning: '',
        status: 'complete',
      })),
      attachments: [],
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return { projects, conversations };
}

export async function prepareR001Screen(page, screen, baseUrl = 'http://127.0.0.1:1420') {
  const state = await readFixtureState(screen);
  const baselineChat = ['CHAT-02', 'CHAT-17'].includes(screen);
  const fixture = materializeState(state, Date.now(), baselineChat);
  const scenario = screen === 'CHAT-01' ? 'empty' : 'normal';
  await page.addInitScript(
    ({ fixture, scenario, contextSize }) => {
      localStorage.setItem(`mir-fixture-${scenario}`, JSON.stringify(fixture.conversations));
      localStorage.setItem(`mir-fixture-projects-${scenario}`, JSON.stringify(fixture.projects));
      localStorage.setItem('mir-fixture-context-size', String(contextSize));
      localStorage.setItem(
        'mir-fixture-ui-preferences',
        JSON.stringify({ sidebarCollapsed: false, presenceExpanded: null }),
      );
    },
    { fixture, scenario, contextSize: state.context.nCtx },
  );
  if (screen === 'CHAT-01' || baselineChat) {
    await prepareDesignScreen(page, screen, baseUrl);
    await expect(page.locator('[data-control-id="button-new-project"]')).toBeEnabled();
    await page.mouse.move(0, 0);
    return;
  }
  await page.goto(`${baseUrl}/?scenario=normal`);
  const control = (id) => page.locator(`[data-control-id="${id}"]`);
  const button = (name) => page.getByRole('button', { name, exact: true });
  await expect(control('button-new-project')).toBeEnabled();
  await button('Launch server').click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');

  if (state.view === 'thread') {
    const chat = state.chats.find((value) => value.id === state.chatId);
    await page.getByTitle(chat.title, { exact: true }).click();
  } else {
    await control('button-all-projects').click();
    if (state.view === 'project') {
      const project = state.projects.find((value) => value.id === state.projectId);
      await page.getByRole('button', { name: project.name, exact: true }).first().click();
      await expect(control('meter-project-context')).toHaveAttribute(
        'aria-valuemax',
        String(state.context.nCtx - state.context.reserve),
      );
      await expect(page.locator('.project-capacity')).toContainText(
        'Counted by the running server.',
      );
    }
  }

  if (screen === 'PROJ-04') {
    await control('button-new-project-page').click();
    await expect(control('input-project-name')).toBeFocused();
  }
  if (screen === 'CHAT-20') {
    await button('Options for Draft a cover letter').click();
    await control('button-move-to-project').click();
    await control('option-project-thesis-research').click();
    await expect(control('button-confirm-move')).toHaveText('Move to Thesis research');
  }
  if (screen === 'CHAT-21') {
    await control('button-system-prompt').click();
    await expect(control('textarea-project-instructions')).toBeVisible();
  }
  if (screen === 'DIALOG-07') {
    await control('button-options-for-current-project').click();
    await control('button-delete-project-menu').click();
    await expect(control('checkbox-also-delete-chats')).not.toBeChecked();
  }
  if (screen === 'DIALOG-08') {
    await control('button-options-for-project-home-server-setup').click();
    await control('button-archive-project-menu').click();
    await expect(control('button-archive-project')).toBeVisible();
  }
  await page.locator('.app-shell').waitFor();
  await page.mouse.move(0, 0);
}

export async function inspectProjectLayout(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const problems = [];
  const modal = page.locator('[role="dialog"], [role="alertdialog"]').last();
  const scope = (await modal.isVisible()) ? modal : page;
  const controls = scope.locator('[data-control-id]').filter({ visible: true });
  for (const control of await controls.all()) {
    if (!(await control.isEnabled())) continue;
    const tag = await control.evaluate((element) => element.tagName);
    if (!['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) continue;
    await control.scrollIntoViewIfNeeded();
    const reachable = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= -1 && rect.right <= innerWidth + 1 && rect.bottom > 0 && rect.top < innerHeight
      );
    });
    if (!reachable) problems.push(await control.getAttribute('data-control-id'));
  }
  return { overflow, unreachableControls: problems };
}
