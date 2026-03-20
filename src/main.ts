import './styles.css';
import {
  Engine,
  SPECIAL,
  type Board,
  type Frame,
  type Pos,
  type Effect,
  type RemovalAnim,
  type RemovalSubStep
} from './engine/index';

document.getElementById('versionTag')!.addEventListener('click', () => {
  location.reload();
});

const urlParams = new URLSearchParams(window.location.search);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const seedParam = urlParams.get('seed');
const initGridSize = clamp(parseInt(urlParams.get('grid') || '8', 10), 4, 16);
const initGemTypes = clamp(parseInt(urlParams.get('gems') || '5', 10), 2, 10);

const config = {
  gridSize: initGridSize,
  rows: initGridSize,
  cols: initGridSize,
  gemTypes: initGemTypes,
  pendingGridSize: initGridSize,
  pendingGemTypes: initGemTypes,
  seed: seedParam ? parseInt(seedParam, 10) : Date.now(),
  seedLocked: seedParam !== null,
  maxHistory: 20,
  timing: {
    swap: 200,
    invalid: 400,
    remove: 400,
    substepTrigger: 150,
    substepClear: 300,
    boardSync: 100,
    specialCreated: 300,
    drop: 250,
    fill: 200,
    preview: 400,
    shufflePause: 500,
    shuffleMove: 700,
    comboHide: 500,
    scorePopup: 1000,
  },
};

const gameState = {
  selected: null as Pos | null,
  isProcessing: false,
  runToken: 0,
  pendingPoints: 0,
  gamePoints: 0,
  gameMoves: 0,
  currentBoard: null as Board | null,
  distHistory: [] as number[][],
  scoreHistory: [] as number[],
  avgHistory: [] as number[],
};

const engine = new Engine({ rows: config.rows, cols: config.cols, gemTypes: config.gemTypes, seed: config.seed });
gameState.currentBoard = engine.state.board;

// T44: Session start time for zen mode hue shift
let sessionStart = Date.now();

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

const boardEl = getEl<HTMLDivElement>('board');
const avgScoreEl = getEl<HTMLSpanElement>('avgScore');
const totalScoreEl = getEl<HTMLSpanElement>('totalScore');
const scoreHistoryEl = getEl<HTMLDivElement>('scoreHistory');
const comboCounterEl = getEl<HTMLDivElement>('comboCounter');
const shuffleNotice = getEl<HTMLDivElement>('shuffleNotice');
const distHistoryEl = document.getElementById('distHistory') as HTMLDivElement | null;
const avgSparklineEl = document.getElementById('avgSparkline') as HTMLCanvasElement | null;
const newGameBtn = getEl<HTMLButtonElement>('newGame');
const gemSlider = getEl<HTMLInputElement>('gemSlider');
const gemSliderValue = getEl<HTMLSpanElement>('gemSliderValue');
const gridSlider = getEl<HTMLInputElement>('gridSlider');
const gridSliderValue = getEl<HTMLSpanElement>('gridSliderValue');
const floatingMessage = getEl<HTMLDivElement>('floatingMessage');
const paletteSelect = getEl<HTMLSelectElement>('paletteSelect');
const settingsBtn = getEl<HTMLButtonElement>('settingsBtn');
const settingsPanel = getEl<HTMLDivElement>('settingsPanel');
const modeToggle = getEl<HTMLInputElement>('modeToggle');

const cells: HTMLDivElement[] = [];
const gems: HTMLDivElement[] = [];
const shapes: HTMLSpanElement[] = [];

const defaultGemColors = [
  '#7ec8e3', '#e07a5f', '#95d5b2', '#f4d35e', '#dda0dd',
  '#e8a87c', '#4ecdc4', '#ff9f43', '#5f6caf', '#ff6b9d'
];
let activeGemColors = [...defaultGemColors];

function refreshGemColors(): void {
  const style = getComputedStyle(document.documentElement);
  for (let i = 0; i < 10; i++) {
    const val = style.getPropertyValue(`--gem-color-${i}`).trim();
    activeGemColors[i] = val || defaultGemColors[i];
  }
}

