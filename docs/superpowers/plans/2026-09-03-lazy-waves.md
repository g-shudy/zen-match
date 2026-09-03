# Lazy Waves, Colour Presets and Hold-to-Start Implementation Plan (Part B, release 2.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cascade run for as long as the board keeps matching, produced one wave at a time so the page never holds more than one wave; expose two and three colours in the settings sheet; make New Game a one-second hold.

**Architecture:** The engine's `swap()` returns a `MoveResult` whose `frames` is a generator: the swap itself is applied eagerly (so validity is known up front), then each cascade wave is computed only when the page pulls its frames. `processMatches`, `shuffleBoard` and `rescueDeadBoard` become generator functions sharing one points tally. The page's `playFrames` already iterates with `for...of`, so it consumes the generator unchanged apart from its type. Hold-to-start is a small pure module (`src/hold.ts`) with injected timers, wired to pointer and keyboard events on the New Game button, drawn as a conic ring on the button's `::after`.

**Tech Stack:** TypeScript (strict) bundled by esbuild, no framework; `node:test` against the node bundle in `dist/`; Playwright MCP (WebKit) for the browser walk.

**Spec:** `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md` (Part B, Cross-cutting, Releases)

## Global Constraints

- Move result shape: `interface MoveResult { frames: IterableIterator<Frame>; readonly pointsEarned: number; readonly moveValid: boolean }`. `pointsEarned` accumulates as frames are pulled and is final when the iterator is exhausted; `moveValid` is known before the first frame is pulled.
- Each pull computes at most one cascade wave (match, remove, drop, fill). Memory held between pulls is one board. `MAX_CASCADE_DEPTH` is removed; a cascade ends only when the board settles with no matches.
- Interrupting a cascade works as today: New Game supersedes the in-flight move through the run token; the abandoned generator is closed. The game is saved only when a board settles.
- The settings sheet offers colours 2, 3, 4, 5, 6, 7. The URL range (2 to 10) is unchanged.
- Hold-to-start: the toolbar New Game requires a `timing.holdToStart = 1000` ms press. Pointer: `pointerdown` starts; `pointerup`, `pointercancel`, `pointerleave`, window `blur` or `contextmenu` before completion cancels. Keyboard: holding Space or Enter while the button is focused; `keydown` with `repeat` is ignored; `keyup` cancels. A plain tap or click does nothing. The button's `aria-description` is "Press and hold for one second". The settings sheet gains a plain-tap "Start new game" button under *This game*.
- Reduced motion keeps the hold ring (it is the progress indicator) and drops the completion pulse.
- `npm test` builds `dist/` then runs every test file; a single file is `node build.mjs --test && node --test tests/<file>`; `npm run typecheck` must be clean at the end of the plan (Task 1 leaves one expected error in `src/main.ts`, cleared by Task 2).
- Commits: sentence-case imperative subject with no type prefix, body explains why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `claude/lazy-waves` in its own worktree; never commit on `main`. `package.json` becomes `2.2.0` in the last task.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `src/engine/index.ts` | `MoveResult`; `swap()` applies the swap eagerly and returns a generator; `cascadeWaves`, `shuffleWaves`, `rescueDeadBoard` as generators sharing a tally; cap removed |
| `src/main.ts` | `playFrames` typed for an iterable; colour presets; hold wiring; sheet Start-new-game handler; `timing.holdToStart` |
| `src/hold.ts` | Pure press-and-hold gate with injected timers |
| `src/styles.css` | Hold ring, completion pulse, reduced-motion override, sheet action row |
| `index.html` | `aria-description` on New Game; sheet button and hint; help copy |
| `build.mjs` | `hold` entry in the node bundle |
| `tests/engine.test.js` | `play()` helper materialises frames; uncapped-lazy and points-accumulation tests |
| `tests/hold.test.js` | Fake-timer tests for the hold gate |
| `README.md`, `docs/project-log.md`, `package.json` | Docs, decisions D19 to D21, version 2.2.0 |

---

### Task 1: Waves as a generator, no cap

