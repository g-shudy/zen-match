export const SPECIAL = {
  NONE: null,
  BOMB: 'bomb',
  LINE: 'line',
  RAINBOW: 'rainbow',
  PROPELLER: 'propeller'
} as const;

export type Special = typeof SPECIAL[keyof typeof SPECIAL];

export interface Cell {
  type: number;
  special: Special;
  arms: Arms | null; // 1..15 on a beam gem, null otherwise
}

export type Board = (Cell | null)[][];

export interface Pos {
  r: number;
  c: number;
}

// A beam gem fires along its arms, one bit each, in board coordinates. A straight
// five makes the two opposite arms of its axis; an L makes two adjacent arms, a T
// three, a plus all four.
export const ARM = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8 } as const;
export const ARMS_HORIZONTAL: number = ARM.LEFT | ARM.RIGHT;
export const ARMS_VERTICAL: number = ARM.UP | ARM.DOWN;
export const ARMS_ALL: number = ARM.UP | ARM.RIGHT | ARM.DOWN | ARM.LEFT;
export type Arms = number;
export type BeamDir = 'up' | 'right' | 'down' | 'left';

const ARM_STEPS: ReadonlyArray<{ arm: number; dr: number; dc: number; dir: BeamDir }> = [
  { arm: ARM.UP, dr: -1, dc: 0, dir: 'up' },
  { arm: ARM.RIGHT, dr: 0, dc: 1, dir: 'right' },
  { arm: ARM.DOWN, dr: 1, dc: 0, dir: 'down' },
  { arm: ARM.LEFT, dr: 0, dc: -1, dir: 'left' }
];

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

export class RNG {
  private state: number;

  constructor(seed: number = Date.now()) {
    this.state = seed >>> 0;
  }

  next(): number {
    // LCG: Numerical Recipes constants
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }
}

export interface EngineConfig {
  rows: number;
  cols: number;
  gemTypes: number;
  seed?: number;
  gravity?: Gravity;
}

export interface EngineState {
  rows: number;
  cols: number;
  gemTypes: number;
  board: Board;
  rng: RNG;
  lastSwapPos: { r1: number; c1: number; r2: number; c2: number } | null;
  gravity: Gravity;
}

export type RemovalAnim = 'matched' | 'exploding' | 'line-cleared' | 'rainbow-cleared' | 'flown';

// A gem leaving `from` for the 2x2 anchored at `to`. Named so the helper that
// records one can hand it back to callers that need the anchor.
export type FlightEffect = { kind: 'flight'; from: Pos; to: Pos };

export type Effect =
  | { kind: 'explosion'; r: number; c: number }
  | { kind: 'beam'; from: Pos; dir: BeamDir }
  | FlightEffect;

export interface ScoreBreakdown {
  base: number;
  matchBonus: number;
  comboMultiplier: number;
}

export interface ScoreEvent {
  points: number;
  combo: number;
  breakdown: ScoreBreakdown;
  isBonus: boolean;
}

export interface RemovalSubStep {
  triggerPos: Pos;
  positions: Pos[];
  animations: Record<string, RemovalAnim>;
  effects: Effect[];
}

export interface GemMove {
  from: Pos;
  to: Pos;
  type: number;
}

export type Frame =
  | { kind: 'swap'; board: Board }
  | { kind: 'invalid'; positions: Pos[] }
  | { kind: 'remove'; positions: Pos[]; animations: Record<string, RemovalAnim>; effects: Effect[]; score: ScoreEvent; subSteps?: RemovalSubStep[] }
  | { kind: 'board'; board: Board; newSpecials?: Pos[] }
  | { kind: 'drop'; board: Board; moves: GemMove[] }
  | { kind: 'fill'; board: Board; moves: GemMove[] }
  | { kind: 'preview'; board: Board; pendingPositions: Pos[] }
  | { kind: 'shuffle'; board: Board; attempt: number; moves?: GemMove[] };

export interface MoveResult {
  // The swap itself is applied when swap() returns, so validity is known at once.
  // Frames are then produced one cascade wave at a time as the caller pulls them;
  // the engine holds at most one wave. Leaving a for...of early closes the
  // generator and the board stays exactly as the last pulled wave left it, which
  // may include live matches (or, until the board frame that follows an invalid
  // frame, an un-reverted invalid swap). A caller that stops early must reset the
  // engine or drain the move before calling swap() again on the same game; after
  // reset() the abandoned move only ever touches the state it started with.
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

// There is no cap on cascade waves. A move's frames are a generator, so a
// two-colour board that cascades for minutes costs one wave of work per pull and
// one board of memory; the old 50-wave cap existed only because every wave was
// computed and stored up front.

interface MatchGroup {
  positions: Pos[];
  effectiveLen: number;
  direction: 'horizontal' | 'vertical' | 'both';
  type: number;
  intersection: Pos | null; // the cell shared by a horizontal and a vertical run, when there is one
  square: Pos | null; // anchor (top-left) of the first 2x2 in the group
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

export function serializeBoard(board: Board): string {
  return JSON.stringify(board);
}

export function deserializeBoard(serialized: string): Board {
  return JSON.parse(serialized) as Board;
}

export function boardToTypeString(board: Board): string {
  return board
    .map(row => row.map(cell => (cell ? String(cell.type) : '.')).join(''))
    .join('\n');
}

function keyFor(r: number, c: number): string {
  return `${r},${c}`;
}

export interface BeamResult {
  cells: Pos[];
  effects: Effect[];
}

// Every cell a beam gem at `origin` clears, plus one `beam` effect per sweep to draw.
// Each arm runs from the gem to the board edge. `halfWidth` widens every arm
// symmetrically (1 makes it three cells wide, the bomb + beam combo). The origin is
// always included so the result is the full footprint; an arm that points straight
// off the board draws no sweep and adds nothing beyond the widened cells beside the origin.
export function beamCells(origin: Pos, arms: Arms, rows: number, cols: number, halfWidth = 0): BeamResult {
  const seen = new Set<string>();
  const cells: Pos[] = [];
  const effects: Effect[] = [];
  const inBounds = (r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols;
  const push = (r: number, c: number): void => {
    if (!inBounds(r, c)) return;
    const key = keyFor(r, c);
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ r, c });
  };

