import type { PresenceState } from '../../domain/presence';

export interface OrbPalette {
  primary: string;
  secondary: string;
}

export interface PresenceRenderer {
  setPalette(palette: OrbPalette | null): void;
  mount(container: HTMLElement): void;
  setState(state: PresenceState): void;
  setPaused(paused: boolean): void;
  resize(size: number): void;
  destroy(): void;
}
