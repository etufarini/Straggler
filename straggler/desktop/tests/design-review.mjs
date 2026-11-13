// Capture the actual React interface and the approved proposals at identical sizes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { prepareDesignScreen, reviewScreens } from './design-scenarios.mjs';
import { captureProposalReference, projectScreens } from './r001-reference.mjs';
import { prepareR001Screen, inspectProjectLayout } from './r001-scenarios.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] || 'final';
assert.match(phase, /^[a-z0-9-]+$/);
const output = path.join(desktop, 'test-results/design', phase);
await mkdir(output, { recursive: true });
const results = [];
const projectReview = phase === 'r001';
const sizes = projectReview
  ? [
      [1200, 820],
      [760, 560],
      [960, 720],
      [1440, 900],
    ]
  : [
      [1200, 820],
      [960, 720],
    ];
const screens = projectReview
  ? projectScreens
  : phase === 'final'
    ? [...new Set([...reviewScreens, ...projectScreens])]
    : ['CHAT-01', 'SET-01'];
for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of sizes) {
      for (const screen of screens) {
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
        const projectScreen = projectScreens.includes(screen);
        if (projectScreen) await prepareR001Screen(page, screen);
        else await prepareDesignScreen(page, screen);
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
        const reference = await captureProposalReference(
          browser,
          screen,
          width,
          height,
          path.join(output, `${name}-proposal.png`),
        );
        const layout = projectScreen ? await inspectProjectLayout(page) : undefined;
        if (layout) {
          assert.equal(layout.overflow, false, `Horizontal overflow in ${name}`);
          assert.deepEqual(layout.unreachableControls, [], `Reachable controls in ${name}`);
        }
        results.push({
          name,
          errors,
          tooSmall,
          layout,
          referenceMissing: reference.referenceMissing,
          referenceNote: reference.reason,
        });
        await context.close();
      }
      console.log(`PASS: ${engine} ${width}×${height}: ${screens.length} screens`);
    }
  } finally {
    await browser.close();
  }
}
await writeFile(path.join(output, 'checks.json'), JSON.stringify(results, null, 2));
await writeFile(
  path.join(output, 'comparison.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Straggler design review</title><style>body{background:#10182f;color:#f3f6ff;font:14px sans-serif}section{display:flex;gap:16px;overflow:auto}img{max-width:48vw;height:auto;object-fit:contain;align-self:start}</style>${results.map(({ name, referenceMissing, referenceNote }) => `<h2>${name}</h2><section>${referenceMissing ? `<p>Missing reference: ${referenceNote}</p>` : `<figure><figcaption>Dossier Proposal</figcaption><img src="${name}-proposal.png"></figure>`}<figure><figcaption>Actual React interface · fixture services</figcaption><img src="${name}-actual.png"></figure></section>`).join('')}`,
);
console.log(
  `PASS: ${results.length} actual captures, console and 11px type floor; ${results.filter((result) => result.referenceMissing).length} explicit actual-only diagnostics: ${output}`,
);
