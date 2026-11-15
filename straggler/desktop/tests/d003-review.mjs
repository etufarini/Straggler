// Run against the fixture dev server: node --experimental-strip-types tests/d003-review.mjs [dossier-path].
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { prepareDesignScreen } from './design-scenarios.mjs';
import { settingsColorViolations, contrastRatio } from './designColors.ts';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossierPath = path.resolve(
  process.argv[2] || path.join(desktop, '../docs/to-be-implemented-design/ui-design.html'),
);
const output = path.join(desktop, 'test-results/design/d003');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const screens = [
  'CHAT-01',
  'CHAT-02',
  'TEMP-CHAT',
  'SET-01',
  'SET-02',
  'SET-04',
  'SET-05',
  'STATE-01',
  'SELECT-CONTEXT',
  'DIALOG-01',
  'BUILD-02',
  'ENTRY-SETUP',
  'PROJ-01',
  'PROJ-03',
  'MODEL-01',
  'WEB-SEARCH',
];
const results = [];
const paletteChecks = [];
const differences = [
  'Web search is already implemented. Its additional composer chip and Settings navigation entry are preserved; the supplied dossier predates them.',
  'The live canvas orb replaces the still captured in the dossier. Its size stays 224px in the expanded panel, with a 48px compact rail.',
  'At 760px the real app uses its existing compact assistant rail; the disconnected dossier keeps an expanded panel over chat.',
  'Control density follows measured space and may hide values or labels; the dossier contains static controls from before the composer fix.',
  'Project context estimates and relative timestamps come from synthetic fixture records and can differ from captured totals. No inference is run.',
  'The Web search prototype uses Tavily and a missing key; the actual screen uses the existing mock provider with a saved key. Prototype-only scenario controls and its captured sidebar conversation are absent.',
  'Danger actions retain their specified red surfaces even where the dossier override specificity makes the profile delete button neutral. The development notice stays muted in Temporary chat as well.',
  'Launch server also becomes tonal beside an enabled New project action, following the one-primary-per-view rule.',
  'At 760px the live context-size list opens above its trigger after scrolling it into view. The disconnected dossier keeps the captured scroll and popup coordinates.',
  'The brand keeps its blue glow. The rest of the Settings palette, including portal controls, is teal.',
];
try {
  const dossier = await browser.newPage({
    viewport: { width: 1950, height: 1500 },
    reducedMotion: 'reduce',
  });
  await dossier.goto(pathToFileURL(dossierPath).href);
  // Use the supplied project names and descriptions, rather than inventing visual content.
  const projectRecords = await dossier.evaluate(() => {
    const template = document.getElementById('baseline-PROJ-01');
    return [...template.content.querySelectorAll('.project-card')].map((card) => ({
      name: card.querySelector('.project-card-open').textContent.trim(),
      description: card.querySelector('.project-card-desc')?.textContent.trim() ?? '',
    }));
  });
  async function prepare(page, screen) {
    const button = (name) => page.getByRole('button', { name, exact: true });
    if (screen.startsWith('PROJ-')) {
      const ids = projectRecords.map(
        (_, index) => `10000000-0000-4000-8000-00000000000${index + 1}`,
      );
      await page.addInitScript(
        ({ projectRecords, ids }) => {
          const now = Date.now();
          const records = projectRecords.map((record, index) => ({
            id: ids[index],
            name: record.name,
            description: record.description === 'No description' ? '' : record.description,
            instructions: index
              ? ''
              : 'Use only the synthetic research notes. Explain uncertainty.',
            starred: index < 2,
            archived: false,
            createdAt: now - 3600000,
            updatedAt: now - (index ? 3600000 : 60000),
            files: index
              ? []
              : [
                  {
                    id: '30000000-0000-4000-8000-000000000001',
                    name: 'notes.md',
                    extension: 'md',
                    size: 48,
                    text: 'Synthetic research notes for the design fixture.',
                    included: true,
                  },
                  {
                    id: '30000000-0000-4000-8000-000000000002',
                    name: 'excluded.txt',
                    extension: 'txt',
                    size: 24,
                    text: 'Excluded synthetic text.',
                    included: false,
                  },
                ],
          }));
          records.push({
            ...records[1],
            id: '10000000-0000-4000-8000-000000000004',
            name: 'Recipe collection',
            starred: false,
            archived: true,
          });
          localStorage.setItem('straggler-fixture-projects-normal', JSON.stringify(records));
          localStorage.setItem(
            'straggler-fixture-normal',
            JSON.stringify([
              {
                id: '20000000-0000-4000-8000-000000000001',
                title: 'A chat with its own prompt',
                createdAt: now,
                updatedAt: now,
                messages: [],
              },
              {
                id: '20000000-0000-4000-8000-000000000002',
                title: 'Existing research chat',
                projectId: ids[0],
                createdAt: now - 60000,
                updatedAt: now - 60000,
                messages: [],
              },
            ]),
          );
        },
        { projectRecords, ids },
      );
      await page.goto('http://127.0.0.1:1420/?scenario=normal');
      await page.locator('[data-control-id="button-all-projects"]').click();
      if (screen === 'PROJ-03')
        await page
          .locator('.project-card-open')
          .filter({ hasText: projectRecords[0].name })
          .click();
      return;
    }
    if (screen === 'ENTRY-SETUP') {
      await page.goto('http://127.0.0.1:1420/?scenario=empty');
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      return;
    }
    if (screen === 'SELECT-CONTEXT') {
      await prepareDesignScreen(page, 'SET-01');
      await page.getByRole('combobox', { name: 'Context size', exact: true }).click();
      return;
    }
    if (screen === 'TEMP-CHAT') {
      await page.goto('http://127.0.0.1:1420/?scenario=normal');
      await button('Launch server').click();
      await button('Temporary').click();
      const expand = button('Expand assistant panel');
      if (await expand.isVisible()) await expand.click();
      await button('Choose files').click();
      await page.locator('.file-row.is-ready').waitFor();
      const collapse = button('Collapse assistant panel');
      if (await page.locator('.presence-slot.is-narrow').count()) await collapse.click();
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Synthetic temporary question');
      await button('Send message').click();
      await page.getByRole('button', { name: 'Copy response', exact: true }).waitFor();
      return;
    }
    if (screen === 'WEB-SEARCH') {
      await page.goto('http://127.0.0.1:1420/?scenario=web-normal');
      await button('Settings').click();
      await button('Web search').click();
      return;
    }
    await prepareDesignScreen(page, screen);
  }
  for (const [width, height] of [
    [1200, 820],
    [760, 560],
  ]) {
    for (const screen of screens) {
      const name = `${screen}-${width}x${height}`;
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await prepare(page, screen);
      // Match the dossier's initial scroll position after fixture setup interactions.
      if (screen !== 'SELECT-CONTEXT')
        await page.locator('.settings-page').evaluateAll((nodes) =>
          nodes.forEach((node) => {
            node.scrollTop = 0;
          }),
        );
      if (screen === 'CHAT-02' || screen === 'TEMP-CHAT')
        await page.locator('.messages').evaluate((node) => {
          node.scrollTop = 0;
        });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${name}-actual.png`) });
      const area = await page.locator('body').getAttribute('data-area');
      const colors = area === 'settings' ? await settingsColorViolations(page) : [];
      assert.deepEqual(colors, [], `Settings colors in ${name}`);
      assert.deepEqual(errors, [], `Console in ${name}`);
      const layers = await page
        .locator('.sidebar, .workspace')
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundImage));
      assert.equal(layers[0].includes('.svg'), false, `No sidebar stars in ${name}`);
      assert.equal(
        layers[1].includes('starfield'),
        area !== 'temporary',
        `Workspace sky in ${name}`,
      );
      if (area === 'settings' || screen === 'CHAT-01') {
        const palette = await page.locator('body').evaluate((node) => {
          const style = getComputedStyle(node);
          return Object.fromEntries(
            [
              '--ui-text-3',
              '--ui-accent-text',
              '--ui-focus',
              '--ui-elev-0',
              '--ui-elev-1',
              '--ui-elev-2',
              '--ui-elev-3',
              '--ui-raised-2',
            ].map((token) => [token, style.getPropertyValue(token).trim()]),
          );
        });
        for (const token of [
          '--ui-elev-0',
          '--ui-elev-1',
          '--ui-elev-2',
          '--ui-elev-3',
          '--ui-raised-2',
        ]) {
          const ratio = contrastRatio(palette['--ui-text-3'], palette[token]);
          assert(ratio >= 4.5, `${name} tertiary contrast on ${token}`);
          paletteChecks.push({
            name,
            token,
            foreground: palette['--ui-text-3'],
            background: palette[token],
            ratio,
          });
        }
      }
      if (screen === 'WEB-SEARCH') {
        const prototype = await browser.newPage({
          viewport: { width, height },
          reducedMotion: 'reduce',
        });
        await prototype.goto(
          pathToFileURL(path.join(path.dirname(dossierPath), 'web-search-prototype.html')).href,
        );
        await prototype.getByRole('button', { name: 'Settings', exact: true }).click();
        await prototype.screenshot({ path: path.join(output, `${name}-proposal.png`) });
        await prototype.close();
      } else {
        await dossier.locator(`[data-screen="${screen}"]`).click();
        await dossier.locator('[data-mode="proposal"]').click();
        await dossier.locator('#preview-size').selectOption(`${width},${height}`);
        await dossier.frameLocator('#stage iframe').locator('#root').waitFor();
        await dossier
          .locator('#stage iframe')
          .screenshot({ path: path.join(output, `${name}-proposal.png`) });
        if (screen === 'SET-01') {
          await dossier.locator('[data-mode="comparison"]').click();
          await dossier
            .locator('#stage')
            .screenshot({ path: path.join(output, `${name}-dossier-comparison.png`) });
        }
      }
      results.push({
        name,
        screen,
        width,
        height,
        area,
        errors,
        colors,
        layers,
        reference: true,
      });
      await context.close();
      console.log(`PASS: ${name}`);
    }
  }
  for (const background of ['#1a716b', '#1f8079'])
    paletteChecks.push({
      name: 'Settings primary',
      foreground: '#ffffff',
      background,
      ratio: contrastRatio('#ffffff', background),
    });
  await writeFile(
    path.join(output, 'checks.json'),
    JSON.stringify({ results, paletteChecks, differences }, null, 2),
  );
  await writeFile(
    path.join(output, 'comparison.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>D003 actual and approved proposal</title><style>body{background:#10182f;color:#f3f6ff;font:14px sans-serif}section{display:flex;gap:16px;overflow:auto}figure{margin:0}img{max-width:48vw;height:auto;object-fit:contain}</style><h1>D003 review · simulated services, no inference</h1><ul>${differences.map((text) => `<li>${text}</li>`).join('')}</ul>${results.map(({ name, reference }) => `<h2>${name}</h2><section>${reference ? `<figure><figcaption>Approved dossier · Proposal</figcaption><img src="${name}-proposal.png"></figure>` : ''}<figure><figcaption>Actual app · fixture services</figcaption><img src="${name}-actual.png"></figure></section>`).join('')}`,
  );
  console.log(
    `PASS: ${results.length} screens, color scans, star placement and contrasts: ${output}`,
  );
} finally {
  await browser.close();
}