**Files:**
- Modify: `src/engine/index.ts` (`ResolveResult` at ~116-120, `MAX_CASCADE_DEPTH` at ~122-130, `Engine.swap` at ~302-628, `rescueDeadBoard` at ~909-914, `processMatches` at ~954-1079, `shuffleBoard` at ~1268-1326)
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: existing `Frame`, `findMatches`, `hasValidMoves`, `dropGems`, `fillGems`, `activateSpecialsInRemovalSet`, `regenerateBoard`, `beamCells`, `claimCells`, `armsOf`.
- Produces: `export interface MoveResult { frames: IterableIterator<Frame>; readonly pointsEarned: number; readonly moveValid: boolean }`; `Engine.swap(pos1, pos2): MoveResult`. Task 2 types `playFrames` against `Iterable<Frame>`.

- [ ] **Step 1: Add the `play()` helper and switch every test to it**

Tests consumed `result.frames` as an array. First rewrite every `<name>.swap(` call in the file as `play(<name>, ` (do this before adding the helper, whose own body contains the one `engine.swap(` call that must survive):

```bash
sed -i '' -E 's/([A-Za-z0-9_]+)\.swap\(/play(\1, /g' tests/engine.test.js
```

Then add this helper directly after `makeCell`:

```js
// The engine hands frames out lazily, one cascade wave at a time. Tests want the
// whole move, so materialise it here; draining also settles the engine's board.
function play(engine, pos1, pos2) {
  const result = engine.swap(pos1, pos2);
  const frames = Array.from(result.frames);
  return { frames, pointsEarned: result.pointsEarned, moveValid: result.moveValid };
}
```

Check the rewrite:

```bash
grep -c "play(" tests/engine.test.js
grep -n "\.swap(" tests/engine.test.js
```

Expected: the first grep counts the helper definition plus every former call (26); the second prints exactly one line, the helper's own `engine.swap(pos1, pos2)`. Calls such as `removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }))` and `const result = play(engine, ...)` now hand the helpers an object whose `frames` is an array, so `placedSpecial`, `removeFrame` and the `JSON.stringify(make().frames)` determinism test keep working unchanged.

- [ ] **Step 2: Replace the cap test and add the two lazy tests**

Delete the test `'Cascades stay bounded at the lowest gem count'` (and its comment block above it). In its place add:

```js
// The cap is gone: waves are produced one at a time as they are pulled, so a
// two-colour board may cascade for as long as it likes without the engine ever
// holding more than one wave. Two halves: more than 60 waves arrive, and the
// caller can stop pulling whenever it wants.
test('Cascades are uncapped and produced lazily', () => {
  let longest = 0;
  for (let seed = 0; seed < 10 && longest <= 50; seed++) {
    const engine = new Engine({ rows: 16, cols: 16, gemTypes: 2, seed });
    engine.init();
    for (let move = 0; move < 5 && longest <= 50; move++) {
      const m = engine.findValidMove();
      if (!m) break;
      const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
      assert.equal(typeof result.frames.next, 'function', 'frames must be an iterator, not an array');
      assert.equal(result.pointsEarned, 0, 'nothing is earned before a frame is pulled');
      let waves = 0;
      for (const frame of result.frames) {
        if (frame.kind === 'remove') waves++;
        if (waves > 50) break; // leaving the loop closes the generator
      }
      longest = Math.max(longest, waves);
    }
  }
  assert.ok(longest > 50, `expected a 16x16 two-colour move to run past the old cap of 50 waves; longest seen ${longest}`);
});

test('pointsEarned accumulates exactly as frames are pulled', () => {
  const engine = new Engine({ rows: 8, cols: 8, gemTypes: 3, seed: 11 });
  engine.init();
  const m = engine.findValidMove();
  assert.ok(m, 'fixture must have a legal move');
  const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
  assert.equal(result.moveValid, true, 'validity is known before any frame is pulled');
  assert.equal(result.pointsEarned, 0);
  let sum = 0;
  for (const frame of result.frames) {
    if (frame.kind === 'remove') sum += frame.score.points;
    assert.equal(result.pointsEarned, sum, `after a ${frame.kind} frame the tally must equal the wave scores pulled so far`);
  }
  assert.ok(sum > 0);
  assert.equal(result.pointsEarned, sum);
});

test('An abandoned move leaves the board hole-free where the last pulled wave left it, and the engine accepts the next move', () => {
  const engine = new Engine({ rows: 8, cols: 8, gemTypes: 2, seed: 5 });
  engine.init();
  const m = engine.findValidMove();
  assert.ok(m, 'fixture must have a legal move');
  const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
  let pulled = 0;
  for (const frame of result.frames) {
    pulled++;
    if (frame.kind === 'fill') break;
  }
  assert.ok(pulled > 0);
  const board = engine.state.board;
  assert.ok(board.every(row => row.every(cell => cell !== null)), 'no holes after a fill frame');
  const again = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });
  assert.equal(typeof again.frames.next, 'function', 'the engine accepts a new move after an abandoned one');
});
```

