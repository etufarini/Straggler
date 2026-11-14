// This function is self-contained so native WebDriver can install the same
// observer as browser diagnostics, without exposing hooks in the application.
export function installOrbMeasurement(Engine) {
  const frames = [];
  const refreshes = [];
  const draws = [];
  const originalClear = CanvasRenderingContext2D.prototype.clearRect;
  const originalDraw = Engine?.prototype.draw;
  let refresh;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.closest('.presence-stage'))
      frames.push({
        time: performance.now(),
        state: this.canvas.closest('.assistant-presence')?.dataset.state,
        pixels: this.canvas.width,
      });
    return originalClear.apply(this, args);
  };
  if (Engine)
    Engine.prototype.draw = function () {
      const start = performance.now();
      originalDraw.call(this);
      draws.push({ state: this.state, ms: performance.now() - start, quality: this.quality });
    };
  function observeRefresh(time) {
    refreshes.push(time);
    refresh = requestAnimationFrame(observeRefresh);
  }
  refresh = requestAnimationFrame(observeRefresh);
  function summarize(values) {
    const ordered = [...values].sort((a, b) => a - b);
    return {
      median: ordered[Math.floor(ordered.length * 0.5)] ?? null,
      p95: ordered[Math.floor(ordered.length * 0.95)] ?? null,
      max: ordered.at(-1) ?? null,
    };
  }
  window.__stragglerOrbMeasurement = {
    frames,
    snapshot() {
      const phases = {};
      for (const state of ['loading', 'reasoning', 'generating', 'ready', 'stopped', 'error']) {
        const matching = frames.filter((frame) => frame.state === state);
        const intervals = [];
        for (let index = 1; index < frames.length; index++)
          if (frames[index].state === state && frames[index - 1].state === state)
            intervals.push(frames[index].time - frames[index - 1].time);
        const drawn = draws.filter((draw) => draw.state === state);
        phases[state] = {
          frames: matching.length,
          frameIntervalMs: summarize(intervals),
          drawMs: summarize(drawn.map((draw) => draw.ms)),
          qualityLevels: [...new Set(drawn.map((draw) => draw.quality))],
          canvasPixels: [...new Set(matching.map((frame) => frame.pixels))],
        };
      }
      return {
        userAgent: navigator.userAgent,
        devicePixelRatio,
        refreshIntervalMs: summarize(
          refreshes.slice(1).map((time, index) => time - refreshes[index]),
        ),
        phases,
      };
    },
    stop() {
      cancelAnimationFrame(refresh);
      CanvasRenderingContext2D.prototype.clearRect = originalClear;
      if (Engine) Engine.prototype.draw = originalDraw;
    },
  };
}
