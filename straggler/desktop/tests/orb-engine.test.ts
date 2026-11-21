import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import type HoloOrb from '../src/features/presence/renderers/orb-engine.js';
import type { PresenceState } from '../src/domain/presence';

// Exercise the real engine with a controlled display clock. Rasterization is
// covered in the browser; a busy CI runner must not change timing assertions.
const callbacks = new Map<number, FrameRequestCallback>();
const document = Object.assign(new EventTarget(), { hidden: false });
let nextHandle = 0;
let now = 0;
let drawClock = 0;
let drawCost = 0;
vi.stubGlobal('window', {
  document,
  performance: { now: () => drawClock },
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame(callback: FrameRequestCallback) {
    callbacks.set(++nextHandle, callback);
    return nextHandle;
  },
  cancelAnimationFrame(handle: number) {
    callbacks.delete(handle);
  },
});
const { default: Orb } = await import('../src/features/presence/renderers/orb-engine.js');

type ObservedOrb = HoloOrb & { time: number; yaw: number; quality: number; draw(): void };
const engines: ObservedOrb[] = [];

function createEngine(state: PresenceState = 'generating', dpr = 1) {
  window.devicePixelRatio = dpr;
  const canvas = { style: {}, getContext: () => ({}) } as unknown as HTMLCanvasElement;
  const engine = new Orb(canvas, { size: 224, state, autostart: false }) as ObservedOrb;
  const frames: number[] = [];
  engine.draw = () => {
    frames.push(now);
    drawClock += drawCost;
  };
  engines.push(engine);
  return { engine, frames, canvas };
}

function refresh(time: number) {
  now = time;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}

beforeEach(() => {
  now = 0;
  drawClock = 0;
  drawCost = 0;
  document.hidden = false;
});
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines.length = 0;
  expect(callbacks.size).toBe(0);
});
afterAll(() => vi.unstubAllGlobals());

test.each([
  { hz: 24, jitter: 0 },
  { hz: 30, jitter: 0 },
  { hz: 59.94, jitter: 0 },
  { hz: 60, jitter: 0 },
  { hz: 60, jitter: 0.4 },
  { hz: 75, jitter: 0 },
  { hz: 90, jitter: 0 },
  { hz: 120, jitter: 0 },
  { hz: 144, jitter: 0 },
  { hz: 165, jitter: 0 },
  { hz: 240, jitter: 0 },
])(
  'draws once per refresh on a $hz Hz display with $jitter ms jitter, without changing speed',
  ({ hz, jitter }) => {
    const { engine, frames } = createEngine();
    engine.wake();
    refresh(0);
    const refreshes = Math.floor(hz * 6);
    for (let i = 1; i <= refreshes; i++) {
      refresh((i * 1000) / hz + (i % 2 ? jitter : -jitter));
    }
    expect(frames).toHaveLength(refreshes + 1);
    const gaps = frames.slice(1).map((time, index) => time - frames[index]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1000 / hz + 2 * jitter + 0.001);
    expect(engine.time).toBeCloseTo(frames.at(-1)! / 1000, 8);
    expect(engine.yaw).toBeCloseTo(0.6 + engine.time * 0.22, 8);
  },
);

test('follows refresh-rate changes without restarting the animation clock', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  refresh(0);
  const expected = [0];
  let time = 0;
  for (const hz of [60, 144, 30, 120]) {
    for (let i = 0; i < hz; i++) {
      time += 1000 / hz;
      expected.push(time);
      refresh(time);
    }
  }
  expect(frames).toEqual(expected);
  expect(engine.time).toBeCloseTo(4, 8);
  expect(engine.yaw).toBeCloseTo(0.6 + 4 * 0.22, 8);
});

test('repeated wake requests keep a single pending refresh', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  engine.wake();
  expect(callbacks.size).toBe(1);
  refresh(0);
  engine.wake();
  engine.wake();
  expect(callbacks.size).toBe(1);
  refresh(16);
  expect(frames).toEqual([0, 16]);
  expect(callbacks.size).toBe(1);
});

test('pausing cancels pending frames and resumes without advancing through the pause', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  refresh(0);
  refresh(20);
  const time = engine.time;
  engine.setPaused(true);
  expect(callbacks.size).toBe(0);
  engine.setState('reasoning');
  engine.resize(200);
  engine.wake();
  engine.setPaused(true);
  refresh(10000);
  expect(frames).toEqual([0, 20]);
  expect(engine.time).toBe(time);
  engine.setPaused(false);
  refresh(10020);
  expect(engine.time).toBe(time);
  refresh(10040);
  expect(engine.time).toBeCloseTo(time + 0.02, 8);
});

test('document visibility cancels immediately and resets the animation clock on return', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  refresh(0);
  refresh(20);
  const time = engine.time;
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(callbacks.size).toBe(0);
  engine.setState('loading');
  refresh(10000);
  expect(frames).toHaveLength(2);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  refresh(10020);
  expect(engine.time).toBe(time);
  refresh(10040);
  expect(engine.time).toBeCloseTo(time + 0.02, 8);
});