- [ ] **Step 3: Run the engine tests to verify the new ones fail**

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: the three new tests fail (`result.frames.next` is not a function, `pointsEarned` already positive); the converted tests still pass because `Array.from` accepts an array.

- [ ] **Step 4: Replace the result type and remove the cap**

In `src/engine/index.ts` replace `export interface ResolveResult { ... }` with:

```ts
export interface MoveResult {
  // The swap itself is applied when swap() returns, so validity is known at once.
  // Frames are then produced one cascade wave at a time as the caller pulls them;
  // the engine holds at most one wave. Leaving a for...of early closes the
  // generator and the board stays exactly as the last pulled wave left it, which
  // may include live matches (or, before the first frame, an un-reverted invalid
  // swap). A caller that stops early must reset the engine or drain the move
  // before calling swap() again; the page does the former on New Game.
  frames: IterableIterator<Frame>;
  // Accumulates as frames are pulled; final once the iterator is exhausted.
  readonly pointsEarned: number;
  // Known before the first frame: the swap made a match or fired a combo.
  readonly moveValid: boolean;
}

// Shared by every generator that clears gems during one move.
interface Tally {
  points: number;
}
```

Delete `MAX_CASCADE_DEPTH` and the whole comment block above it (the paragraph beginning "Cascade waves allowed per move"). Replace it with:

```ts
// There is no cap on cascade waves. A move's frames are a generator, so a
// two-colour board that cascades for minutes costs one wave of work per pull and
// one board of memory; the old 50-wave cap existed only because every wave was
// computed and stored up front.
```

- [ ] **Step 5: Turn `processMatches` into `cascadeWaves`**

Change the signature and the loop head of `processMatches`:

```ts
function* cascadeWaves(state: EngineState, tally: Tally): Generator<Frame, void, undefined> {
  const { rows, cols, board } = state;
  let matches = findMatches(board, rows, cols);
  let comboCount = 0;

  while (matches.length > 0) {
    comboCount++;
```

Inside the loop: replace `totalPoints += points;` with `tally.points += points;`, and every `frames.push(<frame>)` with `yield <frame>` (the `remove`, `board`, `drop`, `fill` and `preview` frames; five sites). Delete `let totalPoints = 0;` and the trailing `return { points: totalPoints };`. Delete the comment "Bounding the `while` rather than breaking mid-body ..." (three lines) above the loop.

- [ ] **Step 6: Turn `shuffleBoard` and `rescueDeadBoard` into generators**

Replace the signature and body of `shuffleBoard` so it reads (the Fisher-Yates block in the middle is unchanged and elided here as `...`):

```ts
function* shuffleWaves(state: EngineState, attempts: number, tally: Tally): Generator<Frame, void, undefined> {
  const MAX_SHUFFLE_ATTEMPTS = 10;
  const MAX_VISUAL_ATTEMPTS = 3;
  const { rows, cols, board } = state;

  ... (gems / Fisher-Yates / moves exactly as before) ...

  // Phase 4C: Only emit shuffle frames for first 3 attempts
  if (attempts < MAX_VISUAL_ATTEMPTS) {
    yield { kind: 'shuffle', board: cloneBoard(board), attempt: attempts, moves };
  }

  // Phase 4A: Award points for shuffle cascades (don't discard)
  if (findMatches(board, rows, cols).length > 0) {
    yield* cascadeWaves(state, tally);
  }

  if (!hasValidMoves(board, rows, cols) && attempts < MAX_SHUFFLE_ATTEMPTS) {
    yield* shuffleWaves(state, attempts + 1, tally);
  } else if (!hasValidMoves(board, rows, cols)) {
    regenerateBoard(state);
    yield { kind: 'shuffle', board: cloneBoard(state.board), attempt: attempts + 1 };
  }
}
```

