import type { PresenceState } from '../../domain/presence';

export interface PresenceRenderer {
  mount(container: HTMLElement): void;
  setState(state: PresenceState): void;
  setPaused(paused: boolean): void;
  resize(size: number): void;
  destroy(): void;
}
