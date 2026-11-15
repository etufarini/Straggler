import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('test-results/design/d006');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const measurements = [];
try {
  for (const viewport of [
    { width: 760, height: 620 },
    { width: 1200, height: 820 },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:1420/?scenario=normal');
    await page.getByRole('button', { name: 'Launch server', exact: true }).click();
    await expect(page.locator('.local-badge')).toHaveText('Ready');
    await page.evaluate(() => document.fonts.ready);
    const images = [];
    for (const state of ['empty', 'message']) {
      if (state === 'message') {
        await page
          .getByRole('textbox', { name: 'Message', exact: true })
          .fill('Keep the top bar steady');
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await expect(page.locator('.assistant .markdown')).toContainText('local answer');
        await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(
          0,
        );
      }
      const file = `${viewport.width}x${viewport.height}-${state}.png`;
      await page.screenshot({ path: resolve(output, file) });
      images.push(file);
      measurements.push({
        viewport,
        state,
        ...(await page.evaluate(() => ({
          topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
          noticeTop: document.querySelector('.notice').getBoundingClientRect().top,
          presenceTop: document.querySelector('.presence').getBoundingClientRect().top,
          orbTop: document.querySelector('.presence-stage canvas').getBoundingClientRect().top,
          temporaryDensity: document.querySelector('.temp-toggle')?.dataset.density ?? null,
        }))),
      });
    }
    const [before, after] = measurements.slice(-2);
    for (const key of ['topbarHeight', 'noticeTop', 'presenceTop', 'orbTop'])
      expect(before[key]).toBe(after[key]);
    expect(before.topbarHeight).toBe(79);
    // Place unmodified captures side by side; labels identify the simulated app states.
    const comparison = await browser.newPage({
      viewport: { width: viewport.width * 2, height: viewport.height + 36 },
    });
    const sources = await Promise.all(
      images.map(
        async (file) =>
          `data:image/png;base64,${(await readFile(resolve(output, file))).toString('base64')}`,
      ),
    );
    await comparison.setContent(`<!doctype html><html lang="en"><style>
      body{margin:0;background:#090e25;color:#e7eafd;font:14px system-ui;display:flex}
      figure{margin:0}figcaption{height:36px;display:flex;align-items:center;padding-left:16px}
      img{display:block}
      </style><figure><figcaption>Empty chat · simulated services</figcaption><img src="${sources[0]}"></figure>
      <figure><figcaption>After first message · simulated services</figcaption><img src="${sources[1]}"></figure></html>`);
    await comparison.screenshot({
      path: resolve(output, `${viewport.width}x${viewport.height}-comparison.png`),
    });
    await comparison.close();
    if (viewport.width === 760) {
      await page.getByRole('button', { name: 'New chat', exact: true }).click();
      await page.getByRole('button', { name: 'Temporary', exact: true }).click();
      await expect(page.locator('.temp-status')).toHaveAttribute('data-density', 'icon');
      await page.screenshot({ path: resolve(output, '760x620-temporary.png') });
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 760, height: 620 } });
  await page.addInitScript(() =>
    localStorage.setItem(
      'straggler-fixture-model',
      '/fixture/models/example-with-a-long-model-name-and-context-configuration-for-layout-validation.gguf',
    ),
  );
  await page.goto('http://127.0.0.1:1420/?scenario=normal');
  await expect(page.locator('.temp-toggle')).toHaveAttribute('data-density', 'icon');
  await page.screenshot({ path: resolve(output, '760x620-long-model.png') });
  await page.close();
  await writeFile(
    resolve(output, 'measurements.json'),
    `${JSON.stringify(measurements, null, 2)}\n`,
  );
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  await browser.close();
}