(`const frames: Frame[] = []`, `let shufflePoints = 0` and the `return { frames, points }` go away.)

Replace `rescueDeadBoard`:

```ts
// Shuffle if the board has no legal move left. The valid-move paths already do this
// after their cascade; the invalid-swap paths did not, so a board that went dead
// stayed dead — every subsequent swap snapping back with no explanation.
function* rescueDeadBoard(state: EngineState, tally: Tally): Generator<Frame, void, undefined> {
  if (hasValidMoves(state.board, state.rows, state.cols)) return;
  yield* shuffleWaves(state, 0, tally);
}
```

- [ ] **Step 7: Rewrite `Engine.swap` around the generator**

Replace the whole `swap` method with the version below. The two combo blocks (`bothAreSpecial` and the rainbow-with-normal path) keep their existing bodies for building `toRemove`, `animationClasses`, `effects` and `points`; only their surroundings change (the `frames.push` calls become `yield`, the trailing cascade/shuffle code moves to the shared tail, and the early-exit paths are gone).

```ts
  swap(pos1: Pos, pos2: Pos): MoveResult {
    const { rows, cols, board } = this.state;
    const tally: Tally = { points: 0 };

    if (!board[pos1.r]?.[pos1.c] || !board[pos2.r]?.[pos2.c]) {
      return { frames: (function* (): Generator<Frame, void, undefined> {})(), pointsEarned: 0, moveValid: false };
    }

    this.state.lastSwapPos = { r1: pos1.r, c1: pos1.c, r2: pos2.r, c2: pos2.c };

    const gem1 = board[pos1.r][pos1.c];
    const gem2 = board[pos2.r][pos2.c];

    // Apply the swap now, so validity is known before any frame is pulled.
    [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];

    const bothAreSpecial = isSpecial(gem1) && isSpecial(gem2);
    const rainbowSwap = isRainbow(gem1) || isRainbow(gem2);
    const moveValid = bothAreSpecial || rainbowSwap || findMatches(board, rows, cols).length > 0;

    const frames = this.resolveMove(pos1, pos2, gem1, gem2, moveValid, tally);
    return {
      frames,
      get pointsEarned() {
        return tally.points;
      },
      moveValid
    };
  }

  private *resolveMove(
    pos1: Pos,
    pos2: Pos,
    gem1: Cell | null,
    gem2: Cell | null,
    moveValid: boolean,
    tally: Tally
  ): Generator<Frame, void, undefined> {
    const { rows, cols, board } = this.state;

    yield { kind: 'swap', board: cloneBoard(board) };

    if (!moveValid) {
      yield { kind: 'invalid', positions: [pos1, pos2] };
      [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];
      yield { kind: 'board', board: cloneBoard(board) };
      yield* rescueDeadBoard(this.state, tally);
      this.state.lastSwapPos = null;
      return;
    }

    const gem1Special = gem1?.special;
    const gem2Special = gem2?.special;
    const bothAreSpecial = isSpecial(gem1) && isSpecial(gem2);

    // Design decision: ... (keep the existing comment block) ...
    if (bothAreSpecial) {
      // (existing body: specials/isRainbowCombo/... through activateSpecialsInRemovalSet,
      //  chainReactionCount and `points += bonusPoints`, unchanged)

      tally.points += points;

      yield {
        kind: 'remove',
        positions: positionsFromSet(toRemove),
        animations: mapToRecord(animationClasses),
        effects,
        score: {
          points,
          combo: 1,
          breakdown: { base: points, matchBonus: 0, comboMultiplier: 1 },
          isBonus: true
        }
      };

      removePositions(board, toRemove);
      yield { kind: 'board', board: cloneBoard(board) };

      const dropMoves = dropGems(board, rows, cols);
      if (dropMoves.length > 0) yield { kind: 'drop', board: cloneBoard(board), moves: dropMoves };

      const fillMoves = fillGems(board, rows, cols, this.state.gemTypes, this.state.rng);
      if (fillMoves.length > 0) yield { kind: 'fill', board: cloneBoard(board), moves: fillMoves };
    } else if (gem1Special === SPECIAL.RAINBOW || gem2Special === SPECIAL.RAINBOW) {
      // (existing body: targetType/rainbowPos/toRemove/.../activateSpecialsInRemovalSet, unchanged)

      const points = 500 + toRemove.size * 10 + bonusPoints;
      tally.points += points;

      yield {
        kind: 'remove',
        positions: positionsFromSet(toRemove),
        animations: mapToRecord(animationClasses),
        effects,
        score: {
          points,
          combo: 1,
          breakdown: { base: points, matchBonus: 0, comboMultiplier: 1 },
          isBonus: true
        }
      };

      removePositions(board, toRemove);
      yield { kind: 'board', board: cloneBoard(board) };

      const dropMoves = dropGems(board, rows, cols);
      if (dropMoves.length > 0) yield { kind: 'drop', board: cloneBoard(board), moves: dropMoves };

      const fillMoves = fillGems(board, rows, cols, this.state.gemTypes, this.state.rng);
      if (fillMoves.length > 0) yield { kind: 'fill', board: cloneBoard(board), moves: fillMoves };
    }

    // Every valid move ends the same way: cascade until the board settles, then
    // reshuffle if it settled with no legal move left.
    yield* cascadeWaves(this.state, tally);
    if (!hasValidMoves(board, rows, cols)) yield* shuffleWaves(this.state, 0, tally);

    this.state.lastSwapPos = null;
  }
```

