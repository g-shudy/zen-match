import './styles.css';
import {
  Engine,
  SPECIAL,
  ARM,
  cloneBoard,
  type Board,
  type Cell,
  type Frame,
  type Pos,
  type Effect,
  type GemMove,
  type RemovalAnim,
  type RemovalSubStep
} from './engine/index';
import {
  LIMITS,
  formatGrid,
  parseSettings,
  serializeSettings,
  resolveSettings,
  serializeGame,
  parseSavedGame,
  type PaletteId,
  type Settings
} from './storage';
import { createHold } from './hold';
import { boardPose, toBoardDelta, type Rotation } from './orientation';

declare const __APP_VERSION__: string;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const KEYS = {
  settings: 'zen-match:settings',
  game: 'zen-match:game',
  visited: 'zen-match-visited',
  legacyPalette: 'zen-match-palette',
  legacyMode: 'zen-match-mode',
  legacyHints: 'zen-match-hints'
};

// localStorage throws in some private-browsing modes; the game must not.
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

const urlParams = new URLSearchParams(window.location.search);
const seedParam = urlParams.get('seed');
const parsedSeed = seedParam !== null ? parseInt(seedParam, 10) : NaN;
const hasValidSeed = Number.isFinite(parsedSeed);

// Desired board: URL > stored > default. The pre-2.0 keys are folded in once
// and removed; classic mode and hints no longer exist.
const settings: Settings = resolveSettings(
  urlParams,
  parseSettings(store.get(KEYS.settings), store.get(KEYS.legacyPalette))
);
store.remove(KEYS.legacyPalette);
store.remove(KEYS.legacyMode);
store.remove(KEYS.legacyHints);

function persistSettings(): void {
  store.set(KEYS.settings, serializeSettings(settings));
}

persistSettings();

// Live board configuration. `settings` may run ahead of this until New Game.
const config = {
  rows: settings.rows,
  cols: settings.cols,
  gemTypes: settings.gemTypes,
  seed: hasValidSeed ? parsedSeed : Date.now(),
  seedLocked: hasValidSeed,
  timing: {
    swap: 200,
    invalid: 400,
    remove: 400,
    substepTrigger: 150,
    substepClear: 300,
    boardSync: 100,
    specialCreated: 300,
    drop: 360,
    fill: 420,
    preview: 400,
    shufflePause: 500,
    shuffleMove: 700,
    dissolve: 420,
    reform: 520,
    glow: 1400,
    ambient: 1200,
    holdToStart: 1000,
    turn: 600
  }
};

const gameState = {
  selected: null as Pos | null,
  isProcessing: false,
  runToken: 0,
  pendingPoints: 0,
  gamePoints: 0,
  gameMoves: 0,
  maxCombo: 0,
  currentBoard: null as Board | null
};

const engine = new Engine({ rows: config.rows, cols: config.cols, gemTypes: config.gemTypes, seed: config.seed });

const sessionStart = Date.now();

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

const stageEl = getEl<HTMLElement>('stage');
const boardFrameEl = getEl<HTMLDivElement>('boardFrame');
const boardEl = getEl<HTMLDivElement>('board');
const scoreEl = getEl<HTMLSpanElement>('score');
const toastEl = getEl<HTMLDivElement>('toast');
const newGameBtn = getEl<HTMLButtonElement>('newGame');
const helpBtn = getEl<HTMLButtonElement>('helpBtn');
const settingsBtn = getEl<HTMLButtonElement>('settingsBtn');
const turnBtn = getEl<HTMLButtonElement>('turnBtn');
const settingsSheet = getEl<HTMLDialogElement>('settingsSheet');
const helpSheet = getEl<HTMLDialogElement>('helpSheet');
const sizeSeg = getEl<HTMLDivElement>('sizeSeg');
const shapeSeg = getEl<HTMLDivElement>('shapeSeg');
const colorsSeg = getEl<HTMLDivElement>('colorsSeg');
const settingsDone = getEl<HTMLButtonElement>('settingsDone');
const settingsNewGame = getEl<HTMLButtonElement>('settingsNewGame');
const statMoves = getEl<HTMLElement>('statMoves');
const statPoints = getEl<HTMLElement>('statPoints');
const statAvg = getEl<HTMLElement>('statAvg');
const statCombo = getEl<HTMLElement>('statCombo');
const aboutEl = getEl<HTMLSpanElement>('about');
const ambientEl = document.querySelector<HTMLDivElement>('.ambient');
const topbarEl = stageEl.querySelector<HTMLElement>('.topbar')!;
const toolbarEl = stageEl.querySelector<HTMLElement>('.toolbar')!;
const backLinkEl = stageEl.querySelector<HTMLElement>('.back-link')!;
const paletteInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="palette"]'));

const cells: HTMLDivElement[] = [];
const gems: HTMLDivElement[] = [];
const shapes: HTMLSpanElement[] = [];

aboutEl.textContent = `Zen Match v${__APP_VERSION__}`;

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const landscapePhoneQuery = window.matchMedia('(orientation: landscape) and (max-height: 520px)');

function reducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
let turningTimeoutId = 0;

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
    window.clearTimeout(turningTimeoutId);
    boardFrameEl.classList.add('turning');
    turningTimeoutId = window.setTimeout(() => boardFrameEl.classList.remove('turning'), turnMs);
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

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const defaultGemColors = [
  '#7ec8e3', '#e07a5f', '#95d5b2', '#f4d35e', '#dda0dd',
  '#e8a87c', '#4ecdc4', '#ff9f43', '#5f6caf', '#ff6b9d'
];
const activeGemColors = [...defaultGemColors];

function refreshGemColors(): void {
  const style = getComputedStyle(document.documentElement);
  for (let i = 0; i < 10; i++) {
    const val = style.getPropertyValue(`--gem-color-${i}`).trim();
    activeGemColors[i] = val || defaultGemColors[i];
  }
}

function applyPalette(palette: PaletteId): void {
  if (palette === 'default') {
    delete document.documentElement.dataset.palette;
  } else {
    document.documentElement.dataset.palette = palette;
  }
  for (const input of paletteInputs) input.checked = input.value === palette;
  refreshGemColors();
}

// ---------------------------------------------------------------------------
// Number formatting and the score display
// ---------------------------------------------------------------------------

const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const standardFormatter = new Intl.NumberFormat(undefined);

function formatNumber(n: number): string {
  if (n >= 100000) return compactFormatter.format(n);
  return standardFormatter.format(n);
}

let shownScore = 0;
let targetScore = 0;
let scoreRaf = 0;

// Eases the displayed number toward the target; retargeting mid-animation just
// bends the curve, which is what a live cascade needs.
function setScore(value: number, animate = true): void {
  targetScore = value;
  if (!animate || reducedMotion()) {
    if (scoreRaf) cancelAnimationFrame(scoreRaf);
    scoreRaf = 0;
    shownScore = value;
    scoreEl.textContent = formatNumber(value);
    return;
  }
  if (scoreRaf) return;
  const step = (): void => {
    const diff = targetScore - shownScore;
    if (Math.abs(diff) < 0.6) {
      shownScore = targetScore;
      scoreEl.textContent = formatNumber(targetScore);
      scoreRaf = 0;
      return;
    }
    shownScore += diff * 0.16;
    scoreEl.textContent = formatNumber(Math.round(shownScore));
    scoreRaf = requestAnimationFrame(step);
  };
  scoreRaf = requestAnimationFrame(step);
}

function bumpScore(): void {
  scoreEl.classList.remove('bump');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('bump');
}

function updateStats(): void {
  const avg = gameState.gameMoves > 0 ? Math.round(gameState.gamePoints / gameState.gameMoves) : 0;
  statMoves.textContent = formatNumber(gameState.gameMoves);
  statPoints.textContent = formatNumber(gameState.gamePoints);
  statAvg.textContent = formatNumber(avg);
  statCombo.textContent = formatNumber(gameState.maxCombo);
}

// ---------------------------------------------------------------------------
// Board layout and rendering
// ---------------------------------------------------------------------------

function posIdx(r: number, c: number): number {
  return r * config.cols + c;
}

function isInBounds(pos: Pos): boolean {
  return pos.r >= 0 && pos.r < config.rows && pos.c >= 0 && pos.c < config.cols;
}

function isAdjacent(a: Pos, b: Pos): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

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
  layout.pad = narrow ? 6 : 16;

  boardEl.style.setProperty('--grid-cols', String(config.cols));
  boardEl.style.setProperty('--cell-size', `${cellSize}px`);
  boardEl.style.setProperty('--gem-size', `${gemSize}px`);
  boardEl.style.setProperty('--gem-radius', `${Math.max(2, Math.round(gemSize * 0.18))}px`);
  boardEl.style.setProperty('--gap', `${gap}px`);
}

