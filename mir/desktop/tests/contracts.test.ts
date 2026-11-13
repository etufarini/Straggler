import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { defaultSettings } from '../src/services/fixtures';

// The direct launcher and native desktop must keep the same release defaults.
describe('direct launcher contract', () => {
  test('server settings agree with the shared native defaults', () => {
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
      const script = `
        MIR_ROOT=$1
        source "$MIR_ROOT/tests/helpers/core.sh"
        load_test_core fake
        initialize_config
        printf '%s\\0' "$CTX_SIZE" "$PORT" "$DEVICE" "$THREADS" "$GPU_LAYERS" \
          "$PROMPT_PROCESSING" "$CACHE_TYPE_K" "$CACHE_TYPE_V" "$SPLIT_MODE" \
          "$TENSOR_SPLIT" "$FIT_TARGET"
        for key in "\${GENERATION_KEYS[@]}"; do printf '%s\\0' "\${GENERATION[$key]}"; done
      `;
      const values = execFileSync('bash', ['-euo', 'pipefail', '-c', script, 'contract', root], {
        env: environment,
        encoding: 'utf8',
        timeout: 10000,
      })
        .split('\0')
        .slice(0, -1);
      const fields = [
        'context',
        'port',
        'device',
        'threads',
        'gpu_layers',
        'prompt_processing',
        'cache_type_k',
        'cache_type_v',
        'split_mode',
        'tensor_split',
        'fit_target',
        'temperature',
        'top_p',
        'top_k',
        'min_p',
        'repeat_penalty',
        'presence_penalty',
        'frequency_penalty',
        'seed',
        'max_tokens',
      ] as const;
      expect(values).toEqual(fields.map((field) => defaultSettings[field]));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