Remove from the old method: `const frames: Frame[] = []`, `let pointsEarned = 0`, `let moveValid = false`, every `pointsEarned += ...`, `moveValid = true` / `moveValid = cascadeResult.points > 0`, the `gem1IsSpecial || gem2IsSpecial` and plain-match branches (their work is now the shared tail), the three `if (!hasValidMoves(...)) { const sr = shuffleBoard(...) ... }` blocks, and the final `return { frames, pointsEarned, moveValid }`. Inside the `bothAreSpecial` block, `pointsEarned += points; moveValid = true;` becomes `tally.points += points;` as shown.

Run: `grep -n "processMatches\|shuffleBoard(\|ResolveResult\|frames\.push\|MAX_CASCADE_DEPTH" src/engine/index.ts`
Expected: no output.

- [ ] **Step 8: Run the engine tests and the typecheck**

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: 40 tests pass (38, minus the deleted cap test, plus 3).

Run: `npm run typecheck`
Expected: exactly one error, in `src/main.ts`, where `playFrames(result.frames, ...)` is declared to take `Frame[]`; Task 2 clears it. No errors in `src/engine/index.ts`.

Run: `npm test`
Expected: 55 tests pass (esbuild does not typecheck; the page's `for...of` already consumes an iterator).

- [ ] **Step 9: Commit**

```bash
git add src/engine/index.ts tests/engine.test.js
git commit -m "Produce cascade waves lazily and drop the wave cap

A move's frames are now a generator: the swap is applied up front so
validity is known immediately, and each cascade wave is computed only when
the page pulls it. The engine never holds more than one wave, which is what
the 50-wave cap was protecting against, so the cap goes and a two-colour
board can cascade for as long as it keeps matching.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The page plays lazy waves; colours 2 and 3

**Files:**
- Modify: `src/main.ts` (`playFrames` signature at ~692, `COLOR_PRESETS` at ~1141)

**Interfaces:**
- Consumes: `MoveResult` from Task 1 (`result.frames` iterable, `result.pointsEarned` getter).
- Produces: nothing downstream.

- [ ] **Step 1: Type `playFrames` for an iterable and close it on early exit**

Change the signature to `async function playFrames(frames: Iterable<Frame>, token: number): Promise<void>` and add, directly above the function, this comment:

```ts
// `frames` is a generator: each cascade wave is computed when the loop pulls it.
// Leaving the loop early (a superseded move) closes the generator through the
// for...of protocol, so the engine drops the wave it was holding.
```

No other change: `for (const frame of frames)` and the token check already do the right thing.

- [ ] **Step 2: Expose colours 2 and 3**

Change `const COLOR_PRESETS = [4, 5, 6, 7];` to `const COLOR_PRESETS = [2, 3, 4, 5, 6, 7];`.

- [ ] **Step 3: Typecheck, test, and check the segment fits**

Run: `npm run typecheck && npm test`
Expected: clean; 55 tests pass.

Build and serve (`npm run build`, then `uv run python -m http.server 8080` in the background) and with the Playwright MCP at 390x844 open `http://localhost:8080/`, open Settings, and screenshot the Colors segment: six segments on one row, none clipped. Close the browser and stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "Play lazily produced waves and offer two and three colours

The page already pulled frames with for...of, so consuming the engine's
generator only changes the declared type and documents that leaving early
closes it. The sheet now offers 2 and 3 colours, the settings where long
cascades live.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Hold to start a new game

**Files:**
- Create: `src/hold.ts`
- Create: `tests/hold.test.js`
- Modify: `build.mjs` (node entries), `src/main.ts` (timing, New Game wiring at ~1218, settings handlers), `src/styles.css` (buttons section ~352-362, reduced-motion block ~1283, sheet styles near `.hint` ~975), `index.html` (New Game button ~70-73, *This game* section ~110-118)

**Interfaces:**
- Consumes: `startNewGame()`, `closeSheet`, `revertPending`, `syncSettingsUI`, `reducedMotion()` in `src/main.ts`.
- Produces: `export function createHold(options: HoldOptions): Hold` where `Hold = { press(): void; release(): void; readonly active: boolean }`.

- [ ] **Step 1: Write the failing hold tests**

Create `tests/hold.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node build.mjs --test && node --test tests/hold.test.js`
Expected: fails to import `../dist/hold.js` (no such bundle).

- [ ] **Step 3: Write the hold module and bundle it**

Create `src/hold.ts`:

```ts
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
```

In `build.mjs` change the node entry points to:

```js
  entryPoints: { engine: 'src/engine/index.ts', storage: 'src/storage.ts', hold: 'src/hold.ts' },
```

- [ ] **Step 4: Run the hold tests to verify they pass**

Run: `node build.mjs --test && node --test tests/hold.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Wire the button, the ring and the sheet**

In `index.html` change the New Game button to:

```html
      <button class="btn btn-primary" id="newGame" type="button" aria-description="Press and hold for one second" title="Press and hold for one second">
        <svg class="icon" aria-hidden="true"><use href="#i-new"/></svg>
        <span>New Game</span>
      </button>
```

Under the *This game* section, directly after the closing `</dl>` of the stats, add:

```html
          <div class="row-action">
            <button class="btn" id="settingsNewGame" type="button">Start new game</button>
          </div>
          <p class="hint">Starts over with the current size and colors. The New Game button under the board needs a one-second hold, so a stray tap never ends a game.</p>
```

In `src/main.ts`:

1. Add `import { createHold } from './hold';` next to the other imports.
2. Add `holdToStart: 1000,` to `config.timing` (after `ambient: 1200`).
3. Add `const settingsNewGame = getEl<HTMLButtonElement>('settingsNewGame');` next to `settingsDone`'s declaration.
4. Replace the block

```ts
newGameBtn.addEventListener('click', () => {
  void startNewGame();
});
```

with:

```ts
// New Game is a hold, not a tap: a stray touch during a long cascade must not
// throw the game away. The ring on the button fills over the hold.
const hold = createHold({
  durationMs: config.timing.holdToStart,
  onStart: () => newGameBtn.classList.add('holding'),
  onCancel: () => newGameBtn.classList.remove('holding'),
  onComplete: () => {
    newGameBtn.classList.remove('holding');
    if (!reducedMotion()) {
      newGameBtn.classList.add('held');
      window.setTimeout(() => newGameBtn.classList.remove('held'), 320);
    }
    void startNewGame();
  }
});
newGameBtn.style.setProperty('--hold-ms', `${config.timing.holdToStart}ms`);

newGameBtn.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  hold.press();
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  newGameBtn.addEventListener(type, () => hold.release());
}
window.addEventListener('blur', () => hold.release());
newGameBtn.addEventListener('contextmenu', event => {
  event.preventDefault();
  hold.release();
});
// A tap or click on its own does nothing; only a completed hold starts a game.
newGameBtn.addEventListener('click', event => event.preventDefault());
newGameBtn.addEventListener('keydown', event => {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  if (!event.repeat) hold.press();
});
newGameBtn.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') hold.release();
});

