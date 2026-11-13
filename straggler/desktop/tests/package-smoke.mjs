// Native package layout, bundled backend and persistence; no models or inference.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';

const store = process.platform === 'darwin';
let binary = process.env.STRAGGLER_PACKAGE_TEST_BINARY;
assert.ok(binary, 'Set STRAGGLER_PACKAGE_TEST_BINARY to the packaged debug executable');
const sessionName = randomUUID();
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(STRAGGLER_|MIR_|LLAMA_|XDG_)/.test(key)),
);
Object.assign(environment, {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  STRAGGLER_STORE_TEST_SESSION: sessionName,
  TAURI_WEBDRIVER_PORT: String(port),
});
let app;
let output = '';
let session;
let testRoot;
let packageRoot;
if (!store) {
  testRoot = await mkdtemp(path.join(tmpdir(), 'straggler-package-window-'));
  Object.assign(environment, {
    HOME: testRoot,
    XDG_CONFIG_HOME: path.join(testRoot, 'config'),
    XDG_DATA_HOME: path.join(testRoot, 'data'),
  });
}
async function request(method, endpoint, body) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(value?.message || response.statusText);
  return value;
}
async function until(predicate, label) {
  const deadline = Date.now() + 30000;
  let error;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (failure) {
      error = failure;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}. ${error?.message || ''}\n${output}`);
}
const evaluate = (expression) =>
  request('POST', `/session/${session}/execute/sync`, {
    script: `return (${expression})`,
    args: [],
  });
const invoke = (command, args) =>
  evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
async function launch() {
  app = spawn(binary, [], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (bytes) => (output += bytes));
  app.stderr.on('data', (bytes) => (output += bytes));
  await until(async () => (await request('GET', '/status')).ready, 'package WebDriver startup');
  session = (await request('POST', '/session', { capabilities: {} })).sessionId;
  // Script execution polls a JS result variable. Wait for initial navigation
  // first, so loading the frontend cannot discard that variable mid-command.
  await until(
    async () => (await request('GET', `/session/${session}/title`)) === 'Straggler',
    'loaded package document',
  );
  await until(() => evaluate('!!document.querySelector(".sidebar-bottom")'), 'package interface');
}
async function close() {
  const exited = once(app, 'exit');
  app.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0, output);
  await until(async () => {
    try {
      await request('GET', '/status');
      return false;
    } catch {
      return true;
    }
  }, 'closed package WebDriver port');
}
try {
  if (!store && process.env.STRAGGLER_PACKAGE_TEST_DEB) {
    packageRoot = await mkdtemp(path.join(tmpdir(), 'straggler-package-layout-'));
    execFileSync('dpkg-deb', ['--extract', process.env.STRAGGLER_PACKAGE_TEST_DEB, packageRoot]);
    const packagedBinary = path.join(packageRoot, 'usr/bin/straggler-desktop');
    // Production cannot include WebDriver. Only this test substitutes a debug
    // GUI; backend libraries and resources retain their actual package layout.
    await copyFile(binary, packagedBinary);
    binary = packagedBinary;
  }
  await launch();
  const config = await invoke('configuration');
  assert.equal(config.appStore, store);
  assert.equal(config.bundledAvailable, true);
  assert.equal(config.serverAvailable, true, config.warning);
  assert.equal(config.llamaDir, '');
  assert.equal(config.build.backend, 'bundled');
  assert.equal(config.build.commit, '3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8');
  const data = await invoke('test_data_dir');
  if (store) {
    assert.ok(data.includes(`/.straggler-tests/${sessionName}/`), data);
    assert.ok(
      data.includes('/Library/Containers/io.github.etufarini.straggler.store-check/Data/'),
      data,
    );
    const isolatedRoot = path.resolve(data, '../../../..');
    assert.equal(path.basename(isolatedRoot), sessionName);
    testRoot = isolatedRoot;
    const rejected = await evaluate(`window.__TAURI_INTERNALS__.invoke('workspace_action', {
      action: 'set-path', arguments: ['llama', '/external/backend'], targets: []
    }).then(() => '', error => String(error))`);
    assert.match(rejected, /included backend/);
  } else {
    assert.ok(data.startsWith(testRoot + path.sep), data);
  }
  const id = randomUUID();
  await invoke('history_create', {
    conversation: {
      id,
      title: 'Package persistence check',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: null,
      messages: [],
    },
  });
  const attachmentPath = path.join(data, 'package-fixture.txt');
  await invoke('write_export', { path: attachmentPath, contents: 'Package attachment ☕' });
  const attached = await invoke('attachment_add', { id, path: attachmentPath });
  assert.equal(attached.attachments[0].text, 'Package attachment ☕');
  await invoke('preferences_save', {
    preferences: { sidebarCollapsed: true, presenceExpanded: false },
  });
  await close();
  await launch();
  const saved = (await invoke('history_list')).find((conversation) => conversation.id === id);
  assert.equal(saved.attachments[0].text, 'Package attachment ☕');
  assert.equal((await invoke('preferences_read')).sidebarCollapsed, true);
  await evaluate(
    `Array.from(document.querySelectorAll('.sidebar-bottom button')).find(button => button.textContent.trim() === 'Settings').click()`,
  );
  await until(() => evaluate('!!document.querySelector(".settings-nav")'), 'package settings');
  await evaluate(
    `Array.from(document.querySelectorAll('.settings-nav button')).find(button => button.textContent.trim() === 'llama.cpp').click()`,
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Choose external build')`,
    ),
    !store,
  );
  const screenshot = await request('GET', `/session/${session}/screenshot`);
  await mkdir('test-results', { recursive: true });
  await writeFile(
    `test-results/${store ? 'store' : 'ubuntu'}-settings.png`,
    Buffer.from(screenshot, 'base64'),
  );
  await invoke('history_delete', { id });
  await close();
  console.log(
    `PASS: ${store ? 'signed Store sandbox' : 'Ubuntu package layout'} GUI, pinned backend discovery, isolated storage, attachments and persistence after relaunch. Native picker interaction is a separate manual check.`,
  );
} catch (error) {
  try {
    const screenshot = await request('GET', `/session/${session}/screenshot`);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/package-failure.png', Buffer.from(screenshot, 'base64'));
  } catch {
    // A failed or closed native window may no longer provide a screenshot.
  }
  throw error;
} finally {
  if (app && app.exitCode === null && app.signalCode === null) {
    app.kill('SIGTERM');
    await until(() => app.exitCode !== null || app.signalCode !== null, 'Store test cleanup');
  }
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  if (packageRoot) await rm(packageRoot, { recursive: true, force: true });
}
