import {
  Channel as NativeChannel,
  invoke as nativeInvoke,
  isTauri as nativeAvailable,
} from '@tauri-apps/api/core';
import { getCurrentWindow as nativeWindow } from '@tauri-apps/api/window';
import { listen as nativeListen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { Scenario } from './fixtures';

// Fixture code is loaded only by the development server and is excluded from releases.
const scenario = import.meta.env.DEV ? new URLSearchParams(location.search).get('scenario') : null;
const fixture = scenario
  ? import('./fixtures').then((module) => {
      if (!module.scenarios.includes(scenario as Scenario))
        throw new Error(`Unknown development scenario: ${scenario}`);
      return module.createFixture(scenario as Scenario);
    })
  : null;
export const isTauri = () => !!fixture || nativeAvailable();
export const isFixture = () => !!fixture;

export type DesktopCommand =
  | 'configuration'
  | 'apply_settings'
  | 'workspace_action'
  | 'start_build'
  | 'job_status'
  | 'cancel_build'
  | 'start_server'
  | 'server_status'
  | 'stop_server'
  | 'generate'
  | 'cancel_generation'
  | 'history_list'
  | 'history_save'
  | 'history_delete';

export async function invoke<T = void>(
  command: DesktopCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  if (fixture) return (await fixture).invoke(command, args) as Promise<T>;
  if (!nativeAvailable())
    throw new Error('Native desktop services are unavailable in this preview.');
  return nativeInvoke<T>(command, args);
}

export class Channel<T> {
  private native = fixture ? null : new NativeChannel<T>();
  private receive: (value: T) => void = () => {};
  set onmessage(callback: (value: T) => void) {
    this.receive = callback;
    if (this.native) this.native.onmessage = callback;
  }
  get onmessage() {
    return this.receive;
  }
  toJSON() {
    return this.native?.toJSON();
  }
}

export function getCurrentWindow() {
  if (!fixture) return nativeWindow();
  return {
    onCloseRequested:
      async (_callback: (event: { preventDefault: () => void }) => void) => () => {},
    destroy: async () => {},
  };
}

export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return fixture ? Promise.resolve(() => {}) : nativeListen<T>(event, handler);
}
