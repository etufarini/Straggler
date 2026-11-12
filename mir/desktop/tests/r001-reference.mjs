// Render proposal references through the dossier viewer so its fixture runs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossierUrl = pathToFileURL(path.join(desktop, '../docs/new-design/mir-ui-design.html')).href;

export const projectScreens = [
  'CHAT-01',
  'CHAT-02',
  'CHAT-17',
  'PROJ-01',
  'PROJ-02',
  'PROJ-03',
  'PROJ-04',
  'PROJ-05',
  'CHAT-20',
  'CHAT-21',
  'DIALOG-07',
  'DIALOG-08',
];

export async function captureProposalReference(browser, screen, width, height, screenshotPath) {
  const context = await browser.newContext({
    viewport: { width: width + 700, height: height + 650 },
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${dossierUrl}#spec-${screen}`);
    if (screen === 'BUILD-03' && !(await page.locator('[data-screen="BUILD-03"]').count())) {
      return {
        screen,
        width,
        height,
        errors,
        referenceMissing: true,
        reason:
          'The dossier explicitly omits persistent running compilation. The normal fixture completes immediately, so this actual-only diagnostic captures its completed build.',
      };
    }
    await page.locator(`[data-screen="${screen}"]`).click();
    await page.locator('[data-mode="proposal"]').click();
    await page.locator('#preview-size').evaluate(
      (select, viewport) => {
        const value = `${viewport.width},${viewport.height}`;
        // The review suite also checks sizes outside the viewer's preset list.
        if (![...select.options].some((option) => option.value === value)) {
          select.add(new Option(`${viewport.width} × ${viewport.height}`, value));
        }
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { width, height },
    );
    const frame = page.frameLocator('#stage iframe');
    await frame.locator('#root').waitFor();
    await frame.locator('body').evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.onload = resolve;
                image.onerror = resolve;
              }),
        ),
      );
    });
    const viewport = await page.locator('#stage iframe').evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
      scale: element.style.transform,
    }));
    assert.deepEqual(viewport, { width, height, scale: 'scale(1)' }, screen);
    assert.deepEqual(errors, [], `Proposal errors in ${screen}`);
    await page.locator('#stage iframe').screenshot({ path: screenshotPath });
    return { screen, width, height, errors, referenceMissing: false };
  } finally {
    await context.close();
  }
}

async function captureProjectReferences() {
  const output = path.join(desktop, 'test-results/design/r001-reference');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const screen of projectScreens) {
      const screenshot = `${screen}-proposal-1200x820.png`;
      const result = await captureProposalReference(
        browser,
        screen,
        1200,
        820,
        path.join(output, screenshot),
      );
      results.push({ ...result, screenshot });
    }
    await writeFile(path.join(output, 'checks.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`PASS: ${results.length} R001 proposal references: ${output}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await captureProjectReferences();
}
