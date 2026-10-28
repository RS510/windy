import { showBanner } from './ui/feedback';
import { load } from './util/storage';

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Shows unexpected errors on screen, so a screenshot tells what went wrong on a device. */
export function reportError(where: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(where, e);
  try {
    showBanner(`Interner Fehler (${where}): ${msg} · Version ${APP_VERSION}`, { id: 'internal' });
  } catch {
    /* banner element missing: nothing more we can do */
  }
}

window.addEventListener('error', (e) => reportError('Skript', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError('Ablauf', e.reason));

/**
 * Runs one start step; a failure is reported and the remaining steps still run, so for
 * example a map problem can't disable the search or the layer menu.
 */
export function safe<T>(name: string, fn: () => T, fallback?: T): T {
  try {
    // Test switch to simulate a failing step (used by the browser tests).
    if (load<string | null>('test-fail', null) === name) throw new Error('Testfehler');
    return fn();
  } catch (e) {
    reportError(name, e);
    return fallback as T;
  }
}