  push(origin.r, origin.c);

  for (const step of ARM_STEPS) {
    if (!(arms & step.arm)) continue;
    for (let w = -halfWidth; w <= halfWidth; w++) {
      // Shift sideways: columns for a vertical arm, rows for a horizontal one.
      const r0 = origin.r + (step.dr === 0 ? w : 0);
      const c0 = origin.c + (step.dc === 0 ? w : 0);
      if (!inBounds(r0, c0)) continue;
      // The widened footprint beside the origin belongs to the arm even when the arm
      // has nowhere to go, so a three-wide beam at the board edge still clears the
      // cells next to the gem.
      push(r0, c0);
      if (!inBounds(r0 + step.dr, c0 + step.dc)) continue; // zero-length: nothing to sweep
      effects.push({ kind: 'beam', from: { r: r0, c: c0 }, dir: step.dir });
      for (let k = 1; inBounds(r0 + step.dr * k, c0 + step.dc * k); k++) {
        push(r0 + step.dr * k, c0 + step.dc * k);
      }
    }
  }

  return { cells, effects };
}

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
// marks the origin as flown. Shared by chain activation and every combo. Returns
// the flight it pushed, so a caller wanting the anchor reads `.to` and a caller
// wanting the effect in a second array pushes the same object.
function launchPropeller(
  board: Board,
  rows: number,
  cols: number,
  origin: Pos,
  toRemove: Set<string>,
  animationClasses: Map<string, RemovalAnim>,
  effects: Effect[],
  rng: RNG
): FlightEffect {
  const anchor = propellerLanding(board, rows, cols, toRemove, rng);
  const flight: FlightEffect = { kind: 'flight', from: { r: origin.r, c: origin.c }, to: anchor };
  effects.push(flight);
  claimCells(toRemove, animationClasses, landingCells(anchor), 'exploding');
  // The gem that flew is gone from its cell whatever lands there.
  toRemove.add(keyFor(origin.r, origin.c));
  animationClasses.set(keyFor(origin.r, origin.c), 'flown');
  return flight;
}

function isSpecial(cell: Cell | null): boolean {
  return !!cell?.special;
}

function isRainbow(cell: Cell | null): boolean {
  return cell?.special === SPECIAL.RAINBOW;
}

function createEmptyBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

// Pick a gem type that does not immediately complete a 3-run with cells already
// placed, or the three cells that would close a 2x2 with this one. Fill order
// runs from the entry edge inward, so "already placed" means
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
  // The cell that closes a 2x2 with `behind` and `beside`: already placed too.
  const diagonal = (): number | undefined =>
    board[r - step.dr - (vertical ? 0 : 1)]?.[c - step.dc - (vertical ? 1 : 0)]?.type;
  let type = 0;
  let attempts = 0;
  do {
    type = rng.int(gemTypes);
    attempts++;
  } while (
    attempts < 50 &&
    ((behind(1) === type && behind(2) === type) || (beside(1) === type && beside(2) === type) ||
      (behind(1) === type && beside(1) === type && diagonal() === type))
  );
  return type;
}

export class Engine {
  state: EngineState;

  constructor(config: EngineConfig) {
    const rng = new RNG(config.seed ?? Date.now());
    this.state = {
      rows: config.rows,
      cols: config.cols,
      gemTypes: config.gemTypes,
      board: createEmptyBoard(config.rows, config.cols),
      rng,
      lastSwapPos: null,
      gravity: config.gravity ?? 'down'
    };
  }

  reset(config: Partial<EngineConfig> = {}): void {
    const prev = this.state;
    const rows = typeof config.rows === 'number' ? config.rows : prev.rows;
    const cols = typeof config.cols === 'number' ? config.cols : prev.cols;
    const gemTypes = typeof config.gemTypes === 'number' ? config.gemTypes : prev.gemTypes;
    const rng = typeof config.seed === 'number' ? new RNG(config.seed) : prev.rng;
    const gravity = config.gravity ?? prev.gravity;
    // A fresh object: a generator left over from an abandoned move keeps the old
    // state and can never touch the board of the game that replaced it.
    this.state = { rows, cols, gemTypes, board: createEmptyBoard(rows, cols), rng, lastSwapPos: null, gravity };
  }

