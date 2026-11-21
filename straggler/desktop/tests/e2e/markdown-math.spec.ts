import { expect, test } from '@playwright/test';

test('math is accessible, left aligned, copyable and safe; long code expands without changing source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|csp/i.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Object.assign(window, { copiedMarkdown: value });
        },
      },
    });
    const code = Array.from(
      { length: 30 },
      (_, i) => `const value${i} = "line ${i}"; // comment`,
    ).join('\n');
    const now = Date.now();
    localStorage.setItem(
      'straggler-fixture-normal',
      JSON.stringify([
        {
          id: '20000000-0000-4000-8000-000000000001',
          title: 'Math and code',
          model: null,
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              content:
                String.raw`Keep $20 literal; inline \(a_b + 1\) and code ` + '`\\(literal\\)`',
              reasoning: '',
              status: 'complete',
            },
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content:
                'Inline \\(x^2\\).\n\n$$\n\\frac{a}{b}\n$$\n\n\\[\\notARealCommand{x}\\]\n\n```javascript\n' +
                code +
                '\n```\n\n```math\n\\(literal fenced code\\)\n```',
              reasoning: '',
              status: 'complete',
            },
          ],
        },
      ]),
    );
  });
  await page.goto('/?scenario=normal');
  await page.getByRole('button', { name: 'Math and code', exact: true }).click();
  await expect(page.locator('.user .katex-mathml math')).toHaveCount(1);
  await expect(page.locator('.user .markdown')).toContainText('$20');
  await expect(page.locator('.user code')).toHaveText(String.raw`\(literal\)`);
  await expect(page.locator('.assistant .katex-mathml math')).toHaveCount(2);
  await expect(page.getByText('Couldn’t render this formula · showing the source')).toBeVisible();
  const block = page.locator('.assistant .math-block').first();
  expect(
    await block
      .locator('.katex-display')
      .evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe('left');
  await block.hover();
  await block.getByRole('button', { name: 'Copy LaTeX' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copiedMarkdown: string }).copiedMarkdown),
  ).toBe(String.raw`\frac{a}{b}`);
  await expect(block.getByRole('status')).toHaveText('Copied');
  const code = page.locator('.code-block').first();
  await expect(code.locator('.code-header')).toContainText('javascript');
  await expect(code.locator('.hljs-keyword').first()).toHaveText('const');
  await expect(code.getByRole('button', { name: 'Show more' })).toBeVisible();
  await code.getByRole('button', { name: 'Show more' }).click();
  await expect(code.locator('pre')).not.toHaveClass('code-collapsed');
  await code.getByRole('button', { name: 'Copy code' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copiedMarkdown: string }).copiedMarkdown),
  ).toContain('const value29 = "line 29"; // comment');
  await code.getByRole('button', { name: 'Show less' }).click();
  await expect(page.locator('.code-block').last().locator('code')).toHaveText(
    String.raw`\(literal fenced code\)`,
  );
  expect(errors).toEqual([]);
});
