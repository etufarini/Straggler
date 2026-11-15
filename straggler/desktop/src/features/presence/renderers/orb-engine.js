/* HoloOrb — revision 1.11 model orb engine (no dependencies).
 *
 * A holographic sphere drawn as light: ~1,100 crisp particles in real 3D,
 * projected with perspective and blended additively, a Fresnel rim for
 * volume, two orbit rings with a travelling arc, a cylinder of code panels
 * and a projector base. The only light at the centre is a soft pulse.
 *
 * Each state has its own colour AND its own motion, so states differ even
 * without colour (the state is also always written next to the orb):
 *   offline    slate      still dust, no centre light
 *   loading    aqua       particles breathe in toward the sphere on a spiral
 *   ready      blue       one slow turn, slow breathing light, then rest
 *   reasoning  violet     counter-flowing bands and a rising scan line
 *   generating cyan       concentric waves from the centre, fast pulse
 *   stopped    dim blue   frozen frame
 *   error      amber      sphere split into shards, still
 *
 * API: new HoloOrb(canvas, {size, state, dpr, autostart, scanlines});
 * setState(s); setTilt(x, y); setPaused(b); disintegrate(); reassemble();
 * renderStill(state, t); resize(size); destroy().
 * Budget: one frame per browser refresh; pauses when hidden; stops once an
 * idle state has settled; one still frame with prefers-reduced-motion.
 */
