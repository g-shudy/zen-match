import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  resolveSettings,
  serializeGame,
  parseSavedGame
} from '../dist/storage.js';

function makeBoard(rows, cols, type = 0) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ type, special: null, direction: null }))
  );
}

test('parseSettings falls back to defaults for missing or malformed input', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(''), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('[1,2,3]'), DEFAULT_SETTINGS);
});

test('parseSettings clamps ranges and rejects unknown palettes', () => {
  const s = parseSettings('{"gridSize":"12","gemTypes":99,"palette":"nope"}');
  assert.deepEqual(s, { gridSize: 12, gemTypes: 10, palette: 'default' });

  const low = parseSettings('{"gridSize":1,"gemTypes":-4,"palette":"highcontrast"}');
  assert.deepEqual(low, { gridSize: 4, gemTypes: 2, palette: 'highcontrast' });

  const nan = parseSettings('{"gridSize":"abc","gemTypes":null}');
  assert.deepEqual(nan, DEFAULT_SETTINGS);
});

test('parseSettings migrates a legacy palette key only when the blob has none', () => {
  assert.equal(parseSettings(null, 'redgreen').palette, 'redgreen');
  assert.equal(parseSettings('{"gridSize":8}', 'highcontrast').palette, 'highcontrast');
  assert.equal(parseSettings('{"palette":"redgreen"}', 'highcontrast').palette, 'redgreen');
  assert.equal(parseSettings(null, 'bogus').palette, 'default');
});

test('settings survive a serialize/parse round trip', () => {
  const s = { gridSize: 10, gemTypes: 6, palette: 'redgreen' };
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
});

test('resolveSettings lets valid URL params override stored board values', () => {
  const stored = { gridSize: 8, gemTypes: 5, palette: 'highcontrast' };
  assert.deepEqual(
    resolveSettings(new URLSearchParams('grid=10&gems=7'), stored),
    { gridSize: 10, gemTypes: 7, palette: 'highcontrast' }
  );
  // Non-numeric values are ignored, out-of-range values are clamped.
  assert.deepEqual(
    resolveSettings(new URLSearchParams('grid=abc&gems=99'), stored),
    { gridSize: 8, gemTypes: 10, palette: 'highcontrast' }
  );
  assert.deepEqual(resolveSettings(new URLSearchParams(''), stored), stored);
});

test('saved game survives a round trip and restores every field', () => {
  const board = makeBoard(4, 4, 2);
  board[1][2] = { type: 1, special: 'line', direction: 'vertical' };
  const json = serializeGame({ rows: 4, cols: 4, gemTypes: 5, board, points: 1230, moves: 7, maxCombo: 3 }, 1700000000000);
  const saved = parseSavedGame(json, { rows: 4, cols: 4, gemTypes: 5 });
  assert.ok(saved);
  assert.equal(saved.v, 1);
  assert.equal(saved.savedAt, 1700000000000);
  assert.equal(saved.points, 1230);
  assert.equal(saved.moves, 7);
  assert.equal(saved.maxCombo, 3);
  assert.deepEqual(saved.board, board);
});

test('parseSavedGame rejects anything that does not fit the current board', () => {
  const board = makeBoard(4, 4, 1);
  const json = serializeGame({ rows: 4, cols: 4, gemTypes: 5, board, points: 10, moves: 1, maxCombo: 1 });
  const expect = { rows: 4, cols: 4, gemTypes: 5 };

  assert.equal(parseSavedGame(null, expect), null);
  assert.equal(parseSavedGame('garbage', expect), null);
  assert.equal(parseSavedGame(json, { rows: 8, cols: 8, gemTypes: 5 }), null, 'different grid');
  assert.equal(parseSavedGame(json, { rows: 4, cols: 4, gemTypes: 6 }), null, 'different gem count');

  const wrongVersion = JSON.parse(json);
  wrongVersion.v = 2;
  assert.equal(parseSavedGame(JSON.stringify(wrongVersion), expect), null);

  const outOfRange = JSON.parse(json);
  outOfRange.board[0][0].type = 5;
  assert.equal(parseSavedGame(JSON.stringify(outOfRange), expect), null, 'gem type out of range');

  const hole = JSON.parse(json);
  hole.board[2][3] = null;
  assert.equal(parseSavedGame(JSON.stringify(hole), expect), null, 'board with a hole');

  const ragged = JSON.parse(json);
  ragged.board[3] = ragged.board[3].slice(0, 3);
  assert.equal(parseSavedGame(JSON.stringify(ragged), expect), null, 'ragged row');

  const badSpecial = JSON.parse(json);
  badSpecial.board[0][0].special = 'nuke';
  assert.equal(parseSavedGame(JSON.stringify(badSpecial), expect), null, 'unknown special');

  const badDirection = JSON.parse(json);
  badDirection.board[0][0] = { type: 0, special: 'line', direction: 'diagonal' };
  assert.equal(parseSavedGame(JSON.stringify(badDirection), expect), null, 'unknown direction');

  const negative = JSON.parse(json);
  negative.points = -5;
  assert.equal(parseSavedGame(JSON.stringify(negative), expect), null, 'negative points');

  const fractional = JSON.parse(json);
  fractional.moves = 1.5;
  assert.equal(parseSavedGame(JSON.stringify(fractional), expect), null, 'fractional moves');
});
