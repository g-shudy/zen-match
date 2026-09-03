# The 2x2 and the Propeller Implementation Plan (Part D, release 2.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a 2x2 block of one colour a match that creates a propeller: a gem that, when set off, flies to a random spot on the board and pops a 2x2 there.

**Architecture:** `findMatches` marks the cells of every monochrome 2x2 alongside run cells, so squares flood into groups like runs do; the creation ladder places a `propeller` special for a group that contains a square and no intersection. The refill guard and `wouldMatchAt` learn the four square windows. Activation lives in `activateSpecialsInRemovalSet` next to bomb, beam and rainbow: the landing anchor is drawn from the seeded RNG among anchors not already being cleared, the landing 2x2 joins the removal set, and a `flight` effect records origin and landing. Combos derive from the same helper: a propeller carries a bomb or beam gem to its landing, two propellers both fly, and a rainbow sends every gem of the propeller's colour flying. The page animates a clone of the gem from its cell to the landing block's centre and applies the landing pop after the flight; reduced motion fades the origin and pops at once.

**Tech Stack:** TypeScript (strict) bundled by esbuild, no framework; `node:test` against the node bundle in `dist/`; Playwright MCP (WebKit) for the browser walk.

**Spec:** `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md` (Part D, Part A's creation table, Cross-cutting, Releases)

## Global Constraints

- A 2x2 of one colour is a match. Groups flood-fill through matched cells of the same colour, so a square touching a run of its colour merges with it.
- Creation precedence for a connected group of one colour: 6+ cells rainbow (200); exactly 5 containing an intersection, beam gem on the intersection (150); contains a square and no intersection, propeller (75); straight 5, line (100); straight 4, bomb (50). The `(len - 3)^2 * 20` bonus stays.
- Propeller placement: the swapped cell when it lies in the square, otherwise the square cell nearest the group's centroid (implemented as `findBestSpecialPosition` over the square's four cells).
- `wouldMatchAt` also checks the four 2x2 windows containing the cell; the refill guard `pickNonMatchingType` also refuses a colour that would complete a square with the three already-placed cells behind, beside and diagonal; `isMoveValid` inherits square detection unchanged.
- Propeller activation (matched, caught in a blast, or swapped with another special): it lifts off, flies to a landing anchor chosen uniformly from the seeded generator among 2x2 anchors whose four cells are on the board and outside the current removal set (any anchor when none is free), and clears the 2x2 there; specials at the landing chain; its own cell is removed; effect `{ kind: 'flight'; from: Pos; to: Pos }` where `to` is the anchor (top-left cell of the landing block); chain bonus 150.
- Combos: propeller + bomb and propeller + beam carry the other special to the landing: the 2x2 clears and the carried special fires centred on the anchor cell. Propeller + propeller: both fly. Rainbow + propeller: every gem of the propeller's colour flies; the rainbow is consumed. Bomb, beam and rainbow combos are unchanged.
- Page: a flight is a real animation with the zen easing over `min(900, 250 + 40 * distance)` ms, distance in cells from the origin's centre to the landing block's centre; several propellers in one wave fly concurrently; the landing pops after the flight; reduced motion fades the origin out and pops the landing at once. Glyph: a pinwheel overlay rotating slowly, static under reduced motion, an overlay so it survives every palette.
- Storage accepts `'propeller'` with `arms` null; the help legend gains a Propeller entry (the structural test enforces it); README, project log D27 to D29, the pipeline doc's Future Considerations gains the spec's Deferred list; `package.json` becomes `2.4.0` in the last task.
- `npm test` builds `dist/` then runs every test file; `npm run typecheck` must be clean at the end of every task.
- Commits: sentence-case imperative subject with no type prefix, body explains why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `claude/propeller` in its own worktree; never commit on `main`.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `src/engine/index.ts` | `SPECIAL.PROPELLER`, square detection in `findMatches`, `MatchGroup.square`, `wouldMatchAt` and refill-guard square checks, the ladder, propeller activation, landing helpers, combos, `flight` effect, `flown` animation |
| `src/storage.ts` | `'propeller'` accepted |
| `src/main.ts` | `special-propeller` class, `playFlights`, sequencing in `playSubSteps` and the `remove` case, `showEffects` ignoring flights |
| `src/styles.css` | Pinwheel glyph, `flown` and `flying` rules, reduced motion |
| `index.html` | Legend entry and combo copy |
| `tests/engine.test.js`, `tests/storage.test.js` | Detection, refill guard, valid move, activation, combos, determinism, storage |
| `README.md`, `docs/project-log.md`, `docs/zen-match-feature-pipeline.md`, `package.json` | Docs, D27 to D29, Future Considerations, version 2.4.0 |

---

### Task 1: Squares are matches

**Files:**
- Modify: `src/engine/index.ts` (`SPECIAL` ~1-6, `MatchGroup` ~132-138, `pickNonMatchingType` ~253-270, `findMatches` ~704-822, ladder in `cascadeWaves` ~992-1011, `specialPriority` ~1053, `wouldMatchAt` ~1168-1178), `index.html` (legend, before the Rainbow entry), `src/main.ts` (`renderBoard`, after the rainbow branch), `src/styles.css` (glyph, after the rainbow glyph rules, plus the reduced-motion selector list)
- Test: `tests/engine.test.js`