const HoloOrb = (function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const lerpHue = (a, b, t) => {
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * t + 360) % 360;
  };

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // hue / spread (iridescence range) / sat; motion parameters.
  const STATES = {
    offline: {
      hue: 222,
      spread: 10,
      sat: 18,
      scatter: 0.8,
      spin: 0,
      energy: 0.42,
      core: 0,
      pulse: 0,
      breathe: 0,
      bands: 0,
      scan: 0,
      waves: 0,
      shards: 0,
      panels: 0.25,
    },
    loading: {
      hue: 168,
      spread: 18,
      sat: 85,
      scatter: 0.3,
      spin: 0.35,
      energy: 0.9,
      core: 0.55,
      pulse: 1.4,
      breathe: 1,
      bands: 0,
      scan: 0,
      waves: 0,
      shards: 0,
      panels: 0.55,
    },
    ready: {
      hue: 222,
      spread: 26,
      sat: 95,
      scatter: 0,
      spin: 0.14,
      energy: 1,
      core: 0.75,
      pulse: 0.35,
      breathe: 0,
      bands: 0,
      scan: 0,
      waves: 0,
      shards: 0,
      panels: 0.8,
    },
    reasoning: {
      hue: 268,
      spread: 20,
      sat: 90,
      scatter: 0,
      spin: 0.25,
      energy: 1.1,
      core: 0.8,
      pulse: 0.9,
      breathe: 0,
      bands: 1,
      scan: 1,
      waves: 0,
      shards: 0,
      panels: 0.9,
    },
    generating: {
      hue: 192,
      spread: 14,
      sat: 100,
      scatter: 0,
      spin: 0.22,
      energy: 1.12,
      core: 1,
      pulse: 2.6,
      breathe: 0,
      bands: 0,
      scan: 0,
      waves: 1,
      shards: 0,
      panels: 0.95,
    },
    stopped: {
      hue: 220,
      spread: 12,
      sat: 45,
      scatter: 0,
      spin: 0,
      energy: 0.72,
      core: 0.35,
      pulse: 0,
      breathe: 0,
      bands: 0,
      scan: 0,
      waves: 0,
      shards: 0,
      panels: 0.6,
    },
    error: {
      hue: 34,
      spread: 10,
      sat: 100,
      scatter: 0,
      spin: 0,
      energy: 0.85,
      core: 0.45,
      pulse: 0,
      breathe: 0,
      bands: 0,
      scan: 0,
      waves: 0,
      shards: 1,
      panels: 0.5,
    },
  };
  // Idle states come to rest (ready after one slow turn: WCAG 2.2.2).
  const RESTING = { offline: 0, stopped: 0, error: 0, ready: 14 };
  const QUALITY = [
    { stride: 1, details: true },
    { stride: 2, details: true },
    { stride: 3, details: false },
  ];
  const PANEL_LINES = [
    [0.1, 0.65, 0.26],
    [0.22, 0.62, 0.44],
    [0.22, 0.84, 0.62],
    [0.1, 0.4, 0.8],
  ];

  const hsla = (h, s, l, a) =>
    `hsla(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%,${a.toFixed(3)})`;

  class HoloOrb {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.loop = this.loop.bind(this);
      this.autostart = options.autostart !== false;
      this.size = options.size || canvas.clientWidth || 240;
      this.dpr = options.dpr || root.devicePixelRatio || 1;
      this.quality = 0;
      this.qualityElapsed = 0;
      this.recoveryElapsed = 0;
      this.frameIntervals = [];
      this.drawTimes = [];
      this.state = options.state || 'ready';
      this.scanlines = options.scanlines !== false;
      this.cur = Object.assign({}, STATES[this.state]);
      this.manualScatter = null;
      this.tiltX = 0;
      this.tiltY = 0;
      this.paused = false;
      this.time = 0;
      this.stateTime = 0;
      this.yaw = 0.6;
      this.raf = 0;
      this.destroyed = false;
      this.last = null;
      this.reduce = root.matchMedia
        ? root.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
      this.sprites = new Map();
      this.build();
      this.resize();
      this.onVisibility = () => {
        if (root.document.hidden) this.stopLoop();
        else this.wake();
      };
      if (root.document) root.document.addEventListener('visibilitychange', this.onVisibility);
      if (options.autostart !== false) this.wake();
    }

    build() {
      const r = rng(7);
      const N = 1100;
      const golden = Math.PI * (3 - Math.sqrt(5));
      this.shell = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const rad = Math.sqrt(1 - y * y);
        const th = golden * i;
        const p = [Math.cos(th) * rad, y, Math.sin(th) * rad];
        const k = 1.7 + r() * 1.8;
        const s = [
          (p[0] + (r() - 0.5) * 0.9) * k,
          (p[1] + (r() - 0.5) * 0.9) * k * 0.8,
          (p[2] + (r() - 0.5) * 0.9) * k,
        ];
        // shard id: the sphere splits into a few pieces along fixed planes
        const shard = (p[0] > 0.2 ? 1 : 0) + (p[1] > -0.15 ? 2 : 0) + (p[2] > 0.35 ? 4 : 0);
        this.shell.push({
          p,
          s,
          seed: r(),
          size: 0.8 + r() * 0.6,
          lat: y,
          huePhase: y * 2.4 + Math.atan2(p[2], p[0]),
          bandDirection: Math.floor((y + 1) * 3) % 2 ? 1 : -1,
          shard,
        });
      }
      this.shardDir = [];
      for (let i = 0; i < 8; i++) {
        const a = r() * TAU,
          b = (r() - 0.5) * 1.2;
        this.shardDir.push([Math.cos(a) * 0.34, b * 0.26, Math.sin(a) * 0.34]);
      }
      this.rings = [
        [1.52, 0.2, 0],
        [1.74, -0.12, 1],
      ].map(([R, tilt, id]) => {
        const points = [];
        for (let i = 0; i < 260; i++) {
          const a = (i / 260) * TAU;
          points.push({
            p: [Math.cos(a) * R, Math.sin(a) * R * Math.sin(tilt) * 0.5, Math.sin(a) * R],
            a,
          });
        }
        return { points, speedFactor: id ? -0.6 : 0.8, hueOffset: id ? 12 : -10 };
      });
      this.panels = [];
      for (let i = 0; i < 9; i++) {
        this.panels.push({
          a: (i / 9) * TAU + r() * 0.4,
          y: (r() - 0.5) * 1.5,
          w: 0.34 + r() * 0.16,
          h: 0.22 + r() * 0.08,
          kind: 'screen',
          seed: r(),
          corners: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
        });
      }
      for (let i = 0; i < 22; i++) {
        this.panels.push({
          a: r() * TAU,
          y: (r() - 0.5) * 1.9,
          w: 0.12 + r() * 0.26,
          h: 0.03 + r() * 0.025,
          kind: 'strip',
          seed: r(),
          corners: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
        });
      }
    }

    resize(size) {
      if (size) this.size = size;
      const px = Math.round(this.size * this.dpr);
      this.canvas.width = px;
      this.canvas.height = px;
      this.canvas.style.width = this.size + 'px';
      this.canvas.style.height = this.size + 'px';
      if (this.autostart) this.wake();
    }

    // Crisp particle: a solid bright centre and a short falloff. Hue in 6°
    // steps, saturation and lightness in coarse steps keep the cache bounded.
    sprite(hue, sat, light) {
      const h = Math.round((((hue % 360) + 360) % 360) / 6) * 6;
      const s = Math.round(clamp(sat, 0, 100) / 20) * 20;
      const l = Math.round(clamp(light, 45, 85) / 10) * 10;
      // Numeric keys avoid allocating a colour string for every particle lookup.
      const key = (h * 101 + s) * 100 + l;
      let c = this.sprites.get(key);
      if (c) return c;
      c = root.document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
      grd.addColorStop(0, hsla(h, s, Math.min(97, l + 22), 1));
      grd.addColorStop(0.32, hsla(h, s, l + 8, 1));
      grd.addColorStop(0.55, hsla(h, s, l, 0.35));
      grd.addColorStop(1, hsla(h, s, l, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 16, 16);
      this.sprites.set(key, c);
      return c;
    }

    setState(state) {
      if (!STATES[state]) return;
      if (state === 'loading' && this.state !== 'loading')
        this.cur.scatter = Math.max(this.cur.scatter, 0.95);
      this.state = state;
      this.stateTime = 0;
      this.manualScatter = null;
      this.wake();
    }
    disintegrate() {
      this.manualScatter = 1;
      this.wake();
    }
    reassemble() {
      this.manualScatter = 0;
      this.wake();
    }
    setTilt(x, y) {
      this.tiltX = x;
      this.tiltY = y;
      this.wake();
    }
    setPaused(p) {
      if (p === this.paused) return;
      this.paused = p;
      if (p) this.stopLoop();
      else this.wake();
    }

    stopLoop() {
      if (this.raf) root.cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.last = null;
      this.qualityElapsed = 0;
      this.frameIntervals.length = 0;
      this.drawTimes.length = 0;
      this.recoveryElapsed = 0;
    }

    wake() {
      if (
        this.destroyed ||
        this.paused ||
        (root.document && root.document.hidden) ||
        this.raf ||
        !root.requestAnimationFrame
      )
        return;
      this.raf = root.requestAnimationFrame(this.loop);
    }

    loop(now) {
      this.raf = 0;
      if (this.destroyed || this.paused || (root.document && root.document.hidden)) {
        this.stopLoop();
        return;
      }
      if (this.reduce) {
        this.snap();
        this.draw();
        this.stopLoop();
        return;
      }
      // The browser owns the refresh cadence, including variable refresh rates.
      // Elapsed time keeps motion independent of that cadence; clamp long stalls
      // so a blocked event loop cannot cause a large jump or catch-up work.
      const interval = this.last === null ? 0 : now - this.last;
      const dt = Math.min(0.1, interval / 1000);
      this.last = now;
      if (this.state !== 'stopped') this.step(dt);
      const drawStart = root.performance.now();
      this.draw();
      this.recordFrame(interval, root.performance.now() - drawStart);
      if (this.settled()) {
        this.stopLoop();
        return;
      }
      this.wake();
    }

    recordFrame(interval, drawMs) {
      // Ignore startup and stalls unrelated to a sustained rendering workload.
      if (interval <= 0 || interval > 250) return;
      this.qualityElapsed += interval;
      this.frameIntervals.push(interval);
      this.drawTimes.push(drawMs);
      if (this.qualityElapsed < 1000) return;

      this.frameIntervals.sort((a, b) => a - b);
      this.drawTimes.sort((a, b) => a - b);
      const count = this.drawTimes.length;
      // Reserve most of a frame for the chat and WebView compositing. Faster
      // displays tighten this budget; missed refreshes must not loosen it.
      const budget = Math.min(1000 / 60, this.frameIntervals[Math.floor(count * 0.2)]);
      const average = this.drawTimes.reduce((sum, time) => sum + time, 0) / count;
      const p95 = this.drawTimes[Math.floor(count * 0.95)];
      let nextQuality = this.quality;
      if (average > budget * 0.45 || p95 > budget * 0.7) {
        nextQuality = Math.min(QUALITY.length - 1, this.quality + 1);
        this.recoveryElapsed = 0;
      } else if (average < budget * 0.18 && p95 < budget * 0.35) {
        this.recoveryElapsed += this.qualityElapsed;
        if (this.recoveryElapsed >= 8000) {
          nextQuality = Math.max(0, this.quality - 1);
          this.recoveryElapsed = 0;
        }
      } else this.recoveryElapsed = 0;
      this.qualityElapsed = 0;
      this.frameIntervals.length = 0;
      this.drawTimes.length = 0;
      this.quality = nextQuality;
    }

    target(key) {
      if (key === 'scatter' && this.manualScatter !== null) return this.manualScatter;
      if (
        this.state === 'ready' &&
        this.stateTime > RESTING.ready &&
        (key === 'spin' || key === 'pulse')
      )
        return 0;
      return STATES[this.state][key];
    }

    settled() {
      if (this.manualScatter !== null && Math.abs(this.cur.scatter - this.manualScatter) > 0.004)
        return false;
      if (this.state === 'stopped') return true;
      if (!(this.state in RESTING) || this.stateTime < RESTING[this.state]) return false;
      for (const key in STATES[this.state]) {
        const d =
          key === 'hue'
            ? Math.abs(((this.cur.hue - this.target('hue') + 540) % 360) - 180)
            : Math.abs(this.cur[key] - this.target(key));
        if (d > (key === 'hue' || key === 'sat' || key === 'spread' ? 0.5 : 0.004)) return false;
      }
      return true;
    }

    snap() {
      for (const key in STATES[this.state]) this.cur[key] = this.target(key);
    }

    step(dt) {
      const k = 1 - Math.pow(0.002, dt);
      this.stateTime += dt;
      for (const key in STATES[this.state]) {
        const goal = this.target(key);
        if (key === 'hue') this.cur.hue = lerpHue(this.cur.hue, goal, k);
        else this.cur[key] = lerp(this.cur[key], goal, key === 'scatter' ? k * 0.55 : k);
      }
      this.time += dt;
      this.yaw += dt * this.cur.spin;
    }

    renderStill(state, t = 4.2) {
      this.state = state;
      this.manualScatter = null;
      this.stateTime = 0;
      this.snap();
      this.time = t;
      this.yaw = 0.6 + t * 0.05;
      this.draw();
    }

    rotate(p, cosY, sinY, cosX, sinX, result = []) {
      const x = p[0] * cosY + p[2] * sinY;
      const z0 = -p[0] * sinY + p[2] * cosY;
      result[0] = x;
      result[1] = p[1] * cosX - z0 * sinX;
      result[2] = p[1] * sinX + z0 * cosX;
      return result;
    }

    project(v, R, cx, cy, result = []) {
      const s = 3.4 / (3.4 - v[2]);
      result[0] = cx + v[0] * s * R;
      result[1] = cy - v[1] * s * R;
      result[2] = v[2];
      result[3] = s;
      return result;
    }

    draw() {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const c = this.cur;
      const t = this.time;
      const E = c.energy;
      const R = W * 0.215;
      const cx = W / 2;
      const cy = W * 0.44;
      const pitch = 0.3 + this.tiltY;
      const yaw = this.yaw + this.tiltX;
      const cosY = Math.cos(yaw),
        sinY = Math.sin(yaw),
        cosX = Math.cos(pitch),
        sinX = Math.sin(pitch);
      const H = c.hue,
        S = c.sat;
      const unit = W / 260;
      const quality = QUALITY[this.quality];

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, W);
      ctx.globalCompositeOperation = 'lighter';

      // Faint halo (kept low so the sphere stays sharp).
      let g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2);
      g.addColorStop(0, hsla(H, S, 55, 0.1 * E));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, W);

      // Projector beam and base.
      const baseY = W * 0.88;
      const beam = ctx.createLinearGradient(0, cy, 0, baseY);
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(1, hsla(H, S, 60, 0.06 * E));
      ctx.fillStyle = beam;
      for (const w of [1, 0.74, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.5 * w, cy);
        ctx.lineTo(cx + R * 0.5 * w, cy);
        ctx.lineTo(cx + R * 0.95 * w, baseY);
        ctx.lineTo(cx - R * 0.95 * w, baseY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.lineWidth = Math.max(1, W / 420);
      for (let i = 1; i <= 6; i++) {
        ctx.strokeStyle = hsla(H, S, 68, (0.26 - i * 0.03) * E);
        ctx.beginPath();
        ctx.ellipse(cx, baseY, R * 0.22 * i, R * 0.035 * i, 0, 0, TAU);
        ctx.stroke();
      }

      const edge = (x, y) => clamp((1 - Math.hypot(x - cx, y - W / 2) / (W * 0.5)) / 0.22, 0, 1);
      // loading: scatter breathes in and out per particle, on a spiral
      const scatterOf = (seed) => {
        let base = c.scatter;
        if (c.breathe > 0.01)
          base = clamp(base + c.breathe * 0.3 * Math.sin(t * 1.5 - seed * 4), 0, 1);
        return ease(clamp(base * 1.45 - seed * 0.45, 0, 1));
      };

      this.drawPanels(ctx, cosY, sinY, cosX, sinX, R, cx, cy, quality.details);

      // Reuse projection buffers across particles to keep garbage collection
      // out of the animation's hot path. Panels retain their own corner arrays.
      const position = [0, 0, 0];
      const v = [0, 0, 0];
      const n = [0, 0, 0];
      const sp = [0, 0, 0, 0];

      // Rings: thin, with a travelling arc.
      for (const ring of this.rings) {
        const sprite = this.sprite(H + ring.hueOffset, S, 66);
        const speed = ring.speedFactor * (0.3 + c.spin * 2 + c.waves * 0.6 + c.bands * 0.4);
        const head = (((t * speed) % TAU) + TAU) % TAU;
        for (let index = 0; index < ring.points.length; index += quality.stride) {
          const q = ring.points[index];
          this.rotate(q.p, cosY, sinY, cosX, sinX, v);
          this.project(v, R, cx, cy, sp);
          let d = Math.abs(q.a - head);
          d = Math.min(d, TAU - d);
          const arc = Math.max(0, 1 - d / 1.1);
          const depth = 0.45 + 0.55 * ((v[2] + 1.8) / 3.6);
          ctx.globalAlpha = clamp(
            (0.12 + arc * arc * 0.85) * depth * E * (1 - c.scatter * 0.7),
            0,
            1,
          );
          const sz = (0.9 + arc * 1.4) * sp[3] * unit;
          ctx.drawImage(sprite, sp[0] - sz, sp[1] - sz, sz * 2, sz * 2);
        }
      }

      // Shell.
      const scanY = Math.sin(t * 1.1) * 0.95;
      const bandAngle = c.bands * t * 0.9;
      const bandCos = Math.cos(bandAngle);
      const bandSin = Math.sin(bandAngle);
      for (let index = 0; index < this.shell.length; index += quality.stride) {
        const q = this.shell[index];
        const k = scatterOf(q.seed);
        let x = q.p[0];
        let z = q.p[2];
        // reasoning: bands flow in opposite directions
        if (c.bands > 0.01) {
          const sa = bandSin * q.bandDirection;
          x = q.p[0] * bandCos + q.p[2] * sa;
          z = -q.p[0] * sa + q.p[2] * bandCos;
        }
        // loading: spiral twist while gathering
        if (c.breathe > 0.01 && k > 0.01) {
          const ang = k * 2.2;
          const ca = Math.cos(ang),
            sa = Math.sin(ang);
          const previousX = x;
          x = previousX * ca + z * sa;
          z = -previousX * sa + z * ca;
        }
        position[0] = lerp(x, q.s[0], k);
        position[1] = lerp(q.p[1], q.s[1], k);
        position[2] = lerp(z, q.s[2], k);
        // error: shards pushed apart along fixed directions
        if (c.shards > 0.01) {
          const d = this.shardDir[q.shard];
          position[0] += d[0] * c.shards;
          position[1] += d[1] * c.shards;
          position[2] += d[2] * c.shards;
        }
        this.rotate(position, cosY, sinY, cosX, sinX, v);
        this.rotate(q.p, cosY, sinY, cosX, sinX, n);
        // generating: concentric waves travelling from the centre of the disc
        let lift = 0;
        if (c.waves > 0.01) {
          const fromCentre = Math.acos(clamp(n[2], -1, 1)); // 0 at the front centre
          lift = c.waves * Math.max(0, Math.sin(fromCentre * 4 - t * 5)) ** 3;
          const r = 1 + lift * 0.05;
          v[0] *= r;
          v[1] *= r;
          v[2] *= r;
        }
        this.project(v, R, cx, cy, sp);
        const fres = Math.pow(1 - Math.abs(n[2]), 1.8);
        const front = 0.5 + 0.5 * ((n[2] + 1) / 2);
        // reasoning: a bright scan line rising and falling
        const scan = c.scan > 0.01 ? c.scan * Math.max(0, 1 - Math.abs(q.lat - scanY) / 0.08) : 0;
        const hue = H + c.spread * Math.sin(q.huePhase + t * 0.4) + fres * 8;
        const a =
          ((0.08 + 0.92 * fres) * front * E * (1 - k * 0.4) + k * 0.14 + scan * 0.8 + lift * 0.5) *
          edge(sp[0], sp[1]);
        const sz = q.size * (0.85 + fres * 0.7 + scan * 0.6 + lift * 0.5) * sp[3] * unit;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.drawImage(
          this.sprite(hue, S, 62 + fres * 10 + (scan + lift) * 15),
          sp[0] - sz,
          sp[1] - sz,
          sz * 2,
          sz * 2,
        );
      }

      // Centre: only a soft pulsing light (no star, no flare).
      const core = c.core * (1 - c.scatter * 0.9);
      if (core > 0.02) {
        const beat = c.pulse > 0.01 ? 0.5 + 0.5 * Math.sin(t * c.pulse * TAU * 0.5) : 0.5;
        const rad = R * (0.42 + 0.16 * beat);
        g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, hsla(H, S * 0.6, 86, (0.62 + 0.33 * beat) * core));
        g.addColorStop(0.35, hsla(H, S, 66, (0.32 + 0.22 * beat) * core));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.fill();
      }

      if (this.scanlines && quality.details) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = '#000';
        const step = Math.max(2, Math.round(3 * this.dpr));
        for (let y = 0; y < W; y += step) ctx.fillRect(0, y, W, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawPanels(ctx, cosY, sinY, cosX, sinX, R, cx, cy, details) {
      const c = this.cur;
      const t = this.time;
      const W = this.canvas.width;
      const H = c.hue,
        S = c.sat;
      const position = [0, 0, 0];
      const rotated = [0, 0, 0];
      for (const q of this.panels) {
        if (!details && q.kind === 'strip') continue;
        const k = ease(clamp(c.scatter * 1.4 - q.seed * 0.4, 0, 1));
        const radius =
          lerp(1.95, 3.1, k) -
          (c.waves > 0.01 ? 0.1 * c.waves * Math.max(0, Math.sin(t * 2.5 + q.seed * 9)) : 0);
        const a = q.a + t * (0.15 * c.bands - 0.05 * c.waves);
        const nx = Math.cos(a),
          nz = Math.sin(a);
        const tx = -nz,
          tz = nx;
        let px = nx * radius,
          pz = nz * radius,
          py = q.y + (k ? (q.seed - 0.5) * k * 1.4 : 0);
        if (c.shards > 0.01) py += (q.seed - 0.5) * 0.25 * c.shards;
        const hw = q.w / 2,
          hh = q.h / 2;
        const corners = q.corners;
        for (let index = 0; index < corners.length; index++) {
          const side = index === 0 || index === 3 ? -1 : 1;
          position[0] = px + side * tx * hw;
          position[1] = py + (index < 2 ? hh : -hh);
          position[2] = pz + side * tz * hw;
          this.rotate(position, cosY, sinY, cosX, sinX, rotated);
          this.project(rotated, R, cx, cy, corners[index]);
        }
        const vz = (-nx * sinY + nz * cosY) * cosX;
        const facing = 0.3 + 0.7 * clamp((vz + 1) / 2, 0, 1);
        const hue = H + (q.kind === 'strip' ? (q.seed - 0.5) * 2 * c.spread : 0);
        ctx.globalAlpha = clamp(c.panels * facing * c.energy * (1 - k * 0.5), 0, 1);
        if (q.kind === 'screen') {
          ctx.fillStyle = hsla(hue, S, 40, 0.14);
          ctx.strokeStyle = hsla(hue, S, 74, 0.9);
          ctx.lineWidth = Math.max(1, W / 380);
          ctx.beginPath();
          corners.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          const l = corners[0],
            rr = corners[1],
            bl = corners[3];
          ctx.lineWidth = Math.max(1, W / 320);
          ctx.strokeStyle = hsla(hue, S, 80, 0.95);
          ctx.beginPath();
          for (let index = 0; index < PANEL_LINES.length; index++) {
            if (index === 3) {
              ctx.stroke();
              ctx.strokeStyle = hsla(hue + c.spread * 1.5, S, 80, 0.95);
              ctx.beginPath();
            }
            const [start, end, row] = PANEL_LINES[index];
            ctx.moveTo(
              l[0] + (rr[0] - l[0]) * start + (bl[0] - l[0]) * row,
              l[1] + (rr[1] - l[1]) * start + (bl[1] - l[1]) * row,
            );
            ctx.lineTo(
              l[0] + (rr[0] - l[0]) * end + (bl[0] - l[0]) * row,
              l[1] + (rr[1] - l[1]) * end + (bl[1] - l[1]) * row,
            );
          }
          ctx.stroke();
        } else {
          const l = corners[0],
            rr = corners[1],
            bl = corners[3];
          for (let i = 0; i < 6; i++) {
            if ((i + Math.floor(q.seed * 10)) % 3 === 2) continue;
            const u0 = i / 6,
              u1 = (i + 0.6) / 6;
            ctx.fillStyle = hsla(i % 2 ? hue + c.spread : hue, S, 72, 0.9);
            ctx.beginPath();
            ctx.moveTo(l[0] + (rr[0] - l[0]) * u0, l[1] + (rr[1] - l[1]) * u0);
            ctx.lineTo(l[0] + (rr[0] - l[0]) * u1, l[1] + (rr[1] - l[1]) * u1);
            ctx.lineTo(bl[0] + (rr[0] - l[0]) * u1, bl[1] + (rr[1] - l[1]) * u1);
            ctx.lineTo(bl[0] + (rr[0] - l[0]) * u0, bl[1] + (rr[1] - l[1]) * u0);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    destroy() {
      this.destroyed = true;
      this.stopLoop();
      this.sprites.clear();
      if (root.document) root.document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  return HoloOrb;
})(typeof window !== 'undefined' ? window : this);

export default HoloOrb;