  init(): Board {
    const { rows, cols } = this.state;
    const board = createEmptyBoard(rows, cols);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = {
          type: this.randomGem(board, r, c),
          special: SPECIAL.NONE,
          arms: null
        };
      }
    }

    let attempts = 0;
    while (findMatches(board, rows, cols).length > 0 && attempts < 100) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          board[r][c] = {
            type: this.randomGem(board, r, c),
            special: SPECIAL.NONE,
            arms: null
          };
        }
      }
      attempts++;
    }

    ensurePlayableBoard(board, rows, cols, this.state.gemTypes, this.state.rng);

    this.state.board = board;
    return cloneBoard(board);
  }

  setBoard(board: Board): void {
    this.state.board = cloneBoard(board);
  }

  setGravity(gravity: Gravity): void {
    this.state.gravity = gravity;
  }

  swap(pos1: Pos, pos2: Pos): MoveResult {
    // Bind the state this move owns. reset() installs a fresh object, so a move
    // abandoned mid-flight keeps working on the board it started on, never on the
    // game that replaced it.
    const state = this.state;
    const { rows, cols, board } = state;
    const tally: Tally = { points: 0 };

    if (!board[pos1.r]?.[pos1.c] || !board[pos2.r]?.[pos2.c]) {
      return { frames: (function* (): Generator<Frame, void, undefined> {})(), pointsEarned: 0, moveValid: false };
    }

    state.lastSwapPos = { r1: pos1.r, c1: pos1.c, r2: pos2.r, c2: pos2.c };

    const gem1 = board[pos1.r][pos1.c];
    const gem2 = board[pos2.r][pos2.c];

    // Apply the swap now, so validity is known before any frame is pulled.
    [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];

    const bothAreSpecial = isSpecial(gem1) && isSpecial(gem2);
    const rainbowSwap = isRainbow(gem1) || isRainbow(gem2);
    const moveValid = bothAreSpecial || rainbowSwap || findMatches(board, rows, cols).length > 0;

    const frames = this.resolveMove(state, pos1, pos2, gem1, gem2, moveValid, tally);
    return {
      frames,
      get pointsEarned() {
        return tally.points;
      },
      moveValid
    };
  }

  // `state` is the state the move was made against, not `this.state`: an abandoned
  // move must never write to the board of the game that replaced it.
  private *resolveMove(
    state: EngineState,
    pos1: Pos,
    pos2: Pos,
    gem1: Cell | null,
    gem2: Cell | null,
    moveValid: boolean,
    tally: Tally
  ): Generator<Frame, void, undefined> {
    const { rows, cols, board } = state;

    yield { kind: 'swap', board: cloneBoard(board) };

    if (!moveValid) {
      yield { kind: 'invalid', positions: [pos1, pos2] };
      [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];
      yield { kind: 'board', board: cloneBoard(board) };
      yield* rescueDeadBoard(state, tally);
      state.lastSwapPos = null;
      return;
    }

    const gem1Special = gem1?.special;
    const gem2Special = gem2?.special;
    const bothAreSpecial = isSpecial(gem1) && isSpecial(gem2);

    // Design decision: When two specials are swapped, they always interact with
    // a combined effect rather than requiring a match. This follows the Candy Crush
    // convention where special+special swaps are powerful combo moves that reward
    // players for setting them up adjacently. The interaction rules:
    // - Rainbow+Rainbow: clears both colors
    // - Rainbow+Bomb: all gems of that color explode (3x3 each)
    // - Rainbow+Beam: all gems of that color fire the beam gem's arms
    // - Bomb+Bomb: 5x5 explosion
    // - Beam+Beam: the union of both arm masks, fired from pos1
    // - Bomb+Beam: each arm fired three cells wide
    // - Propeller+Propeller: both fly
    // - Propeller+Bomb / Propeller+Beam: the propeller carries it to the landing
    // - Rainbow+Propeller: every gem of that color takes flight
    if (bothAreSpecial) {
      const specials = [gem1Special, gem2Special];
      const isRainbowCombo = specials.includes(SPECIAL.RAINBOW);
      const isBombCombo = specials.every(s => s === SPECIAL.BOMB);
      const isLineCombo = specials.every(s => s === SPECIAL.LINE);
      const isBombLineCombo = specials.includes(SPECIAL.BOMB) && specials.includes(SPECIAL.LINE);
      const isPropellerCombo = specials.every(s => s === SPECIAL.PROPELLER);
      const isPropellerCarry = specials.includes(SPECIAL.PROPELLER) && (specials.includes(SPECIAL.BOMB) || specials.includes(SPECIAL.LINE));

      const toRemove = new Set<string>();
      const animationClasses = new Map<string, RemovalAnim>();
      const effects: Effect[] = [];
      let points = 0;
      let chainReactionCount = 0;

      // Both swapped specials are consumed by the combo, whatever shape it fires.
      toRemove.add(keyFor(pos1.r, pos1.c));
      toRemove.add(keyFor(pos2.r, pos2.c));

      // Seeded with the same two: they are consumed BY the combo below, and without
      // this they detonate a second time on top of it, inflating both the cleared
      // area and the score. A combo that launches other gems adds those here too, so
      // a gem consumed by its own flight never fires again.
      const processed = new Set([keyFor(pos1.r, pos1.c), keyFor(pos2.r, pos2.c)]);

      if (isRainbowCombo) {
        const gem1IsRainbow = gem1Special === SPECIAL.RAINBOW;
        const gem2IsRainbow = gem2Special === SPECIAL.RAINBOW;
        const otherSpecial = gem1IsRainbow ? gem2Special : gem1Special;
        // After the swap the rainbow sits where the other gem started.
        const rainbowPos = gem1IsRainbow ? keyFor(pos2.r, pos2.c) : keyFor(pos1.r, pos1.c);

        if (gem1IsRainbow && gem2IsRainbow) {
          const color1 = gem1?.type ?? 0;
          const color2 = gem2?.type ?? 0;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c] && (board[r][c]?.type === color1 || board[r][c]?.type === color2)) {
                toRemove.add(keyFor(r, c));
                animationClasses.set(keyFor(r, c), 'rainbow-cleared');
              }
            }
          }
          toRemove.add(keyFor(pos1.r, pos1.c));
          toRemove.add(keyFor(pos2.r, pos2.c));
          animationClasses.set(keyFor(pos1.r, pos1.c), 'rainbow-cleared');
          animationClasses.set(keyFor(pos2.r, pos2.c), 'rainbow-cleared');
          points = 1000 + toRemove.size * 15;
        } else if (otherSpecial === SPECIAL.BOMB) {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const colorPositions: Pos[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (keyFor(r, c) !== rainbowPos && board[r][c]?.type === targetType) {
                colorPositions.push({ r, c });
              }
            }
          }

          for (const pos of colorPositions) {
            effects.push({ kind: 'explosion', r: pos.r, c: pos.c });
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nr = pos.r + dr;
                const nc = pos.c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc]) {
                  const k = keyFor(nr, nc);
                  toRemove.add(k);
                  animationClasses.set(k, 'exploding');
                }
              }
            }
          }

          points = 2000 + toRemove.size * 20;
        } else if (otherSpecial === SPECIAL.LINE) {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const lineGem = gem1IsRainbow ? gem2 : gem1;
          const arms = armsOf(lineGem);

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (keyFor(r, c) === rainbowPos || board[r][c]?.type !== targetType) continue;
              const beam = beamCells({ r, c }, arms, rows, cols);
              claimCells(toRemove, animationClasses, beam.cells, 'line-cleared');
              effects.push(...beam.effects);
            }
          }

          points = 2500 + toRemove.size * 20;
        } else if (otherSpecial === SPECIAL.PROPELLER) {
          // Every gem of the propeller's colour takes flight; later flights avoid
          // blocks earlier ones already claimed. The rainbow carries a colour of its
          // own, so it is skipped here and consumed as a rainbow below.
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const flock: Pos[] = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (keyFor(r, c) !== rainbowPos && board[r][c]?.type === targetType) flock.push({ r, c });
            }
          }
          for (const origin of flock) {
            launchPropeller(board, rows, cols, origin, toRemove, animationClasses, effects, state.rng);
            // A flight each, and nothing more: a gem the flock consumed never fires
            // again, whatever special it was carrying.
            processed.add(keyFor(origin.r, origin.c));
          }
          points = 2500 + toRemove.size * 20;
        } else {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c]?.type === targetType) {
                const k = keyFor(r, c);
                toRemove.add(k);
                animationClasses.set(k, 'rainbow-cleared');
              }
            }
          }
          points = 500 + toRemove.size * 10;
        }

        // Every branch consumes the rainbow itself. `toRemove` already holds both
        // swapped cells, so this only fixes the class; the size each `points` above
        // read is unchanged.
        toRemove.add(rainbowPos);
        animationClasses.set(rainbowPos, 'rainbow-cleared');
      } else if (isBombCombo) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = pos1.r + dr;
            const nc = pos1.c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc]) {
              const k = keyFor(nr, nc);
              toRemove.add(k);
              animationClasses.set(k, 'exploding');
            }
          }
        }
        effects.push({ kind: 'explosion', r: pos1.r, c: pos1.c });
        points = 1000 + toRemove.size * 15;
      } else if (isLineCombo) {
        const arms = armsOf(gem1) | armsOf(gem2);
        const beam = beamCells({ r: pos1.r, c: pos1.c }, arms, rows, cols);
        claimCells(toRemove, animationClasses, beam.cells, 'line-cleared');
        effects.push(...beam.effects);
        points = 800 + toRemove.size * 12;
      } else if (isBombLineCombo) {
        const lineGem = gem1Special === SPECIAL.LINE ? gem1 : gem2;
        // After the swap the beam gem sits where the other gem started.
        const linePos = gem1Special === SPECIAL.LINE ? { r: pos2.r, c: pos2.c } : { r: pos1.r, c: pos1.c };
        const beam = beamCells(linePos, armsOf(lineGem), rows, cols, 1);
        claimCells(toRemove, animationClasses, beam.cells, 'line-cleared');
        effects.push(...beam.effects);
        points = 1200 + toRemove.size * 15;
      } else if (isPropellerCombo) {
        for (const origin of [pos1, pos2]) launchPropeller(board, rows, cols, origin, toRemove, animationClasses, effects, state.rng);
        // As in every combo above, `toRemove.size` is the count before any chaining:
        // specials the landings claim add their cells afterwards and are paid for by
        // the chain bonus, not by this formula. Same for the carry below.
        points = 900 + toRemove.size * 12;
      } else if (isPropellerCarry) {
        // The propeller carries the other special to its landing and fires it there.
        // After the swap the propeller sits where the other gem started.
        const propellerPos = gem1Special === SPECIAL.PROPELLER ? { r: pos2.r, c: pos2.c } : { r: pos1.r, c: pos1.c };
        const carried = gem1Special === SPECIAL.PROPELLER ? gem2 : gem1;
        const anchor = launchPropeller(board, rows, cols, propellerPos, toRemove, animationClasses, effects, state.rng).to;
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

      // `processed` already holds everything the combo above consumed, so none of it
      // fires a second time. Mirrors the rainbow+normal path below.
      const { bonusPoints, chainCount } = activateSpecialsInRemovalSet(
        board,
        toRemove,
        animationClasses,
        rows,
        cols,
        effects,
        state.rng,
        processed
      );
      chainReactionCount += chainCount;
      points += bonusPoints;

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

      const dropMoves = dropGems(board, rows, cols, state.gravity);
      if (dropMoves.length > 0) yield { kind: 'drop', board: cloneBoard(board), moves: dropMoves };

      const fillMoves = fillGems(board, rows, cols, state.gemTypes, state.rng, state.gravity);
      if (fillMoves.length > 0) yield { kind: 'fill', board: cloneBoard(board), moves: fillMoves };
    } else if (gem1Special === SPECIAL.RAINBOW || gem2Special === SPECIAL.RAINBOW) {
      const gem1IsRainbow = gem1Special === SPECIAL.RAINBOW;
      const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
      const rainbowPos = gem1IsRainbow ? pos2 : pos1;

      const toRemove = new Set<string>();
      const animationClasses = new Map<string, RemovalAnim>();
      const effects: Effect[] = [];

      // Clear all gems matching the non-rainbow gem's color
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c]?.type === targetType) {
            const k = keyFor(r, c);
            toRemove.add(k);
            animationClasses.set(k, 'rainbow-cleared');
          }
        }
      }

      const rainbowKey = keyFor(rainbowPos.r, rainbowPos.c);
      toRemove.add(rainbowKey);
      animationClasses.set(rainbowKey, 'rainbow-cleared');

      const processed = new Set<string>();
      processed.add(rainbowKey);
      const { bonusPoints, chainCount } = activateSpecialsInRemovalSet(
        board,
        toRemove,
        animationClasses,
        rows,
        cols,
        effects,
        state.rng,
        processed
      );

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

      const dropMoves = dropGems(board, rows, cols, state.gravity);
      if (dropMoves.length > 0) yield { kind: 'drop', board: cloneBoard(board), moves: dropMoves };

      const fillMoves = fillGems(board, rows, cols, state.gemTypes, state.rng, state.gravity);
      if (fillMoves.length > 0) yield { kind: 'fill', board: cloneBoard(board), moves: fillMoves };
    }

    // Every valid move ends the same way: cascade until the board settles, then
    // reshuffle if it settled with no legal move left.
    yield* cascadeWaves(state, tally);
    if (!hasValidMoves(board, rows, cols)) yield* shuffleWaves(state, 0, tally);

    state.lastSwapPos = null;
  }

  hasValidMoves(): boolean {
    return hasValidMoves(this.state.board, this.state.rows, this.state.cols);
  }

  findValidMove(): { r1: number; c1: number; r2: number; c2: number } | null {
    return findValidMove(this.state.board, this.state.rows, this.state.cols);
  }

  private randomGem(board: Board, r: number, c: number): number {
    return pickNonMatchingType(board, r, c, this.state.gemTypes, this.state.rng);
  }
}

