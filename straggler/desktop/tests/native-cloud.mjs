import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';

// A local service fixture. Retain request destinations and output limits only, never headers or keys.
export async function startCloudFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    const record = { method: request.method, path: request.url };
    requests.push(record);
    if (request.method === 'GET' && request.url === '/models') {
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: [
            {
              id: 'cloud-fixture',
              name: 'Cloud fixture',
              context_length: 8192,
              architecture: { input_modalities: ['text'] },
              supported_parameters: [],
            },
          ],
        }),
      );
    } else if (request.method === 'POST' && request.url === '/chat/completions') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (body.max_tokens) record.maxOutputTokens = body.max_tokens;
        response.setHeader('Content-Type', 'text/event-stream');
        response.end(
          'data: ' +
            JSON.stringify({
              choices: [
                { delta: { content: 'Native cloud fixture answer.' }, finish_reason: 'stop' },
              ],
              usage: { total_tokens: 24, completion_tokens: 5, cost: 0.01, currency: 'USD' },
            }) +
            '\n\ndata: [DONE]\n\n',
        );
      });
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function exerciseNativeCloud({
  evaluate,
  until,
  fillField,
  invokeNative,
  screenshot,
  output,
  fixture,
}) {
  await evaluate('document.querySelector(".new-chat").click()');
  await evaluate('document.querySelector(".sidebar-bottom .nav-item").click()');
  await until(
    () => evaluate('!!document.querySelector(".settings-nav")'),
    'cloud settings navigation',
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".settings-nav button")).find(button => button.textContent === "Cloud models").click()',
  );
  await evaluate('document.querySelector(".cloud-providers details:nth-child(2) summary").click()');
  await fillField(
    '.cloud-providers details:nth-child(2) input[type=password]',
    'native-cloud-fixture',
  );
  assert.equal(fixture.requests.length, 0);
  await evaluate(
    'Array.from(document.querySelectorAll(".cloud-providers details:nth-child(2) button")).find(button => button.textContent === "Save and verify").click()',
  );
  await until(
    () =>
      evaluate(
        '!!document.querySelector(".cloud-providers details:nth-child(2) input[type=checkbox]")',
      ),
    'verified cloud model list',
  );
  await evaluate(
    'document.querySelector(".cloud-providers details:nth-child(2) input[type=checkbox]").click()',
  );
  await until(
    async () => (await invokeNative('cloud_status', {})).providers[1].shown.length === 1,
    'saved visible cloud model',
  );
  await evaluate('document.querySelector(".settings-heading button").click()');
  await evaluate('document.querySelector(".model-switch").click()');
  await evaluate('document.querySelector("#models-tab-cloud").click()');
  await until(
    () => evaluate('!!document.querySelector(".cloud-model-group .model-option")'),
    'cloud model picker',
  );
  await evaluate('document.querySelector(".cloud-model-group .model-option").click()');
  await evaluate('document.querySelector(".panel .primary-button").click()');
  await until(
    () => evaluate('document.body.dataset.model === "cloud" && !document.querySelector(".panel")'),
    'native Aurora destination',
  );
  assert.equal((await invokeNative('server_status', {})).phase, 'stopped');
  await fillField('.rich-composer-field', 'Native cloud question');
  await evaluate('document.querySelector(".composer").requestSubmit()');
  await until(
    () => evaluate('!!document.querySelector(".cloud-notice")'),
    'native first-send notice',
  );
  assert.deepEqual(fixture.requests, [{ method: 'GET', path: '/models' }]);
  await evaluate('document.querySelector(".cloud-notice .primary-button").click()');
  await until(
    () =>
      evaluate(
        'document.querySelector(".assistant .markdown")?.textContent === "Native cloud fixture answer." && !document.querySelector(".send-button.stop")',
      ),
    'native cloud stream',
  );
  const chat = (await invokeNative('history_list', {})).find(
    (value) => value.title === 'Native cloud question',
  );
  assert.equal(chat.messages[1].cloud.providerId, 'openrouter');
  assert.equal(chat.messages[1].metrics.cost, 0.01);
  assert.equal(
    await evaluate('getComputedStyle(document.body).getPropertyValue("--ui-background").trim()'),
    '#2f152a',
  );
  await fillField('.rich-composer-field', 'Keep these details too.');
  await evaluate('document.querySelector(".composer").requestSubmit()');
  await until(
    () =>
      evaluate(
        'document.querySelectorAll(".assistant .markdown").length === 2 && !document.querySelector(".send-button.stop")',
      ),
    'second native cloud turn',
  );
  await evaluate(`document.querySelector('button[aria-label="Context"]').click()`);
  await until(
    () =>
      evaluate(
        '!!Array.from(document.querySelectorAll(".context-menu button")).find(button => button.textContent === "Compact chat" && !button.disabled)',
      ),
    'native compaction action',
  );
  await evaluate(
    'Array.from(document.querySelectorAll(".context-menu button")).find(button => button.textContent === "Compact chat").click()',
  );
  await until(
    () =>
      evaluate(
        '!!document.querySelector(".chat-summary") && !document.querySelector(".send-button.stop")',
      ),
    'native summary committed',
  );
  const compacted = (await invokeNative('history_list', {})).find((value) => value.id === chat.id);
  assert.equal(compacted.messages.length, 4);
  assert.equal(compacted.summary.text, 'Native cloud fixture answer.');
  assert.equal(compacted.summary.model, 'cloud-fixture');
  assert.ok(fixture.requests.some((request) => request.maxOutputTokens > 0));
  await writeFile(output, Buffer.from(await screenshot(), 'base64'));
  await evaluate('document.querySelector(".model-switch").click()');
  await evaluate('document.querySelector("#models-tab-local").click()');
  await evaluate('document.querySelector(".panel .primary-button").click()');
  await until(
    () =>
      evaluate(
        'document.querySelector(".local-badge")?.textContent === "Ready" && !document.body.dataset.model',
      ),
    'return to local palette and owned server',
  );
  await evaluate(
    'document.querySelector(\'[aria-label="Options for Native cloud question"]\').click()',
  );
  await evaluate(
    'document.querySelector(\'[role="menuitem"][aria-label="Delete Native cloud question"]\').click()',
  );
  await until(
    () => evaluate('!!document.querySelector(".confirmation .danger-button")'),
    'delete cloud fixture chat',
  );
  await evaluate('document.querySelector(".confirmation .danger-button").click()');
  await until(
    () => evaluate('!document.querySelector(".confirmation")'),
    'cloud fixture chat removed',
  );
  await evaluate('document.querySelector(\'[title="Native test question"]\').click()');
}
