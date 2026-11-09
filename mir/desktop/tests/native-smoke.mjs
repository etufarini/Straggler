// Real Tauri/WebKit window, real launcher and a test server; no model inference.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(path.join(tmpdir(), 'mir-native-test-'));
const binary =
  process.env.MIR_TEST_NATIVE || path.join(desktop, 'src-tauri/target/debug/mir-desktop');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function until(predicate, description) {
  const deadline = Date.now() + 20000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`, {
    cause: lastError,
  });
}

let app, driver, session, inspectPage;
try {
  const llama = path.join(stage, 'llama.cpp');
  const models = path.join(stage, 'models');
  await mkdir(path.join(llama, 'build/bin'), { recursive: true });
  await mkdir(models);
  await copyFile(
    path.join(desktop, 'tests/fixtures/server.py'),
    path.join(llama, 'build/bin/llama-server'),
  );
  await chmod(path.join(llama, 'build/bin/llama-server'), 0o755);
  await writeFile(path.join(models, 'test-model.gguf'), '');
  const port = await freePort(),
    automationPort = await freePort();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(MIR_|SPUTNIK_|LLAMA_)/.test(key)),
  );
  Object.assign(environment, {
    XDG_CONFIG_HOME: path.join(stage, 'config'),
    XDG_DATA_HOME: path.join(stage, 'data'),
    MIR_LLAMA_CPP_DIR: llama,
    MIR_MODELS_DIR: models,
    MIR_PORT: String(port),
    TEST_REQUEST: path.join(stage, 'request.json'),
    TAURI_WEBDRIVER_PORT: String(automationPort),
  });
  if (!process.env.MIR_TEST_NATIVE) environment.MIR_ROOT = path.resolve(desktop, '..');
  if (process.env.MIR_CAPTURE_DOCS)
    Object.assign(environment, { MIR_LLAMA_CPP_DIR: '', MIR_MODELS_DIR: '', MIR_PORT: '9931' });
  const log = createWriteStream(path.join(stage, 'app.log'));
  app = spawn(binary, [], { cwd: tmpdir(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.pipe(log);
  app.stderr.pipe(log);
  driver = `http://127.0.0.1:${automationPort}`;
  async function request(method, endpoint, data, timeout = 5000) {
    const response = await fetch(driver + endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(timeout),
    });
    const { value } = await response.json();
    if (!response.ok || value?.error)
      throw new Error(value?.message || `WebDriver ${response.status}`);
    return value;
  }
  await until(async () => {
    if (app.exitCode !== null || app.signalCode !== null) {
      throw new Error(`Desktop exited before WebDriver startup: ${app.exitCode ?? app.signalCode}`);
    }
    const status = await request('GET', '/status');
    return status.ready;
  }, 'native WebDriver server');
  // Session creation can wait 10s for the window and 30s for WebKit evaluation.
  // Send it once with that budget instead of aborting and retrying every 5s.
  const created = await request('POST', '/session', { capabilities: {} }, 45000);
  session = created.sessionId;
  assert.ok(session, 'WebDriver must return a session identifier');
  async function evaluate(expression) {
    return request('POST', `/session/${session}/execute/sync`, {
      script: `return (${expression})`,
      args: [],
    });
  }
  async function screenshot() {
    return request('GET', `/session/${session}/screenshot`);
  }
  inspectPage = evaluate;
  if (process.env.MIR_CAPTURE_DOCS) {
    await until(
      () => evaluate('document.querySelector(".settings-heading h1")?.textContent === "Settings"'),
      'first-launch setup',
    );
    await evaluate('document.querySelector(".settings-heading button").click()');
    const capture = async (name) => {
      await wait(250);
      const shot = await screenshot();
      await writeFile(path.join(desktop, '../docs/screenshots', name), Buffer.from(shot, 'base64'));
    };
    await capture('desktop-chat.png');
    await evaluate(
      'Array.from(document.querySelectorAll(".sidebar-bottom button")).find(button => button.textContent.trim() === "Settings").click()',
    );
    await until(() => evaluate('!!document.querySelector(".settings-nav")'), 'settings page');
    await evaluate('document.querySelector(".settings-nav button").click()');
    await until(
      () =>
        evaluate(
          'document.querySelector(".settings-content h2")?.textContent === "Model settings"',
        ),
      'model settings',
    );
    await capture('desktop-settings.png');
    // Destroying the window also closes the automation response channel.
    await evaluate('window.__TAURI_INTERNALS__.invoke("plugin:window|destroy")').catch(() => {});
    await until(() => app.exitCode !== null, 'capture window exit');
    console.log(
      'Captured real first-launch desktop and settings screens without models or inference.',
    );
  } else {
    await until(
      () => evaluate('globalThis.isTauri && document.querySelector(".count")?.textContent === "1"'),
      'native configuration',
    );
    await evaluate('document.querySelector("nav button").click()');
    await until(
      () => evaluate('!!document.querySelector(".panel .primary-button:not(:disabled)")'),
      'model selection',
    );
    await evaluate('document.querySelector(".panel .primary-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Ready"'),
      'server readiness',
    );
    await evaluate(
      `(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Native test question'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
    );
    await until(
      () => evaluate('!document.querySelector(".send-button").disabled'),
      'enabled composer',
    );
    await evaluate('document.querySelector(".composer").requestSubmit()');
    await until(
      () => evaluate('!!document.querySelector(".copy-button")'),
      'native streaming response',
    );
    assert.match(
      await evaluate('document.querySelector(".assistant .markdown").textContent'),
      /caffè ☕/,
    );
    const history = path.join(stage, 'data/mir.cpp/desktop/conversations');
    let conversationFile, saved;
    // Rendering a response and atomically saving it are separate async operations.
    await until(async () => {
      const files = await readdir(history);
      const filename = files.find((name) => name.endsWith('.json'));
      if (!filename) return false;
      conversationFile = path.join(history, filename);
      saved = JSON.parse(await readFile(conversationFile, 'utf8'));
      return saved.messages[1]?.status === 'complete';
    }, 'completed response persisted');
    assert.equal(saved.messages[1].content, 'caffè ☕');
    assert.equal(saved.messages[1].status, 'complete');
    await mkdir(path.join(desktop, 'test-results'), { recursive: true });
    const shot = await screenshot();
    await writeFile(
      path.join(desktop, 'test-results/native-chat.png'),
      Buffer.from(shot, 'base64'),
    );
    await evaluate('document.querySelector(".server-card").click()');
    await evaluate('document.querySelector(".danger-button").click()');
    await evaluate('document.querySelector(".confirmation .primary-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Stopped"'),
      'owned server shutdown',
    );
    await until(
      () => evaluate('!document.querySelector(".confirmation")'),
      'completed stop confirmation',
    );
    await evaluate('document.querySelector(".panel-heading button").click()');
    await evaluate('document.querySelector("nav button").click()');
    await evaluate('document.querySelector(".panel .primary-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Ready"'),
      'server restart',
    );
    await evaluate(
      `(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'wait'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
    );
    await until(
      () => evaluate('!document.querySelector(".send-button").disabled'),
      'second composer',
    );
    await evaluate('document.querySelector(".composer").requestSubmit()');
    await until(
      () =>
        evaluate(
          'document.querySelectorAll(".assistant .markdown")[1]?.textContent === "caffè ☕"',
        ),
      'active partial response',
    );
    if (process.env.MIR_TEST_SHUTDOWN === 'signal') {
      app.kill('SIGTERM');
    } else {
      await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {event:"tauri://close-requested", payload:null})',
      );
      await until(
        () =>
          evaluate('document.querySelector(".confirmation h2")?.textContent === "Close Mir.cpp?"'),
        'window close confirmation',
      );
      await evaluate(
        'Array.from(document.querySelectorAll(".confirmation button")).find(button => button.textContent === "Cancel").click()',
      );
      assert.equal(app.exitCode, null);
      await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {event:"tauri://close-requested", payload:null})',
      );
      await until(
        () => evaluate('!!document.querySelector(".confirmation .primary-button")'),
        'second close confirmation',
      );
      await evaluate('document.querySelector(".confirmation .primary-button").click()');
    }
    await until(() => app.exitCode !== null, 'native window exit');
    const final = JSON.parse(await readFile(conversationFile, 'utf8'));
    if (process.env.MIR_TEST_SHUTDOWN !== 'signal') {
      assert.equal(final.messages[3].status, 'stopped');
      assert.equal(final.messages[3].content, 'caffè ☕');
    }
    const released = net.createServer();
    released.listen(port, '127.0.0.1');
    await once(released, 'listening');
    await new Promise((resolve) => released.close(resolve));
    console.log(
      `PASS: real Tauri/WebKit window, discovery, readiness, IPC streaming, saved response, confirmed Stop, restart and server cleanup on ${process.env.MIR_TEST_SHUTDOWN === 'signal' ? 'SIGTERM' : 'confirmed close (including canceled close and saved partial response)'}`,
    );
    console.log('Screenshot: test-results/native-chat.png (test server; no model inference)');
  }
} catch (error) {
  if (inspectPage) {
    try {
      console.error(await inspectPage('document.body.innerText'));
    } catch {}
  }
  console.error(await readFile(path.join(stage, 'app.log'), 'utf8').catch(() => ''));
  throw error;
} finally {
  if (driver && session && app?.exitCode === null) {
    await fetch(`${driver}/session/${session}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(1000),
    }).catch(() => {});
  }
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    await once(app, 'exit');
  }
  await rm(stage, { recursive: true, force: true });
}
