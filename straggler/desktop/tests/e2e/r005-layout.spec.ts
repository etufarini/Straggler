import { tabToNextControl } from './keyboard';
import { expect, test } from '@playwright/test';

for (const width of [960, 1200, 1440]) {
  test(`R005 controls remain usable at ${width}px with long names and reduced motion`, async ({
    page,
    browserName,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 960 ? 720 : width === 1200 ? 820 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?scenario=normal');
    await page.getByRole('button', { name: 'Choose model', exact: true }).click();
    await page.getByRole('button', { name: 'Load model', exact: true }).click();
    const expand = page.getByRole('button', { name: 'Expand assistant panel' });
    if (await expand.isVisible()) await expand.click();
    const longName =
      'A document with a very long name that should truncate in the attachment rail.pdf';
    await page.evaluate(
      (name) =>
        localStorage.setItem(
          'straggler-fixture-attachment-paths',
          JSON.stringify([`/fixture/${name}`, '/fixture/budget.xlsx', '/fixture/notes.txt']),
        ),
      longName,
    );
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await expect(page.locator('.file-row.is-ready')).toHaveCount(3);
    const name = page.locator('.file-name').filter({ hasText: longName });
    await expect(name).toHaveAttribute('title', /1,234 bytes/);
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const heights = await page
      .locator('.file-row.is-ready')
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath(`attachments-${width}.png`) });
    if (width === 960) await page.getByRole('button', { name: 'Collapse assistant panel' }).click();
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('A long question '.repeat(60));
    await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit response', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save response' })).toBeInViewport();
    await tabToNextControl(page, browserName);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await tabToNextControl(page, browserName);
    await expect(page.getByRole('button', { name: 'Save response' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save response' })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Edit response', exact: true })).toBeFocused();
    await page.getByRole('button', { name: /^Options for A long question/ }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'Export chat…', exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .getByRole('menuitem')
        .first()
        .evaluate((element) => getComputedStyle(element).outlineStyle),
    ).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Import conversation', exact: true }),
    ).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