function createGrid(): void {
  boardEl.innerHTML = '';
  cells.length = 0;
  gems.length = 0;
  shapes.length = 0;
  renderedKeys = [];
  updateBoardSizing();

  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.tabIndex = r === 0 && c === 0 ? 0 : -1;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`);
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);

      const gem = document.createElement('div');
      gem.className = 'gem empty';

      const shape = document.createElement('span');
      shape.className = 'gem-shape';
      gem.appendChild(shape);
      cell.appendChild(gem);

      boardEl.appendChild(cell);
      cells.push(cell);
      gems.push(gem);
      shapes.push(shape);
    }
  }
}

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

function rerender(): void {
  if (gameState.currentBoard) renderBoard(gameState.currentBoard);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

let glowTimer: number | undefined;
let ambientTimer: number | undefined;

function boardGlow(): void {
  boardEl.classList.add('glow');
  window.clearTimeout(glowTimer);
  glowTimer = window.setTimeout(() => boardEl.classList.remove('glow'), config.timing.glow);
}

function ambientResponse(): void {
  if (!ambientEl) return;
  ambientEl.classList.add('combo-response');
  window.clearTimeout(ambientTimer);
  ambientTimer = window.setTimeout(() => ambientEl.classList.remove('combo-response'), config.timing.ambient);
}

// Centre of a cell in board-local pixels (inside the rotated board element).
function cellCenter(r: number, c: number): { x: number; y: number } {
  const step = layout.cell + layout.gap;
  return { x: layout.pad + c * step + layout.cell / 2, y: layout.pad + r * step + layout.cell / 2 };
}

function showExplosionEffect(r: number, c: number): void {
  const center = cellCenter(r, c);
  const effect = document.createElement('div');
  effect.className = 'explosion-effect';
  effect.style.left = `${center.x}px`;
  effect.style.top = `${center.y}px`;
  boardEl.appendChild(effect);
  setTimeout(() => effect.remove(), 500);
}

type BeamEffect = Extract<Effect, { kind: 'beam' }>;

// A beam's swept rectangle always starts at the board edge in its direction of
// travel, so two beams that share a direction and a row (left/right) or column
// (up/down) nest: the shorter one's pixels are a subset of the longer one's.
// "Reach" is a signed distance such that the longer beam always has the larger
// reach, whichever direction it fires, so the caller can keep the max per group.
function beamReach(beam: BeamEffect): number {
  switch (beam.dir) {
    case 'up': return beam.from.r;
    case 'down': return -beam.from.r;
    case 'left': return beam.from.c;
    case 'right': return -beam.from.c;
  }
}

function beamGroupKey(beam: BeamEffect): string {
  const axis = beam.dir === 'up' || beam.dir === 'down' ? beam.from.c : beam.from.r;
  return `${beam.dir}:${axis}`;
}

// Drop beams whose pixels are entirely covered by a longer beam in the same
// direction and row/column, so a rainbow crossing a Cross fires one beam per
// direction instead of one per gem it touched.
function pruneNestedBeams(beams: BeamEffect[]): BeamEffect[] {
  const kept = new Map<string, BeamEffect>();
  for (const beam of beams) {
    const key = beamGroupKey(beam);
    const existing = kept.get(key);
    if (!existing || beamReach(beam) > beamReach(existing)) kept.set(key, beam);
  }
  return [...kept.values()];
}

// Builds every surviving beam's element from the shared board-local layout, with
// no DOM write between reads, so a large fan-out forces one layout instead of
// one per beam. The board's own size is its untransformed offset size: it is
// rotated, so a client rect would measure the wrong box.
function buildBeamElements(beams: BeamEffect[]): HTMLDivElement[] {
  const elements: HTMLDivElement[] = [];
  const boardWidth = boardEl.offsetWidth;
  const boardHeight = boardEl.offsetHeight;
  const cellSize = layout.cell;
  const half = cellSize / 2;
  for (const beam of pruneNestedBeams(beams)) {
    const center = cellCenter(beam.from.r, beam.from.c);
    const el = document.createElement('div');
    el.className = `beam-effect ${beam.dir}`;
    switch (beam.dir) {
      case 'up':
        el.style.cssText = `left:${center.x - half}px;top:0;width:${cellSize}px;height:${center.y}px;`;
        break;
      case 'down':
        el.style.cssText = `left:${center.x - half}px;top:${center.y}px;width:${cellSize}px;height:${boardHeight - center.y}px;`;
        break;
      case 'left':
        el.style.cssText = `left:0;top:${center.y - half}px;width:${center.x}px;height:${cellSize}px;`;
        break;
      case 'right':
        el.style.cssText = `left:${center.x}px;top:${center.y - half}px;width:${boardWidth - center.x}px;height:${cellSize}px;`;
        break;
    }
    elements.push(el);
  }
  return elements;
}

// Explosions keep their own read-then-write path per effect; only beams fan out
// enough (a rainbow x Cross can fire a couple hundred) to need batching.
function showEffects(effects: Effect[]): void {
  const beams: BeamEffect[] = [];
  for (const effect of effects) {
    if (effect.kind === 'explosion') showExplosionEffect(effect.r, effect.c);
    else beams.push(effect);
  }
  if (beams.length === 0) return;

  const elements = buildBeamElements(beams);
  if (elements.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const el of elements) fragment.appendChild(el);
  boardEl.appendChild(fragment);
  setTimeout(() => {
    for (const el of elements) el.remove();
  }, 450);
}

let activeParticles = 0;
const MAX_PARTICLES = 20;

function spawnParticles(r: number, c: number, color: string, count = 4): void {
  if (reducedMotion()) return;
  const center = cellCenter(r, c);

  for (let i = 0; i < count && activeParticles < MAX_PARTICLES; i++) {
    activeParticles++;
    const p = document.createElement('div');
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = 20 + Math.random() * 30;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    p.className = 'particle';
    p.style.cssText = `left:${center.x}px;top:${center.y}px;background:${color};--tx:${tx}px;--ty:${ty}px;`;
    boardEl.appendChild(p);
    p.addEventListener('animationend', () => { p.remove(); activeParticles--; }, { once: true });
  }
}

function applyRemovalAnimations(positions: Pos[], animations: Record<string, RemovalAnim>): void {
  for (const pos of positions) {
    const gemEl = gems[posIdx(pos.r, pos.c)];
    if (!gemEl) continue;
    gemEl.classList.add(animations[`${pos.r},${pos.c}`] || 'matched');
    const cell = gameState.currentBoard?.[pos.r]?.[pos.c];
    if (cell) spawnParticles(pos.r, pos.c, activeGemColors[cell.type] || '#fff');
  }
}

// ---------------------------------------------------------------------------
// Frame playback
// ---------------------------------------------------------------------------

async function animateGemMoves(
  board: Board,
  moves: GemMove[],
  duration: number,
  staggerMax: number,
  easing = 'cubic-bezier(0.25, 1, 0.5, 1)'
): Promise<void> {
  if (moves.length === 0 || reducedMotion()) {
    renderBoard(board);
    await sleep(20);
    return;
  }

  renderBoard(board);
  const step = layout.cell + layout.gap;

  moves.forEach(move => {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (!gemEl) return;
    const dx = (move.from.c - move.to.c) * step;
    const dy = (move.from.r - move.to.r) * step;
    if (dx === 0 && dy === 0) return;
    gemEl.classList.add('falling');
    gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
    gemEl.style.transition = 'none';
  });

  void boardEl.offsetHeight;

  moves.forEach((move, index) => {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (!gemEl) return;
    const stagger = staggerMax > 0 ? Math.min(staggerMax, index * 18) : 0;
    gemEl.style.transition = `transform ${duration}ms ${easing} ${stagger}ms`;
    gemEl.style.transform = '';
  });

  await sleep(duration + staggerMax);

  for (const move of moves) {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (gemEl) {
      gemEl.classList.remove('falling');
      gemEl.style.transition = '';
      gemEl.style.transform = '';
    }
  }
}

async function animateShuffle(frame: Extract<Frame, { kind: 'shuffle' }>): Promise<void> {
  if (!frame.moves || frame.moves.length === 0 || reducedMotion()) {
    renderBoard(frame.board);
    await sleep(config.timing.shufflePause);
    return;
  }

  renderBoard(frame.board);
  const step = layout.cell + layout.gap;

  for (const move of frame.moves) {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (!gemEl) continue;
    const dx = (move.from.c - move.to.c) * step;
    const dy = (move.from.r - move.to.r) * step;
    if (dx !== 0 || dy !== 0) {
      gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
      gemEl.style.transition = 'none';
    }
  }

  void boardEl.offsetHeight;

  for (const move of frame.moves) {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (!gemEl) continue;
    gemEl.style.transition = `transform 600ms cubic-bezier(0.25, 1, 0.5, 1) ${Math.random() * 100}ms`;
    gemEl.style.transform = '';
  }

  await sleep(config.timing.shuffleMove);

  for (const move of frame.moves) {
    const gemEl = gems[posIdx(move.to.r, move.to.c)];
    if (gemEl) {
      gemEl.style.transition = '';
      gemEl.style.transform = '';
    }
  }
}

async function playSubSteps(subSteps: RemovalSubStep[], token: number, pace: number): Promise<void> {
  for (const step of subSteps) {
    if (token !== gameState.runToken) return;

    const triggerGem = gems[posIdx(step.triggerPos.r, step.triggerPos.c)];
    if (triggerGem) triggerGem.classList.add('activating');
    await sleep(config.timing.substepTrigger * pace);

    for (const pos of step.positions) {
      const gemEl = gems[posIdx(pos.r, pos.c)];
      if (gemEl) gemEl.classList.add(step.animations[`${pos.r},${pos.c}`] || 'matched');
    }
    showEffects(step.effects);
    await sleep(config.timing.substepClear * pace);

    if (triggerGem) triggerGem.classList.remove('activating');
  }
}

// Cascades settle rather than accelerate: each wave is a little slower than the
// last (350ms base, +8% per wave, capped at 500ms) so a long chain reads as
// something to watch, not a race.
function cascadePace(combo: number): number {
  return Math.min(500, 350 * Math.pow(1.08, combo - 1)) / config.timing.remove;
}

// `frames` is a generator: each cascade wave is computed when the loop pulls it.
// Leaving the loop early (a superseded move) closes the generator through the
// for...of protocol, so the engine drops the wave it was holding.
async function playFrames(frames: Iterable<Frame>, token: number): Promise<void> {
  let sawShuffle = false;

  for (const frame of frames) {
    if (token !== gameState.runToken) return;

    switch (frame.kind) {
      case 'swap':
        renderBoard(frame.board);
        await sleep(config.timing.swap);
        break;

      case 'invalid': {
        const [p1, p2] = frame.positions;
        const dr = p2.r - p1.r;
        const dc = p2.c - p1.c;
        const invalidGems: HTMLElement[] = [];
        for (const pos of frame.positions) {
          const gemEl = gems[posIdx(pos.r, pos.c)];
          if (!gemEl) continue;
          const isFirst = pos.r === p1.r && pos.c === p1.c;
          gemEl.style.setProperty('--slide-x', `${(isFirst ? dc : -dc) * 12}px`);
          gemEl.style.setProperty('--slide-y', `${(isFirst ? dr : -dr) * 12}px`);
          gemEl.classList.add('invalid');
          invalidGems.push(gemEl);
        }
        await sleep(config.timing.invalid);
        for (const gemEl of invalidGems) gemEl.classList.remove('invalid');
        break;
      }

      case 'remove': {
        // These gems are about to take a removal class that ends at opacity 0
        // and holds there. The renderer skips any element whose key is
        // unchanged, so an identical cell landing back on the same square - a
        // special re-placed where it was, or a whole new board arriving
        // mid-frame - would keep that class and stay invisible. Forgetting the
        // key makes the next render rewrite these elements whatever they hold.
        // Sub-step positions are part of `frame.positions`, so this covers the
        // chain-reaction victims too.
        for (const pos of frame.positions) renderedKeys[posIdx(pos.r, pos.c)] = '';

        const pace = cascadePace(frame.score.combo);
        gameState.pendingPoints += frame.score.points;
        gameState.maxCombo = Math.max(gameState.maxCombo, frame.score.combo);
        setScore(gameState.gamePoints + gameState.pendingPoints);
        bumpScore();
        if (frame.score.combo >= 3) boardGlow();
        if (frame.score.combo >= 5) ambientResponse();

        if (frame.subSteps && frame.subSteps.length > 0) {
          const subStepKeys = new Set<string>();
          for (const step of frame.subSteps) {
            for (const pos of step.positions) subStepKeys.add(`${pos.r},${pos.c}`);
          }
          // Only the directly matched gems animate now; chain-reaction victims
          // animate when their sub-step fires.
          const initialPositions = frame.positions.filter(pos => !subStepKeys.has(`${pos.r},${pos.c}`));
          applyRemovalAnimations(initialPositions, frame.animations);
          await sleep(config.timing.substepClear * pace);
          await playSubSteps(frame.subSteps, token, pace);
        } else {
          applyRemovalAnimations(frame.positions, frame.animations);
          showEffects(frame.effects);
          await sleep(config.timing.remove * pace);
        }
        break;
      }

      case 'board': {
        renderBoard(frame.board);
        if (frame.newSpecials && frame.newSpecials.length > 0) {
          for (const pos of frame.newSpecials) gems[posIdx(pos.r, pos.c)]?.classList.add('just-created');
          await sleep(config.timing.specialCreated);
          for (const pos of frame.newSpecials) gems[posIdx(pos.r, pos.c)]?.classList.remove('just-created');
        } else {
          await sleep(config.timing.boardSync);
        }
        break;
      }

      case 'drop':
        await animateGemMoves(frame.board, frame.moves, config.timing.drop, 90);
        break;

      case 'fill':
        await animateGemMoves(frame.board, frame.moves, config.timing.fill, 120, 'cubic-bezier(0.22, 0.95, 0.36, 1)');
        break;

      case 'preview':
        renderBoard(frame.board);
        for (const pos of frame.pendingPositions) gems[posIdx(pos.r, pos.c)]?.classList.add('pending-match');
        await sleep(config.timing.preview);
        for (const pos of frame.pendingPositions) gems[posIdx(pos.r, pos.c)]?.classList.remove('pending-match');
        break;

      case 'shuffle':
        if (!sawShuffle) {
          showToast('No moves left. Reshuffling.', 0);
          sawShuffle = true;
        }
        await animateShuffle(frame);
        break;

      default:
        break;
    }

    // Re-check after the awaits: a superseded loop must never pull another frame.
    if (token !== gameState.runToken) return;
  }

  if (sawShuffle) hideToast();
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer: number | undefined;

function showToast(text: string, ms = 2600): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  if (ms > 0) toastTimer = window.setTimeout(hideToast, ms);
}

function hideToast(): void {
  window.clearTimeout(toastTimer);
  toastEl.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function saveGame(): void {
  store.set(
    KEYS.game,
    serializeGame({
      rows: config.rows,
      cols: config.cols,
      gemTypes: config.gemTypes,
      board: engine.state.board,
      points: gameState.gamePoints,
      moves: gameState.gameMoves,
      maxCombo: gameState.maxCombo
    })
  );
}

function resetStats(): void {
  gameState.gamePoints = 0;
  gameState.gameMoves = 0;
  gameState.pendingPoints = 0;
  gameState.maxCombo = 0;
  gameState.selected = null;
  setScore(0, false);
  updateStats();
}

function syncUrl(): void {
  const url = new URL(window.location.toString());
  if (config.gemTypes === LIMITS.gems.default) url.searchParams.delete('gems');
  else url.searchParams.set('gems', String(config.gemTypes));
  if (config.cols === LIMITS.grid.default && config.rows === LIMITS.grid.default) url.searchParams.delete('grid');
  else url.searchParams.set('grid', formatGrid(config.cols, config.rows));
  history.replaceState({}, '', url);
}

async function dissolveBoard(): Promise<void> {
  gems.forEach((gemEl, i) => {
    if (gemEl.classList.contains('empty')) return;
    gemEl.style.setProperty('--d', `${(i % config.cols) * 10 + Math.random() * 90}ms`);
    gemEl.classList.add('dissolve');
  });
  await sleep(config.timing.dissolve);
  for (const gemEl of gems) {
    gemEl.classList.remove('dissolve');
    gemEl.style.removeProperty('--d');
  }
}

function reformBoard(): void {
  if (reducedMotion()) return;
  gems.forEach((gemEl, i) => {
    gemEl.style.setProperty('--d', `${Math.floor(i / config.cols) * 22 + (i % config.cols) * 8}ms`);
    gemEl.classList.add('reform');
  });
  setTimeout(() => {
    for (const gemEl of gems) {
      gemEl.classList.remove('reform');
      gemEl.style.removeProperty('--d');
    }
  }, config.timing.reform + 500);
}

async function startNewGame(options: { transition?: boolean } = {}): Promise<void> {
  // Supersede any in-flight move: playFrames bails out at the end of the frame it
  // is on without pulling another, and trySwap's finally block clears the lock.
  // The lock is then held for the whole transition, so no swap can start against
  // the outgoing board while the dissolve plays; it is released at the very end,
  // once the new board is up. A throw anywhere in between must still release it,
  // so the whole transition runs inside try/finally.
  gameState.runToken++;
  gameState.isProcessing = true;
  boardEl.classList.remove('processing');
  boardEl.setAttribute('aria-busy', 'true');

  try {
    const transition = options.transition !== false && !reducedMotion() && gameState.currentBoard !== null;
    if (transition) await dissolveBoard();

    let needsGridRebuild = false;
    if (settings.gemTypes !== config.gemTypes) {
      config.gemTypes = settings.gemTypes;
    }
    if (settings.rows !== config.rows || settings.cols !== config.cols) {
      config.rows = settings.rows;
      config.cols = settings.cols;
      needsGridRebuild = true;
    }
    syncUrl();

    if (!config.seedLocked) config.seed = Date.now();
    engine.reset({ rows: config.rows, cols: config.cols, gemTypes: config.gemTypes, seed: config.seed });

    if (needsGridRebuild) createGrid();

    const board = engine.init();
    resetStats();
    renderBoard(board);
    saveGame();
    reformBoard();
  } finally {
    boardEl.removeAttribute('aria-busy');
    gameState.isProcessing = false;
  }
}

// Resume the last settled board when it matches the current settings. A seeded
// URL is a request for a specific fresh board, so it never resumes.
function tryResume(): boolean {
  if (config.seedLocked) return false;
  const saved = parseSavedGame(store.get(KEYS.game), { rows: config.rows, cols: config.cols, gemTypes: config.gemTypes });
  if (!saved) return false;

  engine.reset({ rows: config.rows, cols: config.cols, gemTypes: config.gemTypes, seed: config.seed });
  engine.setBoard(saved.board);
  gameState.gamePoints = saved.points;
  gameState.gameMoves = saved.moves;
  gameState.maxCombo = saved.maxCombo;
  gameState.pendingPoints = 0;
  gameState.selected = null;
  setScore(saved.points, false);
  updateStats();
  renderBoard(cloneBoard(saved.board));
  syncUrl();
  reformBoard();
  return true;
}

function recordMove(points: number): void {
  if (points > 0) {
    gameState.gamePoints += points;
    gameState.gameMoves++;
  }
  setScore(gameState.gamePoints);
  updateStats();
  saveGame();
}

async function trySwap(pos1: Pos, pos2: Pos): Promise<void> {
  if (gameState.isProcessing) return;

  gameState.isProcessing = true;
  boardEl.classList.add('processing');
  boardEl.setAttribute('aria-busy', 'true');
  gameState.pendingPoints = 0;
  const localToken = ++gameState.runToken;

  const result = engine.swap(pos1, pos2);
  try {
    await playFrames(result.frames, localToken);
  } finally {
    // Must run even when a New Game superseded this move, or the board stays
    // locked behind pointer-events: none.
    boardEl.classList.remove('processing');
    boardEl.removeAttribute('aria-busy');
  }

  if (localToken !== gameState.runToken) return;

  gameState.isProcessing = false;
  gameState.pendingPoints = 0;
  recordMove(result.pointsEarned);
}

// ---------------------------------------------------------------------------
// Input: pointer and keyboard
// ---------------------------------------------------------------------------

function activateCell(pos: Pos): void {
  if (gameState.isProcessing) return;
  const selected = gameState.selected;

  if (selected && selected.r === pos.r && selected.c === pos.c) {
    gameState.selected = null;
    rerender();
    return;
  }

  if (selected && isAdjacent(selected, pos)) {
    gameState.selected = null;
    rerender();
    void trySwap(selected, pos);
    return;
  }

  gameState.selected = pos;
  rerender();
}

let pointerId: number | null = null;
let pointerStart: { pos: Pos; x: number; y: number; time: number } | null = null;
let dragTriggered = false;
const dragThreshold = 16;
const dragTimeGate = 120;

function cellFromEvent(event: Event): Pos | null {
  const target = event.target as HTMLElement | null;
  const cell = target?.closest('.cell') as HTMLDivElement | null;
  if (!cell) return null;
  return { r: Number(cell.dataset.row), c: Number(cell.dataset.col) };
}

boardEl.addEventListener('pointerdown', (event: PointerEvent) => {
  if (gameState.isProcessing) return;
  const pos = cellFromEvent(event);
  if (!pos) return;

  event.preventDefault();
  pointerId = event.pointerId;
  pointerStart = { pos, x: event.clientX, y: event.clientY, time: performance.now() };
  dragTriggered = false;
  boardEl.setPointerCapture(event.pointerId);
  gems[posIdx(pos.r, pos.c)]?.classList.add('touching');
});

boardEl.addEventListener('pointermove', (event: PointerEvent) => {
  if (!pointerStart || gameState.isProcessing || pointerId !== event.pointerId) return;

  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerStart.time;
  if (distance < dragThreshold || elapsed < dragTimeGate || dragTriggered) return;

  const delta = toBoardDelta(dx, dy, pose.rotation);
  const alongRow = Math.abs(delta.dc) > Math.abs(delta.dr);
  const start = pointerStart.pos;
  const target: Pos = {
    r: start.r + (alongRow ? 0 : delta.dr > 0 ? 1 : -1),
    c: start.c + (alongRow ? (delta.dc > 0 ? 1 : -1) : 0)
  };
  if (!isInBounds(target)) return;

  dragTriggered = true;
  gems[posIdx(start.r, start.c)]?.classList.remove('touching');
  gameState.selected = null;
  rerender();
  void trySwap(start, target);
});

boardEl.addEventListener('pointerup', (event: PointerEvent) => {
  if (!pointerStart || pointerId !== event.pointerId) return;

  gems[posIdx(pointerStart.pos.r, pointerStart.pos.c)]?.classList.remove('touching');
  boardEl.releasePointerCapture(event.pointerId);
  pointerId = null;

  const start = pointerStart.pos;
  const wasDrag = dragTriggered;
  pointerStart = null;
  dragTriggered = false;
  if (wasDrag) return;

  activateCell(start);
});

boardEl.addEventListener('pointercancel', (event: PointerEvent) => {
  if (pointerId !== event.pointerId) return;
  if (pointerStart) gems[posIdx(pointerStart.pos.r, pointerStart.pos.c)]?.classList.remove('touching');
  pointerId = null;
  pointerStart = null;
  dragTriggered = false;
});

// Arrow keys move by what the player sees, so the screen delta is rotated into
// board space exactly like a drag.
const screenDelta: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
};

boardEl.addEventListener('keydown', (event: KeyboardEvent) => {
  const pos = cellFromEvent(event);
  if (!pos) return;

  const screen = screenDelta[event.key];
  if (screen) {
    event.preventDefault();
    const d = toBoardDelta(screen[0], screen[1], pose.rotation);
    const next = { r: pos.r + d.dr, c: pos.c + d.dc };
    if (!isInBounds(next)) return;
    cells[posIdx(pos.r, pos.c)].tabIndex = -1;
    const target = cells[posIdx(next.r, next.c)];
    target.tabIndex = 0;
    target.focus();
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activateCell(pos);
  }
});

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function openSheet(sheet: HTMLDialogElement): void {
  if (sheet.open) return;
  sheet.showModal();
  // Focus the panel itself rather than the close button, which otherwise
  // opens every sheet with a focus ring on the X.
  sheet.querySelector<HTMLElement>('.sheet-body')?.focus({ preventScroll: true });
  if (reducedMotion()) {
    sheet.classList.add('open');
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  }
}

function closeSheet(sheet: HTMLDialogElement): void {
  if (!sheet.open) return;
  sheet.classList.remove('open');
  const finish = (): void => {
    if (sheet.open) sheet.close();
  };
  if (reducedMotion()) finish();
  else setTimeout(finish, 260);
}

function wireSheet(sheet: HTMLDialogElement, onDismiss?: () => void): void {
  sheet.addEventListener('cancel', event => {
    event.preventDefault();
    onDismiss?.();
    closeSheet(sheet);
  });
  sheet.addEventListener('click', event => {
    if (event.target === sheet) {
      onDismiss?.();
      closeSheet(sheet);
    }
  });
  for (const btn of sheet.querySelectorAll<HTMLButtonElement>('[data-close]')) {
    btn.addEventListener('click', () => {
      onDismiss?.();
      closeSheet(sheet);
    });
  }
}

// Settings ------------------------------------------------------------------

const SIZE_PRESETS = [6, 8, 10, 12, 16, 24];
const COLOR_PRESETS = [2, 3, 4, 5, 6, 7];

// The board is a rectangle glued to the device: cols is the short side, rows the
// long one. Tall multiplies the short side by 1.5, rounded; Square keeps them
// equal. A rectangle from the URL that is neither is treated as Square until the
// player changes something.
type Shape = 'square' | 'tall';
function tallRows(short: number): number {
  return Math.round(short * 1.5);
}
function shapeOf(cols: number, rows: number): Shape {
  return rows === tallRows(cols) ? 'tall' : 'square';
}
function currentShape(): Shape {
  return shapeSeg.querySelector<HTMLInputElement>('input:checked')?.value === 'tall' ? 'tall' : 'square';
}

const pending = { cols: settings.cols, rows: settings.rows, gemTypes: settings.gemTypes };

function renderSegments(container: HTMLElement, name: string, presets: number[], current: number, label: (v: number) => string): void {
  // A value set from the URL that is not a preset still gets a segment so the
  // control always reflects the truth.
  const values = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
  container.innerHTML = values
    .map(v => `<label><input type="radio" name="${name}" value="${v}"${v === current ? ' checked' : ''}><span>${label(v)}</span></label>`)
    .join('');
}

function renderShape(container: HTMLElement, current: Shape): void {
  const options: Array<{ value: Shape; label: string }> = [
    { value: 'square', label: 'Square' },
    { value: 'tall', label: 'Tall' }
  ];
  container.innerHTML = options
    .map(o => `<label><input type="radio" name="shape" value="${o.value}"${o.value === current ? ' checked' : ''}><span>${o.label}</span></label>`)
    .join('');
}

function syncSettingsUI(): void {
  renderSegments(sizeSeg, 'size', SIZE_PRESETS, pending.cols, v => String(v));
  renderShape(shapeSeg, shapeOf(pending.cols, pending.rows));
  renderSegments(colorsSeg, 'colors', COLOR_PRESETS, pending.gemTypes, v => String(v));
  updateApplyState();
  updateStats();
}

function updateApplyState(): void {
  const dirty = pending.cols !== config.cols || pending.rows !== config.rows || pending.gemTypes !== config.gemTypes;
  settingsDone.textContent = dirty ? 'Start new game' : 'Done';
  settingsDone.classList.toggle('btn-primary', dirty);
}

function revertPending(): void {
  pending.cols = config.cols;
  pending.rows = config.rows;
  pending.gemTypes = config.gemTypes;
}

sizeSeg.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const v = Number(input.value);
  pending.cols = v;
  pending.rows = currentShape() === 'tall' ? tallRows(v) : v;
  updateApplyState();
});

shapeSeg.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  pending.rows = input.value === 'tall' ? tallRows(pending.cols) : pending.cols;
  updateApplyState();
});

colorsSeg.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  pending.gemTypes = Number(input.value);
  updateApplyState();
});

for (const input of paletteInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings.palette = input.value as PaletteId;
    persistSettings();
    applyPalette(settings.palette);
    rerender();
  });
}

settingsDone.addEventListener('click', () => {
  const dirty = pending.cols !== config.cols || pending.rows !== config.rows || pending.gemTypes !== config.gemTypes;
  closeSheet(settingsSheet);
  if (!dirty) return;
  settings.cols = pending.cols;
  settings.rows = pending.rows;
  settings.gemTypes = pending.gemTypes;
  persistSettings();
  void startNewGame();
});

wireSheet(settingsSheet, () => {
  revertPending();
  syncSettingsUI();
});
wireSheet(helpSheet);

settingsBtn.addEventListener('click', () => {
  revertPending();
  syncSettingsUI();
  openSheet(settingsSheet);
});

helpBtn.addEventListener('click', () => openSheet(helpSheet));

turnBtn.addEventListener('click', turnBoard);
document.addEventListener('keydown', event => {
  if (event.key !== 'r' && event.key !== 'R') return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  turnBoard();
});

// New Game is a hold, not a tap: a stray touch during a long cascade must not
// throw the game away. The ring on the button fills over the hold.
const hold = createHold({
  durationMs: config.timing.holdToStart,
  onStart: () => newGameBtn.classList.add('holding'),
  onCancel: () => {
    // Keep the same animation, paused, while the ring fades at whatever fill it reached.
    newGameBtn.classList.replace('holding', 'draining');
    window.setTimeout(() => newGameBtn.classList.remove('draining'), 180);
  },
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

// Only a completed hold starts a game. There is deliberately no click handler: a
// tap or a click on its own does nothing.
newGameBtn.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  // Touch gets implicit pointer capture, which would swallow pointerleave; release
  // it so a finger that slides off the button cancels the hold like a mouse does.
  if (newGameBtn.hasPointerCapture(event.pointerId)) newGameBtn.releasePointerCapture(event.pointerId);
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
newGameBtn.addEventListener('keydown', event => {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  if (!event.repeat) hold.press();
});
newGameBtn.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') hold.release();
});

// Starts a new game with whatever the sheet shows: a pending size or colour
// change is applied first, so this button and the footer never disagree. It is
// the no-hold path for anyone who cannot hold New Game.
settingsNewGame.addEventListener('click', () => {
  settings.cols = pending.cols;
  settings.rows = pending.rows;
  settings.gemTypes = pending.gemTypes;
  persistSettings();
  closeSheet(settingsSheet);
  void startNewGame();
});

// ---------------------------------------------------------------------------
// Ambient drift, resize, first visit
// ---------------------------------------------------------------------------

// The background orbs drift slowly through hue over a long session (2° per
// minute, capped at 40°). Only the orbs: gem colours are never touched.
function updateDrift(): void {
  if (!ambientEl) return;
  const minutes = (Date.now() - sessionStart) / 60000;
  ambientEl.style.setProperty('--drift', `${Math.min(minutes * 2, 40).toFixed(1)}deg`);
}

setInterval(updateDrift, 60000);

let resizeRaf = 0;
function scheduleSizing(): void {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    updateBoardSizing();
  });
}

window.addEventListener('resize', scheduleSizing);

// The first measurement can run before the page has a settled layout (fonts,
// viewport), so measure again once the first frame has painted and once the
// web font has swapped in. Re-measuring is idempotent and cheap.
window.addEventListener('load', scheduleSizing);
document.fonts?.ready.then(scheduleSizing);

function showFirstVisitTip(): void {
  if (store.get(KEYS.visited)) return;
  showToast('Swap two gems to line up three of a kind', 0);
  const dismiss = (): void => {
    hideToast();
    store.set(KEYS.visited, '1');
    document.removeEventListener('pointerdown', dismiss);
    document.removeEventListener('keydown', dismiss);
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
  }, 500);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

applyPalette(settings.palette);
createGrid();
applyPose({ animate: false });
if (!tryResume()) {
  void startNewGame({ transition: false });
}
showFirstVisitTip();