function posIdx(r: number, c: number): number {
  return r * config.cols + c;
}

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1
});
const standardFormatter = new Intl.NumberFormat(undefined);

function formatNumber(n: number): string {
  if (n >= 10000) return compactFormatter.format(n);
  return standardFormatter.format(n);
}

function updateBoardSizing(): void {
  const maxBoardWidth = Math.min(window.innerWidth - 32, 500);
  const cellSize = Math.max(28, Math.floor(maxBoardWidth / config.cols));
  const gemSize = cellSize - 8;
  boardEl.style.setProperty('--grid-cols', String(config.cols));
  boardEl.style.setProperty('--cell-size', `${cellSize}px`);
  boardEl.style.setProperty('--gem-size', `${gemSize}px`);
}

function createGrid(): void {
  boardEl.innerHTML = '';
  cells.length = 0;
  gems.length = 0;
  shapes.length = 0;
  updateBoardSizing();

  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.tabIndex = 0;
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

  // Re-append overlay elements that live inside the board
  boardEl.appendChild(comboCounterEl);
}

function renderBoard(board: Board): void {
  gameState.currentBoard = board;
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const idx = posIdx(r, c);
      const gemEl = gems[idx];
      const shapeEl = shapes[idx];
      const cell = board[r][c];

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
        gemEl.classList.add(cell.direction || 'horizontal');
      } else if (cell.special === SPECIAL.RAINBOW) {
        gemEl.classList.add('special-rainbow');
      }

      if (gameState.selected && gameState.selected.r === r && gameState.selected.c === c) {
        gemEl.classList.add('selected');
      } else if (gameState.selected && isAdjacent(gameState.selected, { r, c })) {
        gemEl.classList.add('swap-target');
      }
    }
  }
}

function getGemDistribution(board: Board): number[] {
  const counts = new Array(config.gemTypes).fill(0);
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      if (board[r][c]) counts[board[r][c]!.type]++;
    }
  }
  return counts;
}

