# Shapes, boards and long cascades

*Design spec, 2026-09-03. Approved in conversation; implementation follows the plan derived from this document.*

## Summary

Four independently shippable parts, built in this order:

| Part | What | Version |
|---|---|---|
| A | Arm gems: L, T and plus shapes get their own special, the line gem generalised | 2.1 |
| B | Lazy cascade waves (no wave cap), colours 2 and 3 in the sheet, hold-to-start for New Game | 2.2 |
| C | Turning boards: rectangles, rotation that follows the phone, a Turn control, bigger sizes, diffed rendering | 2.3 |
| D | The 2x2 match and the propeller | 2.4 |

Each part is a release on its own: engine tests, docs, help sheet, and a Playwright walk at the three reference viewports.

## Goals

- Give matched shapes an identity. Today an L or T makes the same bomb as a straight 4, and a 2x2 is not a match at all.
- Produce a gem that fires its row and column in one piece. The engine already activates a `cross` direction that nothing creates.
- Let a two- or three-colour board cascade for as long as it wants, without the page computing or holding more than one wave at a time.
- Allow rectangular and much larger boards, and treat the board as a physical object glued to the phone: turn the phone and the board turns with it while gravity stays with the world.
- Keep the philosophy: every addition is spectacle to watch, not strategy to optimise. Nothing adds pressure, timers, or judgement.

## Non-goals

- No autoplay or ambient self-play mode. Long cascades are the screensaver; the player still makes the moves.
- No hex grid. It is a different toy with its own matcher and move verb, and gets its own project.
- No tilt-sensor gravity via `DeviceOrientationEvent`. Orientation comes from the screen orientation API and a manual control; the sensor path needs a permission prompt that is unreliable in home-screen web apps.
- No new tiers above rainbow, no board masks, no in-place "bloom" refill. Listed under Deferred.

## Philosophy check

The design doc asks four questions of every feature. Arm gems, the propeller and turning boards create spectacle and reward noticing: the glyph on an arm gem shows what it will do, a propeller's flight is a thing to watch, and a turned board changes where gems come from without changing what a match is. Lazy waves remove a limit on watching. Hold-to-start removes a way to lose a game by accident. None of them add pressure or comparison.

---

## Part A: Arm gems

### Model

The line gem becomes the general beam gem. A cell's `direction` field is replaced by an arm mask:

```ts
type Special = null | 'bomb' | 'line' | 'rainbow' | 'propeller';
// Arms is a 4-bit mask. UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8. Board coordinates.
type Arms = number;
interface Cell { type: number; special: Special; arms?: Arms }
```

`arms` is present only when `special === 'line'`. The identifier `line` is kept for continuity of CSS classes and saved games; the help sheet names the four variants by their glyph: Line, Corner, Tee, Cross.

### Creation

For a connected group of matched cells of one colour, in this precedence:

| Group | Special | Bonus |
|---|---|---|
| 6 or more cells, any shape | Rainbow | 200 |
| Exactly 5 cells containing an intersection (a cell in both a horizontal and a vertical run) | Beam gem with arms from the intersection: L gives two adjacent arms, T three, plus four | 150 |
| Contains a 2x2 square, no intersection (Part D) | Propeller | 75 |
| Straight 5 | Beam gem with both arms along its axis (Line) | 100 |
| Straight 4 | Bomb | 50 |

The existing extra bonus of `(len - 3)^2 * 20` for groups over 3 stays. With exactly 5 cells and an intersection, the only possible shapes are L, T and plus, and there is exactly one intersection; a 4-run meeting a 3-run is 6 cells and is a rainbow, as today.

Arms for a complex shape are the directions from the intersection cell to its in-group neighbours. Arms for a straight run are both directions along the run's axis regardless of where the gem sits within the run.

### Placement

Complex shapes place the gem on the intersection cell. For a player-made L, T or plus the swapped cell is always the intersection, because two runs cannot both pre-exist without having matched already. In cascades the intersection is a sensible centre. Straight runs keep today's rule: the swapped cell if it is in the match, otherwise the cell nearest the centroid.

### Activation

When a beam gem fires (matched, caught in a blast, or swapped with another special), each arm clears a beam of cells from the gem to the board edge. The effect list gains:

```ts
{ kind: 'beam'; from: Pos; dir: 'up' | 'right' | 'down' | 'left' }
```

The renderer sweeps each beam outward from the gem. The existing full-row and full-column `line` effect is removed; a Line is two beams.

### Combos

Combos are defined by primitives, not by a hand-written table:

| Swap | Result |
|---|---|
| Beam + beam | One firing from the first-selected gem's starting cell (`pos1`, as today for line + line) with the union of both arm masks. Perpendicular lines still make a cross; parallel lines make one line. |
| Beam + bomb | Each arm fires three cells wide: the beam plus its two parallel neighbours, to the edge. For a straight Line this is today's three-row clear. |
| Beam + rainbow | Every gem of the rainbow's partner colour becomes a beam gem with the same arm mask; all fire. This generalises today's rainbow + line. |
| Bomb + bomb, rainbow + bomb, rainbow + rainbow | Unchanged. |
| Beam + propeller | See Part D. |

A rainbow caught in a blast behaves as today.

### Rendering

The glyph is thin bars from the gem's centre along each arm, drawn as an overlay on the colour shape so it survives every palette (decision D2). The rainbow's universal spin (D10) is unchanged. Arms are board-relative and turn with the board in Part C.

### Storage

Saved games move to `v: 2`. The validator accepts `v: 1` and migrates: `direction: 'horizontal'` becomes arms `LEFT | RIGHT`, `'vertical'` becomes `UP | DOWN`, and the never-created `'cross'` becomes all four. `arms` is validated as an integer in `1..15` present only on a `line` cell. Anything else is rejected, as today.

### Tests

- Each of L, T, plus and straight 5 creates a beam gem with the expected arm mask, on the expected cell, from a swap and from a cascade.
- Each arm mask fires the expected cells to the edge, including from a cell on the edge (zero-length arm).
- Every combo row above, plus determinism under a seed.
- Storage: v1 migration for each direction value; rejection of bad masks; round trip of v2.
- A structural test that every `Special` value and every arm variant has a help-sheet entry.

---

## Part B: Lazy waves, colour presets, hold to start

### Lazy waves

A move returns its frames as a generator rather than an array:

```ts
interface MoveResult {
  frames: IterableIterator<Frame>;
  readonly pointsEarned: number; // accumulates as frames are pulled; final when the iterator completes
}
```

Each pull computes at most one cascade wave: match, remove, drop, fill. Memory held between pulls is one board. `playFrames` already consumes frames with `for...of`, so the page changes only where it reads `pointsEarned`, which moves to after the loop.

`MAX_CASCADE_DEPTH` is removed. A cascade ends when the board settles with no matches. The dead-board rescue and shuffle stay as the tail of the generator. At two colours a cascade can genuinely run without end; that is the feature, and the page never blocks because each wave is animated before the next is computed.

Interrupting a cascade works as today: New Game supersedes the in-flight move through the run token, and the abandoned generator is returned so the engine does not hold it. The game is saved only when a board settles, as today; reloading mid-cascade resumes the last settled board.

Gravity (Part C) is read from engine state at the start of each wave's drop, so a turn during a cascade takes effect at the next wave.

### Colour presets

The settings sheet offers 2, 3, 4, 5, 6, 7 colours. Nothing else changes; the URL already allowed 2 to 10.

### Hold to start a new game

The toolbar's New Game requires a one-second press. A single tap does nothing but show the affordance.

- Pointer: `pointerdown` starts a 1000 ms timer and a fill ring that grows around the button for the duration. `pointerup`, `pointercancel`, `pointerleave` or `contextmenu` before completion cancels the timer and drains the ring. On completion the game dissolves and restarts exactly as today.
- Keyboard: holding Space or Enter for one second while the button is focused does the same. `keydown` with `repeat` set is ignored; `keyup` cancels.
- iOS: the button gets `touch-action: manipulation`, `-webkit-touch-callout: none` and `user-select: none`, and the `contextmenu` event is prevented, so the long press does not raise a callout.
- The button's accessible description says "Press and hold for one second". The settings sheet gains a plain-tap "Start new game" button under *This game* as the path for anyone who cannot hold, sitting behind a deliberate two-step so it cannot be hit by accident.
- The duration is `timing.holdToStart = 1000`. Reduced motion keeps the ring, since it is the progress indicator, and drops any pulse on completion.

### Tests

- Generator produces the same frame sequence as today's array for a fixed seed (golden comparison across the existing engine tests).
- A two-colour board produces more than 50 waves without the cap and without growth in retained frames.
- `pointsEarned` is zero before iteration and equals the summed wave points after.
- Hold: timer completes at 1000 ms; release at 900 ms cancels; `repeat` keydown ignored. Pure timer logic is unit-tested; the ring is checked in the Playwright walk.

---

## Part C: Turning boards

### Rectangles

The board is defined by `cols` and `rows` in the device's natural portrait frame: `cols` runs across the device's short side, `rows` down its long side. On a desktop the natural frame is the viewport at creation.

