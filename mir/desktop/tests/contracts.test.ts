import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { defaultSettings } from '../src/services/fixtures';
import type { Configuration } from '../src/domain/types';

// Check development defaults against the real bridge rather than a second schema.
describe('desktop contract', () => {
  test('fixture settings and release serialization agree with the launcher', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const temporary = mkdtempSync(path.join(tmpdir(), 'mir-contract-'));
    try {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(MIR_|LLAMA_|XDG_)/.test(key)),
      );
      Object.assign(environment, {
        HOME: temporary,
        XDG_CONFIG_HOME: path.join(temporary, 'config'),
        XDG_DATA_HOME: path.join(temporary, 'data'),
      });
      const llama = path.join(temporary, 'llama');
      const models = path.join(temporary, 'models');
      mkdirSync(path.join(llama, 'bin'), { recursive: true });
      mkdirSync(models);
      writeFileSync(
        path.join(llama, 'bin/llama-server'),
        '#!/bin/sh\nif [ "$1" = --list-devices ]; then printf "Available devices:\\n  Future0: Accelerator (8192 MiB, 4096 MiB free)\\n"; fi\n',
        { mode: 0o755 },
      );
      const model = path.join(models, 'model.gguf');
      writeFileSync(model, '');
      Object.assign(environment, { MIR_LLAMA_CPP_DIR: llama, MIR_MODELS_DIR: models });
      const invoke = (action: string, args: string[] = [], request = {}) =>
        JSON.parse(
          execFileSync('bash', [path.join(root, 'mir.sh'), '--desktop', action, ...args], {
            env: environment,
            input: JSON.stringify(request),
            encoding: 'utf8',
            timeout: 10000,
          }),
        ) as Configuration;
      const config = invoke('inspect');
      expect(config.settings).toEqual({ ...defaultSettings, model });
      expect(config.devices[0].name).toBe('Future0');
      expect(config.capabilities.cacheTypesK).toEqual([]);
      try {
        invoke('inspect', [], { settings: { ...config.settings, threads: '0' } });
        throw new Error('Invalid settings were accepted');
      } catch (error) {
        const failure = error as { stderr: Buffer };
        const detail = JSON.parse(failure.stderr.toString().trim());
        expect(detail.mirValidation).toBe(true);
        expect(detail.field).toBe('threads');
        expect(detail.message).toContain('positive integer');
      }
      expect(
        config.backends.every(
          (backend) => typeof backend.id === 'string' && typeof backend.label === 'string',
        ),
      ).toBe(true);

      // The old desktop's removed reasoning field is tolerated without rewriting it.
      const profiles = path.join(temporary, 'config/mir.cpp/profiles');
      mkdirSync(profiles, { recursive: true });
      const legacyFields = Object.entries(config.settings).filter(
        ([key]) =>
          ![
            'cache_type_k',
            'cache_type_v',
            'split_mode',
            'tensor_split',
            'fit_target',
            'chat_system_prompt',
            'chat_reasoning',
            'chat_reasoning_effort',
          ].includes(key),
      );
      const legacy =
        legacyFields.map(([key, value]) => `${key}=${value}`).join('\n') + '\nreasoning=on\n';
      writeFileSync(path.join(profiles, 'Desktop.conf'), legacy);
      expect(invoke('load-profile', ['Desktop']).settings).toEqual(config.settings);
      invoke('save-profile', ['Release', 'new'], { settings: config.settings });
      const chatDefaults = {
        ...config.settings,
        chat_system_prompt: 'Literal instructions\n$(touch executed)\nUnicode: caffè ☕',
        chat_reasoning: 'off',
        chat_reasoning_effort: 'xhigh',
      };
      invoke('save-profile', ['Chat defaults', 'new'], { settings: chatDefaults });
      expect(invoke('load-profile', ['Chat defaults']).settings).toEqual(chatDefaults);
      expect(invoke('load-profile', ['Release']).settings).toEqual(config.settings);
      expect(() =>
        invoke('inspect', [], { settings: { ...chatDefaults, chat_reasoning: 'maybe' } }),
      ).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
