import './styles.css';
import {
  Engine,
  SPECIAL,
  type Board,
  type Frame,
  type Pos,
  type Effect,
  type RemovalAnim
} from './engine/index';

const ROWS = 8;
const COLS = 8;

const urlParams = new URLSearchParams(window.location.search);
let GEM_TYPES = parseInt(urlParams.get('gems') || '5', 10);
GEM_TYPES = Math.max(2, Math.min(10, GEM_TYPES));
let pendingGemTypes = GEM_TYPES;
const seedParam = urlParams.get('seed');
const seedLocked = seedParam !== null;
let seed = seedParam ? parseInt(seedParam, 10) : Date.now();

const engine = new Engine({ rows: ROWS, cols: COLS, gemTypes: GEM_TYPES, seed });
let currentBoard: Board = engine.state.board;

let selected: Pos | null = null;
let isProcessing = false;
let runToken = 0;
let pendingPoints = 0;

let gamePoints = 0;
let gameMoves = 0;
let distHistory: number[][] = [];
let scoreHistory: number[] = [];
let avgHistory: number[] = [];
const MAX_HISTORY = 20;

const boardEl = document.getElementById('board') as HTMLDivElement;
const avgScoreEl = document.getElementById('avgScore') as HTMLSpanElement;
const scoreHistoryEl = document.getElementById('scoreHistory') as HTMLDivElement;
const cascadeEl = document.getElementById('cascade') as HTMLDivElement;
const comboEl = document.getElementById('combo') as HTMLDivElement;
const chainEl = document.getElementById('chain') as HTMLDivElement;
const shuffleNotice = document.getElementById('shuffleNotice') as HTMLDivElement;
const distHistoryEl = document.getElementById('distHistory') as HTMLDivElement;
const avgSparklineEl = document.getElementById('avgSparkline') as HTMLCanvasElement;
const newGameBtn = document.getElementById('newGame') as HTMLButtonElement;
const gemSlider = document.getElementById('gemSlider') as HTMLInputElement;
const gemSliderValue = document.getElementById('gemSliderValue') as HTMLSpanElement;
const floatingMessage = document.getElementById('floatingMessage') as HTMLDivElement;

const cells: HTMLDivElement[] = [];
const gems: HTMLDivElement[] = [];

const gemColors = [
  '#7ec8e3',
  '#e07a5f',
  '#95d5b2',
  '#f4d35e',
  '#dda0dd',
  '#e8a87c',
  '#4ecdc4',
  '#ff9f43',
  '#5f6caf',
  '#ff6b9d'
];

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1
});
const standardFormatter = new Intl.NumberFormat(undefined);

function formatNumber(n: number): string {
  if (n >= 10000) return compactFormatter.format(n);
  return standardFormatter.format(n);
}

function createGrid(): void {
  boardEl.innerHTML = '';
  cells.length = 0;
  gems.length = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);

      const gem = document.createElement('div');
      gem.className = 'gem empty';
      cell.appendChild(gem);

      boardEl.appendChild(cell);
      cells.push(cell);
      gems.push(gem);
    }
  }
}

function renderBoard(board: Board): void {
  currentBoard = board;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const gemEl = gems[idx];
      const cell = board[r][c];

      if (!cell) {
        gemEl.className = 'gem empty';
        continue;
      }

      gemEl.className = `gem gem-${cell.type}`;

      if (cell.special === SPECIAL.BOMB) {
        gemEl.classList.add('special-bomb');
      } else if (cell.special === SPECIAL.LINE) {
        gemEl.classList.add('special-line');
        gemEl.classList.add(cell.direction || 'horizontal');
      } else if (cell.special === SPECIAL.RAINBOW) {
        gemEl.classList.add('special-rainbow');
      }

      if (selected && selected.r === r && selected.c === c) {
        gemEl.classList.add('selected');
      }
    }
  }
}

function getGemDistribution(board: Board): number[] {
  const counts = new Array(GEM_TYPES).fill(0);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) counts[board[r][c]!.type]++;
    }
  }
  return counts;
}

