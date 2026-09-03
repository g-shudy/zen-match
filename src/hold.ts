// Press-and-hold gate for the New Game button: a tap does nothing, a held press
// completes after `durationMs`. Timers are injected so the logic runs in tests
// without a DOM; the page passes window.setTimeout / window.clearTimeout.

export interface HoldOptions {
  durationMs: number;
  onStart: () => void;
  onCancel: () => void;
  onComplete: () => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface Hold {
  // Begin a hold; ignored while one is already running.
  press(): void;
  // End a hold before it completes; ignored when idle.
  release(): void;
  readonly active: boolean;
}

export function createHold(options: HoldOptions): Hold {
  const set = options.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clear = options.clearTimeout ?? (id => window.clearTimeout(id));
  let timer: number | null = null;

  return {
    get active() {
      return timer !== null;
    },
    press() {
      if (timer !== null) return;
      timer = set(() => {
        timer = null;
        options.onComplete();
      }, options.durationMs);
      options.onStart();
    },
    release() {
      if (timer === null) return;
      clear(timer);
      timer = null;
      options.onCancel();
    }
  };
}