**Interfaces:**
- Produces: `SPECIAL.PROPELLER = 'propeller'` (so `Special` includes it), `MatchGroup.square: Pos | null` (the anchor of the first square in the group), propellers placed by the ladder with bonus 75, the `special-propeller` class and its glyph, and the legend entry (brought forward from Tasks 3 and 4 so `tests/help-legend.test.js`'s structural check never sees a `SPECIAL` value it can't find a sample for). Task 2 adds the propeller's behaviour; Task 3 adds its flight animation.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine.test.js` (the helpers `makeCell`, `play`, `placedSpecial`, `cyclicBoard`, `keys`, `removeFrame` already exist there):

```js
// --- Squares ----------------------------------------------------------------

test('A 2x2 of one colour is a match and makes a propeller on the swapped cell', () => {
  // The cyclic board has no runs and no squares. Three 0s sit at (1,1), (1,2), (2,1);
  // swapping (3,2) up into (2,2) completes the square.
  const board = cyclicBoard();
  board[1][1] = makeCell(0);
  board[1][2] = makeCell(0);
  board[2][1] = makeCell(0);
  board[3][2] = makeCell(0);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const result = play(engine, { r: 3, c: 2 }, { r: 2, c: 2 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 }, 'the swapped cell lies in the square');
  assert.equal(gem.special, SPECIAL.PROPELLER);
  assert.equal(gem.arms, null);
  const remove = removeFrame(result);
  assert.equal(remove.score.breakdown.matchBonus, 75 + 1 * 20, 'propeller bonus plus the length bonus');
});

test('findMatches reports a square as a group of four with its anchor', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 4);
  assert.deepEqual(groups[0].square, { r: 1, c: 1 });
  assert.equal(groups[0].intersection, null);
});

test('A 2x3 block is six cells and makes a rainbow', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 6);

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const { gem } = placedSpecial(play(engine, { r: 0, c: 0 }, { r: 0, c: 1 }));
  assert.equal(gem.special, SPECIAL.RAINBOW, 'six or more is a rainbow whatever its shape');
});

test('A square sharing two cells with a 3-run is five cells without an intersection and makes a propeller', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 5);
  assert.equal(groups[0].intersection, null, 'no vertical run of three, so no intersection');
  assert.deepEqual(groups[0].square, { r: 1, c: 1 });

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const { gem } = placedSpecial(play(engine, { r: 0, c: 0 }, { r: 0, c: 1 }));
  assert.equal(gem.special, SPECIAL.PROPELLER);
});

test('A swap whose only match is a square is judged legal', () => {
  const board = cyclicBoard();
  board[1][1] = makeCell(0);
  board[1][2] = makeCell(0);
  board[2][1] = makeCell(0);
  board[3][2] = makeCell(0);
  assert.equal(hasValidMoves(board, 5, 5), true);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const result = play(engine, { r: 3, c: 2 }, { r: 2, c: 2 });
  assert.equal(result.moveValid, true, 'the square alone makes the swap legal');
  assert.equal(placedSpecial(result).gem.special, SPECIAL.PROPELLER, 'and it is the square that matched');
});

test('The refill guard never completes a square with the three cells already placed', () => {
  // (0,0), (0,1) and (1,0) are colour 0; the cell at (1,1) is filled last under
  // 'down' and must never come out 0, whatever the seed.
  for (let seed = 0; seed < 40; seed++) {
    const board = [
      [makeCell(0), makeCell(0), makeCell(1)],
      [makeCell(0), null, makeCell(0)],
      [makeCell(1), makeCell(0), makeCell(1)]
    ];
    fillGems(board, 3, 3, 2, new RNG(seed), 'down');
    assert.equal(board[1][1].type, 1, `seed ${seed}: the guard must refuse the square`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: the six new tests fail (`SPECIAL.PROPELLER` undefined, no square group, the square-only swap's `moveValid` is false with nothing placed, the guard lets 0 through).

- [ ] **Step 3: Detect squares and place propellers**

In `src/engine/index.ts`:

1. `SPECIAL` gains `PROPELLER: 'propeller'`.
2. `MatchGroup` gains `square: Pos | null; // anchor (top-left) of the first 2x2 in the group`.
3. In `findMatches`, widen the map's value type to `{ r; c; type; direction: 'horizontal' | 'vertical' | 'square'; isComplex?: boolean; square?: Pos }` and add, after the vertical scan and before `if (matchedCells.size === 0) return [];`:

```ts
  // A 2x2 of one colour is a match in its own right. Its cells join the same
  // map, so a square touching a run of its colour floods into one group.
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const type = cell.type;
      if (board[r][c + 1]?.type !== type || board[r + 1][c]?.type !== type || board[r + 1][c + 1]?.type !== type) continue;
      for (const [i, j] of [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]]) {
        const key = keyFor(i, j);
        const existing = matchedCells.get(key);
        if (existing) {
          existing.square = existing.square ?? { r, c };
        } else {
          matchedCells.set(key, { r: i, c: j, type, direction: 'square', square: { r, c } });
        }
      }
    }
  }
```

   In the flood fill add `let square: Pos | null = null;` next to `intersection`, and after the `intersection` assignment add `if (cellData.square && !square) square = cellData.square;`. Add `square` to the pushed group. (`hDir`/`vDir` are set only for `'horizontal'`/`'vertical'` cells, as now.)