function renderSparkline(history: number[], isLive = false): void {
  const canvas = avgSparklineEl;
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

function renderStats(): void {
  distHistoryEl.innerHTML = distHistory.map(dist => {
    const total = dist.reduce((a, b) => a + b, 0) || 1;
    return `<div class="dist-bar">${dist.map((count, i) =>
      `<div class="dist-segment" style="height:${(count / total) * 24}px;background:${gemColors[i]}"></div>`
    ).join('')}</div>`;
  }).join('');

  renderSparkline(avgHistory, false);

  scoreHistoryEl.innerHTML = scoreHistory.map(s => `<span>+${formatNumber(s)}</span>`).join('');
}

function liveUpdateStats(board: Board): void {
  if (pendingPoints > 0 && gameMoves >= 0) {
    const projectedAvg = Math.round((gamePoints + pendingPoints) / (gameMoves + 1));
    avgScoreEl.textContent = formatNumber(projectedAvg);

    const liveHistory = [pendingPoints, ...scoreHistory.slice(0, 7)];
    scoreHistoryEl.innerHTML = liveHistory.map((s, i) =>
      `<span${i === 0 ? ' class="live"' : ''}>+${formatNumber(s)}</span>`
    ).join('');

    const liveAvgHistory = [...avgHistory, projectedAvg];
    renderSparkline(liveAvgHistory, true);
  }

  distHistoryEl.innerHTML = [...distHistory, getGemDistribution(board)].slice(-MAX_HISTORY).map(dist => {
    const total = dist.reduce((a, b) => a + b, 0) || 1;
    return `<div class="dist-bar">${dist.map((count, i) =>
      `<div class="dist-segment" style="height:${(count / total) * 24}px;background:${gemColors[i]}"></div>`
    ).join('')}</div>`;
  }).join('');
}

function recordMove(board: Board, points: number): void {
  distHistory.push(getGemDistribution(board));
  if (distHistory.length > MAX_HISTORY) distHistory.shift();

  if (points > 0) {
    scoreHistory.unshift(points);
    if (scoreHistory.length > 8) scoreHistory.pop();

    gamePoints += points;
    gameMoves++;
    const currentAvg = Math.round(gamePoints / gameMoves);
    avgScoreEl.textContent = formatNumber(currentAvg);

    avgHistory.push(currentAvg);
    if (avgHistory.length > MAX_HISTORY) avgHistory.shift();
  }

  renderStats();
}

function showCascade(count: number): void {
  if (count > 1) {
    cascadeEl.textContent = `${count}x Cascade!`;
    cascadeEl.classList.add('show');
  }
}

function showCombo(count: number): void {
  const texts = [
    null,
    null,
    { text: 'Good!', class: 'good' },
    { text: 'Great!', class: 'great' },
    { text: 'Amazing!', class: 'amazing' },
    { text: 'Incredible!', class: 'incredible' }
  ];

  const combo = texts[Math.min(count, texts.length - 1)];
  if (combo) {
    comboEl.textContent = combo.text;
    comboEl.className = `combo-text show ${combo.class}`;
  }
}

function showChainReaction(count: number): void {
  if (count > 0) {
    chainEl.textContent = `Chain x${count}!`;
    chainEl.classList.add('show');
  }
}

function showScorePopup(points: number, isBonus = false, isChain = false): void {
  const popup = document.createElement('div');
  popup.className = `score-popup${isChain ? ' chain' : (isBonus ? ' bonus' : '')}`;
  popup.textContent = `+${points}`;
  popup.style.left = '50%';
  popup.style.top = '45%';
  popup.style.transform = 'translateX(-50%)';
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1000);
}