function renderSparkline(history: number[], isLive = false): void {
  const canvas = avgSparklineEl;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (history.length > 0) {
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;

    if (history.length > 1) {
      ctx.strokeStyle = 'rgba(149, 213, 178, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((val, i) => {
        const x = (i / (history.length - 1)) * w;
        const y = h - ((val - min) / range) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    const lastVal = history[history.length - 1];
    const lastX = history.length > 1 ? w : w / 2;
    const lastY = h - ((lastVal - min) / range) * h;
    ctx.fillStyle = isLive ? '#95d5b2' : '#f4d35e';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function distBarHTML(dist: number[]): string {
  const total = dist.reduce((a, b) => a + b, 0) || 1;
  return `<div class="dist-bar">${dist.map((count, i) =>
    `<div class="dist-segment" style="height:${(count / total) * 24}px;background:${activeGemColors[i]}"></div>`
  ).join('')}</div>`;
}

function renderStats(): void {
  if (distHistoryEl) {
    distHistoryEl.innerHTML = gameState.distHistory.map(dist => distBarHTML(dist)).join('');
  }

  renderSparkline(gameState.avgHistory, false);

  scoreHistoryEl.innerHTML = gameState.scoreHistory.map(s => `<span>+${formatNumber(s)}</span>`).join('');
}

function liveUpdateStats(board: Board): void {
  if (gameState.pendingPoints > 0) {
    const projectedAvg = Math.round((gameState.gamePoints + gameState.pendingPoints) / (gameState.gameMoves + 1));
    avgScoreEl.textContent = formatNumber(projectedAvg);

    const liveHistory = [gameState.pendingPoints, ...gameState.scoreHistory.slice(0, 7)];
    scoreHistoryEl.innerHTML = liveHistory.map((s, i) =>
      `<span${i === 0 ? ' class="live"' : ''}>+${formatNumber(s)}</span>`
    ).join('');

    const liveAvgHistory = [...gameState.avgHistory, projectedAvg];
    renderSparkline(liveAvgHistory, true);
  }

  if (distHistoryEl) {
    distHistoryEl.innerHTML = [...gameState.distHistory, getGemDistribution(board)].slice(-config.maxHistory).map(dist => distBarHTML(dist)).join('');
  }
}

function recordMove(board: Board, points: number): void {
  gameState.distHistory.push(getGemDistribution(board));
  if (gameState.distHistory.length > config.maxHistory) gameState.distHistory.shift();

  if (points > 0) {
    gameState.scoreHistory.unshift(points);
    if (gameState.scoreHistory.length > 8) gameState.scoreHistory.pop();

    gameState.gamePoints += points;
    gameState.gameMoves++;
    const currentAvg = Math.round(gameState.gamePoints / gameState.gameMoves);
    avgScoreEl.textContent = formatNumber(currentAvg);
    totalScoreEl.textContent = formatNumber(gameState.gamePoints);

    gameState.avgHistory.push(currentAvg);
    if (gameState.avgHistory.length > config.maxHistory) gameState.avgHistory.shift();
  }

  renderStats();
}

function showComboCounter(combo: number): void {
  if (combo >= 2) {
    comboCounterEl.textContent = `Combo x${combo}`;
    comboCounterEl.className = 'combo-counter show';
    if (combo >= 5) {
      comboCounterEl.classList.add('epic');
      if (document.body.dataset.mode !== 'zen') {
        boardEl.classList.add('combo-flash');
        setTimeout(() => boardEl.classList.remove('combo-flash'), 600);
      } else {
        // Zen mode: ambient orbs respond
        document.querySelector('.ambient')?.classList.add('combo-response');
        setTimeout(() => document.querySelector('.ambient')?.classList.remove('combo-response'), 1200);
      }
    } else if (combo >= 4) {
      comboCounterEl.classList.add('hot');
    } else if (combo >= 3) {
      comboCounterEl.classList.add('warm');
    }
  }
}

function showScorePopup(points: number, combo: number, positions: Pos[], isBonus = false): void {
  const popup = document.createElement('div');
  popup.className = `score-popup${isBonus ? ' bonus' : ''}`;

  const text = combo >= 2 ? `+${formatNumber(points)} x${combo}` : `+${formatNumber(points)}`;
  popup.textContent = text;

  // Scale font by point value
  const scale = Math.min(1 + Math.log10(Math.max(points, 10)) * 0.3, 2.5);
  popup.style.fontSize = `${scale}rem`;

  // Position at centroid of matched positions
  if (positions.length > 0) {
    const centroidR = positions.reduce((sum, p) => sum + p.r, 0) / positions.length;
    const centroidC = positions.reduce((sum, p) => sum + p.c, 0) / positions.length;

    const idx = Math.round(centroidR) * config.cols + Math.round(centroidC);
    const cell = cells[Math.min(idx, cells.length - 1)];
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const boardRect = boardEl.getBoundingClientRect();
      popup.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
      popup.style.top = `${rect.top - boardRect.top}px`;
      // Alternate drift direction based on combo count
      if (combo % 2 === 0) {
        popup.style.setProperty('--drift', '-30px');
      }
    }
  } else {
    popup.style.left = '50%';
    popup.style.top = '45%';
  }

  boardEl.appendChild(popup);
  setTimeout(() => popup.remove(), config.timing.scorePopup);
}

function showExplosionEffect(r: number, c: number): void {
  const idx = r * config.cols + c;
  const cell = cells[idx];
  if (!cell) return;

  const rect = cell.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();

  const effect = document.createElement('div');
  effect.className = 'explosion-effect';
  effect.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
  effect.style.top = `${rect.top - boardRect.top + rect.height / 2}px`;
  boardEl.appendChild(effect);

  setTimeout(() => effect.remove(), 500);
}

function showLineEffect(effect: Effect): void {
  if (effect.kind !== 'line') return;

  const el = document.createElement('div');
  el.className = `line-effect ${effect.direction}`;

  if (effect.direction === 'horizontal' && effect.row !== undefined) {
    const cell = cells[effect.row * config.cols];
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const boardRect = boardEl.getBoundingClientRect();
      el.style.top = `${rect.top - boardRect.top}px`;
    }
  }

  if (effect.direction === 'vertical' && effect.col !== undefined) {
    const cell = cells[effect.col];
    if (cell) {
      const rect = cell.getBoundingClientRect();
      const boardRect = boardEl.getBoundingClientRect();
      el.style.left = `${rect.left - boardRect.left}px`;
    }
  }

  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 400);
}

