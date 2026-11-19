import { describe, expect, it } from 'vitest';
import { memoryFit, offloadedLayers } from '../src/domain/memory';

const gib = 1024 ** 3;
describe('pre-load memory estimates', () => {
  const memory = {
    availableRamMiB: 16384,
    devices: [
      { name: 'a', availableMiB: 4096 },
      { name: 'b', availableMiB: 4096 },
    ],
  };
  it('sums discovered GPU memory and reserves context and overhead', () => {
    expect(memoryFit(5 * gib, memory)).toBe('Fits in GPU memory');
    expect(memoryFit(8 * gib, memory)).toBe('Partly on CPU · slower');
    expect(memoryFit(24 * gib, memory)).toBe('Likely too large');
    expect(memoryFit(5 * gib, memory, '65536')).toBe('Partly on CPU · slower');
  });
  it('does not count unified memory twice or invent missing telemetry', () => {
    expect(memoryFit(10 * gib, { ...memory, unified: true })).toBe('Fits in GPU memory');
    expect(memoryFit(20 * gib, { ...memory, unified: true })).toBe('Likely too large');
    expect(memoryFit(gib, { ...memory, devices: [] })).toBe('Memory unknown');
    expect(memoryFit(gib, { ...memory, devices: [{ name: 'a', availableMiB: NaN }] })).toBe(
      'Memory unknown',
    );
    expect(memoryFit(null, memory)).toBe('Memory unknown');
    expect(memoryFit(gib, { ...memory, unified: true, availableRamMiB: null })).toBe(
      'Memory unknown',
    );
  });
  it('reads the latest valid offload record without failing on changed log formats', () => {
    expect(
      offloadedLayers(['loader: offloaded 12/33 layers to GPU', 'offloaded 22 / 33 layers to GPU']),
    ).toBe('22 / 33');
    expect(offloadedLayers(['new format', 'offloaded 40/33 layers to GPU'])).toBe('—');
  });
});