function showExplosionEffect(r: number, c: number): void {
  const idx = r * COLS + c;
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
    const cell = cells[effect.row * COLS];
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

function applyRemovalAnimations(positions: Pos[], animations: Record<string, RemovalAnim>): void {
  for (const pos of positions) {
    const idx = pos.r * COLS + pos.c;
    const gemEl = gems[idx];
    if (!gemEl) continue;
    const key = `${pos.r},${pos.c}`;
    gemEl.classList.add(animations[key] || 'matched');
  }
}

async function playFrames(frames: Frame[], token: number): Promise<void> {
  let sawShuffle = false;

  for (const frame of frames) {
    if (token !== runToken) return;

    switch (frame.kind) {
      case 'swap':
        renderBoard(frame.board);
        await sleep(200);
        break;
      case 'invalid':
        for (const pos of frame.positions) {
          const idx = pos.r * COLS + pos.c;
          const gemEl = gems[idx];
          if (gemEl) gemEl.classList.add('invalid');
        }
        await sleep(400);
        break;
      case 'remove':
        showCascade(frame.score.cascade);
        showCombo(frame.score.cascade);
        showChainReaction(frame.score.chain);
        showScorePopup(frame.score.points, frame.score.isBonus, frame.score.chain > 0);
        pendingPoints += frame.score.points;
        liveUpdateStats(currentBoard);
        applyRemovalAnimations(frame.positions, frame.animations);
        frame.effects.forEach(effect => {
          if (effect.kind === 'explosion') {
            showExplosionEffect(effect.r, effect.c);
          } else {
            showLineEffect(effect);
          }
        });
        await sleep(400);
        break;
      case 'board':
        renderBoard(frame.board);
        await sleep(100);
        break;
      case 'drop':
        renderBoard(frame.board);
        await sleep(250);
        break;
      case 'fill':
        renderBoard(frame.board);
        await sleep(200);
        break;
      case 'shuffle':
        if (!sawShuffle) {
          shuffleNotice.classList.add('show');
          sawShuffle = true;
        }
        renderBoard(frame.board);
        await sleep(500);
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
  gamePoints = 0;
  gameMoves = 0;
  pendingPoints = 0;
  selected = null;
  avgScoreEl.textContent = '0';
  distHistory = [];
  scoreHistory = [];
  avgHistory = [];
  cascadeEl.classList.remove('show');
  comboEl.classList.remove('show');
  chainEl.classList.remove('show');
}

function startNewGame(): void {
  if (pendingGemTypes !== GEM_TYPES) {
    GEM_TYPES = pendingGemTypes;
    const newUrl = new URL(window.location.toString());
    if (GEM_TYPES === 5) {
      newUrl.searchParams.delete('gems');
    } else {
      newUrl.searchParams.set('gems', GEM_TYPES.toString());
    }
    history.replaceState({}, '', newUrl);
  }

  if (!seedLocked) {
    seed = Date.now();
  }

  engine.reset({ rows: ROWS, cols: COLS, gemTypes: GEM_TYPES, seed });
  const board = engine.init();
  resetStats();
  renderBoard(board);
  distHistory = [getGemDistribution(board)];
  renderStats();
  hideFloatingMessage();
}

async function trySwap(pos1: Pos, pos2: Pos): Promise<void> {
  if (isProcessing) return;

  isProcessing = true;
  pendingPoints = 0;
  const localToken = ++runToken;

  const result = engine.swap(pos1, pos2);
  await playFrames(result.frames, localToken);

  if (localToken !== runToken) return;

  isProcessing = false;
  recordMove(engine.state.board, result.pointsEarned);
  pendingPoints = 0;

  setTimeout(() => {
    cascadeEl.classList.remove('show');
    comboEl.classList.remove('show');
    chainEl.classList.remove('show');
  }, 500);
}

function isAdjacent(a: Pos, b: Pos): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

let pointerId: number | null = null;
let pointerStart: { pos: Pos; x: number; y: number } | null = null;
let dragTriggered = false;
const dragThreshold = 12;

boardEl.addEventListener('pointerdown', (event: PointerEvent) => {
  if (isProcessing) return;
  const target = event.target as HTMLElement | null;
  const cell = target?.closest('.cell') as HTMLDivElement | null;
  if (!cell) return;

  event.preventDefault();
  const r = Number(cell.dataset.row);
  const c = Number(cell.dataset.col);
  pointerId = event.pointerId;
  pointerStart = { pos: { r, c }, x: event.clientX, y: event.clientY };
  dragTriggered = false;
  boardEl.setPointerCapture(event.pointerId);

  if (!selected) {
    selected = { r, c };
    renderBoard(currentBoard);
  }
});

boardEl.addEventListener('pointermove', (event: PointerEvent) => {
  if (!pointerStart || isProcessing) return;
  if (pointerId !== event.pointerId) return;

  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  const distance = Math.hypot(dx, dy);

  if (distance < dragThreshold || dragTriggered) return;

  const horizontal = Math.abs(dx) > Math.abs(dy);
  const start = pointerStart.pos;
  const target: Pos = {
    r: start.r + (horizontal ? 0 : (dy > 0 ? 1 : -1)),
    c: start.c + (horizontal ? (dx > 0 ? 1 : -1) : 0)
  };

  if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    return;
  }

  dragTriggered = true;
  selected = null;
  renderBoard(currentBoard);
  void trySwap(start, target);
});

boardEl.addEventListener('pointerup', (event: PointerEvent) => {
  if (!pointerStart || pointerId !== event.pointerId) return;

  boardEl.releasePointerCapture(event.pointerId);
  pointerId = null;

  if (dragTriggered) {
    pointerStart = null;
    return;
  }

  const start = pointerStart.pos;
  pointerStart = null;

  if (!selected) {
    selected = start;
    renderBoard(currentBoard);
    return;
  }

  if (selected.r === start.r && selected.c === start.c) {
    selected = null;
    renderBoard(currentBoard);
    return;
  }

  if (isAdjacent(selected, start)) {
    const from = selected;
    selected = null;
    renderBoard(currentBoard);
    void trySwap(from, start);
    return;
  }

  selected = start;
  renderBoard(currentBoard);
});

boardEl.addEventListener('pointercancel', (event: PointerEvent) => {
  if (pointerId === event.pointerId) {
    pointerId = null;
    pointerStart = null;
    dragTriggered = false;
  }
});

newGameBtn.addEventListener('click', () => {
  if (isProcessing) {
    runToken++;
    isProcessing = false;
    setTimeout(startNewGame, 100);
    return;
  }
  startNewGame();
});

gemSlider.value = GEM_TYPES.toString();
gemSliderValue.textContent = GEM_TYPES.toString();
let floatingMessageTimeout: number | undefined;

gemSlider.addEventListener('input', () => {
  const newValue = parseInt(gemSlider.value, 10);
  gemSliderValue.textContent = newValue.toString();
  pendingGemTypes = newValue;

  if (newValue !== GEM_TYPES) {
    showFloatingMessage('New Game to apply');
    if (floatingMessageTimeout) window.clearTimeout(floatingMessageTimeout);
    floatingMessageTimeout = window.setTimeout(hideFloatingMessage, 3000);
  } else {
    hideFloatingMessage();
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

createGrid();
startNewGame();