function showEffects(effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'explosion') {
      showExplosionEffect(effect.r, effect.c);
    } else {
      showLineEffect(effect);
    }
  }
}

let activeParticles = 0;
const MAX_PARTICLES = 20;

function spawnParticles(r: number, c: number, color: string, count = 6): void {
  const idx = posIdx(r, c);
  const cell = cells[idx];
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  const cx = rect.left - boardRect.left + rect.width / 2;
  const cy = rect.top - boardRect.top + rect.height / 2;

  for (let i = 0; i < count && activeParticles < MAX_PARTICLES; i++) {
    activeParticles++;
    const p = document.createElement('div');
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = 20 + Math.random() * 30;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    p.className = 'particle';
    p.style.cssText = `left:${cx}px;top:${cy}px;background:${color};--tx:${tx}px;--ty:${ty}px;`;
    boardEl.appendChild(p);
    p.addEventListener('animationend', () => { p.remove(); activeParticles--; }, { once: true });
  }
}

function applyRemovalAnimations(positions: Pos[], animations: Record<string, RemovalAnim>): void {
  for (const pos of positions) {
    const idx = posIdx(pos.r, pos.c);
    const gemEl = gems[idx];
    if (!gemEl) continue;
    const key = `${pos.r},${pos.c}`;
    gemEl.classList.add(animations[key] || 'matched');
    // Spawn particles matching the gem's color
    const cell = gameState.currentBoard?.[pos.r]?.[pos.c];
    if (cell) {
      spawnParticles(pos.r, pos.c, activeGemColors[cell.type] || '#fff', 4);
    }
  }
}

async function animateShuffle(frame: Extract<Frame, { kind: 'shuffle' }>, token: number): Promise<void> {
  if (!frame.moves || frame.moves.length === 0) {
    renderBoard(frame.board);
    await sleep(config.timing.shufflePause);
    return;
  }

  // FLIP technique: record old positions, render new, animate from old -> new
  const oldRects = new Map<number, DOMRect>();
  for (const move of frame.moves) {
    const idx = move.from.r * config.cols + move.from.c;
    const cell = cells[idx];
    if (cell) oldRects.set(idx, cell.getBoundingClientRect());
  }

  renderBoard(frame.board);

  // Animate gems from old position to new
  for (const move of frame.moves) {
    const newIdx = move.to.r * config.cols + move.to.c;
    const oldIdx = move.from.r * config.cols + move.from.c;
    const gemEl = gems[newIdx];
    const oldRect = oldRects.get(oldIdx);
    if (!gemEl || !oldRect) continue;

    const newRect = cells[newIdx].getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
      gemEl.style.transition = 'none';
    }
  }

  // Force layout
  void boardEl.offsetHeight;

  // Animate to final position with staggered timing
  for (const move of frame.moves) {
    const newIdx = move.to.r * config.cols + move.to.c;
    const gemEl = gems[newIdx];
    if (!gemEl) continue;

    const stagger = Math.random() * 100;
    gemEl.style.transition = `transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1) ${stagger}ms`;
    gemEl.style.transform = '';
  }

  await sleep(config.timing.shuffleMove);

  // Cleanup inline styles
  for (const move of frame.moves) {
    const newIdx = move.to.r * config.cols + move.to.c;
    const gemEl = gems[newIdx];
    if (gemEl) {
      gemEl.style.transition = '';
      gemEl.style.transform = '';
    }
  }
}