- Settings: `gridSize` is replaced by `cols` and `rows`. Existing settings migrate as `cols = rows = gridSize`.
- Sheet: a **Size** control for the short side, 6, 8, 10, 12, 16, 24, and a **Shape** control: Square or Tall. Tall makes the long side `round(short * 1.5)`: 9, 12, 15, 18, 24, 36.
- URL: `?grid=8x12` sets cols and rows; `?grid=8` remains square. Each side is clamped to 4..40. The URL is written back in the same form, omitting it at the default 8x8.
- Storage: the saved-game validator already checks rows and cols independently.

### Glued to the phone

Board coordinates are fixed to the device body: row 0 is at the device's natural top. The page reads `screen.orientation.angle` and its `change` event. The board element is rotated by the negative of that angle so it stays aligned with the body while the viewport rotates around it. Gravity is screen-down expressed in board coordinates, so new gems enter from whichever board edge is physically up.

Browsers without `screen.orientation` fall back to the `(orientation: landscape)` media query, treated as angle 90.

The engine gains a gravity parameter:

```ts
type Gravity = 'down' | 'up' | 'left' | 'right'; // the direction gems fall, in board coordinates
```

`dropGems` and the fill step generalise to the gravity axis; fill moves originate off-board beyond the edge opposite gravity. Matching, specials, arms and scoring are unaffected. Arms are board-relative, so a Corner's beams turn with the board, as a physical L would.

### Turn control

A toolbar button, Turn, and the R key add a quarter turn clockwise per press. Manual turns compose with the device angle: effective rotation is `deviceAngle + 90 * turns`, and the same pure function maps that to the board's CSS rotation and to the gravity direction. The manual turn count, mod 4, is saved in settings and restored on load; the device angle is always read live. Turn is available at all times, including mid-cascade.

This is the only way to invert on an iPhone, which never rotates its UI upside down, and the only rotation on a desktop.

### Timing

The visual turn animates over 600 ms with the zen easing (D4), instantly under reduced motion. Gravity changes from the next wave: live mid-cascade once Part B is in, at the next move before then.

### Input under rotation

Hit-testing follows CSS transforms, so taps land on the right cells with no change. Two things do not:

- Drag direction. Pointer deltas are in screen space; the swap target is chosen after rotating the delta by the negative of the effective rotation into board space.
- Arrow keys. Screen-relative arrows are mapped into board space the same way, so "right" on screen moves right on screen.

Fall and swap animations that compute offsets from `getBoundingClientRect` must instead compute in board space (cell size times cell delta), because a translate applied inside the rotated board element is rotated with it.

### Sizing and bigger boards

- The 560 px width cap is removed. The stage's available width and height are measured in the viewport, swapped when the effective rotation is 90 or 270, and the cell size is the largest that fits `cols` by `rows`, clamped to 12..72 px.
- The landscape-phone rail layout is unchanged; the rotated board occupies the space the square did.
- The render diffs: `renderBoard` keeps the last rendered cell per index (type, special, arms) and touches only elements whose cell changed. This closes tech debt TD5 and is required for 40x40 boards.
- Legibility beyond roughly 16 columns on a phone is not a goal; big boards are for tablets and desktops, and the toy still works if the cells are small.

### Sign verification

The orientation API's angle sign and the primary/secondary mapping differ across platforms. The mapping from `(deviceAngle, turns)` to `(cssRotation, gravity)` is a pure function unit-tested for all 16 combinations against a truth table, and the truth table itself is confirmed on Jerry's iPhone before release, not assumed; the iPad-only upside-down case is covered by the unit test and checked on an iPad when one is at hand.

### Tests

- Gravity in all four directions: drop and fill produce the expected boards and move lists; a seeded cascade is identical under 'down' to today's output.
- URL parsing and write-back for `8x12`, `8`, out-of-range and malformed values.
- Settings migration from `gridSize`.
- The orientation mapping function, all 16 cases.
- Pointer-delta and arrow-key mapping under each rotation.
- Playwright: 390x844 portrait, 844x390 landscape and 1280x800, plus a Turn press at each, checking the board's transform and that a swap by drag still reaches the intended neighbour.

---

## Part D: The 2x2 and the propeller

### Matching

`findMatches` marks the four cells of any 2x2 block of one colour as matched, alongside run cells. Groups still flood-fill through matched cells of the same colour, so a square touching a run of its colour merges with it. The precedence table in Part A decides what a group makes; a pure square is 4 cells with no intersection and makes a propeller.

