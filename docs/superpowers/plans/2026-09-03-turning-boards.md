# Turning Boards Implementation Plan (Part C, release 2.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the board be a rectangle that is glued to the phone: turn the phone and the board turns with it while gravity stays with the world; add a Turn control for desktops and for inverting; allow much bigger boards; render by diffing.

**Architecture:** The engine gains a four-way `gravity` read at the start of every wave; `dropGems`/`fillGems` run along "fall lines" so one implementation serves all four directions. Settings carry `cols`, `rows` and `turns` instead of `gridSize`; the URL takes `?grid=8x12`. A pure module `src/orientation.ts` maps `(deviceAngle, turns)` to the board's CSS rotation and gravity, and maps screen deltas into board space. The page wraps the board in a frame sized to its rotated footprint, rotates the board inside it, computes every effect and animation offset in board-local coordinates (cell index times step), and rotates drag and arrow deltas into board space. `renderBoard` diffs against the last rendered cell.

**Tech Stack:** TypeScript (strict) bundled by esbuild, no framework; `node:test` against the node bundle in `dist/`; Playwright MCP (WebKit) for the browser walk.

**Spec:** `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md` (Part C, Cross-cutting, Releases)

## Global Constraints

- Board coordinates are fixed to the device body: row 0 at the device's natural top, col 0 at its natural left. `cols` is the short side, `rows` the long side. Ruling (deviation from one spec sentence): on every device the board renders unrotated at `turns = 0`; a Tall board on a desktop is upright until the player turns it, and the turn count persists.
- Settings: `cols`, `rows`, `turns` replace `gridSize`; a stored `gridSize` migrates as `cols = rows = gridSize`; `turns` is `0..3`. URL `?grid=8x12` sets cols and rows, `?grid=8` is square; each side clamped `4..40`; written back the same way, omitted at 8x8. The palette and `turns` never come from the URL.
- `export type Gravity = 'down' | 'up' | 'left' | 'right'` is the direction gems fall in board coordinates; it is read from engine state at the start of each wave; fill moves originate off-board beyond the edge opposite gravity. Under `'down'` every frame sequence is identical to 2.2.
- Pose: rotation is CSS clockwise degrees `0 | 90 | 180 | 270`; `rotation = normalize(-deviceAngle + 90 * turns)` under the W3C convention that `screen.orientation.angle` is counter-clockwise from natural; gravity by rotation: `0 -> down`, `90 -> right`, `180 -> up`, `270 -> left`. Browsers without `screen.orientation` treat a landscape media query as angle 90. The truth table is pinned by a 16-case test and must be confirmed on Jerry's iPhone before release.
- Turn control: toolbar button `#turnBtn` and the `R` key add a quarter turn clockwise; available at all times including mid-cascade; the visual turn takes `timing.turn = 600` ms with `var(--ease)`, instant under reduced motion; gravity changes from the next wave.
- Sizing: no 560 px cap; measure the viewport, swap width and height when rotation is 90 or 270; cell size clamped `12..72` px; the landscape-phone rail is unchanged.
- Every effect and animation offset is computed in board-local coordinates from cell indices, never from `getBoundingClientRect` of rotated elements. Drag deltas and arrow keys are rotated into board space; taps rely on hit-testing.
- `renderBoard` touches only elements whose cell changed.
- First commit of this branch fixes the parked assertion: in `tests/engine.test.js`, the abandoned-move hole-free test asserts `assert.equal(again.moveValid, true, 'the engine judges the next move against the abandoned board')`.
- `npm test` builds `dist/` then runs every test file; `npm run typecheck` must be clean at the end of every task in this plan except where a task says otherwise.
- Commits: sentence-case imperative subject with no type prefix, body explains why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `claude/turning-boards` in its own worktree; never commit on `main`. `package.json` becomes `2.3.0` in the last task.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `src/engine/index.ts` | `Gravity`, `EngineState.gravity`, `setGravity`, fall-line `dropGems`/`fillGems`, gravity read per wave |
| `src/storage.ts` | `cols`/`rows`/`turns`, migration, `parseGrid`/`formatGrid`, URL resolution |
| `src/orientation.ts` | `boardPose`, `toBoardDelta`, `normalizeRotation` |
| `src/main.ts` | Pose state, Turn control, board frame and sizing, board-local geometry, input mapping, render diffing, sheet Shape control |
| `src/styles.css` | Board frame, rotation transition, Turn button, reduced motion |
| `index.html` | Board frame, Turn button and icon, Shape control, help copy |
| `build.mjs` | `orientation` entry in the node bundle |
| `tests/engine.test.js`, `tests/storage.test.js`, `tests/orientation.test.js` | Gravity, settings/URL, pose and delta tests |
| `README.md`, `docs/project-log.md`, `package.json` | Docs, decisions D22 to D26, version 2.3.0 |

---

### Task 1: Engine gravity

**Files:**
- Modify: `src/engine/index.ts` (`EngineConfig`/`EngineState` ~40-56, constructor/`reset` ~250-262, `dropGems` ~1069-1088, `fillGems` ~1090-1115, the two combo tails in `resolveMove` and the wave loop in `cascadeWaves`)
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: existing `Board`, `Pos`, `GemMove`, `pickNonMatchingType`, `RNG`.
- Produces: `export type Gravity`, `EngineConfig.gravity?`, `EngineState.gravity`, `Engine.setGravity(gravity: Gravity): void`, `export function dropGems(board, rows, cols, gravity): GemMove[]`, `export function fillGems(board, rows, cols, gemTypes, rng, gravity): GemMove[]`. Task 4 calls `engine.setGravity` whenever the pose changes.

- [ ] **Step 1: Fix the parked assertion**

In `tests/engine.test.js`, in the test named `'An abandoned move leaves the board hole-free where the last pulled wave left it, and the engine accepts the next move'`, replace the line `assert.equal(typeof again.moveValid, 'boolean', ...)` with:

```js
  assert.equal(again.moveValid, true, 'the engine judges the next move against the abandoned board');
```

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: 41 pass.

- [ ] **Step 2: Write the failing gravity tests**

Extend the engine import in `tests/engine.test.js` with `dropGems, fillGems, RNG` (RNG is already imported; add the two functions). Append:

```js
// --- Gravity ----------------------------------------------------------------

// A 3x3 with one gem left in the middle line, so one gem falls and two enter.
function gravityFixture(gravity) {
  const board = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => makeCell(1)));
  const keep = { down: { r: 0, c: 1 }, up: { r: 2, c: 1 }, right: { r: 1, c: 0 }, left: { r: 1, c: 2 } }[gravity];
  const line = gravity === 'down' || gravity === 'up' ? [{ r: 0, c: 1 }, { r: 1, c: 1 }, { r: 2, c: 1 }] : [{ r: 1, c: 0 }, { r: 1, c: 1 }, { r: 1, c: 2 }];
  for (const pos of line) board[pos.r][pos.c] = null;
  board[keep.r][keep.c] = makeCell(2);
  return { board, keep };
}

test('dropGems compacts each line toward the gravity edge in every direction', () => {
  const landing = { down: { r: 2, c: 1 }, up: { r: 0, c: 1 }, right: { r: 1, c: 2 }, left: { r: 1, c: 0 } };
  for (const gravity of ['down', 'up', 'right', 'left']) {
    const { board, keep } = gravityFixture(gravity);
    const moves = dropGems(board, 3, 3, gravity);
    assert.deepEqual(moves, [{ from: keep, to: landing[gravity], type: 2 }], gravity);
    assert.equal(board[landing[gravity].r][landing[gravity].c].type, 2, `${gravity}: gem landed`);
    assert.equal(board[keep.r][keep.c], null, `${gravity}: origin emptied`);
  }
});

test('fillGems enters new gems from the edge opposite gravity, each travelling the full gap', () => {
  const beyond = {
    down: m => m.from.r < 0 && m.from.c === m.to.c && m.to.r - m.from.r === 2,
    up: m => m.from.r > 2 && m.from.c === m.to.c && m.from.r - m.to.r === 2,
    right: m => m.from.c < 0 && m.from.r === m.to.r && m.to.c - m.from.c === 2,
    left: m => m.from.c > 2 && m.from.r === m.to.r && m.from.c - m.to.c === 2
  };
  for (const gravity of ['down', 'up', 'right', 'left']) {
    const { board } = gravityFixture(gravity);
    dropGems(board, 3, 3, gravity);
    const moves = fillGems(board, 3, 3, 4, new RNG(1), gravity);
    assert.equal(moves.length, 2, gravity);
    assert.ok(moves.every(beyond[gravity]), `${gravity}: ${JSON.stringify(moves)}`);
    assert.ok(board.every(row => row.every(cell => cell !== null)), `${gravity}: board full`);
  }
});

test('Refill avoidance works in every direction: an emptied line never refills as a run of three', () => {
  // Under the old guard, 'up' and 'left' looked at cells not yet filled and could
  // complete a run of three inside the refilled line itself.
  for (const gravity of ['down', 'up', 'right', 'left']) {
    for (let seed = 0; seed < 60; seed++) {
      const board = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => makeCell((r + c) % 2 === 0 ? 0 : 1)));
      const isVertical = gravity === 'down' || gravity === 'up';
      for (let i = 0; i < 3; i++) {
        if (isVertical) board[i][1] = null;
        else board[1][i] = null;
      }
      fillGems(board, 3, 3, 2, new RNG(seed), gravity);
      const line = isVertical ? [board[0][1], board[1][1], board[2][1]] : [board[1][0], board[1][1], board[1][2]];
      assert.ok(line.every(cell => cell !== null), `${gravity} seed ${seed}: line refilled`);
      assert.ok(!(line[0].type === line[1].type && line[1].type === line[2].type), `${gravity} seed ${seed}: refilled a run of three`);
    }
  }
});

test('Gravity is read at the start of each wave, so a turn mid-cascade changes where refills come from', () => {
  let proved = false;
  for (let seed = 0; seed < 20 && !proved; seed++) {
    const engine = new Engine({ rows: 8, cols: 8, gemTypes: 2, seed });
    engine.init();
    const m = engine.findValidMove();
    if (!m) continue;
    const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
    let fills = 0;
    for (const frame of result.frames) {
      if (frame.kind !== 'fill') continue;
      fills++;
      if (fills === 1) {
        assert.ok(frame.moves.every(mv => mv.from.r < 0), 'the first fill comes from the top under down');
        engine.setGravity('up');
      } else {
        assert.ok(frame.moves.every(mv => mv.from.r >= 8), 'after the turn the next fill comes from the bottom');
        proved = true;
        break;
      }
    }
  }
  assert.ok(proved, 'a two-colour move should cascade at least two waves within 20 seeds');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: the three gravity tests fail (`dropGems` is not exported / `setGravity` is not a function).

- [ ] **Step 4: Add gravity to the engine**

Directly after the `ARM_STEPS` table add:

```ts
// The direction gems fall, in board coordinates. The page sets it from the
// device orientation and the Turn control; the engine reads it at the start of
// every wave, so a turn mid-cascade changes where the next refill comes from.
export type Gravity = 'down' | 'up' | 'left' | 'right';

const GRAVITY_STEP: Record<Gravity, { dr: number; dc: number }> = {
  down: { dr: 1, dc: 0 },
  up: { dr: -1, dc: 0 },
  right: { dr: 0, dc: 1 },
  left: { dr: 0, dc: -1 }
};
```

Add `gravity?: Gravity;` to `EngineConfig` and `gravity: Gravity;` to `EngineState`. In the constructor's state literal add `gravity: config.gravity ?? 'down'`. In `reset()` add `const gravity = config.gravity ?? prev.gravity;` and include `gravity` in the fresh state object. Add the method after `setBoard`:

```ts
  setGravity(gravity: Gravity): void {
    this.state.gravity = gravity;
  }
```

Replace `dropGems` and `fillGems` with:

```ts
// The lines gems fall along, each listed from the landing edge inward: index 0 is
// where the first gem comes to rest and the last entry touches the edge new gems
// enter from. Under 'down' this is column by column, bottom row first, which is
// exactly the order the old code used, so 'down' frames are unchanged.
function fallLines(rows: number, cols: number, gravity: Gravity): Pos[][] {
  const lines: Pos[][] = [];
  if (gravity === 'down' || gravity === 'up') {
    for (let c = 0; c < cols; c++) {
      const line: Pos[] = [];
      for (let i = 0; i < rows; i++) line.push({ r: gravity === 'down' ? rows - 1 - i : i, c });
      lines.push(line);
    }
  } else {
    for (let r = 0; r < rows; r++) {
      const line: Pos[] = [];
      for (let i = 0; i < cols; i++) line.push({ r, c: gravity === 'right' ? cols - 1 - i : i });
      lines.push(line);
    }
  }
  return lines;
}

export function dropGems(board: Board, rows: number, cols: number, gravity: Gravity): GemMove[] {
  const moves: GemMove[] = [];

  for (const line of fallLines(rows, cols, gravity)) {
    let write = 0;
    for (let i = 0; i < line.length; i++) {
      const from = line[i];
      const cell = board[from.r][from.c];
      if (!cell) continue;
      if (write !== i) {
        const to = line[write];
        board[to.r][to.c] = cell;
        board[from.r][from.c] = null;
        moves.push({ from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c }, type: cell.type });
      }
      write++;
    }
  }

  return moves;
}