function positionsFromSet(toRemove: Set<string>): Pos[] {
  return Array.from(toRemove).map(key => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

function mapToRecord(map: Map<string, RemovalAnim>): Record<string, RemovalAnim> {
  const record: Record<string, RemovalAnim> = {};
  for (const [key, value] of map.entries()) {
    record[key] = value;
  }
  return record;
}

function removePositions(board: Board, toRemove: Set<string>): void {
  for (const key of toRemove) {
    const [r, c] = key.split(',').map(Number);
    board[r][c] = null;
  }
}

// One cell joining the removal set, and the single place `'flown'` is kept sticky:
// a gem that flew away is gone whatever lands on its cell afterwards, so a later
// landing, blast or beam claims the cell without restyling it. Every write that can
// fall on a cell some gem already flew out of goes through here; `launchPropeller`
// sets the sticky value itself rather than over it.
function markForRemoval(toRemove: Set<string>, animationClasses: Map<string, RemovalAnim>, key: string, anim: RemovalAnim): void {
  toRemove.add(key);
  if (animationClasses.get(key) === 'flown') return;
  animationClasses.set(key, anim);
}

// Claim every cell of a beam sweep into the removal set with one animation class.
// Shared by the three swap-combo branches that fire a beam gem's arms (rainbow+beam,
// beam+beam, bomb+beam) so the four-line loop is not repeated three times.
function claimCells(toRemove: Set<string>, animationClasses: Map<string, RemovalAnim>, cells: Pos[], anim: RemovalAnim): void {
  for (const pos of cells) markForRemoval(toRemove, animationClasses, keyFor(pos.r, pos.c), anim);
}

// A beam gem always carries arms once it exists; the fallback only guards a cell
// that reached the engine without them, and every path must agree on it.
function armsOf(cell: Cell | null | undefined): Arms {
  return cell?.arms ?? ARMS_HORIZONTAL;
}

export function findMatches(board: Board, rows: number, cols: number): MatchGroup[] {
  const matchedCells = new Map<string, { r: number; c: number; type: number; direction: 'horizontal' | 'vertical' | 'square'; isComplex?: boolean; square?: Pos }>();

  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!board[r][c]) { c++; continue; }

      const type = board[r][c]!.type;
      let endC = c + 1;
      while (endC < cols && board[r][endC]?.type === type) {
        endC++;
      }

      const len = endC - c;
      if (len >= 3) {
        for (let i = c; i < endC; i++) {
          const key = keyFor(r, i);
          if (!matchedCells.has(key)) {
            matchedCells.set(key, { r, c: i, type, direction: 'horizontal' });
          } else {
            // Unreachable: runs within a row are non-overlapping (c jumps to endC).
            matchedCells.get(key)!.isComplex = true;
          }
        }
      }
      c = endC;
    }
  }

  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!board[r][c]) { r++; continue; }

      const type = board[r][c]!.type;
      let endR = r + 1;
      while (endR < rows && board[endR][c]?.type === type) {
        endR++;
      }

      const len = endR - r;
      if (len >= 3) {
        for (let i = r; i < endR; i++) {
          const key = keyFor(i, c);
          if (!matchedCells.has(key)) {
            matchedCells.set(key, { r: i, c, type, direction: 'vertical' });
          } else {
            // Cell is in both a horizontal and a vertical run: an L/T intersection.
            matchedCells.get(key)!.isComplex = true;
          }
        }
      }
      r = endR;
    }
  }

  // A 2x2 of one colour is a match in its own right. Its cells join the same
  // map, so a square touching a run of its colour floods into one group.
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const type = cell.type;
      if (board[r][c + 1]?.type !== type || board[r + 1][c]?.type !== type || board[r + 1][c + 1]?.type !== type) continue;
      // A cell in two overlapping squares keeps the first anchor, and a group with
      // two squares keeps whichever of them its BFS reaches first. Neither choice is
      // observable: such a group spans six or more cells, so the ladder gives it a
      // rainbow and never asks for the anchor.
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

  if (matchedCells.size === 0) return [];

  const matches: MatchGroup[] = [];
  const visited = new Set<string>();

  for (const [key, data] of matchedCells) {
    if (visited.has(key)) continue;

    const match: Pos[] = [];
    const queue = [key];
    let intersection: Pos | null = null;
    let square: Pos | null = null;
    let hDir = false;
    let vDir = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const cellData = matchedCells.get(current);
      if (!cellData) continue;

      match.push({ r: cellData.r, c: cellData.c });
      if (cellData.isComplex && !intersection) {
        intersection = { r: cellData.r, c: cellData.c };
      }
      if (cellData.square && !square) square = cellData.square;
      if (cellData.direction === 'horizontal') hDir = true;
      if (cellData.direction === 'vertical') vDir = true;

      const [cr, cc] = current.split(',').map(Number);
      const neighbors = [
        keyFor(cr - 1, cc), keyFor(cr + 1, cc),
        keyFor(cr, cc - 1), keyFor(cr, cc + 1)
      ];

      for (const neighbor of neighbors) {
        if (matchedCells.has(neighbor) && !visited.has(neighbor)) {
          const neighborData = matchedCells.get(neighbor)!;
          if (neighborData.type === cellData.type) {
            queue.push(neighbor);
          }
        }
      }
    }

    // `direction` reads 'vertical' for a pure-square group: every cell of one
    // carries direction 'square', so neither hDir nor vDir is ever set. Nothing
    // reads `direction` on that path — the ladder tests `square` first, and only
    // the straight-five branch below it asks which way a group runs.
    // Phase 3A: Always use actual group cell count for effectiveLen
    matches.push({
      positions: match,
      effectiveLen: match.length,
      direction: hDir && vDir ? 'both' : (hDir ? 'horizontal' : 'vertical'),
      type: data.type,
      intersection,
      square
    });
  }

  return matches;
}