4. `wouldMatchAt`: before the final `return run >= 3;` line, change that line to `if (run >= 3) return true;` and append:

```ts
  // A 2x2 of one colour is a match too: check the four windows that contain (r, c).
  for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
    const r0 = r + dr;
    const c0 = c + dc;
    if (r0 < 0 || c0 < 0 || r0 + 1 >= rows || c0 + 1 >= cols) continue;
    let all = true;
    for (let i = r0; i <= r0 + 1 && all; i++) {
      for (let j = c0; j <= c0 + 1; j++) {
        if (i === r && j === c) continue;
        if (board[i][j]?.type !== type) {
          all = false;
          break;
        }
      }
    }
    if (all) return true;
  }
  return false;
```

5. `pickNonMatchingType`: add a diagonal look-back and a square clause. After `beside`, add:

```ts
  // The cell that closes a 2x2 with `behind` and `beside`: already placed too.
  const diagonal = (): number | undefined =>
    board[r - step.dr - (vertical ? 0 : 1)]?.[c - step.dc - (vertical ? 1 : 0)]?.type;
```

   and extend the `while` condition with `|| (behind(1) === type && beside(1) === type && diagonal() === type)`. Update the comment above the function: "or the three cells that would close a 2x2 with this one".

6. In `cascadeWaves`'s ladder insert, between the intersection branch and the straight-5 branch:

```ts
      } else if (match.square) {
        // A 2x2 (possibly touching a run): the propeller sits on the swapped cell
        // when that lies in the square, else on the square cell nearest the centre.
        const a = match.square;
        const squareCells: Pos[] = [{ r: a.r, c: a.c }, { r: a.r, c: a.c + 1 }, { r: a.r + 1, c: a.c }, { r: a.r + 1, c: a.c + 1 }];
        const pos = findBestSpecialPosition({ ...match, positions: squareCells }, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.PROPELLER });
        matchBonus += 75;
```

   and update the ladder comment above it to list the propeller. Change `specialPriority` to `{ [SPECIAL.RAINBOW]: 4, [SPECIAL.LINE]: 3, [SPECIAL.PROPELLER]: 2, [SPECIAL.BOMB]: 1 }`.

- [ ] **Step 4: Legend entry and glyph, so the structural test stays green**

`tests/help-legend.test.js`'s `'every special the engine can create has a legend entry'` walks every value of `SPECIAL` and fails the moment `PROPELLER` exists with nothing to show for it. Bring its legend entry and glyph forward from Tasks 3 and 4 rather than leave the suite red until they land:

In `index.html` add a legend entry before the Rainbow entry:

```html
            <li>
              <span class="gem gem-4 sample special-propeller" aria-hidden="true"><span class="gem-shape shape-4"></span></span>
              <span class="legend-text"><strong>Propeller</strong>A 2&times;2 block of one color. When it goes off it lifts away, lands somewhere else on the board, and pops a 2&times;2 there.</span>
            </li>
```

In `renderBoard`, add after the rainbow branch:

```ts
      } else if (cell.special === SPECIAL.PROPELLER) {
        gemEl.classList.add('special-propeller');
      }
```

In `src/styles.css`, after the rainbow glyph rules add:

```css
/* The propeller: four blades that turn slowly, an overlay like the beam arms so
   it reads in every palette. */
.gem.special-propeller::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: conic-gradient(
    rgba(255, 255, 255, 0.9) 0 12.5%, transparent 0 25%,
    rgba(255, 255, 255, 0.9) 0 37.5%, transparent 0 50%,
    rgba(255, 255, 255, 0.9) 0 62.5%, transparent 0 75%,
    rgba(255, 255, 255, 0.9) 0 87.5%, transparent 0
  );
  -webkit-mask: radial-gradient(circle, #000 0 14%, transparent 15% 24%, #000 25% 58%, transparent 60%);
  mask: radial-gradient(circle, #000 0 14%, transparent 15% 24%, #000 25% 58%, transparent 60%);
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.8));
  animation: propellerSpin 4s linear infinite;
  z-index: 2;
}

@keyframes propellerSpin {
  to { transform: rotate(360deg); }
}
```

In the reduced-motion block, next to the other special glyph animations, add `.gem.special-propeller::after` to the selector list that sets `animation: none`.

Task 3 still adds its own `.gem.flown`/`.gem.flying` rules after these when it builds the flight animation; only the glyph and the legend sample move here.

- [ ] **Step 5: Run the tests, the typecheck and the whole suite**

Run: `node build.mjs --test && node --test tests/engine.test.js && npm run typecheck && npm test`
Expected: 51 engine tests pass; typecheck clean; 79 total, all green including `tests/help-legend.test.js`. Watch the pre-existing `'init produces a settled, playable board'` and `'Refill does not manufacture immediate matches'` tests: they now also demand square-free boards. If either fails (two colours on 16x16 is the stress case), do not weaken it; report NEEDS_CONTEXT with the failing sizes and seeds.

