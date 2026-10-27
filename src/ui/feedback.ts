import { $, clear, h } from './dom';

let pending = 0;

/** Wraps a promise with the loading indicator. */
export async function withLoading<T>(p: Promise<T>): Promise<T> {
  const el = $('#loading');
  pending++;
  el.hidden = false;
  try {
    return await p;
  } finally {
    pending--;
    if (pending <= 0) {
      pending = 0;
      el.hidden = true;
    }
  }
}

let current: string | null = null;

export function showBanner(message: string, opts: { retry?: () => void; info?: boolean; id?: string } = {}): void {
  const el = $('#banner');
  clear(el);
  current = opts.id ?? message;
  el.classList.toggle('info', !!opts.info);
  el.append(h('span', { 'data-testid': 'banner-text' }, message));
  if (opts.retry) {
    const retry = opts.retry;
    el.append(
      h('button', {
        onclick: () => {
          hideBanner();
          retry();
        },
      }, 'Erneut versuchen'),
    );
  }
  el.append(h('button', { 'aria-label': 'Schließen', onclick: () => hideBanner() }, '✕'));
  el.hidden = false;
}

/** Hides the banner; with an id only if that banner is the one shown. */
export function hideBanner(id?: string): void {
  if (id && current !== id) return;
  $('#banner').hidden = true;
  current = null;
}
