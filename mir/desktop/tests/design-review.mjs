// Capture the actual React interface and the approved proposals at identical sizes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { prepareDesignScreen, reviewScreens } from './design-scenarios.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] || 'final';
assert.match(phase, /^[a-z0-9-]+$/);
const output = path.join(desktop, 'test-results/design', phase);
await mkdir(output, { recursive: true });
const dossier = await readFile(path.join(desktop, '../docs/new_design/mir-ui-design.html'), 'utf8');
function reference(id) {
  const source = (element) =>
    dossier.match(
      new RegExp(`<[^>]+id="${element}"[^>]*>([\\s\\S]*?)<\\/(?:style|script|template)>`),
    )[1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${source('baseline-styles')}\n${source('proposal-styles')}</style></head><body>${source(`proposal-${id}`)}</body></html>`;
}
const results = [];
for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [
      [1200, 820],
      [960, 720],
    ]) {
      for (const screen of phase === 'final' ? reviewScreens : ['CHAT-01', 'SET-01']) {
        const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await prepareDesignScreen(page, screen);
        const name = `${engine}-${screen}-${width}x${height}`;
        await page.screenshot({ path: path.join(output, `${name}-actual.png`) });
        const tooSmall = await page.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return (
                box.width &&
                box.height &&
                getComputedStyle(element).visibility !== 'hidden' &&
                [...element.childNodes].some(
                  (child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
                ) &&
                parseFloat(getComputedStyle(element).fontSize) < 11
              );
            })
            .map(
              (element) =>
                `${element.tagName}.${element.className}: ${getComputedStyle(element).fontSize}`,
            ),
        );
        assert.deepEqual(tooSmall, [], `Visible type floor in ${name}`);
        assert.deepEqual(errors, [], `Console in ${name}`);
        const proposal = await context.newPage();
        await proposal.setContent(reference(screen));
        await proposal.screenshot({ path: path.join(output, `${name}-proposal.png`) });
        await proposal.close();
        results.push({ name, errors, tooSmall });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
await writeFile(path.join(output, 'checks.json'), JSON.stringify(results, null, 2));
await writeFile(
  path.join(output, 'comparison.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mir.cpp design review</title><style>body{background:#10182f;color:#f3f6ff;font:14px sans-serif}section{display:flex;gap:16px;overflow:auto}img{max-width:48vw;height:auto;object-fit:contain;align-self:start}</style>${results.map(({ name }) => `<h2>${name}</h2><section><figure><figcaption>Approved proposal 1.11</figcaption><img src="${name}-proposal.png"></figure><figure><figcaption>Actual React interface · fixture services</figcaption><img src="${name}-actual.png"></figure></section>`).join('')}`,
);
console.log(`PASS: ${results.length} paired captures, console and 11px type floor: ${output}`);