// Expects dropGems to have run first, so every empty in a line sits at the entry edge; that is what makes "every new gem travels n cells" true.
export function fillGems(board: Board, rows: number, cols: number, gemTypes: number, rng: RNG, gravity: Gravity): GemMove[] {
  const moves: GemMove[] = [];
  const step = GRAVITY_STEP[gravity];

  for (const line of fallLines(rows, cols, gravity)) {
    const empties = line.filter(pos => !board[pos.r][pos.c]);
    const n = empties.length;
    // Fill from the entry edge inward, the order the old code used, so the
    // match-avoidance sees the neighbours it expects and the RNG draws match.
    for (let k = n - 1; k >= 0; k--) {
      const pos = empties[k];
      // Refill with the same match-avoidance the initial board uses. Without this
      // the engine builds a clean board then refills it carelessly, and below ~4
      // gem types the refill manufactures matches faster than they clear.
      const type = pickNonMatchingType(board, pos.r, pos.c, gemTypes, rng, gravity);
      board[pos.r][pos.c] = { type, special: SPECIAL.NONE, arms: null };
      // Every new gem starts n cells beyond the entry edge, so all of them travel
      // the same distance into place.
      moves.push({ from: { r: pos.r - step.dr * n, c: pos.c - step.dc * n }, to: pos, type });
    }
  }

  return moves;
}
```

`pickNonMatchingType`'s look-back guard always checked the two cells above and the two to the left, which is only correct for the fill order `'down'`/`'right'` use — under `'up'`/`'left'` the fill order walks away from those cells, so they are still empty and the guard never fires. Replace it with a guard that looks back along the actual fall direction:

```ts
// Pick a gem type that does not immediately complete a 3-run with cells already
// placed. Fill order runs from the entry edge inward, so "already placed" means
// the two cells behind this one along its line (toward the entry edge, opposite
// the fall) and the two beside it in the lines done earlier (the column to the
// left for vertical gravity, the row above for horizontal). Under 'down' this is
// the row-major look-back board generation has always used. It only looks back,
// never forward: a run can still be completed from the other side, which is
// acceptable and matches the original behaviour.
function pickNonMatchingType(board: Board, r: number, c: number, gemTypes: number, rng: RNG, gravity: Gravity = 'down'): number {
  const step = GRAVITY_STEP[gravity];
  const vertical = step.dc === 0;
  const behind = (k: number): number | undefined => board[r - k * step.dr]?.[c - k * step.dc]?.type;
  const beside = (k: number): number | undefined => (vertical ? board[r]?.[c - k] : board[r - k]?.[c])?.type;
  let type = 0;
  let attempts = 0;
  do {
    type = rng.int(gemTypes);
    attempts++;
  } while (
    attempts < 50 &&
    ((behind(1) === type && behind(2) === type) || (beside(1) === type && beside(2) === type))
  );
  return type;
}
```

The default parameter keeps every other caller unchanged: `init`'s `randomGem` and `regenerateBoard`'s `randomGem` closure keep calling `pickNonMatchingType` with no gravity argument, so board generation always uses the `'down'` guard. Under `'down'` this new guard is byte-for-byte equivalent to the old one (same two cells, OR order swapped, no behavioural difference), so the golden check still holds.

Update every call site to pass gravity read from state at that moment:
- In `resolveMove`, both combo tails: `dropGems(board, rows, cols, state.gravity)` and `fillGems(board, rows, cols, state.gemTypes, state.rng, state.gravity)`.
- In `cascadeWaves`: the same two calls with `state.gravity`.

Run: `grep -n "dropGems(\|fillGems(" src/engine/index.ts`
Expected: every call passes a gravity argument.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node build.mjs --test && node --test tests/engine.test.js && npm run typecheck && npm test`
Expected: 45 engine tests; typecheck clean; 66 total (all pre-existing tests, which run under `'down'`, are unchanged: that is the golden check).

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts tests/engine.test.js
git commit -m "Give the engine a four-way gravity read at every wave

Gems fall along lines that run from the landing edge inward, one
implementation for all four directions, and new gems enter from the edge
opposite gravity. Under 'down' the order of every move and RNG draw is what
it was, so existing frames are unchanged. The page will set gravity from the
device orientation and the Turn control. Also asserts moveValid in the
abandoned-move test, parked from 2.2.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Settings, storage and URL for rectangles

**Files:**
- Modify: `src/storage.ts` (`LIMITS`, `Settings`, `DEFAULT_SETTINGS`, `parseSettings`, `resolveSettings`), `src/main.ts` (`config`, `startNewGame`, `syncUrl`, `pending`, `syncSettingsUI`, `updateApplyState`, `revertPending`, the `sizeSeg` change handler)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `Settings { cols; rows; gemTypes; palette; turns }`, `LIMITS.grid = { min: 4, max: 40, default: 8 }`, `export function parseGrid(value: unknown): { cols: number; rows: number } | null`, `export function formatGrid(cols: number, rows: number): string`. Task 4 reads and writes `settings.turns`; Task 6 replaces the sheet's size control.

- [ ] **Step 1: Update the storage tests**

In `tests/storage.test.js`, extend the import with `parseGrid, formatGrid`. Replace the two settings tests `'parseSettings clamps ranges and rejects unknown palettes'` and `'settings survive a serialize/parse round trip'`, and the `resolveSettings` test, with:

```js
test('parseSettings clamps ranges, rejects unknown palettes, and migrates gridSize', () => {
  const s = parseSettings('{"cols":"12","rows":18,"gemTypes":99,"palette":"nope","turns":2}');
  assert.deepEqual(s, { cols: 12, rows: 18, gemTypes: 10, palette: 'default', turns: 2 });

  const low = parseSettings('{"cols":1,"rows":99,"gemTypes":-4,"palette":"highcontrast","turns":7}');
  assert.deepEqual(low, { cols: 4, rows: 40, gemTypes: 2, palette: 'highcontrast', turns: 3 });

  const legacy = parseSettings('{"gridSize":12,"gemTypes":6,"palette":"redgreen"}');
  assert.deepEqual(legacy, { cols: 12, rows: 12, gemTypes: 6, palette: 'redgreen', turns: 0 });

  const nan = parseSettings('{"cols":"abc","gemTypes":null}');
  assert.deepEqual(nan, DEFAULT_SETTINGS);
});

test('settings survive a serialize/parse round trip', () => {
  const s = { cols: 10, rows: 15, gemTypes: 6, palette: 'redgreen', turns: 1 };
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
});

test('parseGrid accepts a side or WxH, clamps, and rejects anything else', () => {
  assert.deepEqual(parseGrid('8'), { cols: 8, rows: 8 });
  assert.deepEqual(parseGrid('8x12'), { cols: 8, rows: 12 });
  assert.deepEqual(parseGrid(' 12X8 '), { cols: 12, rows: 8 });
  assert.deepEqual(parseGrid('3x99'), { cols: 4, rows: 40 });
  assert.equal(parseGrid('8x'), null);
  assert.equal(parseGrid('x8'), null);
  assert.equal(parseGrid('abc'), null);
  assert.equal(parseGrid('8x12x3'), null);
  assert.equal(parseGrid(''), null);
  assert.equal(parseGrid(null), null);
});

test('formatGrid writes a bare side for squares and WxH otherwise', () => {
  assert.equal(formatGrid(8, 8), '8');
  assert.equal(formatGrid(8, 12), '8x12');
});

test('resolveSettings lets valid URL params override stored board values', () => {
  const stored = { cols: 8, rows: 8, gemTypes: 5, palette: 'highcontrast', turns: 2 };
  assert.deepEqual(
    resolveSettings(new URLSearchParams('grid=10x15&gems=7'), stored),
    { cols: 10, rows: 15, gemTypes: 7, palette: 'highcontrast', turns: 2 }
  );
  assert.deepEqual(
    resolveSettings(new URLSearchParams('grid=12'), stored),
    { cols: 12, rows: 12, gemTypes: 5, palette: 'highcontrast', turns: 2 }
  );
  // Malformed grid is ignored, out-of-range gems are clamped, turns never come from the URL.
  assert.deepEqual(
    resolveSettings(new URLSearchParams('grid=abc&gems=99&turns=1'), stored),
    { cols: 8, rows: 8, gemTypes: 10, palette: 'highcontrast', turns: 2 }
  );
  assert.deepEqual(resolveSettings(new URLSearchParams(''), stored), stored);
});
```

