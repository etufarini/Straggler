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
  if (process.platform !== 'linux') {
    console.log(
      'SKIP: native orb CPU measurement requires Linux /proc; animation lifecycle is covered by browser checks.',
    );
    return;
  }
  await evaluate(`(() => {
    window.__mirOrbFrames=0;
    const original=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
      if(this.canvas.closest('.presence-stage')) window.__mirOrbFrames++;
      return original.apply(this,args);
    };
  })()`);
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  async function sample() {
    const documentHidden = await evaluate('document.hidden');
    const nativeMinimized = await evaluate(
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized",{label:"main"})',
    );
    const nativeVisible = await evaluate(
      'window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible",{label:"main"})',
    );
    const hidden = documentHidden || nativeMinimized || !nativeVisible;
    const frames = await evaluate('window.__mirOrbFrames');
    const before = await processTicks(pid);
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const after = await processTicks(pid);
    const seconds = (performance.now() - start) / 1000;
    const ticks = [...after].reduce(
      (sum, [processId, value]) => sum + Math.max(0, value - (before.get(processId) ?? value)),
      0,
    );
    const drawn = (await evaluate('window.__mirOrbFrames')) - frames;
    return {
      hidden,
      documentHidden,
      nativeMinimized,
      nativeVisible,
      seconds,
      guiCpuPercent: Math.round((ticks / hz / seconds) * 10000) / 100,
      orbFrames: drawn,
      orbFps: drawn / seconds,
    };
  }
  const visible = await sample();
  await hide();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const hidden = await sample();
  await writeFile(
    output,
    JSON.stringify(
      {
        method:
          'Owned native GUI process tree; CPU percentage of one core; local fixture stream; software rendering.',
        visible,
        hidden,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native orb: visible ${visible.guiCpuPercent}% CPU, ${visible.orbFps.toFixed(1)} fps; hidden ${hidden.guiCpuPercent}% CPU, ${hidden.orbFrames} frames. ${output}`,
  );
  assert.equal(visible.hidden, false, 'Visible window must be visible to WebKit');
  assert.ok(
    visible.orbFrames > 0 && visible.orbFps <= 31,
    'Live orb must draw at no more than 30 fps (sampling tolerance 1 fps)',
  );
  assert.equal(hidden.hidden, true, 'Native window must actually be hidden for the hidden sample');
  assert.equal(hidden.orbFrames, 0, 'Hidden orb must stop drawing');
}