function activateSpecialsInRemovalSet(
  board: Board,
  toRemove: Set<string>,
  animationClasses: Map<string, RemovalAnim>,
  rows: number,
  cols: number,
  effects: Effect[],
  rng: RNG,
  processed = new Set<string>()
): { bonusPoints: number; chainCount: number; subSteps: RemovalSubStep[] } {
  let bonusPoints = 0;
  let chainCount = 0;
  let newSpecialsFound = true;
  let iterations = 0;
  const maxIterations = 20;
  const subSteps: RemovalSubStep[] = [];

  while (newSpecialsFound && iterations < maxIterations) {
    newSpecialsFound = false;
    iterations++;

    const currentToRemove = new Set(toRemove);

    for (const key of currentToRemove) {
      const [r, c] = key.split(',').map(Number);
      const gem = board[r]?.[c];
      if (!gem || !gem.special) continue;
      if (processed.has(key)) continue;
      processed.add(key);

      const stepPositions: Pos[] = [];
      const stepAnimations: Record<string, RemovalAnim> = {};
      const stepEffects: Effect[] = [];

      if (gem.special === SPECIAL.BOMB) {
        chainCount++;
        stepEffects.push({ kind: 'explosion', r, c });
        effects.push({ kind: 'explosion', r, c });

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const newKey = keyFor(nr, nc);
              if (!toRemove.has(newKey)) {
                toRemove.add(newKey);
                animationClasses.set(newKey, 'exploding');
                stepPositions.push({ r: nr, c: nc });
                stepAnimations[newKey] = 'exploding';
                newSpecialsFound = true;
              }
            }
          }
        }
        markForRemoval(toRemove, animationClasses, key, 'exploding');
        bonusPoints += 150;
      } else if (gem.special === SPECIAL.LINE) {
        chainCount++;
        const beam = beamCells({ r, c }, armsOf(gem), rows, cols);
        for (const pos of beam.cells) {
          const newKey = keyFor(pos.r, pos.c);
          if (toRemove.has(newKey)) continue;
          toRemove.add(newKey);
          animationClasses.set(newKey, 'line-cleared');
          stepPositions.push(pos);
          stepAnimations[newKey] = 'line-cleared';
          newSpecialsFound = true;
        }
        stepEffects.push(...beam.effects);
        effects.push(...beam.effects);
        markForRemoval(toRemove, animationClasses, key, 'line-cleared');
        bonusPoints += 200;
      } else if (gem.special === SPECIAL.RAINBOW) {
        chainCount++;
        const targetType = gem.type;

        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (board[i][j]?.type === targetType) {
              const newKey = keyFor(i, j);
              if (!toRemove.has(newKey)) {
                toRemove.add(newKey);
                animationClasses.set(newKey, 'rainbow-cleared');
                stepPositions.push({ r: i, c: j });
                stepAnimations[newKey] = 'rainbow-cleared';
                newSpecialsFound = true;
              }
            }
          }
        }

        markForRemoval(toRemove, animationClasses, key, 'rainbow-cleared');
        bonusPoints += 500;
      } else if (gem.special === SPECIAL.PROPELLER) {
        chainCount++;
        const before = new Set(toRemove);
        const flight = launchPropeller(board, rows, cols, { r, c }, toRemove, animationClasses, stepEffects, rng);
        // One object in both arrays: the page plays it with the sub-step and splits
        // the frame's effects by identity.
        effects.push(flight);
        for (const pos of landingCells(flight.to)) {
          const newKey = keyFor(pos.r, pos.c);
          if (before.has(newKey)) continue;
          stepPositions.push(pos);
          stepAnimations[newKey] = 'exploding';
          newSpecialsFound = true;
        }
        bonusPoints += 150;
      }

      if (stepPositions.length > 0) {
        subSteps.push({
          triggerPos: { r, c },
          positions: stepPositions,
          animations: stepAnimations,
          effects: stepEffects
        });
      }
    }
  }

  return { bonusPoints, chainCount, subSteps };
}

