import { measureNativeOrb } from './native-orb-performance.mjs';
// Real Tauri/WebKit window, native services and a test server; no model inference.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
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
const stage = await mkdtemp(path.join(tmpdir(), 'straggler-native-test-'));
const builtBinary =
  process.env.STRAGGLER_TEST_NATIVE ||
  path.join(desktop, 'src-tauri/target/debug/straggler-desktop');
const binary =
  process.env.STRAGGLER_TEST_NATIVE ||
  path.join(stage, 'desktop without launcher', 'straggler-desktop');
const forbiddenCommands = path.join(stage, 'unexpected-desktop-command');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function pdfFixture() {
  const text = 'BT /F1 12 Tf 40 750 Td (Native PDF attachment text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

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
  if (!process.env.STRAGGLER_TEST_NATIVE) {
    await mkdir(path.dirname(binary));
    await copyFile(builtBinary, binary);
    await chmod(binary, 0o755);
  }
  const guards = path.join(stage, 'guarded-tools');
  await mkdir(guards);
  const rejectCommandBody = 'printf "%s\\n" "$0 $*" >> "$STRAGGLER_FORBIDDEN_COMMANDS"\nexit 99\n';
  for (const tool of ['bash', 'curl', 'ss', 'ps', 'find', 'gfind', 'gmv', 'gtimeout', 'timeout']) {
    await writeFile(path.join(guards, tool), '#!/bin/sh\n' + rejectCommandBody, { mode: 0o755 });
  }
  const python = execFileSync('python3', ['-c', 'import sys;print(sys.executable)'], {
    encoding: 'utf8',
  }).trim();
  await writeFile(
    path.join(guards, 'python3'),
    '#!/bin/sh\nif [ "$1" != "$STRAGGLER_FIXTURE_SERVER" ]; then\n' +
      rejectCommandBody +
      'fi\nexec "$STRAGGLER_FIXTURE_PYTHON" "$@"\n',
    { mode: 0o755 },
  );
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
    Object.entries(process.env).filter(([key]) => !/^(STRAGGLER_|MIR_|SPUTNIK_|LLAMA_)/.test(key)),
  );
  Object.assign(environment, {
    PATH: guards + path.delimiter + process.env.PATH,
    HOME: stage,
    STRAGGLER_FORBIDDEN_COMMANDS: forbiddenCommands,
    STRAGGLER_FIXTURE_PYTHON: python,
    STRAGGLER_FIXTURE_SERVER: path.join(llama, 'build/bin/llama-server'),
    XDG_CONFIG_HOME: path.join(stage, 'config'),
    XDG_DATA_HOME: path.join(stage, 'data'),
    STRAGGLER_LLAMA_CPP_DIR: llama,
    STRAGGLER_MODELS_DIR: models,
    STRAGGLER_PORT: String(port),
    TEST_REQUEST: path.join(stage, 'request.json'),
    TAURI_WEBDRIVER_PORT: String(automationPort),
  });
  if (process.env.STRAGGLER_CAPTURE_DOCS)
    Object.assign(environment, {
      STRAGGLER_LLAMA_CPP_DIR: '',
      STRAGGLER_MODELS_DIR: '',
      STRAGGLER_PORT: '9931',
    });
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
  async function fillField(selector, text) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
  }
  async function sendMessage(text) {
    await fillField('textarea', text);
    await until(
      () => evaluate('!document.querySelector(".send-button").disabled'),
      'enabled composer',
    );
    await evaluate('document.querySelector(".composer").requestSubmit()');
  }
  if (process.env.STRAGGLER_CAPTURE_DOCS) {
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
      () =>
        evaluate(
          'document.querySelector(".model-switch")?.textContent.includes("test-model.gguf") && !document.querySelector(".header-controls .primary-button").disabled',
        ),
      'native configuration',
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".sidebar-bottom button")).find(button => button.textContent.trim() === "Settings").click()',
    );
    await until(() => evaluate('!!document.querySelector(".settings-nav")'), 'settings navigation');
    await evaluate(
      'Array.from(document.querySelectorAll(".settings-nav button")).find(button => button.textContent === "Performance").click()',
    );
    await until(
      () => evaluate('!!document.querySelector("input[aria-label^=CPU]")'),
      'performance fields',
    );
    await fillField('input[aria-label="CPU threads"]', '0');
    await evaluate('document.querySelector(".configuration-heading button").click()');
    await until(
      () =>
        evaluate(
          'document.querySelector("input[aria-label^=CPU]")?.getAttribute("aria-invalid") === "true"',
        ),
      'native validation attached to its field',
    );
    assert.match(
      await evaluate('document.querySelector(".field-error").textContent'),
      /positive integer/,
    );
    await fillField('input[aria-label="CPU threads"]', '2');
    await evaluate('document.querySelector(".configuration-heading button").click()');
    await until(
      () =>
        evaluate('document.querySelector(".success-message")?.textContent === "Settings applied."'),
      'corrected settings',
    );
    await evaluate('document.querySelector(".settings-heading button").click()');
    await evaluate('document.querySelector(".model-switch").click()');
    await until(
      () => evaluate('!!document.querySelector(".panel .primary-button:not(:disabled)")'),
      'model selection',
    );
    await evaluate('document.querySelector(".panel .primary-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Ready"'),
      'server readiness',
    );
    await sendMessage('Native test question');
    await until(
      () => evaluate(`!!document.querySelector('[aria-label="Copy response"]')`),
      'native streaming response',
    );
    assert.match(
      await evaluate('document.querySelector(".assistant .markdown").textContent'),
      /caffè ☕/,
    );
    const history = path.join(stage, 'data/straggler/desktop/conversations');
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
    // Exercise file commands against real IPC and temporary documents, then use
    // the native window to reopen and remove the stored attachment conversation.
    const attachmentChatId = crypto.randomUUID();
    const attachmentChat = {
      id: attachmentChatId,
      title: 'Attachment contract',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: null,
      messages: [],
      options: { systemPrompt: 'Native chat own prompt', reasoning: null, effort: null },
    };
    const invokeNative = (command, args) =>
      evaluate(
        `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
      );
    await invokeNative('history_create', { conversation: attachmentChat });
    for (const [extension, original, text] of [
      ['txt', Buffer.from('Native attachment text ☕'), 'Native attachment text ☕'],
      ['pdf', pdfFixture(), 'Native PDF attachment text'],
    ]) {
      const source = path.join(stage, `attachment.${extension}`);
      await writeFile(source, original);
      const attached = await invokeNative('attachment_add', { id: attachmentChatId, path: source });
      const attachment = attached.attachments.at(-1);
      assert.equal(attachment.extension, extension);
      assert.ok(attachment.text.includes(text));
      await rm(source);
      const downloaded = path.join(stage, `download.${extension}`);
      await invokeNative('attachment_download', {
        id: attachmentChatId,
        attachmentId: attachment.id,
        destination: downloaded,
      });
      assert.deepEqual(await readFile(downloaded), original);
    }
    const exported = path.join(stage, 'export.json');
    await invokeNative('write_export', {
      path: exported,
      contents: JSON.stringify([{ role: 'user', content: 'Imported text' }]),
    });
    const imported = await invokeNative('read_conversation_import', { path: exported });
    assert.equal(imported.messages[0].content, 'Imported text');
    await evaluate('location.reload()');
    await until(
      () => evaluate(`!!document.querySelector('[title="Attachment contract"]')`),
      'native attachment history',
    );
    await evaluate(`document.querySelector('[title="Attachment contract"]').click()`);
    await until(
      () => evaluate('document.querySelector(".file-name")?.textContent === "attachment.txt"'),
      'native attachment rail',
    );
    await until(
      () =>
        evaluate(
          'document.querySelector(".type-pdf .file-name")?.textContent === "attachment.pdf"',
        ),
      'native PDF attachment rail',
    );
    // Set up native project files through the public IPC contract, then exercise
    // membership, shared instructions and lifecycle through production controls.
    async function clickControl(controlId) {
      const selector = JSON.stringify(`[data-control-id="${controlId}"]`);
      await until(
        () =>
          evaluate(`(() => {
            const control = document.querySelector(${selector});
            return !!control && !control.disabled && control.getAttribute('aria-disabled') !== 'true';
          })()`),
        `native control ${controlId}`,
      );
      await evaluate(`document.querySelector(${selector}).click()`);
    }
    const projectId = crypto.randomUUID();
    const projectName = 'Native project';
    const projectInstructions = 'Use these native project instructions for every member chat.';
    const projectSourceText = 'Project source text stays on the device. ☕';
    const projectSource = path.join(stage, 'source.txt');
    await writeFile(projectSource, projectSourceText);
    const createdProject = await invokeNative('project_save', {
      project: {
        id: projectId,
        name: projectName,
        description: 'Native persistence and window contract',
        instructions: projectInstructions,
        starred: true,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: [],
      },
    });
    assert.equal(createdProject.project.id, projectId);
    const addedProjectFile = await invokeNative('project_file_add', {
      projectId,
      path: projectSource,
      charactersPerToken: 4,
    });
    const projectFile = addedProjectFile.project.files[0];
    assert.equal(projectFile.text, projectSourceText);
    assert.equal(projectFile.included, true);
    const projectsRoot = path.join(stage, 'data/straggler/desktop/projects');
    const projectRecordPath = path.join(projectsRoot, projectId, 'project.json');
    const projectTextPath = path.join(projectsRoot, projectId, 'files', `${projectFile.id}.txt`);
    const projectRecord = JSON.parse(await readFile(projectRecordPath, 'utf8'));
    assert.equal(projectRecord.files[0].id, projectFile.id);
    assert.equal(Object.hasOwn(projectRecord.files[0], 'text'), false);
    assert.equal(await readFile(projectTextPath, 'utf8'), projectSourceText);
    await evaluate('location.reload()');
    await until(
      () =>
        evaluate(`!!document.querySelector('[data-control-id="button-project-native-project"]')`),
      'project sidebar loaded from native storage',
    );
    await evaluate(`document.querySelector('[title="Attachment contract"]').click()`);
    await clickControl('button-options-for-attachment-contract');
    await clickControl('button-move-to-project');
    await clickControl('option-project-native-project');
    assert.match(
      await evaluate('document.querySelector(".confirmation").textContent'),
      /This chat has its own system prompt/,
    );
    await clickControl('button-confirm-move');
    const attachmentRecordPath = path.join(history, `${attachmentChatId}.json`);
    await until(async () => {
      const member = JSON.parse(await readFile(attachmentRecordPath, 'utf8'));
      return member.projectId === projectId && member.ownSystemPrompt === 'Native chat own prompt';
    }, 'native move preserves the own prompt');
    await clickControl('button-all-projects');
    await clickControl('button-open-project-native-project');
    await until(
      () =>
        evaluate(
          'document.querySelector(".project-instructions-preview")?.textContent === ' +
            JSON.stringify(projectInstructions),
        ),
      'persisted project instructions',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Project files"] .file-name')?.textContent`,
      ),
      'source.txt',
    );
    await clickControl('switch-include-source-txt');
    await until(async () => {
      const stored = JSON.parse(await readFile(projectRecordPath, 'utf8'));
      return stored.files[0].included === false;
    }, 'native file exclusion persisted');
    await clickControl('switch-include-source-txt');
    await until(async () => {
      const stored = JSON.parse(await readFile(projectRecordPath, 'utf8'));
      return stored.files[0].included === true;
    }, 'native file inclusion persisted');
    await clickControl('button-open-attachment-contract');
    await until(
      () =>
        evaluate(
          `document.querySelector('[data-control-id="button-crumb-project"]')?.textContent === "Native project"`,
        ),
      'native member chat breadcrumb',
    );
    assert.match(
      await evaluate(
        `document.querySelector('[data-control-id="button-system-prompt"]').textContent`,
      ),
      /Project instructions/,
    );
    await clickControl('button-options-for-attachment-contract');
    assert.equal(
      await evaluate(
        `document.querySelector('[data-control-id="button-move-to-project"]').textContent.trim()`,
      ),
      'Move to another project…',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-control-id="button-remove-from-project"]').getAttribute("aria-disabled")`,
      ),
      null,
    );
    await clickControl('button-options-for-attachment-contract');
    await clickControl('button-system-prompt');
    assert.equal(
      await evaluate(
        `document.querySelector('[data-control-id="textarea-project-instructions"]').value`,
      ),
      projectInstructions,
    );
    const editedProjectInstructions = 'Updated native project instructions for every chat.';
    await fillField('[data-control-id="textarea-project-instructions"]', editedProjectInstructions);
    await clickControl('button-save-instructions-for-chats');
    await until(async () => {
      const stored = JSON.parse(await readFile(projectRecordPath, 'utf8'));
      return stored.instructions === editedProjectInstructions;
    }, 'shared instructions saved through the native chip');
    await clickControl('button-crumb-project');
    await until(
      () =>
        evaluate(
          'document.querySelector(".project-instructions-preview")?.textContent === ' +
            JSON.stringify(editedProjectInstructions),
        ),
      'project detail reflects the shared prompt edit',
    );
    await writeFile(
      path.join(desktop, 'test-results/native-project.png'),
      Buffer.from(await screenshot(), 'base64'),
    );
    await clickControl('button-options-for-current-project');
    await clickControl('button-archive-project-menu');
    await clickControl('button-archive-project');
    await until(
      () => evaluate(`!!document.querySelector('[data-control-id="button-restore-project"]')`),
      'archived native project detail',
    );
    assert.equal(
      await evaluate(`document.querySelector('[data-control-id="textarea-start-chat"]').disabled`),
      true,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-control-id="switch-include-source-txt"]').disabled`,
      ),
      true,
    );
    await clickControl('button-open-attachment-contract');
    await until(
      () => evaluate(`!!document.querySelector('[data-control-id="button-restore-from-chat"]')`),
      'archived native member chat',
    );
    assert.equal(await evaluate('document.querySelector(".composer textarea").disabled'), true);
    await clickControl('button-options-for-attachment-contract');
    for (const controlId of ['button-move-to-project', 'button-remove-from-project']) {
      assert.equal(
        await evaluate(
          `document.querySelector('[data-control-id="${controlId}"]').getAttribute('aria-disabled')`,
        ),
        'true',
      );
    }
    await clickControl('button-options-for-attachment-contract');
    await clickControl('button-restore-from-chat');
    await until(
      () => evaluate('!document.querySelector(".composer textarea").disabled'),
      'restored native member chat',
    );
    await clickControl('button-crumb-project');
    await clickControl('button-options-for-current-project');
    await clickControl('button-delete-project-menu');
    await until(
      () => evaluate(`!!document.querySelector('[data-control-id="checkbox-also-delete-chats"]')`),
      'native project deletion confirmation',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-control-id="checkbox-also-delete-chats"]').checked`,
      ),
      false,
    );
    await clickControl('button-delete-project');
    await until(
      async () => !(await readdir(projectsRoot)).includes(projectId),
      'native project deleted',
    );
    const detached = JSON.parse(await readFile(attachmentRecordPath, 'utf8'));
    assert.equal(detached.projectId, undefined);
    assert.equal(detached.ownSystemPrompt, 'Native chat own prompt');
    assert.equal(detached.options.systemPrompt, 'Native chat own prompt');
    assert.equal(detached.attachments.length, 2);
    assert.equal(await readFile(projectSource, 'utf8'), projectSourceText);
    assert.ok(!(await readdir(projectsRoot)).includes(projectId));
    for (const attachment of detached.attachments) {
      assert.ok(
        (
          await readFile(
            path.join(
              history,
              attachmentChatId,
              'attachments',
              `${attachment.id}.${attachment.extension}`,
            ),
          )
        ).length,
      );
    }
    await until(
      () => evaluate('!document.querySelector(".confirmation")'),
      'native project deletion dialog closed',
    );
    await evaluate(`document.querySelector('[title="Attachment contract"]').click()`);
    await clickControl('button-system-prompt');
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="System prompt instructions"]').value`),
      'Native chat own prompt',
    );
    await clickControl('button-system-prompt');
    await evaluate(
      `document.querySelector('[aria-label="Options for Attachment contract"]').click()`,
    );
    await until(
      () => evaluate('!!document.querySelector(".chat-menu")'),
      'native conversation menu',
    );
    await evaluate(
      `document.querySelector('[role="menuitem"][aria-label="Delete Attachment contract"]').click()`,
    );
    await until(
      () => evaluate('!!document.querySelector(".confirmation .danger-button")'),
      'native delete confirmation',
    );
    await evaluate('document.querySelector(".confirmation .danger-button").click()');
    await until(
      () => evaluate('!document.querySelector(".confirmation")'),
      'native attachment deletion',
    );
    assert.ok(!(await readdir(history)).includes(attachmentChatId));
    await evaluate(`document.querySelector('[title="Native test question"]').click()`);
    await sendMessage('oom-stream');
    await until(
      () =>
        evaluate(
          'document.querySelectorAll(".assistant .markdown")[1]?.textContent === "caffè ☕"',
        ),
      'partial response before backend failure',
    );
    await writeFile(path.join(stage, 'request.json.continue'), '');
    await until(
      () =>
        evaluate(
          'document.querySelector(".local-badge")?.textContent === "Needs restart" && document.querySelector(".workspace-feedback")?.textContent.includes("Not enough memory")',
        ),
      'fatal backend error despite successful health checks',
    );
    await until(async () => {
      const failed = JSON.parse(await readFile(conversationFile, 'utf8'));
      return failed.messages[3]?.status === 'error' && failed.messages[3]?.content === 'caffè ☕';
    }, 'saved partial response after OOM');
    assert.equal(await evaluate('document.querySelector(".send-button").disabled'), true);
    await evaluate('document.querySelector(".local-badge").click()');
    await evaluate('document.querySelector(".danger-button").click()');
    await evaluate('document.querySelector(".confirmation .danger-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Stopped"'),
      'owned server shutdown',
    );
    await until(
      () => evaluate('!document.querySelector(".confirmation")'),
      'completed stop confirmation',
    );
    await evaluate('document.querySelector(".panel-heading button").click()');
    await evaluate('document.querySelector(".model-switch").click()');
    await evaluate('document.querySelector(".panel .primary-button").click()');
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Ready"'),
      'server restart',
    );
    await until(
      () => evaluate('!document.querySelector(".workspace-feedback")'),
      'fresh server without stale failure',
    );
    const historyBeforeTemporary = (await readdir(history)).sort();
    const originalConversation = await readFile(conversationFile, 'utf8');
    await evaluate(
      'document.dispatchEvent(new KeyboardEvent("keydown", {key:"N", ctrlKey:true, shiftKey:true, bubbles:true}))',
    );
    await until(
      () => evaluate('!!document.querySelector(".workspace.is-temporary .temp-status")'),
      'native temporary chat',
    );
    await until(
      () => evaluate('document.querySelector(".local-badge")?.textContent === "Ready"'),
      'temporary server with RAM cache disabled',
    );
    await sendMessage('hello');
    await until(
      () =>
        evaluate(
          'document.querySelector(".assistant .markdown")?.textContent === "caffè ☕" && !document.querySelector(".send-button.stop")',
        ),
      'temporary response kept in memory',
    );
    assert.deepEqual((await readdir(history)).sort(), historyBeforeTemporary);
    assert.equal(await readFile(conversationFile, 'utf8'), originalConversation);
    await writeFile(
      path.join(desktop, 'test-results/native-temporary.png'),
      Buffer.from(await screenshot(), 'base64'),
    );
    await evaluate(
      'window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {event:"tauri://close-requested", payload:null})',
    );
    await until(
      () =>
        evaluate(
          'document.querySelector(".confirmation h2")?.textContent === "Quit and erase this temporary chat?"',
        ),
      'native temporary window-close confirmation',
    );
    await evaluate(
      'Array.from(document.querySelectorAll(".confirmation button")).find(button => button.textContent === "Cancel").click()',
    );
    assert.equal(app.exitCode, null);
    assert.equal(await evaluate('!!document.querySelector(".temp-status")'), true);
    await clickControl('button-new-chat');
    await until(
      () => evaluate('!!document.querySelector(".confirmation .danger-button")'),
      'temporary erase confirmation',
    );
    await evaluate('document.querySelector(".confirmation .danger-button").click()');
    await until(
      () =>
        evaluate(
          '!document.querySelector(".temp-status") && !document.querySelector(".confirmation") && document.querySelector(".local-badge")?.textContent === "Ready"',
        ),
      'temporary slot erased and normal server restored',
    );
    assert.equal(await readFile(path.join(stage, 'request.json.erase'), 'utf8'), 'slot 7 erased');
    assert.deepEqual((await readdir(history)).sort(), historyBeforeTemporary);
    await evaluate(
      `Array.from(document.querySelectorAll('.conversation-row > button')).find(button => button.title === ${JSON.stringify(JSON.parse(originalConversation).title)}).click()`,
    );
    await sendMessage('wait');
    await until(
      () =>
        evaluate(
          'document.querySelectorAll(".assistant .markdown")[2]?.textContent === "caffè ☕"',
        ),
      'active partial response',
    );
    if (process.env.STRAGGLER_MEASURE_ORB === '1') {
      await measureNativeOrb({
        pid: app.pid,
        evaluate,
        hide: () =>
          evaluate('window.__TAURI_INTERNALS__.invoke("test_window_visibility",{visible:false})'),
        output: path.join(desktop, 'test-results/native-orb-cpu.json'),
      });
    }
    if (
      process.env.STRAGGLER_TEST_SHUTDOWN === 'signal' ||
      process.env.STRAGGLER_MEASURE_ORB === '1'
    ) {
      app.kill('SIGTERM');
    } else {
      await evaluate(
        'window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {event:"tauri://close-requested", payload:null})',
      );
      await until(
        () =>
          evaluate(
            'document.querySelector(".confirmation h2")?.textContent === "Close Straggler?"',
          ),
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
        () => evaluate('!!document.querySelector(".confirmation .danger-button")'),
        'second close confirmation',
      );
      await evaluate('document.querySelector(".confirmation .danger-button").click()');
    }
    await until(() => app.exitCode !== null, 'native window exit');
    const final = JSON.parse(await readFile(conversationFile, 'utf8'));
    if (
      process.env.STRAGGLER_TEST_SHUTDOWN !== 'signal' &&
      process.env.STRAGGLER_MEASURE_ORB !== '1'
    ) {
      assert.equal(final.messages[5].status, 'stopped');
      assert.equal(final.messages[5].content, 'caffè ☕');
    }
    const released = net.createServer();
    released.listen(port, '127.0.0.1');
    await once(released, 'listening');
    await new Promise((resolve) => released.close(resolve));
    assert.equal(await readFile(forbiddenCommands, 'utf8').catch(() => ''), '');
    console.log(
      `PASS: native desktop without launcher or utility subprocesses, real Tauri/WebKit window, discovery, readiness, IPC streaming, saved response, fatal OOM recovery, confirmed Stop, restart and server cleanup on ${process.env.STRAGGLER_TEST_SHUTDOWN === 'signal' || process.env.STRAGGLER_MEASURE_ORB === '1' ? 'SIGTERM' : 'confirmed close (including canceled close and saved partial response)'}`,
    );
    console.log(
      'Screenshots: test-results/native-chat.png and test-results/native-project.png (test server; no model inference)',
    );
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
