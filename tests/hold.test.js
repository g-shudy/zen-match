import test from 'node:test';
import assert from 'node:assert/strict';
import { createHold } from '../dist/hold.js';

// Deterministic timers: advance() fires everything due at or before the new time.
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size
  };
}

function harness() {
  const timers = fakeTimers();
  const calls = { start: 0, cancel: 0, complete: 0 };
  const hold = createHold({
    durationMs: 1000,
    onStart: () => calls.start++,
    onCancel: () => calls.cancel++,
    onComplete: () => calls.complete++,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  return { timers, calls, hold };
}

test('a hold completes exactly at its duration', () => {
  const { timers, calls, hold } = harness();
  hold.press();
  assert.equal(calls.start, 1);
  assert.equal(hold.active, true);
  timers.advance(999);
  assert.equal(calls.complete, 0, 'not yet');
  timers.advance(1);
  assert.equal(calls.complete, 1);
  assert.equal(hold.active, false);
  assert.equal(calls.cancel, 0);
});

test('releasing before the duration cancels and nothing fires later', () => {
  const { timers, calls, hold } = harness();
  hold.press();
  timers.advance(900);
  hold.release();
  assert.equal(calls.cancel, 1);
  assert.equal(hold.active, false);
  timers.advance(500);
  assert.equal(calls.complete, 0);
  assert.equal(timers.pending(), 0, 'the timer was cleared, not left to fire');
});

test('pressing again while holding is ignored', () => {
  const { timers, calls, hold } = harness();
  hold.press();
  timers.advance(500);
  hold.press();
  assert.equal(calls.start, 1, 'one start');
  timers.advance(500);
  assert.equal(calls.complete, 1, 'the original timer completes on schedule');
  assert.equal(timers.pending(), 0);
});

test('releasing when idle does nothing', () => {
  const { calls, hold } = harness();
  hold.release();
  assert.equal(calls.cancel, 0);
  assert.equal(hold.active, false);
});

test('a new hold can start after one completed', () => {
  const { timers, calls, hold } = harness();
  hold.press();
  timers.advance(1000);
  hold.press();
  timers.advance(1000);
  assert.equal(calls.complete, 2);
});

test('releasing after completion is a no-op', () => {
  const { timers, calls, hold } = harness();
  hold.press();
  timers.advance(1000);
  hold.release();
  assert.equal(calls.complete, 1);
  assert.equal(calls.cancel, 0, 'the trailing pointerup after a completed hold must not cancel anything');
});