test('a delayed callback draws once and resumes with elapsed time without a catch-up burst', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  refresh(0);
  refresh(2000);
  expect(frames).toEqual([0, 2000]);
  expect(engine.time).toBeCloseTo(0.1);
  expect(callbacks.size).toBe(1);
  refresh(2001);
  expect(frames).toEqual([0, 2000, 2001]);
  expect(engine.time).toBeCloseTo(0.101);
  refresh(2020);
  expect(frames).toHaveLength(4);
  expect(engine.time).toBeCloseTo(0.12);
});

test('reduced motion draws once, remains paused through changes and restarts smoothly', () => {
  const { engine, frames } = createEngine();
  engine.reduce = true;
  engine.wake();
  refresh(0);
  expect(callbacks.size).toBe(0);
  engine.setPaused(true);
  engine.setState('reasoning');
  engine.wake();
  refresh(5000);
  expect(frames).toEqual([0]);
  engine.setPaused(false);
  refresh(5020);
  expect(frames).toEqual([0, 5020]);
  expect(callbacks.size).toBe(0);
  engine.reduce = false;
  engine.wake();
  refresh(10000);
  expect(engine.time).toBe(0);
  refresh(10020);
  expect(engine.time).toBeCloseTo(0.02);
});

test('quiet states stop scheduling, including ready after its existing settling period', () => {
  const { engine, frames } = createEngine('ready');
  engine.wake();
  for (let i = 0; i <= 18 * 60; i++) refresh((i * 1000) / 60);
  expect(frames.length).toBeGreaterThan(14 * 60);
  expect(callbacks.size).toBe(0);
  engine.setState('generating');
  refresh(20000);
  expect(callbacks.size).toBe(1);
  engine.setState('stopped');
  refresh(20020);
  expect(callbacks.size).toBe(0);
});

test('destroy cancels callbacks and prevents later updates from restarting the engine', () => {
  const { engine, frames } = createEngine();
  engine.wake();
  engine.destroy();
  engine.setState('loading');
  engine.resize(200);
  engine.setPaused(true);
  engine.setPaused(false);
  engine.wake();
  document.dispatchEvent(new Event('visibilitychange'));
  refresh(10000);
  expect(frames).toEqual([]);
  expect(callbacks.size).toBe(0);
});

test.each([1, 2, 3])('expensive draws reduce detail but preserve resolution at DPR %i', (dpr) => {
  const { engine, frames, canvas } = createEngine('generating', dpr);
  expect(canvas.width).toBe(224 * dpr);
  drawCost = 14;
  engine.wake();
  for (let i = 0; i <= 180; i++) refresh((i * 1000) / 60);
  expect(engine.quality).toBe(2);
  expect(canvas.width).toBe(224 * dpr);
  expect(frames).toHaveLength(181);
  expect(engine.time).toBeCloseTo(3);
  drawCost = 1;
  for (let i = 181; i <= 360; i++) refresh((i * 1000) / 60);
  expect(engine.quality).toBe(2);
  for (let i = 361; i <= 1260; i++) refresh((i * 1000) / 60);
  expect(engine.quality).toBe(0);
  expect(canvas.width).toBe(224 * dpr);
  expect(frames).toHaveLength(1261);
  expect(engine.time).toBeCloseTo(21);
});

test('a single cold draw and a long background pause do not lower detail', () => {
  const { engine } = createEngine();
  engine.wake();
  drawCost = 100;
  refresh(0);
  drawCost = 1;
  for (let i = 1; i <= 120; i++) refresh((i * 1000) / 60);
  engine.setPaused(true);
  engine.setPaused(false);
  refresh(120000);
  expect(engine.quality).toBe(0);
});

test('high refresh displays use a smaller drawing budget', () => {
  const { engine, frames } = createEngine();
  drawCost = 5;
  engine.wake();
  for (let i = 0; i <= 300; i++) refresh((i * 1000) / 144);
  expect(engine.quality).toBe(2);
  expect(frames).toHaveLength(301);
  expect(engine.time).toBeCloseTo(300 / 144);
});

test('palette changes retain motion, amber error semantics and restore local colors', () => {
  const { engine } = createEngine('ready');
  const observed = engine as ObservedOrb & {
    target(key: string): number;
    cur: { hue: number; sat: number };
  };
  const localHue = observed.target('hue');
  const spin = observed.target('spin');
  engine.setPalette({ primary: '#d55cbf', secondary: '#f89dc9' });
  expect(observed.target('hue')).not.toBe(localHue);
  expect(observed.target('spin')).toBe(spin);
  engine.setState('error');
  const errorHue = observed.target('hue');
  engine.setPalette(null);
  expect(observed.target('hue')).toBe(errorHue);
  engine.setState('ready');
  expect(observed.target('hue')).toBe(localHue);
});