// The sheet's plain button is the path for anyone who cannot hold; it already
// sits behind a deliberate step, so a tap is safe here.
settingsNewGame.addEventListener('click', () => {
  revertPending();
  syncSettingsUI();
  closeSheet(settingsSheet);
  void startNewGame();
});
```

In `src/styles.css`, after the `.btn-primary:hover` rule add:

```css
/* Hold-to-start ring. A conic fill sweeps around New Game over --hold-ms while
   the pointer or key is down, masked to a 3px band that follows the pill. */
@property --hold-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

#newGame {
  position: relative;
  touch-action: none;
}

#newGame::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 999px;
  padding: 3px;
  background: conic-gradient(var(--accent) var(--hold-angle), transparent 0);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

#newGame.holding::after {
  opacity: 1;
  animation: holdFill var(--hold-ms, 1000ms) linear forwards;
}

@keyframes holdFill {
  from { --hold-angle: 0deg; }
  to { --hold-angle: 360deg; }
}

#newGame.held {
  animation: heldPulse 0.32s var(--ease);
}

@keyframes heldPulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
```

After the `.hint` rule add:

```css
.row-action {
  display: flex;
  margin-top: 12px;
}
```

Inside the `@media (prefers-reduced-motion: reduce)` block add:

```css
  /* The hold ring stays: it is the progress indicator. Only the completion pulse goes. */
  #newGame.held {
    animation: none;
  }
