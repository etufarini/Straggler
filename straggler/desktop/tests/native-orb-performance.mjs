import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';

// Measure the app and its child processes, with the same fixture stream running
// in both samples. This includes GUI/polling overhead; it is not inference CPU.
async function processTicks(rootPid) {
  const records = new Map();
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const text = await readFile(`/proc/${name}/stat`, 'utf8');
      const fields = text
        .slice(text.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      records.set(Number(name), {
        parent: Number(fields[1]),
        ticks: Number(fields[11]) + Number(fields[12]),
      });
    } catch {
      /* A process may exit during sampling. */
    }
  }
  const owned = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, record] of records)
      if (!owned.has(pid) && owned.has(record.parent)) {
        owned.add(pid);
        changed = true;
      }
  }
  return new Map(
    [...records].filter(([pid]) => owned.has(pid)).map(([pid, record]) => [pid, record.ticks]),
  );
}

export async function measureNativeOrb({ pid, evaluate, hide, output }) {
  const measureCpu = process.platform === 'linux';
  if (!measureCpu) console.log('SKIP: native GUI CPU measurement requires Linux /proc.');
  const hz = measureCpu
    ? Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
    : null;
  async function sample() {
    const documentHidden = await evaluate('document.hidden');
    const nativeMinimized = await evaluate(
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized",{label:"main"})',
    );
    const nativeVisible = await evaluate(
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible",{label:"main"})',
    );
    const hidden = documentHidden || nativeMinimized || !nativeVisible;
    const frames = await evaluate('window.__stragglerOrbMeasurement.frames.length');
    const before = measureCpu ? await processTicks(pid) : new Map();
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const after = measureCpu ? await processTicks(pid) : new Map();
    const seconds = (performance.now() - start) / 1000;
    const ticks = [...after].reduce(
      (sum, [processId, value]) => sum + Math.max(0, value - (before.get(processId) ?? value)),
      0,
    );
    const frameTimes = await evaluate(
      `window.__stragglerOrbMeasurement.frames.slice(${frames}).map(frame => frame.time)`,
    );
    const drawn = frameTimes.length;
    const intervals = frameTimes
      .slice(1)
      .map((time, index) => time - frameTimes[index])
      .sort((a, b) => a - b);
    return {
      hidden,
      documentHidden,
      nativeMinimized,
      nativeVisible,
      seconds,
      guiCpuPercent: measureCpu ? Math.round((ticks / hz / seconds) * 10000) / 100 : null,
      orbFrames: drawn,
      orbFps: drawn / seconds,
      frameIntervalMsMedian: intervals[Math.floor(intervals.length * 0.5)] ?? null,
      frameIntervalMsP95: intervals[Math.floor(intervals.length * 0.95)] ?? null,
    };
  }
  const visible = await sample();
  await hide();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const hidden = await sample();
  const animation = await evaluate('window.__stragglerOrbMeasurement.snapshot()');
  await evaluate('window.__stragglerOrbMeasurement.stop()');
  await writeFile(
    output,
    JSON.stringify(
      {
        method:
          'Native WebView draw callbacks, not presented frames; local fixture responses; Linux CPU percentage of one core for the owned GUI process tree. Rendering mode depends on the host environment.',
        visible,
        hidden,
        animation,
      },
      null,
      2,
    ),
  );
  const cpuLabel = (sample) =>
    sample.guiCpuPercent === null ? 'CPU unavailable' : `${sample.guiCpuPercent}% CPU`;
  console.log(
    `Native orb: visible ${cpuLabel(visible)}, ${visible.orbFps.toFixed(1)} draws/s; hidden ${cpuLabel(hidden)}, ${hidden.orbFrames} draws. ${output}`,
  );
  assert.equal(visible.hidden, false, 'Visible window must be visible to WebKit');
  assert.ok(
    visible.orbFrames > 0,
    'Live orb must draw while visible; the browser determines the available refresh rate',
  );
  const maxP95 = process.env.STRAGGLER_ORB_MAX_FRAME_P95_MS;
  if (maxP95 !== undefined) {
    const limit = Number(maxP95);
    assert.ok(Number.isFinite(limit) && limit > 0, 'Frame interval limit must be positive');
    assert.ok(
      visible.frameIntervalMsP95 !== null && visible.frameIntervalMsP95 <= limit,
      `Visible frame interval p95 ${visible.frameIntervalMsP95} ms exceeds ${limit} ms`,
    );
  }
  assert.equal(hidden.hidden, true, 'Native window must actually be hidden for the hidden sample');
  assert.equal(hidden.orbFrames, 0, 'Hidden orb must stop drawing');
}