Two other pre-existing tests can be caught out by the same RNG-stream shift (the refill guard now rejects one more candidate per cell, so every draw after the first rejection differs from before) even though they don't touch squares themselves:
- `'A swap whose only match is a square is judged legal'`'s fixture (above) has a second, incidental valid move if written as a bare `findValidMove` coordinate check instead of asserting on the intended swap directly — column 2 already holds colour 0 two rows apart, and a swap between them makes a plain vertical 3-run before row-major scan order ever reaches the square swap. Assert on `play(...).moveValid` and the placed special, not on `findValidMove`'s exact return value, as Step 1 now does.
- `'An abandoned move leaves the board hole-free where the last pulled wave left it, and the engine accepts the next move'` (seed 5, gemTypes 2, 8x8) hard-codes its post-abandon probe as `engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 })`. Once the refill guard changes, that pair can land on two cells that already match by chance, which is a legitimate no-op, not a broken engine. Replace the probe with:

```js
  const next = engine.findValidMove();
  assert.ok(next, 'the abandoned board still has a legal move');
  const again = engine.swap({ r: next.r1, c: next.c1 }, { r: next.r2, c: next.c2 });
  assert.equal(again.moveValid, true, 'the engine accepts a legal move on the abandoned board');
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts tests/engine.test.js index.html src/main.ts src/styles.css
git commit -m "Make a 2x2 of one colour a match that creates a propeller

Squares join the matcher alongside runs, so a square that touches a run
of its colour floods into one group, and the ladder places a propeller for
a group with a square and no intersection. The refill guard and the settle
predicate learn the square windows so a refill never hands one out. The
legend entry and glyph land now too, so the structural test never sees a
SPECIAL value it can't show a sample for. The propeller's flight behaviour
follows in the next task.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The propeller flies

**Files:**
- Modify: `src/engine/index.ts` (`RemovalAnim`/`Effect` ~88-92, `activateSpecialsInRemovalSet` ~819-926 and its three call sites, the combo block in `resolveMove` ~405-560, the design comment above it)
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `SPECIAL.PROPELLER`, `claimCells`, `beamCells`, `armsOf`, `RNG`.
- Produces: `Effect` variant `{ kind: 'flight'; from: Pos; to: Pos }`, `RemovalAnim` `'flown'`, `export function landingCells(anchor: Pos): Pos[]`, `activateSpecialsInRemovalSet(board, toRemove, animationClasses, rows, cols, effects, rng, processed?)`. Task 3's page animates `flight` effects and styles `flown`.

- [ ] **Step 1: Write the failing tests**

Extend the engine import in `tests/engine.test.js` with `landingCells`. Append:

```js
// --- Propeller ----------------------------------------------------------------

function flightsOf(frame) {
  return frame.effects.filter(e => e.kind === 'flight');
}

test('A matched propeller flies to a landing outside the clearing and pops a 2x2 there', () => {
  // Propeller at (1,1); swapping (2,0) and (2,1) completes column 1 rows 0-2.
  const board = cyclicBoard();
  board[0][1] = makeCell(0);
  board[1][1] = makeCell(0, SPECIAL.PROPELLER);
  board[2][0] = makeCell(0);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 1, c: 1 });
  const landing = landingCells(flights[0].to);
  assert.ok(flights[0].to.r >= 0 && flights[0].to.r <= 3 && flights[0].to.c >= 0 && flights[0].to.c <= 3, 'anchor keeps the block on a 5x5');
  const removed = new Set(keys(frame.positions));
  for (const pos of landing) assert.ok(removed.has(`${pos.r},${pos.c}`), 'every landing cell is cleared');
  for (const pos of landing) assert.ok(!['0,1', '1,1', '2,1'].includes(`${pos.r},${pos.c}`), 'the landing avoids the cells already being cleared');
  assert.equal(frame.animations['1,1'], 'flown');
  assert.equal(frame.positions.length, 3 + 4);
  assert.equal(frame.subSteps.length, 1);
  assert.deepEqual(frame.subSteps[0].triggerPos, { r: 1, c: 1 });
});

test('Propeller + bomb carries the bomb to the landing', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.PROPELLER);
  board[2][3] = makeCell(3, SPECIAL.BOMB);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 2, c: 3 }, 'after the swap the propeller sits where the bomb started');
  const anchor = flights[0].to;
  const explosions = frame.effects.filter(e => e.kind === 'explosion');
  assert.deepEqual(explosions, [{ kind: 'explosion', r: anchor.r, c: anchor.c }], 'the bomb fires centred on the anchor');
  const removed = new Set(keys(frame.positions));
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = anchor.r + dr;
      const c = anchor.c + dc;
      if (r >= 0 && r < 5 && c >= 0 && c < 5) assert.ok(removed.has(`${r},${c}`), `blast covers ${r},${c}`);
    }
  }
  for (const pos of landingCells(anchor)) assert.ok(removed.has(`${pos.r},${pos.c}`));
  assert.ok(removed.has('2,2') && removed.has('2,3'), 'both swapped specials are consumed');
  assert.equal(frame.score.points, 1100 + frame.positions.length * 15);
});