async function playSubSteps(subSteps: RemovalSubStep[], token: number, cascadeSpeed = 1): Promise<void> {
  for (const step of subSteps) {
    if (token !== gameState.runToken) return;

    // Show activation pulse on trigger gem
    const triggerIdx = step.triggerPos.r * config.cols + step.triggerPos.c;
    const triggerGem = gems[triggerIdx];
    if (triggerGem) triggerGem.classList.add('activating');
    await sleep(config.timing.substepTrigger * cascadeSpeed);

    // Show the effect
    for (const pos of step.positions) {
      const idx = pos.r * config.cols + pos.c;
      const gemEl = gems[idx];
      const key = `${pos.r},${pos.c}`;
      if (gemEl) gemEl.classList.add(step.animations[key] || 'matched');
    }
    showEffects(step.effects);
    await sleep(config.timing.substepClear * cascadeSpeed);

    if (triggerGem) triggerGem.classList.remove('activating');
  }
}

async function playFrames(frames: Frame[], token: number): Promise<void> {
  let sawShuffle = false;

  for (let i = 0; i < frames.length; i++) {
    if (token !== gameState.runToken) return;
    const frame = frames[i];

    switch (frame.kind) {
      case 'swap':
        renderBoard(frame.board);
        await sleep(config.timing.swap);
        break;
      case 'invalid': {
        // Determine slide direction from the two positions
        const p1 = frame.positions[0];
        const p2 = frame.positions[1];
        const dr = p2.r - p1.r;
        const dc = p2.c - p1.c;

        for (const pos of frame.positions) {
          const idx = posIdx(pos.r, pos.c);
          const gemEl = gems[idx];
          if (gemEl) {
            // First gem slides toward second, second slides toward first
            const isFirst = pos.r === p1.r && pos.c === p1.c;
            const slideR = isFirst ? dr : -dr;
            const slideC = isFirst ? dc : -dc;
            gemEl.style.setProperty('--slide-x', `${slideC * 12}px`);
            gemEl.style.setProperty('--slide-y', `${slideR * 12}px`);
            gemEl.classList.add('invalid');
          }
        }
        await sleep(config.timing.invalid);
        break;
      }
      case 'remove': {
        let cascadeSpeed: number;
        if (document.body.dataset.mode === 'zen') {
          // Zen: decelerate (each step slower), 350ms base, +8% per combo, cap 500ms
          const zenBase = 350;
          cascadeSpeed = Math.min(500, zenBase * Math.pow(1.08, frame.score.combo - 1)) / config.timing.remove;
        } else {
          // Classic: accelerate (each step faster)
          cascadeSpeed = Math.max(0.6, Math.pow(0.92, frame.score.combo - 1));
        }
        showComboCounter(frame.score.combo);
        showScorePopup(frame.score.points, frame.score.combo, frame.positions, frame.score.isBonus);
        gameState.pendingPoints += frame.score.points;
        liveUpdateStats(gameState.currentBoard!);

        // Phase 5B: If sub-steps exist, play them sequentially
        if (frame.subSteps && frame.subSteps.length > 0) {
          // Collect positions that subSteps will animate later
          const subStepKeys = new Set<string>();
          for (const step of frame.subSteps) {
            for (const pos of step.positions) {
              subStepKeys.add(`${pos.r},${pos.c}`);
            }
          }
          // Only animate initially matched positions, not chain-reaction victims
          const initialPositions = frame.positions.filter(pos => !subStepKeys.has(`${pos.r},${pos.c}`));
          applyRemovalAnimations(initialPositions, frame.animations);
          await sleep(config.timing.substepClear * cascadeSpeed);
          // Then play special activation sequences (which animate blast victims)
          await playSubSteps(frame.subSteps, token, cascadeSpeed);
        } else {
          applyRemovalAnimations(frame.positions, frame.animations);
          showEffects(frame.effects);
          await sleep(config.timing.remove * cascadeSpeed);
        }
        break;
      }
      case 'board': {
        renderBoard(frame.board);
        // Phase 5E: Longer pause and animation when new specials appear
        if (frame.newSpecials && frame.newSpecials.length > 0) {
          for (const pos of frame.newSpecials) {
            const idx = pos.r * config.cols + pos.c;
            const gemEl = gems[idx];
            if (gemEl) gemEl.classList.add('just-created');
          }
          await sleep(config.timing.specialCreated);
          for (const pos of frame.newSpecials) {
            const idx = pos.r * config.cols + pos.c;
            const gemEl = gems[idx];
            if (gemEl) gemEl.classList.remove('just-created');
          }
        } else {
          await sleep(config.timing.boardSync);
        }
        break;
      }
      case 'drop':
        renderBoard(frame.board);
        await sleep(config.timing.drop);
        break;
      case 'fill':
        renderBoard(frame.board);
        await sleep(config.timing.fill);
        break;
      case 'preview':
        // Phase 5A: Trembling preview of pending matches
        renderBoard(frame.board);
        for (const pos of frame.pendingPositions) {
          const idx = pos.r * config.cols + pos.c;
          const gemEl = gems[idx];
          if (gemEl) gemEl.classList.add('pending-match');
        }
        await sleep(config.timing.preview);
        for (const pos of frame.pendingPositions) {
          const idx = pos.r * config.cols + pos.c;
          const gemEl = gems[idx];
          if (gemEl) gemEl.classList.remove('pending-match');
        }
        break;
      case 'shuffle':
        if (!sawShuffle) {
          shuffleNotice.classList.add('show');
          sawShuffle = true;
        }
        await animateShuffle(frame, token);
        break;
      default:
        break;
    }
  }

  if (sawShuffle) {
    shuffleNotice.classList.remove('show');
  }
}