`wouldMatchAt` also checks the four 2x2 windows that contain the cell, so refills and `settleBoard` avoid completing squares the same way they avoid completing runs. `isMoveValid` runs the matcher on a trial swap and inherits square detection unchanged. `ensurePlayableBoard` still plants a straight run.

### Placement

The propeller is placed on the swapped cell when it lies in the square, otherwise on the square cell nearest the group's centroid.

### Propeller

When matched, caught in a blast, or swapped with another special, the propeller lifts off, flies to a landing, and clears the 2x2 block anchored there. Specials at the landing chain as any blast does.

- Landing: choose uniformly, from the seeded generator, among 2x2 anchors whose four cells are all inside the board and outside the current removal set. If there is none, choose uniformly among all in-board anchors.
- The propeller's own cell is removed; it flew away.
- Effect: `{ kind: 'flight'; from: Pos; to: Pos }` where `to` is the anchor. The renderer moves the gem element to the centre of the landing block over `250 + 40 * distance` ms, capped at 900 ms, with the zen easing, then pops the four cells. Several propellers in one wave fly concurrently. Reduced motion fades the gem out at its origin and pops the landing.
- Glyph: a small pinwheel overlay that rotates slowly; static under reduced motion.

### Combos

| Swap | Result |
|---|---|
| Propeller + bomb | The propeller carries the bomb: at the landing, the 2x2 clears and the bomb fires centred on the anchor cell. |
| Propeller + beam | Carries the beam gem: the 2x2 clears and the arms fire from the anchor cell. |
| Propeller + propeller | Both fly, each to its own landing. |
| Propeller + rainbow | Every gem of the propeller's colour becomes a propeller and all fly. The rainbow is consumed. Matches today's rainbow + bomb and rainbow + line pattern. |

### Tests

- A 2x2 is found as a group of 4 and makes a propeller; a 2x3 block is 6 cells and makes a rainbow; a square sharing two cells with a 3-run is 5 cells without an intersection and makes a propeller.
- Refill never completes a square; the forced-placement fallback at two colours still terminates.
- A trial swap that only completes a square is a valid move.
- Landing selection excludes the removal set, falls back when the board is fully claimed, and is deterministic under a seed.
- Every combo row. Chains at the landing.

---

## Cross-cutting

### Data model summary

| Field | Today | After |
|---|---|---|
| `Cell.special` | `null / bomb / line / rainbow` | adds `propeller` |
| `Cell.direction` | `horizontal / vertical / cross` | removed |
| `Cell.arms` | absent | 4-bit mask on `line` cells |
| Saved game `v` | 1 | 2, with v1 migration |
| Settings `gridSize` | number | replaced by `cols`, `rows`; adds `turns` |
| Engine state | rows, cols, gemTypes, seed | adds `gravity` |
| Move result | `{ frames: Frame[], pointsEarned }` | `{ frames: iterator, pointsEarned }` |
| Effects | explosion, line | explosion, beam, flight |

### Help sheet and docs

- Help sheet: entries for Line, Corner, Tee, Cross and Propeller with their glyphs; the combo paragraph rewritten in terms of the tables above; a line each for Turn and for hold-to-start.
- README: the specials list, the settings and URL sections (`?grid=8x12`, colours 2 to 7 in the sheet, sides to 40), and the cascade paragraph, which no longer mentions a cap.
- Project log: decisions D17 onward for the arm family, lazy waves, hold-to-start, glued-board orientation, and the propeller. TD5 closed in Part C.
- Pipeline doc: Deferred items below recorded under Future Considerations; hex noted as its own toy.

### Accessibility

Arm and propeller glyphs are shape overlays and work in every palette. Reduced motion is honoured by the turn animation, the flight, the pinwheel, and the hold ring's completion pulse. Hold-to-start has a keyboard path and a plain-tap alternative in the sheet. Turn has a key. Rotated boards keep screen-relative arrow keys.

### Releases

Each part ships from its own branch off `main`, merged after its review, with the version in `package.json` bumped as in the summary table. Deploy is unchanged: push to `main`, Vercel builds, `zen.ghsj.me` updates.

---

## Deferred

- **Nova tier.** Groups of 9 or more at two or three colours all make one rainbow; a tier that turns a whole colour into bombs would make low-colour boards visibly different.
- **Board masks.** Holes, a diamond, a circle. Needs per-column refill paths; only after rectangles.
- **Bloom refill.** Cleared gems regrow in place instead of falling. Cheap, but it removes the fall the philosophy names as the gift.
- **Tilt gravity.** `DeviceOrientationEvent` would let the board obey real tilt at any angle, including upside down on an iPhone. Permission prompt and standalone-mode reliability keep it out for now.
- **Hex toy.** A sibling project, not a mode of this one.
