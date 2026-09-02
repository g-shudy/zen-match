// Pure persistence helpers: settings and saved-game (de)serialisation with
// validation. No DOM, no localStorage - callers hand in strings and get back
// values they can trust. Anything malformed, out of range, or from a different
// board configuration is rejected rather than "repaired", because a bad board
// silently breaks the engine's invariants.

import type { Board, Cell } from './engine/index';

export const PALETTES = ['default', 'redgreen', 'highcontrast'] as const;
export type PaletteId = (typeof PALETTES)[number];

export const LIMITS = {
  grid: { min: 4, max: 16, default: 8 },
  gems: { min: 2, max: 10, default: 5 }
} as const;

export interface Settings {
  gridSize: number;
  gemTypes: number;
  palette: PaletteId;
}

export const DEFAULT_SETTINGS: Settings = {
  gridSize: LIMITS.grid.default,
  gemTypes: LIMITS.gems.default,
  palette: 'default'
};

// Math.max(lo, Math.min(hi, NaN)) is NaN, so a bare clamp lets non-numeric input
// through. Anything that does not parse to a finite integer becomes the fallback.
export function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function isPalette(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(json: string | null | undefined): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// `legacyPalette` is the value of the pre-2.0 standalone palette key; it only
// applies when the settings blob carries no palette of its own.
export function parseSettings(json: string | null | undefined, legacyPalette?: string | null): Settings {
  const raw = asRecord(parseJson(json)) ?? {};
  const palette = isPalette(raw.palette)
    ? raw.palette
    : isPalette(legacyPalette)
      ? legacyPalette
      : DEFAULT_SETTINGS.palette;
  return {
    gridSize: clampInt(raw.gridSize, LIMITS.grid.min, LIMITS.grid.max, DEFAULT_SETTINGS.gridSize),
    gemTypes: clampInt(raw.gemTypes, LIMITS.gems.min, LIMITS.gems.max, DEFAULT_SETTINGS.gemTypes),
    palette
  };
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}

// URL parameters win over stored values for the board shape so links stay
// shareable; the palette is a personal preference and never comes from the URL.
export function resolveSettings(params: URLSearchParams, stored: Settings): Settings {
  return {
    gridSize: clampInt(params.get('grid'), LIMITS.grid.min, LIMITS.grid.max, stored.gridSize),
    gemTypes: clampInt(params.get('gems'), LIMITS.gems.min, LIMITS.gems.max, stored.gemTypes),
    palette: stored.palette
  };
}

export interface SavedGame {
  v: 1;
  rows: number;
  cols: number;
  gemTypes: number;
  board: Board;
  points: number;
  moves: number;
  maxCombo: number;
  savedAt: number;
}

export type GameSnapshot = Omit<SavedGame, 'v' | 'savedAt'>;

export function serializeGame(game: GameSnapshot, now: number = Date.now()): string {
  const saved: SavedGame = { v: 1, ...game, savedAt: now };
  return JSON.stringify(saved);
}

const SPECIALS = new Set<unknown>([null, 'bomb', 'line', 'rainbow']);
const DIRECTIONS = new Set<unknown>([null, 'horizontal', 'vertical', 'cross']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCell(value: unknown, gemTypes: number): value is Cell {
  const cell = asRecord(value);
  if (!cell) return false;
  if (!isCount(cell.type) || cell.type >= gemTypes) return false;
  if (!SPECIALS.has(cell.special ?? null)) return false;
  if (!DIRECTIONS.has(cell.direction ?? null)) return false;
  return true;
}

function isBoard(value: unknown, rows: number, cols: number, gemTypes: number): value is Board {
  if (!Array.isArray(value) || value.length !== rows) return false;
  return value.every(row =>
    Array.isArray(row) && row.length === cols && row.every(cell => isCell(cell, gemTypes))
  );
}

// Returns the saved game only if it was recorded for exactly this board shape and
// gem count; a board saved under other settings cannot be resumed meaningfully.
export function parseSavedGame(
  json: string | null | undefined,
  expect: { rows: number; cols: number; gemTypes: number }
): SavedGame | null {
  const raw = asRecord(parseJson(json));
  if (!raw || raw.v !== 1) return null;
  if (raw.rows !== expect.rows || raw.cols !== expect.cols || raw.gemTypes !== expect.gemTypes) return null;
  if (!isBoard(raw.board, expect.rows, expect.cols, expect.gemTypes)) return null;
  if (!isCount(raw.points) || !isCount(raw.moves) || !isCount(raw.maxCombo)) return null;
  const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0;

  return {
    v: 1,
    rows: expect.rows,
    cols: expect.cols,
    gemTypes: expect.gemTypes,
    board: raw.board.map(row =>
      row.map(cell => ({
        type: cell!.type,
        special: cell!.special ?? null,
        direction: cell!.direction ?? null
      }))
    ),
    points: raw.points,
    moves: raw.moves,
    maxCombo: raw.maxCombo,
    savedAt
  };
}