function showFloatingMessage(text: string): void {
  floatingMessage.textContent = text;
  floatingMessage.classList.add('visible');
}

function hideFloatingMessage(): void {
  floatingMessage.classList.remove('visible');
}

function resetStats(): void {
  gameState.gamePoints = 0;
  gameState.gameMoves = 0;
  gameState.pendingPoints = 0;
  gameState.selected = null;
  avgScoreEl.textContent = '0';
  gameState.distHistory = [];
  gameState.scoreHistory = [];
  gameState.avgHistory = [];
  comboCounterEl.classList.remove('show');
}

function startNewGame(): void {
  const newUrl = new URL(window.location.toString());
  let needsGridRebuild = false;

  if (config.pendingGemTypes !== config.gemTypes) {
    config.gemTypes = config.pendingGemTypes;
    if (config.gemTypes === 5) {
      newUrl.searchParams.delete('gems');
    } else {
      newUrl.searchParams.set('gems', config.gemTypes.toString());
    }
  }

  if (config.pendingGridSize !== config.gridSize) {
    config.gridSize = config.pendingGridSize;
    config.rows = config.gridSize;
    config.cols = config.gridSize;
    needsGridRebuild = true;
    if (config.gridSize === 8) {
      newUrl.searchParams.delete('grid');
    } else {
      newUrl.searchParams.set('grid', config.gridSize.toString());
    }
  }

  history.replaceState({}, '', newUrl);

  if (!config.seedLocked) {
    config.seed = Date.now();
  }

  engine.reset({ rows: config.rows, cols: config.cols, gemTypes: config.gemTypes, seed: config.seed });

  if (needsGridRebuild) {
    createGrid();
  }

  const board = engine.init();
  resetStats();
  renderBoard(board);
  gameState.distHistory = [getGemDistribution(board)];
  renderStats();
  hideFloatingMessage();
  resetHintTimer();
  // Reset session timer for zen mode hue shift
  sessionStart = Date.now();
}

async function trySwap(pos1: Pos, pos2: Pos): Promise<void> {
  if (gameState.isProcessing) return;

  clearHint();
  clearTimeout(hintTimer);

  gameState.isProcessing = true;
  boardEl.classList.add('processing');
  gameState.pendingPoints = 0;
  const localToken = ++gameState.runToken;

  const result = engine.swap(pos1, pos2);
  await playFrames(result.frames, localToken);

  if (localToken !== gameState.runToken) return;

  gameState.isProcessing = false;
  boardEl.classList.remove('processing');
  recordMove(engine.state.board, result.pointsEarned);
  gameState.pendingPoints = 0;

  setTimeout(() => {
    comboCounterEl.classList.remove('show');
  }, config.timing.comboHide);

  resetHintTimer();
}

