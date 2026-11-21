import type { OrbPalette } from '../renderer';
import type { PresenceState } from '../../../domain/presence';

export default class HoloOrb {
  constructor(
    canvas: HTMLCanvasElement,
    options?: { size?: number; state?: PresenceState; autostart?: boolean },
  );
  reduce: boolean;
  setPalette(palette: OrbPalette | null): void;
  setState(state: PresenceState): void;
  setPaused(paused: boolean): void;
  resize(size: number): void;
  wake(): void;
  destroy(): void;
}
