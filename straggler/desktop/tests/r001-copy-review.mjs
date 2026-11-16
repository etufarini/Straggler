// Compare the supplied R001 copy/presence dossier with the real React fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { prepareDesignScreen } from './design-scenarios.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossierPath = path.resolve(
  process.argv[2] || path.join(desktop, '../docs/to-be-implemented-design/ui-design.html'),
);
const output = path.join(desktop, 'test-results/design/r001-copy');
const baseURL = process.env.STRAGGLER_REVIEW_URL || 'http://127.0.0.1:1420';
const screens = [
  'CHAT-01',
  'CHAT-02',
  'CHAT-03',
  'CHAT-05',
  'TEMP-EMPTY',
  'TEMP-LEAVE',
  'SET-01',
  'SET-01D',
  'SET-02',
  'SET-05',
  'SET-HUB',
  'SET-WEB',
  'PROJECTS-DETAIL',
  'PROJECTS-ARCHIVE',
  'PROJECTS-DELETE',
  'DIALOG-02',
  'BUILD-01',
  'CHAT-11',
];
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function prepare(page, screen) {
  if (screen.startsWith('TEMP-')) {
    await page.goto('/?scenario=normal');
    await button(page, 'Launch server').click();
    await expect(page.locator('.local-badge')).toContainText('Ready');
    await button(page, 'Temporary').click();
    if (screen === 'TEMP-LEAVE') {
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Synthetic unsaved draft');
      await button(page, 'Settings').click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    }
  } else if (screen === 'SET-HUB' || screen === 'SET-WEB') {
    await page.goto(`/?scenario=${screen === 'SET-WEB' ? 'web-low' : 'normal'}`);
    await button(page, 'Settings').click();
    await button(page, screen === 'SET-HUB' ? 'Hugging Face' : 'Web search').click();
  } else if (screen.startsWith('PROJECTS-')) {
    await page.addInitScript(() => {
      localStorage.setItem(
        'straggler-fixture-projects-normal',
        JSON.stringify([
          {
            id: '10000000-0000-4000-8000-000000000001',
            name: 'Synthetic field notes',
            description: 'Dossier sample project',
            instructions: 'Use only the synthetic local notes.',
            starred: true,
            archived: false,
            createdAt: 1,
            updatedAt: 1,
            files: [
              {
                id: '30000000-0000-4000-8000-000000000001',
                name: 'notes.md',
                extension: 'md',
                size: 27,
                text: 'Synthetic local field notes.',
                included: true,
              },
            ],
          },
        ]),
      );
    });
    await page.goto('/?scenario=normal');
    await button(page, 'All projects').click();
    await button(page, 'Synthetic field notes').first().click();
    if (screen !== 'PROJECTS-DETAIL') {
      await page.locator('[data-control-id="button-options-for-current-project"]').click();
      await page
        .locator(
          `[data-control-id="button-${screen === 'PROJECTS-DELETE' ? 'delete' : 'archive'}-project-menu"]`,
        )
        .click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    }
  } else {
    await prepareDesignScreen(page, screen, baseURL);
  }
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  const dossier = await browser.newPage({
    viewport: { width: 2850, height: 1500 },
    reducedMotion: 'reduce',
  });
  await dossier.goto(pathToFileURL(dossierPath).href);
  await dossier.getByRole('button', { name: 'Compare', exact: true }).click();
  for (const [width, height] of [
    [1200, 820],
    [760, 620],
  ]) {
    await dossier.locator('#preview-size').selectOption(`${width},${height}`);
    for (const screen of screens) {
      const name = `${screen}-${width}x${height}`;
      await dossier.locator(`#catalog [data-screen="${screen}"]`).click();
      const proposal = dossier.locator('#stage iframe').nth(1);
      await expect(proposal.contentFrame().locator('.app-shell')).toBeVisible();
      // The dossier's scrollable workbench clips tall iframes. Render the exact
      // Compare srcdoc in an isolated viewport to capture its full CSS dimensions.
      const preview = await browser.newPage({ viewport: { width, height } });
      await preview.setContent(await proposal.getAttribute('srcdoc'));
      await preview.screenshot({ path: path.join(output, `${name}-proposal.png`) });
      const settingsScroll = await preview.evaluate(
        () => document.querySelector('.settings-page')?.scrollTop ?? null,
      );
      await preview.close();
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await prepare(page, screen);
      if (settingsScroll !== null) {
        await page.locator('.settings-page').evaluate((element, scrollTop) => {
          element.scrollTop = scrollTop;
        }, settingsScroll);
      }
      await page.screenshot({ path: path.join(output, `${name}-actual.png`) });
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('.presence');
        const canvas = panel?.querySelector('canvas');
        const rect = canvas?.getBoundingClientRect();
        return {
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          orb: rect
            ? {
                width: rect.width,
                height: rect.height,
                topInPanel: rect.top - panel.getBoundingClientRect().top,
                pixels: canvas.width,
              }
            : null,
        };
      });
      assert.deepEqual(errors, [], name);
      assert.equal(geometry.horizontalOverflow, false, name);
      results.push({ screen, width, height, errors, ...geometry });
      if (screen === 'CHAT-02' && width === 760) {
        await button(page, 'Expand assistant panel').click();
        await expect(page.locator('.presence-stage')).toHaveCSS('width', '224px');
        await page.screenshot({ path: path.join(output, `${name}-expanded.png`) });
      }
      await context.close();
      console.log(`Captured Compare proposal and live app: ${name}`);
    }
  }
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(results, null, 2));
  await writeFile(
    path.join(output, 'comparison.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>R001 copy and presence review</title><style>body{background:#10182f;color:#f3f6ff;font:14px sans-serif}section{display:flex;gap:16px}figure{margin:0}img{width:48vw;height:auto}h2{margin-top:32px}</style>${results
      .map(({ screen, width, height }) => {
        const name = `${screen}-${width}x${height}`;
        return `<h2>${name}</h2><section><figure><figcaption>Dossier proposal</figcaption><img src="${name}-proposal.png"></figure><figure><figcaption>Actual React app · simulated services</figcaption><img src="${name}-actual.png"></figure></section>`;
      })
      .join('')}`,
  );
} finally {
  await browser.close();
}
