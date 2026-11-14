import type { Page } from '@playwright/test';
import type { PresenceState } from '../../src/domain/presence';

declare global {
  interface Window {
    __stragglerOrbMeasurement: {
      frames: { time: number; state?: PresenceState; pixels: number }[];
      draws: { state: PresenceState; ms: number; quality: number }[];
      snapshot(): {
        phases: Record<string, { frames: number; drawMs: { p95: number | null } }>;
      };
      stop(): void;
    };
  }
}

export async function observeOrb(page: Page) {
  await page.evaluate(async () => {
    const enginePath = '/src/features/presence/renderers/orb-engine.js';
    const measurementPath = '/tests/orb-performance.mjs';
    // Vite can add a version query after an edit. Observe the module actually
    // used by the app instead of importing a second copy with a different URL.
    const engineUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === enginePath);
    if (!engineUrl) throw new Error('The application orb module was not loaded.');
    const [{ default: Engine }, { installOrbMeasurement }] = await Promise.all([
      import(engineUrl),
      import(measurementPath),
    ]);
    installOrbMeasurement(Engine);
  });
}
