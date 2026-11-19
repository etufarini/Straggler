import type { Memory } from './types';

export const memoryEstimateNote =
  'Estimate from the file size and detected memory; llama.cpp makes the final fit when the model loads.';

export function memoryFit(bytes: number | null | undefined, memory?: Memory, context = 'auto') {
  const known = (value: number | null | undefined): value is number =>
    value != null && Number.isFinite(value) && value > 0;
  if (!known(bytes) || !memory) return 'Memory unknown';
  const ram = known(memory.availableRamMiB) ? memory.availableRamMiB * 1024 ** 2 : null;
  const devicesKnown =
    memory.devices.length > 0 && memory.devices.every((d) => known(d.availableMiB));
  const gpu = memory.unified
    ? ram
    : devicesKnown
      ? memory.devices.reduce((sum, device) => sum + device.availableMiB * 1024 ** 2, 0)
      : null;
  if (gpu === null) return 'Memory unknown';
  // A pre-load allowance, not a prediction of the model's actual KV cache layout.
  const tokens = known(Number(context)) ? Number(context) : 4096;
  const estimate = bytes * 1.25 + Math.max(512 * 1024 ** 2, tokens * 128 * 1024);
  if (estimate <= gpu) return 'Fits in GPU memory';
  if (ram !== null && estimate <= (memory.unified ? ram : gpu + ram))
    return 'Partly on CPU · slower';
  return ram === null ? 'Memory unknown' : 'Likely too large';
}

export function offloadedLayers(logs: string[]) {
  for (const line of [...logs].reverse()) {
    const match = /\boffloaded\s+(\d+)\s*\/\s*(\d+)\s+layers\s+to\s+GPU\b/i.exec(line);
    if (match && Number(match[1]) <= Number(match[2]) && Number(match[2]) > 0)
      return `${match[1]} / ${match[2]}`;
  }
  return '—';
}