```

- [ ] **Step 6: Typecheck, test, and walk it in the browser**

Run: `npm run typecheck && npm test`
Expected: clean; 60 tests pass (55 plus the 5 hold tests).

Build, serve the repo root (`npm run build`, `uv run python -m http.server 8080` in the background), and with the Playwright MCP at 1280x800 on `http://localhost:8080/`:

1. Read the score and moves from Settings, then a plain click on New Game (`browser_click` on `#newGame`): the board must not dissolve and the score must not change.
2. A hold, via `browser_evaluate`:

```js
async () => {
  const btn = document.getElementById('newGame');
  const before = document.getElementById('score').textContent;
  btn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 300));
  const ringShown = btn.classList.contains('holding');
  await new Promise(r => setTimeout(r, 900));
  btn.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 1200));
  return { before, after: document.getElementById('score').textContent, ringShown, holdingNow: btn.classList.contains('holding') };
}
```

   Expected: `ringShown` true, `holdingNow` false, `after` is `0` (a new game) when `before` was non-zero. If the board was already at zero, make one move first.
3. A short press (pointerdown, 400 ms, pointerup): the ring shows then hides, the score does not change.
4. Keyboard: focus `#newGame`, dispatch `keydown` Enter, wait 1100 ms, dispatch `keyup` Enter: new game. Then `keydown` + immediate `keyup`: nothing.
5. Open Settings and click "Start new game": the sheet closes and a new game starts.
6. Screenshot the button mid-hold (dispatch pointerdown, wait 500 ms, screenshot, pointerup) at 1280x800 and at 390x844: the ring is visible around the pill.
7. Console: no errors.

Close the browser and stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/hold.ts tests/hold.test.js build.mjs src/main.ts src/styles.css index.html
git commit -m "Make New Game a one-second hold

With cascades no longer capped, a stray tap on New Game could throw away
minutes of play. The button now needs a held press or a held key, shown by
a ring that fills over the second; the settings sheet keeps a plain
Start new game for anyone who cannot hold.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Docs, long-cascade walk and release 2.2.0