function isAdjacent(a: Pos, b: Pos): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

let hintTimer: number | undefined;
let hintedCells: number[] = [];

function clearHint(): void {
  for (const idx of hintedCells) {
    gems[idx]?.classList.remove('hint-glow');
  }
  hintedCells = [];
}

function showHint(): void {
  if (gameState.isProcessing) return;
  clearHint();
  const move = engine.findValidMove();
  if (!move) return;
  const idx1 = posIdx(move.r1, move.c1);
  const idx2 = posIdx(move.r2, move.c2);
  gems[idx1]?.classList.add('hint-glow');
  gems[idx2]?.classList.add('hint-glow');
  hintedCells = [idx1, idx2];
}

function resetHintTimer(): void {
  clearTimeout(hintTimer);
  clearHint();
  hintTimer = window.setTimeout(showHint, 6000);
}

let pointerId: number | null = null;
let pointerStart: { pos: Pos; x: number; y: number; time: number } | null = null;
let dragTriggered = false;
const dragThreshold = 16;
const dragTimeGate = 120;

boardEl.addEventListener('pointerdown', (event: PointerEvent) => {
  if (gameState.isProcessing) return;
  const target = event.target as HTMLElement | null;
  const cell = target?.closest('.cell') as HTMLDivElement | null;
  if (!cell) return;

  event.preventDefault();
  resetHintTimer();
  const r = Number(cell.dataset.row);
  const c = Number(cell.dataset.col);
  pointerId = event.pointerId;
  pointerStart = { pos: { r, c }, x: event.clientX, y: event.clientY, time: performance.now() };
  dragTriggered = false;
  boardEl.setPointerCapture(event.pointerId);

  const gemIdx = posIdx(r, c);
  const gemEl = gems[gemIdx];
  if (gemEl) gemEl.classList.add('touching');
});

boardEl.addEventListener('pointermove', (event: PointerEvent) => {
  if (!pointerStart || gameState.isProcessing) return;
  if (pointerId !== event.pointerId) return;

  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerStart.time;

  if (distance < dragThreshold || elapsed < dragTimeGate || dragTriggered) return;

  const horizontal = Math.abs(dx) > Math.abs(dy);
  const start = pointerStart.pos;
  const target: Pos = {
    r: start.r + (horizontal ? 0 : (dy > 0 ? 1 : -1)),
    c: start.c + (horizontal ? (dx > 0 ? 1 : -1) : 0)
  };

  if (target.r < 0 || target.r >= config.rows || target.c < 0 || target.c >= config.cols) {
    return;
  }

  dragTriggered = true;
  // Remove touch feedback on drag
  const dragIdx = posIdx(start.r, start.c);
  gems[dragIdx]?.classList.remove('touching');
  gameState.selected = null;
  renderBoard(gameState.currentBoard!);
  void trySwap(start, target);
});

boardEl.addEventListener('pointerup', (event: PointerEvent) => {
  if (!pointerStart || pointerId !== event.pointerId) return;

  // Remove touch feedback
  const prevIdx = posIdx(pointerStart.pos.r, pointerStart.pos.c);
  gems[prevIdx]?.classList.remove('touching');

  boardEl.releasePointerCapture(event.pointerId);
  pointerId = null;

  if (dragTriggered) {
    pointerStart = null;
    return;
  }

  if (gameState.isProcessing) {
    pointerStart = null;
    return;
  }

  const start = pointerStart.pos;
  pointerStart = null;

  if (gameState.selected && gameState.selected.r === start.r && gameState.selected.c === start.c) {
    gameState.selected = null;
    renderBoard(gameState.currentBoard!);
    return;
  }

  if (gameState.selected && isAdjacent(gameState.selected, start)) {
    const from = gameState.selected;
    gameState.selected = null;
    renderBoard(gameState.currentBoard!);
    void trySwap(from, start);
    return;
  }

  gameState.selected = start;
  renderBoard(gameState.currentBoard!);
});