Also update `'parseSettings falls back to defaults for missing or malformed input'` only if it fails (it compares to `DEFAULT_SETTINGS`, which changes shape; the assertions themselves stay valid).

- [ ] **Step 2: Run the storage tests to verify they fail**

Run: `node build.mjs --test && node --test tests/storage.test.js`
Expected: the new tests fail (`parseGrid` not exported, `gridSize` still produced).

- [ ] **Step 3: Implement the settings changes**

In `src/storage.ts` replace `LIMITS`, `Settings`, `DEFAULT_SETTINGS`, `parseSettings` and `resolveSettings` with:

```ts
export const LIMITS = {
  grid: { min: 4, max: 40, default: 8 }, // per side
  gems: { min: 2, max: 10, default: 5 },
  turns: { min: 0, max: 3 }
} as const;

export interface Settings {
  cols: number; // across the device's short side
  rows: number; // down its long side
  gemTypes: number;
  palette: PaletteId;
  turns: number; // manual quarter turns clockwise, 0..3
}

export const DEFAULT_SETTINGS: Settings = {
  cols: LIMITS.grid.default,
  rows: LIMITS.grid.default,
  gemTypes: LIMITS.gems.default,
  palette: 'default',
  turns: 0
};
```

```ts
// "8" is a square, "8x12" is cols by rows. Anything else is not a grid.
export function parseGrid(value: unknown): { cols: number; rows: number } | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d+)(?:\s*[xX]\s*(\d+))?\s*$/.exec(value);
  if (!m) return null;
  const cols = clampInt(m[1], LIMITS.grid.min, LIMITS.grid.max, LIMITS.grid.default);
  const rows = m[2] === undefined ? cols : clampInt(m[2], LIMITS.grid.min, LIMITS.grid.max, LIMITS.grid.default);
  return { cols, rows };
}

export function formatGrid(cols: number, rows: number): string {
  return cols === rows ? String(cols) : `${cols}x${rows}`;
}

// `legacyPalette` is the value of the pre-2.0 standalone palette key; it only
// applies when the settings blob carries no palette of its own. A pre-2.3 blob
// carries `gridSize`, which becomes a square of that side.
export function parseSettings(json: string | null | undefined, legacyPalette?: string | null): Settings {
  const raw = asRecord(parseJson(json)) ?? {};
  const palette = isPalette(raw.palette)
    ? raw.palette
    : isPalette(legacyPalette)
      ? legacyPalette
      : DEFAULT_SETTINGS.palette;
  const legacySide = clampInt(raw.gridSize, LIMITS.grid.min, LIMITS.grid.max, LIMITS.grid.default);
  return {
    cols: clampInt(raw.cols, LIMITS.grid.min, LIMITS.grid.max, legacySide),
    rows: clampInt(raw.rows, LIMITS.grid.min, LIMITS.grid.max, legacySide),
    gemTypes: clampInt(raw.gemTypes, LIMITS.gems.min, LIMITS.gems.max, DEFAULT_SETTINGS.gemTypes),
    palette,
    turns: clampInt(raw.turns, LIMITS.turns.min, LIMITS.turns.max, DEFAULT_SETTINGS.turns)
  };
}
```

```ts
// URL parameters win over stored values for the board shape so links stay
// shareable; the palette and the turn count are personal and never come from
// the URL.
export function resolveSettings(params: URLSearchParams, stored: Settings): Settings {
  const grid = parseGrid(params.get('grid'));
  return {
    cols: grid ? grid.cols : stored.cols,
    rows: grid ? grid.rows : stored.rows,
    gemTypes: clampInt(params.get('gems'), LIMITS.gems.min, LIMITS.gems.max, stored.gemTypes),
    palette: stored.palette,
    turns: stored.turns
  };
}
```

In `src/main.ts`:
1. Import `formatGrid` from `./storage` alongside `LIMITS`.
2. `config`: replace `gridSize: settings.gridSize, rows: settings.gridSize, cols: settings.gridSize,` with `rows: settings.rows, cols: settings.cols,`.
3. `startNewGame`: replace the `if (settings.gridSize !== config.gridSize) { ... }` block with:

```ts
  if (settings.rows !== config.rows || settings.cols !== config.cols) {
    config.rows = settings.rows;
    config.cols = settings.cols;
    needsGridRebuild = true;
  }
```

4. `syncUrl`: replace the two `grid` lines with:

```ts
  if (config.cols === LIMITS.grid.default && config.rows === LIMITS.grid.default) url.searchParams.delete('grid');
  else url.searchParams.set('grid', formatGrid(config.cols, config.rows));
```

5. Settings sheet plumbing (Task 6 adds the Shape control; keep the sheet working now): `const pending = { cols: settings.cols, rows: settings.rows, gemTypes: settings.gemTypes };`; in `syncSettingsUI` render the size segment from `pending.cols` with the label `` v => `${v}×${v}` ``; `updateApplyState` computes `dirty` as `pending.cols !== config.cols || pending.rows !== config.rows || pending.gemTypes !== config.gemTypes`; `revertPending` copies `cols` and `rows` from `config`; the `sizeSeg` change handler sets `pending.cols = pending.rows = Number(input.value)`; `settingsDone` and `settingsNewGame` copy `pending.cols`/`pending.rows` into `settings` (replacing the `gridSize` lines).

Run: `grep -n "gridSize" src/main.ts src/storage.ts`
Expected: only the migration read in `parseSettings`.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: clean; 68 tests (65 plus `parseGrid`, `formatGrid`, and the migration case counted inside the rewritten tests: exactly 65 + 2 new tests + 0 = 67 if the suite counts `parseGrid` and `formatGrid` as the two new tests; report the real number). Reload `http://localhost:8080/?grid=8x12` in a served build and confirm the board is 8 wide and 12 tall and the URL keeps `grid=8x12`; `?grid=8` shows no `grid` param after load.

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts src/main.ts tests/storage.test.js
git commit -m "Store the board as cols, rows and turns, and take ?grid=8x12

The board can now be a rectangle. Settings carry cols and rows (a stored
gridSize migrates to a square) plus the manual turn count, and the URL
accepts a bare side or WxH, clamped to 4..40 per side. The sheet still
offers squares until the Shape control lands.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The orientation module

**Files:**
- Create: `src/orientation.ts`
- Create: `tests/orientation.test.js`
- Modify: `build.mjs` (node entries)

**Interfaces:**
- Produces: `export type Rotation = 0 | 90 | 180 | 270`, `export function normalizeRotation(deg: number): Rotation`, `export function boardPose(deviceAngle: number, turns: number): { rotation: Rotation; gravity: Gravity }`, `export function toBoardDelta(dx: number, dy: number, rotation: Rotation): { dr: number; dc: number }`, `export const GRAVITY_BY_ROTATION`. Task 4 uses all of them.

- [ ] **Step 1: Write the failing tests**