test('Propeller + beam fires the arms from the landing anchor', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.LINE, ARMS_HORIZONTAL);
  board[2][3] = makeCell(3, SPECIAL.PROPELLER);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 2, c: 2 });
  const anchor = flights[0].to;
  const removed = new Set(keys(frame.positions));
  for (let c = 0; c < 5; c++) assert.ok(removed.has(`${anchor.r},${c}`), `the beam clears row ${anchor.r}`);
  const beams = frame.effects.filter(e => e.kind === 'beam');
  assert.ok(beams.every(b => b.from.r === anchor.r && b.from.c === anchor.c), 'beams fire from the anchor');
  assert.equal(frame.score.points, 1100 + frame.positions.length * 15);
});

test('Two propellers both fly', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.PROPELLER);
  board[2][3] = makeCell(3, SPECIAL.PROPELLER);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 2);
  assert.deepEqual(keys(flights.map(f => f.from)), ['2,2', '2,3']);
  assert.equal(frame.score.points, 900 + frame.positions.length * 12);
});

test('Rainbow + propeller sends every gem of that colour flying, and landings fall back when the board is claimed', () => {
  // Two colours on a 4x4 checkerboard: eight gems of colour 1 fly; there are only
  // nine anchors, so most flights must fall back to an already-claimed anchor.
  const board = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => makeCell((r + c) % 2)));
  board[1][1] = makeCell(0, SPECIAL.RAINBOW); // keeps the checkerboard colour at (1,1)
  board[1][2] = makeCell(1, SPECIAL.PROPELLER); // colour 1, as the checkerboard has there
  assert.equal(findMatches(board, 4, 4).length, 0, 'fixture must start match-free');
  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 2, seed: 8 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 1, c: 1 }, { r: 1, c: 2 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 8, 'every colour-1 gem on the swapped board, the propeller included');
  const removed = new Set(keys(frame.positions));
  for (const f of flights) {
    assert.ok(f.to.r >= 0 && f.to.r <= 2 && f.to.c >= 0 && f.to.c <= 2, 'every anchor keeps its block on the board');
    assert.equal(frame.animations[`${f.from.r},${f.from.c}`], 'flown');
    assert.ok(removed.has(`${f.from.r},${f.from.c}`), 'the gem that flew is gone from its cell');
    for (const pos of landingCells(f.to)) assert.ok(removed.has(`${pos.r},${pos.c}`), 'every landing cell is cleared');
  }
  assert.ok(removed.has('1,2'), 'the rainbow is consumed');
  assert.equal(frame.score.points, 2500 + frame.positions.length * 20);
});

test('Landings are deterministic under a seed', () => {
  const make = () => {
    const board = cyclicBoard();
    board[2][2] = makeCell(2, SPECIAL.PROPELLER);
    board[2][3] = makeCell(3, SPECIAL.PROPELLER);
    const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 21 });
    engine.setBoard(board);
    return play(engine, { r: 2, c: 2 }, { r: 2, c: 3 });
  };
  assert.equal(JSON.stringify(make().frames), JSON.stringify(make().frames));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node build.mjs --test && node --test tests/engine.test.js`
Expected: the six new tests fail (`landingCells` not exported, no flights, wrong positions).

- [ ] **Step 3: Types, helpers, activation**

In `src/engine/index.ts`:

1. `RemovalAnim` gains `'flown'`; `Effect` gains `| { kind: 'flight'; from: Pos; to: Pos }` (to is the landing anchor).
2. Add after `beamCells`:

```ts
// The four cells of the 2x2 a propeller pops, from its top-left anchor.
export function landingCells(anchor: Pos): Pos[] {
  return [
    { r: anchor.r, c: anchor.c },
    { r: anchor.r, c: anchor.c + 1 },
    { r: anchor.r + 1, c: anchor.c },
    { r: anchor.r + 1, c: anchor.c + 1 }
  ];
}

// Where a propeller lands: uniformly, from the seeded generator, among anchors
// whose block is on the board and not already being cleared; any anchor when
// nothing is left. Boards are at least 4x4, so an anchor always exists.
function propellerLanding(board: Board, rows: number, cols: number, toRemove: Set<string>, rng: RNG): Pos {
  const anchors: Pos[] = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) anchors.push({ r, c });
  }
  const free = anchors.filter(a => landingCells(a).every(p => board[p.r][p.c] && !toRemove.has(keyFor(p.r, p.c))));
  const pool = free.length > 0 ? free : anchors;
  return pool[rng.int(pool.length)];
}

// One propeller taking off: records the flight, claims its landing block, and
// marks the origin as flown. Shared by chain activation and every combo.
function launchPropeller(
  board: Board,
  rows: number,
  cols: number,
  origin: Pos,
  toRemove: Set<string>,
  animationClasses: Map<string, RemovalAnim>,
  effects: Effect[],
  rng: RNG
): Pos {
  const anchor = propellerLanding(board, rows, cols, toRemove, rng);
  effects.push({ kind: 'flight', from: { r: origin.r, c: origin.c }, to: anchor });
  claimCells(toRemove, animationClasses, landingCells(anchor), 'exploding');
  // The gem that flew is gone from its cell whatever lands there.
  toRemove.add(keyFor(origin.r, origin.c));
  animationClasses.set(keyFor(origin.r, origin.c), 'flown');
  return anchor;
}
```

3. `activateSpecialsInRemovalSet` gains a `rng: RNG` parameter before `processed`; update its three call sites to pass `state.rng` (in `cascadeWaves` and both call sites in `resolveMove`, where the variable is `state`). Add the branch after the rainbow branch:

```ts
      } else if (gem.special === SPECIAL.PROPELLER) {
        chainCount++;
        const before = new Set(toRemove);
        const anchor = launchPropeller(board, rows, cols, { r, c }, toRemove, animationClasses, stepEffects, rng);
        effects.push(...stepEffects.filter(e => e.kind === 'flight'));
        for (const pos of landingCells(anchor)) {
          const newKey = keyFor(pos.r, pos.c);
          if (before.has(newKey)) continue;
          stepPositions.push(pos);
          stepAnimations[newKey] = 'exploding';
          newSpecialsFound = true;
        }
        bonusPoints += 150;
      }