boardEl.addEventListener('pointercancel', (event: PointerEvent) => {
  if (pointerId === event.pointerId) {
    if (pointerStart) {
      const prevIdx = posIdx(pointerStart.pos.r, pointerStart.pos.c);
      gems[prevIdx]?.classList.remove('touching');
    }
    pointerId = null;
    pointerStart = null;
    dragTriggered = false;
  }
});

newGameBtn.addEventListener('click', () => {
  if (gameState.isProcessing) {
    gameState.runToken++;
    gameState.isProcessing = false;
    setTimeout(startNewGame, 100);
    return;
  }
  startNewGame();
});

gemSlider.value = config.gemTypes.toString();
gemSliderValue.textContent = config.gemTypes.toString();
gridSlider.value = config.gridSize.toString();
gridSliderValue.textContent = `${config.gridSize}x${config.gridSize}`;
let floatingMessageTimeout: number | undefined;

function showSliderChangeMessage(): void {
  if (config.pendingGemTypes !== config.gemTypes || config.pendingGridSize !== config.gridSize) {
    showFloatingMessage('New Game to apply');
    if (floatingMessageTimeout) window.clearTimeout(floatingMessageTimeout);
    floatingMessageTimeout = window.setTimeout(hideFloatingMessage, 3000);
  } else {
    hideFloatingMessage();
  }
}

gemSlider.addEventListener('input', () => {
  const newValue = parseInt(gemSlider.value, 10);
  gemSliderValue.textContent = newValue.toString();
  config.pendingGemTypes = newValue;
  showSliderChangeMessage();
});

gridSlider.addEventListener('input', () => {
  const newValue = parseInt(gridSlider.value, 10);
  gridSliderValue.textContent = `${newValue}x${newValue}`;
  config.pendingGridSize = newValue;
  showSliderChangeMessage();
});

paletteSelect.addEventListener('change', () => {
  const palette = paletteSelect.value;
  if (palette === 'default') {
    delete document.documentElement.dataset.palette;
  } else {
    document.documentElement.dataset.palette = palette;
  }
  localStorage.setItem('zen-match-palette', palette);
  refreshGemColors();
  renderBoard(gameState.currentBoard!);
  renderStats();
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener('resize', updateBoardSizing);

function showOnboarding(): void {
  if (localStorage.getItem('zen-match-visited')) return;

  const tip = document.createElement('div');
  tip.className = 'onboarding-tip';
  tip.textContent = 'Swap adjacent gems to match 3 or more';
  boardEl.appendChild(tip);

  const dismiss = () => {
    tip.remove();
    localStorage.setItem('zen-match-visited', '1');
    document.removeEventListener('pointerdown', dismiss);
  };

  // Dismiss on any tap after a short delay
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 500);
}

// Load saved mode (default is zen)
const savedMode = localStorage.getItem('zen-match-mode') || 'zen';
if (savedMode === 'classic') {
  document.body.dataset.mode = 'classic';
  modeToggle.checked = true;
} else {
  document.body.dataset.mode = 'zen';
}

modeToggle.addEventListener('change', () => {
  const mode = modeToggle.checked ? 'classic' : 'zen';
  document.body.dataset.mode = mode;
  localStorage.setItem('zen-match-mode', mode);
});

// T44: Session-length awareness (zen mode only)
function updateSessionHue(): void {
  if (document.body.dataset.mode !== 'zen') return;
  const elapsed = (Date.now() - sessionStart) / 1000 / 60; // minutes
  const degrees = Math.min(elapsed * 2, 40); // 2 deg/min, cap 40
  document.body.style.filter = degrees > 0.5 ? `hue-rotate(${degrees}deg)` : '';
}

setInterval(updateSessionHue, 60000);

// Load saved palette before refreshGemColors reads CSS custom properties
const savedPalette = localStorage.getItem('zen-match-palette') || 'default';
if (savedPalette !== 'default') {
  document.documentElement.dataset.palette = savedPalette;
  paletteSelect.value = savedPalette;
}

refreshGemColors();
createGrid();
startNewGame();
showOnboarding();