Create `tests/orientation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPose, toBoardDelta, normalizeRotation } from '../dist/orientation.js';

// Truth table. deviceAngle is screen.orientation.angle (counter-clockwise from the
// natural orientation, per the W3C spec); rotation is the board's CSS rotation
// (clockwise). The board is glued to the device, so it turns the way the device
// turned: the negative of the API angle, plus a quarter turn clockwise per manual
// turn. Gravity is screen-down expressed in board coordinates. This table is
// what must be confirmed on a real iPhone before the release ships.
const TABLE = [
  // angle, turns, rotation, gravity
  [0, 0, 0, 'down'], [0, 1, 90, 'right'], [0, 2, 180, 'up'], [0, 3, 270, 'left'],
  [90, 0, 270, 'left'], [90, 1, 0, 'down'], [90, 2, 90, 'right'], [90, 3, 180, 'up'],
  [180, 0, 180, 'up'], [180, 1, 270, 'left'], [180, 2, 0, 'down'], [180, 3, 90, 'right'],
  [270, 0, 90, 'right'], [270, 1, 180, 'up'], [270, 2, 270, 'left'], [270, 3, 0, 'down']
];

test('boardPose maps every device angle and turn count per the truth table', () => {
  for (const [angle, turns, rotation, gravity] of TABLE) {
    assert.deepEqual(boardPose(angle, turns), { rotation, gravity }, `angle ${angle}, turns ${turns}`);
  }
});

test('normalizeRotation wraps into 0..270 on quarter turns', () => {
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-450), 270);
});

test('toBoardDelta rotates a screen delta into board space', () => {
  // Screen right (dx 1) and screen down (dy 1) under each board rotation.
  const right = { 0: { dr: 0, dc: 1 }, 90: { dr: -1, dc: 0 }, 180: { dr: 0, dc: -1 }, 270: { dr: 1, dc: 0 } };
  const down = { 0: { dr: 1, dc: 0 }, 90: { dr: 0, dc: 1 }, 180: { dr: -1, dc: 0 }, 270: { dr: 0, dc: -1 } };
  // Negating a literal 0 gives -0, which strict deep-equal distinguishes from 0.
  const flip = d => ({ dr: d.dr === 0 ? 0 : -d.dr, dc: d.dc === 0 ? 0 : -d.dc });
  for (const rotation of [0, 90, 180, 270]) {
    assert.deepEqual(toBoardDelta(1, 0, rotation), right[rotation], `right at ${rotation}`);
    assert.deepEqual(toBoardDelta(0, 1, rotation), down[rotation], `down at ${rotation}`);
    assert.deepEqual(toBoardDelta(-1, 0, rotation), flip(right[rotation]), `left at ${rotation}`);
    assert.deepEqual(toBoardDelta(0, -1, rotation), flip(down[rotation]), `up at ${rotation}`);
  }
});

test('screen-down under a rotation is the pose gravity', () => {
  const name = { '1,0': 'down', '-1,0': 'up', '0,1': 'right', '0,-1': 'left' };
  for (const [angle, turns, rotation, gravity] of TABLE) {
    const d = toBoardDelta(0, 1, rotation);
    assert.equal(name[`${d.dr},${d.dc}`], gravity, `angle ${angle}, turns ${turns}`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node build.mjs --test && node --test tests/orientation.test.js`
Expected: fails to import `../dist/orientation.js`.

- [ ] **Step 3: Write the module and bundle it**

Create `src/orientation.ts`:

```ts
// Where the board points and which way gems fall, from the device orientation and
// the player's manual turns. Pure, so the truth table is unit-tested; the sign
// convention below is the W3C one and is confirmed on a real iPhone before each
// release that touches it.
//
// screen.orientation.angle is the screen's rotation counter-clockwise from its
// natural orientation. The board is glued to the device body, so it must turn the
// way the device turned: the negative of that angle, as a CSS (clockwise)
// rotation. Each manual turn adds a quarter turn clockwise.

import type { Gravity } from './engine/index';

export type Rotation = 0 | 90 | 180 | 270;

export const GRAVITY_BY_ROTATION: Record<Rotation, Gravity> = {
  0: 'down',
  90: 'right',
  180: 'up',
  270: 'left'
};

export function normalizeRotation(deg: number): Rotation {
  const wrapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return wrapped as Rotation;
}

export function boardPose(deviceAngle: number, turns: number): { rotation: Rotation; gravity: Gravity } {
  const rotation = normalizeRotation(-deviceAngle + 90 * turns);
  return { rotation, gravity: GRAVITY_BY_ROTATION[rotation] };
}

// A screen-space delta (x right, y down) expressed in board rows and columns.
// The board appears rotated clockwise by `rotation`, so a screen vector is the
// board vector rotated the other way. Results are normalised so a negated zero
// never leaks out as -0.
export function toBoardDelta(dx: number, dy: number, rotation: Rotation): { dr: number; dc: number } {
  const zero = (v: number): number => (v === 0 ? 0 : v);
  switch (rotation) {
    case 90:
      return { dr: zero(-dx), dc: zero(dy) };
    case 180:
      return { dr: zero(-dy), dc: zero(-dx) };
    case 270:
      return { dr: zero(dx), dc: zero(-dy) };
    default:
      return { dr: zero(dy), dc: zero(dx) };
  }
}
```

In `build.mjs` add `orientation: 'src/orientation.ts'` to the node `entryPoints`.

- [ ] **Step 4: Run the tests**

Run: `node build.mjs --test && node --test tests/orientation.test.js && npm run typecheck && npm test`
Expected: 4 orientation tests pass; typecheck clean; the suite grows by 4.

- [ ] **Step 5: Commit**

```bash
git add src/orientation.ts tests/orientation.test.js build.mjs
git commit -m "Add the orientation module that maps device angle and turns to a pose

One pure function decides the board's CSS rotation and its gravity from
screen.orientation.angle and the manual turn count, and one maps screen
deltas into board space. The 16-case truth table pins the sign convention
so the on-device check has one place to correct.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The page turns

**Files:**
- Modify: `index.html` (board frame ~67, toolbar ~69-82, icon sprite ~33-40), `src/styles.css` (`.board` ~452, effects, reduced motion ~1347, narrow media ~1334), `src/main.ts` (imports; `config.timing`; DOM refs ~140-165; `updateBoardSizing` ~286-315; `cellCenter` ~412; `showEffects` ~465-499; `cellStepY` ~553; `animateGemMoves` ~562; `animateShuffle` ~619; pointer/keyboard input ~1020-1090; boot ~1319)

**Interfaces:**
- Consumes: `boardPose`, `toBoardDelta`, `Rotation` from Task 3; `engine.setGravity` from Task 1; `settings.turns` from Task 2.
- Produces: `pose` state, `applyPose()`, `turnBoard()`, `#boardFrame`, `#turnBtn`, `layout` (cell, gap, pad) used by Task 5's renderer and Task 6's walk.

- [ ] **Step 1: Markup and styles**

In `index.html`:
1. Add to the icon sprite, after `#i-settings`: `<symbol id="i-turn" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></symbol>`
2. Wrap the board: replace `<div class="board" id="board" role="group" aria-label="Game board"></div>` with

```html
    <div class="board-frame" id="boardFrame">
      <div class="board" id="board" role="group" aria-label="Game board"></div>
    </div>
```

3. In the toolbar group, before the help button, add:

```html
        <button class="icon-btn" id="turnBtn" type="button" aria-label="Turn the board" title="Turn the board (R)">
          <svg class="icon" aria-hidden="true"><use href="#i-turn"/></svg>
        </button>
```

In `src/styles.css`:
1. Next to the existing `@property --hold-angle`, register the properties a turn eases:

```css
/* Registered so a turn can ease the cell size along with the rotation. */
@property --cell-size {
  syntax: '<length>';
  inherits: true;
  initial-value: 48px;
}

@property --gem-size {
  syntax: '<length>';
  inherits: true;
  initial-value: 40px;
}

@property --board-scale {
  syntax: '<number>';
  inherits: false;
  initial-value: 1;
}
```

2. Change `.board { grid-area: board; position: relative; ... }` so the frame takes the grid area and the board sits inside it, rotated about its centre. A turn is one motion: the frame's footprint, the cell and gem sizes, and the rotation all ease on the same `--turn-ms` curve, and the board dips at mid-turn so its corners do not sweep the chrome:

```css
/* The frame is the board's footprint on screen (swapped when the board is turned
   sideways); the board itself keeps its unrotated grid and turns inside it. */
.board-frame {
  grid-area: board;
  position: relative;
  /* The lift rides here, not on .board: the board's transform is under a
     transition, which interpolates between its two end matrices and so never
     sees --board-scale change mid-flight. The frame has no transform
     transition, and the board is centred in it, so scaling the frame lifts the
     board about the same centre. */
  transform: scale(var(--board-scale, 1));
  transition: width var(--turn-ms, 600ms) var(--ease), height var(--turn-ms, 600ms) var(--ease);
}

.board {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) rotate(var(--board-rotation, 0deg));
  transition:
    box-shadow 1.2s var(--ease),
    transform var(--turn-ms, 600ms) var(--ease),
    --cell-size var(--turn-ms, 600ms) var(--ease),
    --gem-size var(--turn-ms, 600ms) var(--ease);
  /* (keep every other declaration of the existing .board rule) */
}

/* A turn lifts the board a little so its corners do not sweep over the chrome. */
.board-frame.turning {
  animation: turnLift var(--turn-ms, 600ms) var(--ease);
}

@keyframes turnLift {
  0%, 100% { --board-scale: 1; }
  50% { --board-scale: 0.82; }
}
```

   Remove `grid-area: board;` and the old `position: relative;` and `transition: box-shadow 1.2s var(--ease);` from `.board` (the new declarations above replace them).
3. Where `body { ... overflow: hidden; ... }` is set, add `html { overflow: hidden; }` so the document can never scroll during a turn.
4. In the reduced-motion block add `.board { transition: box-shadow 1.2s var(--ease); }` (no transform transition), `.board-frame { transition: none; }` and `.board-frame.turning { animation: none; }`.

- [ ] **Step 2: Pose state, sizing and the Turn control**

In `src/main.ts`:
1. Imports: `import { boardPose, toBoardDelta, type Rotation } from './orientation';`
2. `config.timing`: add `turn: 600,`.
3. DOM refs: `const boardFrameEl = getEl<HTMLDivElement>('boardFrame');` and `const turnBtn = getEl<HTMLButtonElement>('turnBtn');`.
4. Replace `updateBoardSizing` with:

```ts
// Board geometry in board-local pixels, refreshed by updateBoardSizing. Every
// effect and animation offset is computed from these, never from client rects:
// the board element is rotated, so a screen rect would be in the wrong frame.
const layout = { cell: 48, gap: 4, pad: 16 };

function updateBoardSizing(): void {
  const narrow = window.innerWidth <= 480;
  const boardPadding = (narrow ? 12 : 32) + 2; // padding both sides + 1px border each side
  const gap = narrow ? 2 : 4;
  const sideways = pose.rotation === 90 || pose.rotation === 270;
  const screenCols = sideways ? config.rows : config.cols;
  const screenRows = sideways ? config.cols : config.rows;
  const landscape = landscapePhoneQuery.matches;

  const stageStyle = getComputedStyle(stageEl);
  const padX = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
  const padY = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
  const rowGap = parseFloat(stageStyle.rowGap) || 0;
  const railWidth = landscape ? (parseFloat(stageStyle.getPropertyValue('--rail-w')) || 172) + 20 : 0;
  const chromeHeight = landscape
    ? 0
    : backLinkEl.offsetHeight + topbarEl.offsetHeight + toolbarEl.offsetHeight + rowGap * 3;

  const availWidth = window.innerWidth - padX - railWidth - boardPadding - (screenCols - 1) * gap;
  const availHeight = window.innerHeight - padY - chromeHeight - boardPadding - (screenRows - 1) * gap;
  const cellSize = Math.max(12, Math.min(72, Math.floor(Math.min(availWidth / screenCols, availHeight / screenRows))));
  const gemSize = cellSize - (cellSize < 28 ? 4 : 6);

  const boardW = boardPadding + config.cols * cellSize + (config.cols - 1) * gap;
  const boardH = boardPadding + config.rows * cellSize + (config.rows - 1) * gap;
  boardFrameEl.style.width = `${sideways ? boardH : boardW}px`;
  boardFrameEl.style.height = `${sideways ? boardW : boardH}px`;

  layout.cell = cellSize;
  layout.gap = gap;
  layout.pad = narrow ? 6 : 16; // effects resolve from the padding box, not the border box

  boardEl.style.setProperty('--grid-cols', String(config.cols));
  boardEl.style.setProperty('--cell-size', `${cellSize}px`);
  boardEl.style.setProperty('--gem-size', `${gemSize}px`);
  boardEl.style.setProperty('--gem-radius', `${Math.max(2, Math.round(gemSize * 0.18))}px`);
  boardEl.style.setProperty('--gap', `${gap}px`);
}
```

5. Add the pose state and control after the DOM refs section (it must be declared before `updateBoardSizing` runs, so place it above `createGrid`):

```ts
// ---------------------------------------------------------------------------
// Pose: the board is glued to the device. Turn the phone and the board turns
// with it; gravity stays with the world. Manual turns add quarter turns.
// ---------------------------------------------------------------------------

const landscapeQuery = window.matchMedia('(orientation: landscape)');

const orientationApi = typeof window.screen.orientation?.angle === 'number' ? window.screen.orientation : null;

function deviceAngle(): number {
  return orientationApi ? orientationApi.angle : landscapeQuery.matches ? 90 : 0;
}

const pose: { rotation: Rotation; visualRotation: number } = { rotation: 0, visualRotation: 0 };

function applyPose({ animate = true }: { animate?: boolean } = {}): void {
  const next = boardPose(deviceAngle(), settings.turns);
  // Keep the CSS angle continuous so a turn always animates the short way round.
  let delta = next.rotation - pose.rotation;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const turned = delta !== 0;
  pose.visualRotation += delta;
  pose.rotation = next.rotation;

  const turnMs = animate && !reducedMotion() ? config.timing.turn : 0;
  boardFrameEl.style.setProperty('--turn-ms', `${turnMs}ms`);
  if (turnMs > 0 && turned) {
    boardFrameEl.classList.add('turning');
    window.setTimeout(() => boardFrameEl.classList.remove('turning'), turnMs);
  }
  boardEl.style.setProperty('--board-rotation', `${pose.visualRotation}deg`);
  boardEl.dataset.rotation = String(pose.rotation);
  engine.setGravity(next.gravity);
  updateBoardSizing();
  if (turnMs === 0) {
    // Commit the instant change before restoring the duration, or the next
    // style recalc would see the normal duration and animate anyway.
    void boardEl.offsetHeight;
    boardFrameEl.style.setProperty('--turn-ms', `${config.timing.turn}ms`);
  }
}

function turnBoard(): void {
  settings.turns = (settings.turns + 1) % 4;
  persistSettings();
  applyPose();
}

if (orientationApi) orientationApi.addEventListener('change', () => applyPose());
else landscapeQuery.addEventListener('change', () => applyPose());
```

   and, with the other button handlers near the bottom:

