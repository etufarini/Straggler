import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real IPC and supervised processes, with local synthetic files and no inference.
export async function verifyNativeModelOptions({ invoke, stage }) {
  const initial = await invoke('configuration', {});
  assert.equal(initial.capabilities.chatTemplateFile, true);
  assert.equal(initial.capabilities.mtp, true);
  const template = path.join(stage, 'models/chat_template.jinja');
  assert.equal(
    initial.models.find((model) => model.path === initial.settings.model).template,
    template,
  );
  const launchPath = path.join(stage, 'launch.json');
  assert.equal(JSON.parse(await readFile(launchPath, 'utf8')).chat_template_file, null);
  await invoke('stop_server', {});
  const selected = {
    ...initial.settings,
    chat_template_file: template,
    mtp: 'file',
    mtp_file: path.join(stage, 'mtp.gguf'),
  };
  await invoke('apply_settings', { settings: selected });
  await invoke('start_server', { model: selected.model });
  const deadline = Date.now() + 15000;
  while ((await invoke('server_status', {})).phase !== 'ready') {
    assert.ok(Date.now() < deadline, 'model-option fixture must become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const launch = JSON.parse(await readFile(launchPath, 'utf8'));
  assert.equal(launch.chat_template_file, template);
  assert.equal(launch.spec_type, 'draft-mtp');
  assert.equal(launch.spec_draft_model, selected.mtp_file);
  const status = await invoke('server_status', {});
  assert.deepEqual(status.runningSettings, selected);
  await invoke('stop_server', {});
  await invoke('apply_settings', { settings: initial.settings });
  await invoke('start_server', { model: initial.settings.model });
  const restoreDeadline = Date.now() + 15000;
  while ((await invoke('server_status', {})).phase !== 'ready') {
    assert.ok(
      Date.now() < restoreDeadline,
      'default fixture must become ready after restoring settings',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
