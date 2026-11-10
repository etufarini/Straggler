import { OrbRenderer } from './renderers/OrbRenderer';
import type { PresenceRenderer } from './renderer';

// Renderer selection belongs here. The rest of the application uses the contract.
export function createPresenceRenderer(): PresenceRenderer {
  return new OrbRenderer();
}