```ts
turnBtn.addEventListener('click', turnBoard);
document.addEventListener('keydown', event => {
  if (event.key !== 'r' && event.key !== 'R') return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  turnBoard();
});
```

6. Boot: after `createGrid();` call `applyPose({ animate: false });` so a saved `turns` is in place without the board spinning into position on load (the engine now has the right gravity before the first move; note `createGrid` already calls `updateBoardSizing`, which reads `pose`, so `pose` must be declared above it in the file).

- [ ] **Step 3: Board-local geometry for effects and animations**

Replace `cellCenter` with:

```ts
// Centre of a cell in board-local pixels (inside the rotated board element).
function cellCenter(r: number, c: number): { x: number; y: number } {
  const step = layout.cell + layout.gap;
  return { x: layout.pad + c * step + layout.cell / 2, y: layout.pad + r * step + layout.cell / 2 };
}
```

In `showEffects`, remove the `boardRect` read and replace `boardRect.height` with `boardEl.offsetHeight` and `boardRect.width` with `boardEl.offsetWidth` (the untransformed size); `cellSize` may read `layout.cell` instead of computed style. `cellCenter` no longer returns null, so drop its null checks (`if (!center) return;` sites in `showExplosionEffect`, the beam builder and `spawnParticles`).

Delete `cellStepY`. In `animateGemMoves` replace the rect-based offset computation with index math:

```ts
  renderBoard(board);
  const step = layout.cell + layout.gap;

  moves.forEach((move, index) => {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (!gemEl) return;
    const dx = (move.from.c - move.to.c) * step;
    const dy = (move.from.r - move.to.r) * step;
    if (dx === 0 && dy === 0) return;
    gemEl.classList.add('falling');
    gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
    gemEl.style.transition = 'none';
  });
```

   (delete the `oldRects` array and the `cellStepY` call). In `animateShuffle` likewise replace `oldRects`/`newRect` with `dx = (move.from.c - move.to.c) * step`, `dy = (move.from.r - move.to.r) * step`.

- [ ] **Step 4: Input in board space**

In the `pointermove` handler replace the target computation with:

```ts
  const delta = toBoardDelta(dx, dy, pose.rotation);
  const alongRow = Math.abs(delta.dc) > Math.abs(delta.dr);
  const start = pointerStart.pos;
  const target: Pos = {
    r: start.r + (alongRow ? 0 : delta.dr > 0 ? 1 : -1),
    c: start.c + (alongRow ? (delta.dc > 0 ? 1 : -1) : 0)
  };
```

In the board `keydown` handler replace the arrow lookup with:

```ts
  const screenDelta: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0]
  };
  const screen = screenDelta[event.key];
  if (screen) {
    event.preventDefault();
    const d = toBoardDelta(screen[0], screen[1], pose.rotation);
    const next = { r: pos.r + d.dr, c: pos.c + d.dc };
    ...
```

   (delete the old `arrowDeltas` table).

- [ ] **Step 5: Typecheck, test, and walk it**

Run: `npm run typecheck && npm test`
Expected: clean; suite unchanged in count.

Build and serve; with the Playwright MCP:
1. 1280x800, `http://localhost:8080/?grid=8x12`: the frame is taller than wide; press `R` (keyboard) or click `#turnBtn`: `getComputedStyle(board).transform` changes and `board.dataset.rotation` reads `90`; the frame is now wider than tall; the Colors and score chrome still fit. Press three more times: rotation returns to `0` and `--board-rotation` reads `360deg` (continuous).
2. With rotation `90`, drag with `mcp__playwright__browser_drag` from the centre cell to the cell that is visually to its right; the swap target must be the board cell that is visually right (which is a different `data-row`/`data-col` than under rotation 0). Verify by reading which two gems got `swap`ped: install a `MutationObserver` on class changes or compare board snapshots before and after; a snapped-back invalid swap also proves the mapping if the two cells that nudged are the visually adjacent pair.
3. Make a move under rotation `90` and watch the refill: new gems must enter from the board edge that is visually at the top of the screen.
4. 390x844 and 844x390: the board fits without overflow at rotation 0 and 90 (screenshot both); on 844x390 the rail layout is in effect.
5. Console: no errors.

Close the browser and stop the server.

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles.css src/main.ts
git commit -m "Turn the board with the device and by hand, gravity following the world

The board is glued to the phone: the page reads screen.orientation and
counter-rotates the board inside a frame sized to its footprint, and sets
the engine's gravity so new gems fall from whichever edge is physically
up. A Turn button and the R key add quarter turns for desktops and for
inverting on an iPhone. Effects, falls and drags now work in board-local
coordinates, which is what a rotated element needs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Render by diffing

**Files:**
- Modify: `src/main.ts` (`renderBoard` ~348-386, `createGrid`)

- [ ] **Step 1: Diff against the last render**

Replace `renderBoard` with:

```ts
// The class list each gem element last received, by index. Only elements whose
// cell changed are touched, so a 40x40 board costs a few writes per frame.
let renderedKeys: string[] = [];

function cellKey(cell: Cell | null, r: number, c: number): string {
  if (!cell) return 'empty';
  const selected = gameState.selected;
  const state = selected
    ? selected.r === r && selected.c === c
      ? 'selected'
      : isAdjacent(selected, { r, c })
        ? 'target'
        : ''
    : '';
  return `${cell.type}|${cell.special ?? ''}|${cell.arms ?? ''}|${state}`;
}

function renderBoard(board: Board): void {
  gameState.currentBoard = board;
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const idx = posIdx(r, c);
      const cell = board[r][c];
      const key = cellKey(cell, r, c);
      if (renderedKeys[idx] === key) continue;
      renderedKeys[idx] = key;

      const gemEl = gems[idx];
      const shapeEl = shapes[idx];

      if (!cell) {
        gemEl.className = 'gem empty';
        shapeEl.className = 'gem-shape';
        continue;
      }

      gemEl.className = `gem gem-${cell.type}`;
      shapeEl.className = `gem-shape shape-${cell.type}`;

      if (cell.special === SPECIAL.BOMB) {
        gemEl.classList.add('special-bomb');
      } else if (cell.special === SPECIAL.LINE) {
        gemEl.classList.add('special-line');
        const arms = cell.arms ?? 0;
        if (arms & ARM.UP) gemEl.classList.add('arm-up');
        if (arms & ARM.RIGHT) gemEl.classList.add('arm-right');
        if (arms & ARM.DOWN) gemEl.classList.add('arm-down');
        if (arms & ARM.LEFT) gemEl.classList.add('arm-left');
      } else if (cell.special === SPECIAL.RAINBOW) {
        gemEl.classList.add('special-rainbow');
      }

      if (key.endsWith('|selected')) gemEl.classList.add('selected');
      else if (key.endsWith('|target')) gemEl.classList.add('swap-target');
    }
  }
}
```

