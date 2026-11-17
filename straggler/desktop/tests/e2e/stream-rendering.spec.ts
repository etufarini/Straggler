import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type FrameGate = {
  callbacks: Map<number, FrameRequestCallback>;
  step(): void;
  restore(): void;
};
declare global {
  interface Window {
    streamFrameGate: FrameGate;
  }
}

async function prepare(page: Page, scenario: string) {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByRole('button', { name: 'Launch server', exact: true }).click();
  await expect(page.locator('.local-badge')).toHaveText('Ready');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A streamed answer');
  await page.evaluate(() => {
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let handle = 1_000_000;
    // Hold paint callbacks, as happens in a hidden WebView. IPC and persistence
    // still run, letting these checks exercise terminal snapshots independently.
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (id) => {
      if (!callbacks.delete(id)) originalCancel.call(window, id);
    };
    window.streamFrameGate = {
      callbacks,
      step() {
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(performance.now());
      },
      restore() {
        callbacks.clear();
        window.requestAnimationFrame = originalRequest;
        window.cancelAnimationFrame = originalCancel;
      },
    };
    if (new URLSearchParams(location.search).get('scenario') === 'burst-stream')
      localStorage.setItem('straggler-fixture-response-paused', '1');
    document.querySelector<HTMLFormElement>('.composer')!.requestSubmit();
  });
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('straggler-fixture-request')))
    .not.toBeNull();
}

test('a burst of deltas paints together and the final snapshot cancels queued paints', async ({
  page,
}) => {
  await prepare(page, 'burst-stream');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('straggler-fixture-burst-emitted')))
    .toBe('1');
  await expect(page.locator('.message.assistant .markdown')).toBeEmpty();
  // Hundreds of deltas must leave only a bounded set of pending frame callbacks.
  expect(await page.evaluate(() => window.streamFrameGate.callbacks.size)).toBeLessThanOrEqual(3);
  await page.evaluate(() => window.streamFrameGate.step());
  await expect(page.locator('.message.assistant .markdown strong')).toHaveCount(80);
  await expect(page.locator('.message.assistant .markdown p').last()).toHaveText(
    'A local answer with caffè ☕.',
  );
  // React can commit the text before its passive scroll effect is scheduled.
  // Keep advancing the held clock while waiting, as a visible WebView would.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.streamFrameGate.step());
      return page
        .locator('.messages')
        .evaluate((element) =>
          Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
        );
    })
    .toBeLessThan(2);
  await page.locator('.messages').evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => {
    localStorage.removeItem('straggler-fixture-response-paused');
  });
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  await page.evaluate(() => window.streamFrameGate.step());
  await expect(page.locator('.assistant-presence')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.message.assistant .markdown strong')).toHaveCount(80);
  expect(await page.locator('.messages').evaluate((element) => element.scrollTop)).toBe(0);
  await page.evaluate(() => window.streamFrameGate.restore());
  await page.reload();
  await page.getByRole('button', { name: 'A streamed answer', exact: true }).click();
  await expect(page.locator('.message.assistant .markdown strong')).toHaveCount(80);
});

test('stopping before the next paint preserves and saves partial text', async ({ page }) => {
  await prepare(page, 'cancel');
  await expect(page.locator('.message.assistant .markdown')).toBeEmpty();
  await page
    .getByRole('button', { name: 'Stop response' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  await expect(page.locator('.message.assistant .markdown strong')).toHaveText('local');
  await page.evaluate(() => window.streamFrameGate.step());
  await expect(page.locator('.assistant-presence')).toHaveAttribute('data-state', 'stopped');
  await page.evaluate(() => window.streamFrameGate.restore());
  await page.reload();
  await page.getByRole('button', { name: 'A streamed answer', exact: true }).click();
  await expect(page.locator('.message.assistant .markdown strong')).toHaveText('local');
  await expect(page.locator('.message-status')).toHaveText('Response stopped');
});