// Shuffle if the board has no legal move left. The valid-move paths already do this
// after their cascade; the invalid-swap paths did not, so a board that went dead
// stayed dead — every subsequent swap snapping back with no explanation.
function* rescueDeadBoard(state: EngineState, tally: Tally): Generator<Frame, void, undefined> {
  if (hasValidMoves(state.board, state.rows, state.cols)) return;
  yield* shuffleWaves(state, 0, tally);
}

function findBestSpecialPosition(match: MatchGroup, lastSwapPos: EngineState['lastSwapPos'], comboCount = 1): Pos {
  // Phase 3F: During cascades (combo > 1), use geometric center instead of swap position
  if (comboCount <= 1 && lastSwapPos) {
    for (const pos of match.positions) {
      if ((pos.r === lastSwapPos.r1 && pos.c === lastSwapPos.c1) ||
        (pos.r === lastSwapPos.r2 && pos.c === lastSwapPos.c2)) {
        return pos;
      }
    }
  }

  // Find geometric center and pick closest match position to it
  const centroidR = match.positions.reduce((sum, p) => sum + p.r, 0) / match.positions.length;
  const centroidC = match.positions.reduce((sum, p) => sum + p.c, 0) / match.positions.length;

  let bestPos = match.positions[0];
  let bestDist = Infinity;
  for (const pos of match.positions) {
    const dist = Math.hypot(pos.r - centroidR, pos.c - centroidC);
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = pos;
    }
  }
  return bestPos;
}

// Arms of a five-cell L, T or plus: one for each in-group neighbour of the intersection.
function armsFromIntersection(match: MatchGroup): Arms {
  const at = match.intersection!;
  const inGroup = new Set(match.positions.map(p => keyFor(p.r, p.c)));
  let arms = 0;
  for (const step of ARM_STEPS) {
    if (inGroup.has(keyFor(at.r + step.dr, at.c + step.dc))) arms |= step.arm;
  }
  return arms;
}