Import the `Cell` type from the engine if it is not already imported. In `createGrid`, reset the cache: `renderedKeys = [];` next to `cells.length = 0;`.

Note: transient classes that other code adds to a gem element (`falling`, `touching`, `matched`, `exploding`, `line-cleared`, `rainbow-cleared`, `just-created`, `pending-match`, `dissolve`, `reform`, `invalid`, `activating`) are cleared today by `renderBoard` rewriting `className` on every frame. With diffing, a gem whose key did not change keeps such a class. Audit each: the removal animations are always followed by a `board` frame that changes the cell (it becomes empty or a new gem), `falling` is removed by `animateGemMoves` itself, `dissolve`/`reform` are removed by their timers, `touching`/`invalid`/`activating`/`pending-match`/`just-created` are removed by the code that adds them. If any is only ever cleared by the full rewrite, clear it explicitly where it is added, and say so in the report.

- [ ] **Step 2: Typecheck, test, and measure**

Run: `npm run typecheck && npm test`
Expected: clean.

Build and serve; with the Playwright MCP at 1280x800 open `http://localhost:8080/?grid=16x16`, install a `MutationObserver` on `#board` with `{ attributes: true, attributeFilter: ['class'], subtree: true }` counting mutations, make one swap that creates a plain 3-match, wait for the cascade to settle, and read the count. Expected: on the order of the cells that changed (tens), not hundreds per frame; record the number. Then `?grid=40x40` at 1280x800: the board renders with cells at least 12 px, a swap works, no console errors, and the page stays responsive (open the help sheet during the cascade).

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "Render only the cells that changed

renderBoard used to rewrite every gem's class list on every frame, which
was fine at 8x8 and would not be at 40x40. It now keeps the key it last
rendered per cell and touches only the elements whose cell differs, and
the classes other code adds transiently are cleared by their owners.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Sheet controls, docs and release 2.3.0

**Files:**
- Modify: `index.html` (Board section ~97-107, help sheet), `src/main.ts` (settings sheet code), `README.md`, `docs/project-log.md`, `package.json` + `package-lock.json`

- [ ] **Step 1: Size and Shape controls**

In `index.html`, in the Board section, after the Size row add:

```html
          <div class="row">
            <span class="row-label" id="shapeLabel">Shape</span>
            <div class="seg" id="shapeSeg" role="radiogroup" aria-labelledby="shapeLabel"></div>
          </div>
```

and change the hint below the rows to: `Size is the short side; Tall makes the long side half again as long. Fewer colors mean longer cascades. Changes start a new game.`

In `src/main.ts`:
- `const SIZE_PRESETS = [6, 8, 10, 12, 16, 24];` (labels are the bare side, `v => String(v)`).
- Add `const shapeSeg = getEl<HTMLDivElement>('shapeSeg');`, and a shape helper:

```ts
type Shape = 'square' | 'tall';
function tallRows(short: number): number {
  return Math.round(short * 1.5);
}
function shapeOf(cols: number, rows: number): Shape {
  return rows === tallRows(cols) ? 'tall' : 'square';
}
```

- `pending` gains nothing; `syncSettingsUI` renders the size segment from `pending.cols` and a shape segment: `renderShape(shapeSeg, shapeOf(pending.cols, pending.rows))` where `renderShape` writes two radios (`square` labelled "Square", `tall` labelled "Tall") in the same markup `renderSegments` uses. A rectangle from the URL that is neither square nor tall shows as Square with the size segment carrying its `cols`, and stays untouched until the player changes something.
- Handlers: the size change sets `pending.cols = v` and `pending.rows = shape === 'tall' ? tallRows(v) : v` using the current shape radio; the shape change recomputes `pending.rows` from `pending.cols`.

- [ ] **Step 2: Docs, help, log, version**

README: in Settings, replace the board-size bullet with `- **Size** (the short side: 6, 8, 10, 12, 16, 24) and **Shape** (Square or Tall, half again as long). **Colors** 2 to 7. Changing any of these starts a new game; the button says so before it does.` Add a bullet under Playing: `- **The board is glued to your phone.** Turn the phone and the board turns with it; new gems fall from whichever edge is up. The Turn button (or R) adds a quarter turn, which is how to invert on an iPhone and the only way to turn on a desktop; the turn is remembered.` In URL parameters, replace the `?grid=12` line with `?grid=8x12   Any rectangle, each side 4 to 40 (a bare number is a square)`.

Help sheet: in "The idea" add a sentence: `The board is glued to your phone: turn the phone, or press Turn, and gems fall from whichever edge is up.`

Append to `docs/project-log.md`:

```markdown
## 2.3 Turning boards (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part C.

| # | Decision | Rationale |
|---|----------|-----------|
| D22 | The board is a rectangle glued to the device body; `cols` is the short side, `rows` the long side, and it renders unrotated at zero turns on every device, so a Tall board on a desktop is upright until turned. | One frame of reference everywhere; the turn count persists, so a desktop player turns once. |
| D23 | Gravity is a four-way engine parameter read at the start of each wave; drop and fill run along fall lines from the landing edge inward, so `'down'` reproduces 2.2 exactly. | A physical toy: gems fall toward the ground, whichever board edge that is. |
| D24 | The pose comes from `screen.orientation.angle` plus manual turns through one pure function with a 16-case truth table; the sign is confirmed on an iPhone before release. | Platforms disagree on the API's sign; a single place to correct. |
| D25 | Effects, falls and drags are computed in board-local coordinates from cell indices. | A translate applied inside a rotated element is rotated with it; client rects lie. |
| D26 | Sides go to 40 by URL and 24 in the sheet; the render diffs. | Big boards are for tablets and desktops; the toy still works small. |
```

Bump the version: `npm version 2.3.0 --no-git-tag-version`.

- [ ] **Step 3: Final walk**

Run: `npm run typecheck && npm test && grep -n '"version"' package.json`
Expected: clean; suite green; `2.3.0`.

Build and serve; with the Playwright MCP at 390x844, 844x390 and 1280x800: Settings shows Size 6..24 and Shape Square/Tall; choosing 8 + Tall and starting a game gives an 8x12 board and the URL `?grid=8x12`; a Turn press at each viewport rotates the board and the frame's footprint swaps; a drag swap under rotation reaches the visually adjacent cell; reduced motion (if the run_code tool can emulate it) turns instantly. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.ts README.md docs/project-log.md package.json package-lock.json
git commit -m "Offer Size and Shape in the sheet, document turning boards, release 2.3.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Release

After the final review: merge `claude/turning-boards` into `main` and push (Vercel deploys). Before announcing, the truth table needs Jerry's iPhone: open zen.ghsj.me, turn the phone to landscape both ways; the board must stay glued to the phone (its top edge at the phone's physical top) and new gems must fall toward the ground. If the board turns the wrong way, the fix is the sign in `boardPose` and the truth table, one release. Also on the phone: Turn twice gives an inverted board with gems falling toward the physical top. Remove the worktree.