```

   (The flight effect must reach both `stepEffects`, which the page plays with the sub-step, and `effects`; `launchPropeller` pushes into the array it is given, so pass `stepEffects` and copy the flight into `effects`.)

- [ ] **Step 4: Combos**

In `resolveMove`, extend the flags:

```ts
      const isPropellerCombo = specials.every(s => s === SPECIAL.PROPELLER);
      const isPropellerCarry = specials.includes(SPECIAL.PROPELLER) && (specials.includes(SPECIAL.BOMB) || specials.includes(SPECIAL.LINE));
```

Inside the rainbow combo, add before its final `else`:

```ts
        } else if (otherSpecial === SPECIAL.PROPELLER) {
          // Every gem of the propeller's colour takes flight; later flights avoid
          // blocks earlier ones already claimed.
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const flock: Pos[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c]?.type === targetType) flock.push({ r, c });
            }
          }
          for (const origin of flock) launchPropeller(board, rows, cols, origin, toRemove, animationClasses, effects, state.rng);
          const rainbowPos = gem1IsRainbow ? keyFor(pos2.r, pos2.c) : keyFor(pos1.r, pos1.c);
          toRemove.add(rainbowPos);
          animationClasses.set(rainbowPos, 'rainbow-cleared');
          points = 2500 + toRemove.size * 20;
```

After the `isBombLineCombo` branch add:

```ts
      } else if (isPropellerCombo) {
        for (const origin of [pos1, pos2]) launchPropeller(board, rows, cols, origin, toRemove, animationClasses, effects, state.rng);
        points = 900 + toRemove.size * 12;
      } else if (isPropellerCarry) {
        // The propeller carries the other special to its landing and fires it there.
        // After the swap the propeller sits where the other gem started.
        const propellerPos = gem1Special === SPECIAL.PROPELLER ? { r: pos2.r, c: pos2.c } : { r: pos1.r, c: pos1.c };
        const carried = gem1Special === SPECIAL.PROPELLER ? gem2 : gem1;
        const anchor = launchPropeller(board, rows, cols, propellerPos, toRemove, animationClasses, effects, state.rng);
        if (carried?.special === SPECIAL.BOMB) {
          effects.push({ kind: 'explosion', r: anchor.r, c: anchor.c });
          const blast: Pos[] = [];
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = anchor.r + dr;
              const nc = anchor.c + dc;
              if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) blast.push({ r: nr, c: nc });
            }
          }
          claimCells(toRemove, animationClasses, blast, 'exploding');
        } else {
          const beam = beamCells(anchor, armsOf(carried), rows, cols);
          claimCells(toRemove, animationClasses, beam.cells, 'line-cleared');
          effects.push(...beam.effects);
        }
        points = 1100 + toRemove.size * 15;
      }
```

Add to the design comment above `if (bothAreSpecial)`:

```ts
    // - Propeller+Propeller: both fly
    // - Propeller+Bomb / Propeller+Beam: the propeller carries it to the landing
    // - Rainbow+Propeller: every gem of that color takes flight
```

- [ ] **Step 5: Run the tests, the typecheck and the suite**

Run: `node build.mjs --test && node --test tests/engine.test.js && npm run typecheck && npm test`
Expected: 57 engine tests; typecheck clean; 85 total.

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts tests/engine.test.js
git commit -m "Let the propeller fly to a seeded landing and pop a 2x2 there

When matched, caught in a blast, or swapped with another special, a
propeller records a flight from its cell to an anchor drawn from the
seeded generator among blocks not already being cleared, and its landing
joins the removal set. Combos derive from one helper: two propellers both
fly, a propeller carries a bomb or beam gem and fires it at the landing,
and a rainbow sends every gem of the propeller's colour flying.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Storage, glyph and the flight on the page

**Files:**
- Modify: `src/storage.ts` (`SPECIALS` ~133), `src/main.ts` (`showEffects` ~612-628, `playSubSteps` ~755-772, the `remove` case ~815-850), `src/styles.css` (flight classes after the propeller glyph rules Task 1 added, removal animations ~634-671, reduced motion ~1440+)
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `flight` effects, `layout`, `cellCenter`, `reducedMotion`, `gems`, `posIdx`, the `special-propeller` class and glyph Task 1 added (a flying clone inherits it via `cloneNode`).
- Produces: the `flown`/`flying` animation classes; `playFlights(effects): Promise<void>`.

- [ ] **Step 1: Storage**

Add to `tests/storage.test.js`, next to the arms-rejection cases:

```js
  const propeller = JSON.parse(json);
  propeller.board[0][0] = { type: 0, special: 'propeller', arms: null };
  assert.ok(parseSavedGame(JSON.stringify(propeller), expect), 'a propeller with no arms loads');

  const propellerArms = JSON.parse(json);
  propellerArms.board[0][0] = { type: 0, special: 'propeller', arms: 3 };
  assert.equal(parseSavedGame(JSON.stringify(propellerArms), expect), null, 'arms on a propeller');