function* cascadeWaves(state: EngineState, tally: Tally): Generator<Frame, void, undefined> {
  const { rows, cols, board } = state;
  let matches = findMatches(board, rows, cols);
  let comboCount = 0;

  while (matches.length > 0) {
    comboCount++;

    const toRemove = new Set<string>();
    const specials: Array<{ pos: Pos; type: number; special: Special; arms?: Arms }> = [];
    let matchBonus = 0;
    const animationClasses = new Map<string, RemovalAnim>();
    const effects: Effect[] = [];

    for (const match of matches) {
      const len = match.effectiveLen || match.positions.length;
      const type = match.type;

      // Phase 3B: len >= 6 -> RAINBOW; a 5-cell L/T/plus (isComplex, has an intersection) -> beam
      // gem; a group with a square and no intersection -> propeller; a straight 5 -> beam gem
      if (len >= 6) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.RAINBOW });
        matchBonus += 200;
      } else if (len === 5 && match.intersection) {
        // L, T or plus: the gem sits where the legs meet and fires along each of them.
        specials.push({ pos: match.intersection, type, special: SPECIAL.LINE, arms: armsFromIntersection(match) });
        matchBonus += 150;
      } else if (match.square) {
        // A 2x2 (possibly touching a run): the propeller sits on the swapped cell
        // when that lies in the square, else on the square cell nearest the centre.
        const a = match.square;
        const squareCells: Pos[] = [{ r: a.r, c: a.c }, { r: a.r, c: a.c + 1 }, { r: a.r + 1, c: a.c }, { r: a.r + 1, c: a.c + 1 }];
        const pos = findBestSpecialPosition({ ...match, positions: squareCells }, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.PROPELLER });
        matchBonus += 75;
      } else if (len === 5) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        const arms = match.direction === 'horizontal' ? ARMS_HORIZONTAL : ARMS_VERTICAL;
        specials.push({ pos, type, special: SPECIAL.LINE, arms });
        matchBonus += 100;
      } else if (len === 4) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.BOMB });
        matchBonus += 50;
      }

      if (len > 3) {
        matchBonus += Math.pow(len - 3, 2) * 20;
      }

      for (const pos of match.positions) {
        toRemove.add(keyFor(pos.r, pos.c));
      }
    }

    const { bonusPoints, chainCount, subSteps } = activateSpecialsInRemovalSet(
      board,
      toRemove,
      animationClasses,
      rows,
      cols,
      effects,
      state.rng
    );

    matchBonus += bonusPoints;

    const basePoints = toRemove.size * 10;
    const comboMultiplier = 1 + (comboCount - 1) * 0.5;
    const points = Math.floor((basePoints + matchBonus) * comboMultiplier);
    tally.points += points;

    yield {
      kind: 'remove',
      positions: positionsFromSet(toRemove),
      animations: mapToRecord(animationClasses),
      effects,
      score: {
        points,
        combo: comboCount,
        breakdown: { base: basePoints, matchBonus, comboMultiplier },
        isBonus: matchBonus > 50
      },
      subSteps: subSteps.length > 0 ? subSteps : undefined
    };

    removePositions(board, toRemove);

    const specialPriority: Record<string, number> = { [SPECIAL.RAINBOW]: 4, [SPECIAL.LINE]: 3, [SPECIAL.PROPELLER]: 2, [SPECIAL.BOMB]: 1 };
    specials.sort((a, b) => (specialPriority[b.special ?? ''] ?? 0) - (specialPriority[a.special ?? ''] ?? 0));

    const usedPositions = new Set<string>();
    const newSpecialPositions: Pos[] = [];
    for (const sp of specials) {
      const posKey = keyFor(sp.pos.r, sp.pos.c);
      if (usedPositions.has(posKey)) continue;
      if (!board[sp.pos.r][sp.pos.c]) {
        board[sp.pos.r][sp.pos.c] = {
          type: sp.type,
          special: sp.special,
          arms: sp.arms ?? null
        };
        usedPositions.add(posKey);
        newSpecialPositions.push(sp.pos);
      }
    }

    yield { kind: 'board', board: cloneBoard(board), newSpecials: newSpecialPositions.length > 0 ? newSpecialPositions : undefined };

    const dropMoves = dropGems(board, rows, cols, state.gravity);
    if (dropMoves.length > 0) yield { kind: 'drop', board: cloneBoard(board), moves: dropMoves };

    const fillMoves = fillGems(board, rows, cols, state.gemTypes, state.rng, state.gravity);
    if (fillMoves.length > 0) yield { kind: 'fill', board: cloneBoard(board), moves: fillMoves };

    matches = findMatches(board, rows, cols);

    // Phase 2B: Emit preview frame when more matches are pending after fill
    if (matches.length > 0) {
      const pendingPositions: Pos[] = [];
      for (const match of matches) {
        for (const pos of match.positions) {
          pendingPositions.push(pos);
        }
      }
      yield { kind: 'preview', board: cloneBoard(board), pendingPositions };
    }
  }
}

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

// Would placing `type` at (r,c) complete a run of 3+ through that cell? Unlike the
// generation-time predicate this looks in all four directions, so it can repair a
// cell in the middle of an existing board rather than only append safely.
function wouldMatchAt(board: Board, r: number, c: number, type: number, rows: number, cols: number): boolean {
  let run = 1;
  for (let i = c - 1; i >= 0 && board[r][i]?.type === type; i--) run++;
  for (let i = c + 1; i < cols && board[r][i]?.type === type; i++) run++;
  if (run >= 3) return true;

  run = 1;
  for (let i = r - 1; i >= 0 && board[i][c]?.type === type; i--) run++;
  for (let i = r + 1; i < rows && board[i][c]?.type === type; i++) run++;
  if (run >= 3) return true;

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
}

// Clear any matches sitting on a freshly generated board, silently: no frames, no
// specials, no score. Generation gives up after 100 rerolls and accepts a matched
// board, which otherwise hands the player unearned points on their first swap.
//
// Repairs matched cells in place rather than removing and refilling them. Refilling
// cannot converge at gemTypes=2, where "differ from the pair left AND the pair above"
// is frequently unsatisfiable; recolouring a single cell against all four directions
// converges in a pass or two.
function settleBoard(board: Board, rows: number, cols: number, gemTypes: number, rng: RNG): void {
  for (let pass = 0; pass < 500; pass++) {
    const matches = findMatches(board, rows, cols);
    if (matches.length === 0) return;

    // One cell per group per pass, then re-evaluate. Recolouring every cell in a
    // group is disruptive enough to keep creating fresh matches elsewhere, which
    // made the search cycle instead of converge.
    for (const match of matches) {
      const pos = match.positions[rng.int(match.positions.length)];
      const cell = board[pos.r][pos.c];
      if (!cell) continue;

      const start = rng.int(gemTypes);
      let placed = false;
      for (let k = 0; k < gemTypes; k++) {
        const candidate = (start + k) % gemTypes;
        if (!wouldMatchAt(board, pos.r, pos.c, candidate, rows, cols)) {
          cell.type = candidate;
          placed = true;
          break;
        }
      }

      // Every colour is blocked (common at gemTypes=2, e.g. AA_BB horizontally).
      // Force a different one anyway: it breaks the current configuration so a
      // later pass can find a clean assignment, instead of stalling forever.
      if (!placed && gemTypes > 1) {
        cell.type = (cell.type + 1 + rng.int(gemTypes - 1)) % gemTypes;
      }
    }
  }
}

