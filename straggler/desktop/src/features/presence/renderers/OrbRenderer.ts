import HoloOrb from './orb-engine.js';
import type { PresenceRenderer } from '../renderer';
import type { PresenceState } from '../../../domain/presence';

export class OrbRenderer implements PresenceRenderer {
  private engine: HoloOrb | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: PresenceState = 'offline';
  private appliedState: PresenceState = 'offline';
  private paused = false;
  private size: number | null = null;
  private pendingResize = false;
  private motion: MediaQueryList | null = null;
  private updateMotion = () => {
    if (this.engine && this.motion) {
      this.engine.reduce = this.motion.matches;
      if (!this.paused) this.engine.wake();
    }
  };

  mount(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    if (!this.canvas.getContext('2d')) throw new Error('Canvas rendering is unavailable.');
    container.append(this.canvas);
    this.size = container.clientWidth;
    this.engine = new HoloOrb(this.canvas, { size: container.clientWidth, state: this.state });
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.updateMotion);
  }
  setState(state: PresenceState) {
    if (state === this.state) return;
    this.state = state;
    if (!this.paused) {
      this.engine?.setState(state);
      this.appliedState = state;
    }
  }
  setPaused(paused: boolean) {
    // Repeated native visibility reports must not wake a resting or paused engine.
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) {
      if (this.state !== this.appliedState) {
        this.engine?.setState(this.state);
        this.appliedState = this.state;
      }
      if (this.pendingResize && this.size !== null) {
        this.engine?.resize(this.size);
        this.pendingResize = false;
      }
    }
    this.engine?.setPaused(paused);
  }
  resize(size: number) {
    if (size <= 0 || size === this.size) return;
    this.size = size;
    if (this.paused) this.pendingResize = true;
    else this.engine?.resize(size);
  }
  destroy() {
    this.motion?.removeEventListener('change', this.updateMotion);
    this.engine?.destroy();
    this.canvas?.remove();
    this.engine = null;
    this.canvas = null;
    this.motion = null;
  }
}