```

Run `node build.mjs --test && node --test tests/storage.test.js` and see the first assertion fail; then in `src/storage.ts` change `SPECIALS` to `new Set<unknown>([null, 'bomb', 'line', 'rainbow', 'propeller'])`, and see it pass.

- [ ] **Step 2: Flight classes**

The `special-propeller` glyph and its legend entry already exist (Task 1 brought them forward so the structural test never went red). This step only adds the classes the flight animation drives.

In `src/styles.css`, after the propeller glyph rules add:

```css
/* The gem that took off: its flying copy carries the visual. */
.gem.flown {
  opacity: 0;
  transition: none;
}

.gem.flying {
  position: absolute;
  pointer-events: none;
  z-index: 60;
  will-change: transform;
}
```

- [ ] **Step 3: Flights on the page**

In `src/main.ts` add, near `showEffects`:

```ts
type FlightEffect = Extract<Effect, { kind: 'flight' }>;

function flightDuration(flight: FlightEffect): number {
  const dist = Math.hypot(flight.to.r + 0.5 - flight.from.r, flight.to.c + 0.5 - flight.from.c);
  return Math.min(900, 250 + 40 * dist);
}

// Sends a copy of each flying gem from its cell to the centre of its landing
// block, all at once, and resolves after the longest flight. The originals go
// out immediately. Under reduced motion nothing flies: the origin fades and the
// landing pops at once.
async function playFlights(effects: Effect[]): Promise<void> {
  const flights = effects.filter((e): e is FlightEffect => e.kind === 'flight');
  if (flights.length === 0) return;
  for (const flight of flights) gems[posIdx(flight.from.r, flight.from.c)]?.classList.add('flown');
  if (reducedMotion()) return;

  const step = layout.cell + layout.gap;
  const clones: Array<{ el: HTMLElement; dx: number; dy: number; ms: number }> = [];
  for (const flight of flights) {
    const source = gems[posIdx(flight.from.r, flight.from.c)];
    if (!source) continue;
    const el = source.cloneNode(true) as HTMLElement;
    el.classList.remove('flown', 'selected', 'swap-target', 'touching');
    el.classList.add('flying');
    const from = cellCenter(flight.from.r, flight.from.c);
    // Computed style is untransformed, which is what a rotated board needs.
    const size = parseFloat(getComputedStyle(source).width) || layout.cell - 6;
    el.style.left = `${from.x - size / 2}px`;
    el.style.top = `${from.y - size / 2}px`;
    el.style.transition = 'none';
    el.style.transform = '';
    clones.push({
      el,
      dx: (flight.to.c + 0.5 - flight.from.c) * step,
      dy: (flight.to.r + 0.5 - flight.from.r) * step,
      ms: flightDuration(flight)
    });
  }
  const fragment = document.createDocumentFragment();
  for (const c of clones) fragment.appendChild(c.el);
  boardEl.appendChild(fragment);
  void boardEl.offsetHeight;
  let longest = 0;
  for (const c of clones) {
    c.el.style.transition = `transform ${c.ms}ms var(--ease)`;
    c.el.style.transform = `translate(${c.dx}px, ${c.dy}px)`;
    longest = Math.max(longest, c.ms);
  }
  await sleep(longest);
  for (const c of clones) c.el.remove();
}
```

In `showEffects`, skip flights: change the loop body to `if (effect.kind === 'explosion') showExplosionEffect(effect.r, effect.c); else if (effect.kind === 'beam') beams.push(effect);`.

Sequencing. Chain flights belong to a sub-step and must play after that sub-step's trigger highlight; a combo's own flights belong to the frame and must play before the frame's first removal classes. The engine pushes the same flight object into both the sub-step's `effects` and the frame's `effects`, so identity tells them apart:
- In `playSubSteps`, after the `substepTrigger` sleep and before the classes are applied, insert `await playFlights(step.effects);`.
- In the `remove` case, compute once `const subStepEffects = new Set<Effect>(frame.subSteps?.flatMap(s => s.effects) ?? []);` and `const ownFlights = frame.effects.filter(e => !subStepEffects.has(e));`. In the no-sub-step branch insert `await playFlights(ownFlights);` before `applyRemovalAnimations(frame.positions, frame.animations)`; in the sub-step branch insert the same line before the initial `applyRemovalAnimations(initialPositions, ...)`.

- [ ] **Step 4: Typecheck, test, and walk**

Run: `npm run typecheck && npm test`
Expected: clean; 85 tests (the storage additions are assertions inside an existing test).

Build and serve; with the Playwright MCP at 1280x800:
1. Craft a saved game (v2, 8x8, gemTypes 5, cyclic non-matching fill `((r + c) % 3) + 1`) with a propeller of type 0 at (1,1), type 0 at (0,1) and (2,0), the rest cyclic; inject into `localStorage['zen-match:game']`, reload; the gem at row 1, column 1 shows the pinwheel (screenshot).
2. Install a `MutationObserver` on `#board` counting `.gem.flying` insertions; click cells 17 and 18 (row 2, columns 0 and 1) to complete column 1; expect one flying clone, a landing pop elsewhere, and after settle no gem with `flown`/`flying` left and no console errors.
3. Emulate reduced motion if the run_code tool allows (`page.emulateMedia({ reducedMotion: 'reduce' })`): the same swap produces no `.flying` element and the board settles.
4. 390x844 quick check of the pinwheel legibility.

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts src/main.ts src/styles.css tests/storage.test.js
git commit -m "Draw the propeller and fly it to its landing

