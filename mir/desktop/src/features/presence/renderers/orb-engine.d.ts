import type { PresenceState } from '../../../domain/presence';

export default class HoloOrb {
  constructor(
    canvas: HTMLCanvasElement,
    options?: { size?: number; state?: PresenceState; autostart?: boolean },
  );
  reduce: boolean;
  setState(state: PresenceState): void;
  setPaused(paused: boolean): void;
  resize(size: number): void;
  wake(): void;
  destroy(): void;
}