// A board with no legal move is a silent soft-lock: every swap snaps back with no
// explanation, and the shuffle machinery only runs after a *valid* move's cascade.
function ensurePlayableBoard(board: Board, rows: number, cols: number, gemTypes: number, rng: RNG): void {
  settleBoard(board, rows, cols, gemTypes, rng);
  if (hasValidMoves(board, rows, cols)) return;
  if (rows < 2 || cols < 3) return;

  // Plant a move rather than reshuffling. On a small board with many colours a
  // random permutation almost never happens to contain a legal move (4x4 gems=10
  // failed 50 attempts routinely), whereas this constructs one directly:
  //
  //     T T x        swapping the two right-hand cells completes T T T
  //     . . T
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = rng.int(rows - 1);
    const c = rng.int(cols - 2);
    const t = rng.int(gemTypes);
    const other = (t + 1) % gemTypes;

    const saved = [board[r][c], board[r][c + 1], board[r][c + 2], board[r + 1][c + 2]];
    board[r][c] = { type: t, special: SPECIAL.NONE, arms: null };
    board[r][c + 1] = { type: t, special: SPECIAL.NONE, arms: null };
    board[r][c + 2] = { type: other, special: SPECIAL.NONE, arms: null };
    board[r + 1][c + 2] = { type: t, special: SPECIAL.NONE, arms: null };

    // The plant must not itself create a live match.
    if (findMatches(board, rows, cols).length === 0 && hasValidMoves(board, rows, cols)) return;

    board[r][c] = saved[0];
    board[r][c + 1] = saved[1];
    board[r][c + 2] = saved[2];
    board[r + 1][c + 2] = saved[3];
  }
}

export function hasValidMoves(board: Board, rows: number, cols: number): boolean {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && board[r][c] && board[r][c + 1]) {
        if (isMoveValid(board, rows, cols, r, c, r, c + 1)) return true;
      }
      if (r < rows - 1 && board[r][c] && board[r + 1][c]) {
        if (isMoveValid(board, rows, cols, r, c, r + 1, c)) return true;
      }
    }
  }
  return false;
}

export function findValidMove(board: Board, rows: number, cols: number): { r1: number; c1: number; r2: number; c2: number } | null {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && board[r][c] && board[r][c + 1]) {
        if (isMoveValid(board, rows, cols, r, c, r, c + 1)) {
          return { r1: r, c1: c, r2: r, c2: c + 1 };
        }
      }
      if (r < rows - 1 && board[r][c] && board[r + 1][c]) {
        if (isMoveValid(board, rows, cols, r, c, r + 1, c)) {
          return { r1: r, c1: c, r2: r + 1, c2: c };
        }
      }
    }
  }
  return null;
}

function isMoveValid(board: Board, rows: number, cols: number, r1: number, c1: number, r2: number, c2: number): boolean {
  const gem1 = board[r1][c1];
  const gem2 = board[r2][c2];
  if (!gem1 || !gem2) return false;

  if (isSpecial(gem1) && isSpecial(gem2)) return true;
  if (isRainbow(gem1) || isRainbow(gem2)) return true;

  [board[r1][c1], board[r2][c2]] = [board[r2][c2], board[r1][c1]];
  const hasMatch = findMatches(board, rows, cols).length > 0;
  [board[r1][c1], board[r2][c2]] = [board[r2][c2], board[r1][c1]];

  return hasMatch;
}

function* shuffleWaves(state: EngineState, attempts: number, tally: Tally): Generator<Frame, void, undefined> {
  const MAX_SHUFFLE_ATTEMPTS = 10;
  const MAX_VISUAL_ATTEMPTS = 3;
  const { rows, cols, board } = state;

  // Shuffle {cell, from} pairs so each gem's origin survives Fisher-Yates (Phase 2D
  // slide animation). Shuffling bare cells against a parallel position array made
  // every recorded move a no-op (from === to), because that array stayed in
  // destination order — so the FLIP animation had nothing to animate.
  const gems: Array<{ cell: Cell; from: Pos }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c]) gems.push({ cell: board[r][c]!, from: { r, c } });
    }
  }

  for (let i = gems.length - 1; i > 0; i--) {
    const j = state.rng.int(i + 1);
    [gems[i], gems[j]] = [gems[j], gems[i]];
  }

  let idx = 0;
  const moves: Array<{ from: Pos; to: Pos; type: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const entry = gems[idx];
      // `gems` is shorter than the grid if the board had holes; write null, never undefined.
      board[r][c] = entry ? entry.cell : null;
      if (entry) {
        moves.push({ from: entry.from, to: { r, c }, type: entry.cell.type });
      }
      idx++;
    }
  }

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

function regenerateBoard(state: EngineState): void {
  const { rows, cols, gemTypes, rng } = state;

  // Phase 4B: Preserve specials before regeneration
  const savedSpecials: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = state.board[r][c];
      if (cell && cell.special) {
        savedSpecials.push({ ...cell });
      }
    }
  }

  const board = createEmptyBoard(rows, cols);

  const randomGem = (r: number, c: number): number => pickNonMatchingType(board, r, c, gemTypes, rng);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      board[r][c] = {
        type: randomGem(r, c),
        special: SPECIAL.NONE,
        arms: null
      };
    }
  }

  let attempts = 0;
  while (findMatches(board, rows, cols).length > 0 && attempts < 100) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = {
          type: randomGem(r, c),
          special: SPECIAL.NONE,
          arms: null
        };
      }
    }
    attempts++;
  }

  // Settle and guarantee playability before the specials go back, so they survive
  // (settleBoard would clear any that landed inside a match).
  ensurePlayableBoard(board, rows, cols, gemTypes, rng);

  // Place saved specials back at random positions
  for (const special of savedSpecials) {
    const r = rng.int(rows);
    const c = rng.int(cols);
    if (board[r][c]) {
      board[r][c] = special;
    }
  }

  state.board = board;
  state.lastSwapPos = null;
}