A pinwheel overlay marks the propeller. When it goes off, a copy of the
gem crosses the board to the centre of its landing block over a duration
that scales with the distance, then the landing pops; the original fades
at once. Reduced motion skips the flight. Saved games accept the new
special with no arms.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Docs and release 2.4.0

**Files:**
- Modify: `index.html` (combining paragraph; the legend entry itself landed in Task 1), `README.md` (specials block ~27-39), `docs/project-log.md` (append), `docs/zen-match-feature-pipeline.md` (Phase 5), `package.json` + `package-lock.json`

- [ ] **Step 1: Legend and copy**

The Propeller legend entry already exists (Task 1). This step is just the combining paragraph, which needs the propeller's combo behaviour once Task 2 has defined it.

Replace the combining paragraph with:

```html
          <p>Swap two special gems together for something bigger. Two beam gems fire every arm either of them had, so a horizontal and a vertical line make a cross. A bomb with a beam gem fires each beam three wide. A rainbow with a beam gem gives every gem of that color the same beams, and they all fire. Two bombs make a wider blast, and a rainbow with a bomb sets off every gem of that color. A propeller carries a bomb or a beam gem to wherever it lands; two propellers both fly; a rainbow with a propeller sends every gem of that color flying.</p>
```

- [ ] **Step 2: README, log, pipeline, version**

README specials block: add after the Rainbow bullet `  - **Propeller**: a 2x2 block of one color - lifts away, lands somewhere else, and pops a 2x2 there` and append to the combos paragraph: `A propeller carries a bomb or a beam gem to where it lands, two propellers both fly, and a rainbow with a propeller sends every gem of that color flying.`

Append to `docs/project-log.md`:

```markdown
## 2.4 The propeller (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part D.

| # | Decision | Rationale |
|---|----------|-----------|
| D27 | A 2x2 of one colour is a match; its cells join the matcher's map so a square touching a run floods into one group, and precedence is rainbow, beam, propeller, line, bomb. | The 2x2 had no identity; the group model already existed, so the square is one more way to mark cells. |
| D28 | The propeller flies to an anchor drawn from the seeded generator among blocks not already being cleared, and pops the 2x2 there. | A gem that travels is spectacle to watch, and a seeded landing keeps `?seed=` boards reproducible. |
| D29 | Combos derive from one launch helper: two propellers both fly, a carried bomb or beam fires at the landing, a rainbow sends the whole colour flying. | The rainbow pattern from 2.1 (rainbow + X turns the colour into X) extended once more. |
```

In `docs/zen-match-feature-pipeline.md`, under `## Phase 5: Future Considerations`, append a subsection:

```markdown
### 5.4 Carried over from the 2026-09-03 spec (2.1 to 2.4)

- **Nova tier.** Groups of 9 or more at two or three colours all make one rainbow; a tier that turns a whole colour into bombs would make low-colour boards visibly different.
- **Board masks.** Holes, a diamond, a circle. Needs per-column refill paths.
- **Bloom refill.** Cleared gems regrow in place instead of falling. Cheap, but it removes the fall the philosophy names as the gift.
- **Tilt gravity.** `DeviceOrientationEvent` would let the board obey real tilt at any angle. Permission prompt and standalone-mode reliability keep it out.
- **Hex toy.** A sibling project, not a mode of this one.
```

Bump: `npm version 2.4.0 --no-git-tag-version`.

- [ ] **Step 3: Final walk and commit**

Run: `npm run typecheck && npm test && grep -n '"version"' package.json`
Expected: clean; 85 tests; `2.4.0`.

Build and serve; with the Playwright MCP at 1280x800 and 390x844: the help sheet shows the Propeller entry with a spinning pinwheel sample; the crafted-game flight from Task 3 still plays; `?gems=3&grid=10` for a couple of minutes of automated random legal moves (find pairs by clicking adjacent cells) produces at least one propeller creation and flight without console errors. Then commit:

```bash
git add index.html README.md docs/project-log.md docs/zen-match-feature-pipeline.md package.json package-lock.json
git commit -m "Document the propeller and release 2.4.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Release

After the final review: merge `claude/propeller` into `main` and push (Vercel deploys). On the live site confirm the legend, a crafted propeller flight, and that a 2.3 saved game resumes. Remove the worktree. This closes the 2026-09-03 spec.