**Files:**
- Modify: `README.md` (Playing bullets ~15-40, Settings ~46, the "Cascades are bounded" paragraph ~62-64), `index.html` (help Scoring paragraph ~213), `docs/project-log.md` (append), `package.json` + `package-lock.json` (version)

**Interfaces:**
- Consumes: everything above.
- Produces: release 2.2.0.

- [ ] **Step 1: README**

In the Playing section, after the "**No way to lose**" bullet, add:

```markdown
- **New Game is a hold**: press and keep pressing for a second, and a ring fills around the button. A stray tap never ends a game. Settings has a plain *Start new game* as well.
```

Change the Settings bullet to:

```markdown
- **Board size** (6x6, 8x8, 10x10, 12x12) and **colors** (2 to 7). Changing either starts a new game; the button says so before it does.
```

Replace the paragraph beginning "Cascades are bounded:" with:

```markdown
Cascades are not capped. Refills avoid creating immediate matches, but at two or three
colors a single move can cascade for minutes, and it is allowed to. Waves are produced
one at a time as they play, so the page stays responsive however long a chain runs; a
held New Game ends it whenever you like.
```

- [ ] **Step 2: Help sheet**

Replace the Scoring paragraph in `index.html` with:

```html
          <p>Every gem is worth ten points. Longer matches, special gems, and each step of a cascade add more. There is no timer and no way to lose: if the board runs out of moves, it quietly reshuffles itself. A cascade runs for as long as the board keeps matching. To start over, hold New Game for a second.</p>
```

- [ ] **Step 3: Project log and version**

Append to `docs/project-log.md`:

```markdown
## 2.2 Lazy waves and hold-to-start (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part B.

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | A move's frames are a generator; each cascade wave is computed when the page pulls it, and the 50-wave cap is gone. The swap itself is applied eagerly so `moveValid` is known before the first frame. | The cap only existed because every wave was computed and stored up front (one 2-colour move once blocked the page for seven seconds and 2.4 GB). One wave of work per pull and one board of memory make an endless cascade cheap, and the design doc calls cascades the gift. |
| D20 | New Game is a one-second hold with a ring that fills over the second; a plain-tap Start new game lives in the settings sheet. | With no cap, a stray tap could throw away minutes of watching. The hold is the guard; the sheet button keeps a no-hold path behind a deliberate step. |
| D21 | Colours 2 and 3 join the sheet. | They were always reachable by URL; they are where the long cascades live, and the sheet should offer them. |
```

Bump the version:

```bash
npm version 2.2.0 --no-git-tag-version
```

- [ ] **Step 4: Long-cascade walk**

Run: `npm run typecheck && npm test && grep -n '"version"' package.json`
Expected: clean; 60 tests; `2.2.0`.

Build and serve, then with the Playwright MCP at 1280x800 open `http://localhost:8080/?gems=2&grid=12`:

1. Make the first legal move (find it with `browser_evaluate` by trying adjacent pairs is not possible from the page; instead click two adjacent cells in the middle row and, if the swap snaps back, try the next pair) until a cascade starts.
2. While the board carries the `processing` class, click the help button: the sheet must open (the page is responsive mid-cascade). Close it.
3. Wait 20 s; evaluate `document.getElementById('board').classList.contains('processing')` — on most 2-colour boards it is still true (the chain is still running). Read the score: it should have increased since step 1.
4. Hold New Game (the pointerdown / 1200 ms / pointerup script from Task 3): the cascade stops, the board dissolves and a fresh game starts with score 0.
5. Console: no errors. Note the longest wave count observed if visible in Settings (*Longest cascade*).

Close the browser and stop the server.

- [ ] **Step 5: Commit**

```bash
git add README.md index.html docs/project-log.md package.json package-lock.json
git commit -m "Document uncapped cascades and the hold, release 2.2.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Release

After the final review: merge `claude/lazy-waves` into `main`, push (Vercel deploys `zen.ghsj.me`), then on the live site confirm the Colors segment offers 2 to 7, a plain tap on New Game does nothing while a held press starts a game, and a `?gems=2` move keeps cascading past a minute with the page responsive. Remove the worktree.
