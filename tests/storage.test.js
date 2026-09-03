import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  resolveSettings,
  parseGrid,
  formatGrid,
  serializeGame,
  parseSavedGame
} from '../dist/storage.js';

function makeBoard(rows, cols, type = 0) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ type, special: null, arms: null }))
  );
}

test('parseSettings falls back to defaults for missing or malformed input', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(''), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('[1,2,3]'), DEFAULT_SETTINGS);
});

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

test('parseSettings migrates a legacy palette key only when the blob has none', () => {
  assert.equal(parseSettings(null, 'redgreen').palette, 'redgreen');
  assert.equal(parseSettings('{"gridSize":8}', 'highcontrast').palette, 'highcontrast');
  assert.equal(parseSettings('{"palette":"redgreen"}', 'highcontrast').palette, 'redgreen');
  assert.equal(parseSettings(null, 'bogus').palette, 'default');
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

test('saved game survives a round trip and restores every field', () => {
  const board = makeBoard(4, 4, 2);
  board[1][2] = { type: 1, special: 'line', arms: 5 };
  const json = serializeGame({ rows: 4, cols: 4, gemTypes: 5, board, points: 1230, moves: 7, maxCombo: 3 }, 1700000000000);
  const saved = parseSavedGame(json, { rows: 4, cols: 4, gemTypes: 5 });
  assert.ok(saved);
  assert.equal(saved.v, 2);
  assert.equal(saved.savedAt, 1700000000000);
  assert.equal(saved.points, 1230);
  assert.equal(saved.moves, 7);
  assert.equal(saved.maxCombo, 3);
  assert.deepEqual(saved.board, board);
});

test('a rectangular saved game round-trips and a transposed shape is rejected', () => {
  const board = makeBoard(6, 4, 1); // 6 rows by 4 columns
  const json = serializeGame({ rows: 6, cols: 4, gemTypes: 5, board, points: 10, moves: 1, maxCombo: 1 }, 1);
  const saved = parseSavedGame(json, { rows: 6, cols: 4, gemTypes: 5 });
  assert.ok(saved, 'same shape resumes');
  assert.equal(saved.rows, 6);
  assert.equal(saved.cols, 4);
  assert.deepEqual(saved.board, board);
  assert.equal(parseSavedGame(json, { rows: 4, cols: 6, gemTypes: 5 }), null, 'a transposed shape is a different board');
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
  wrongVersion.v = 3;
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

  const badArms = JSON.parse(json);
  badArms.board[0][0] = { type: 0, special: 'line', arms: 16 };
  assert.equal(parseSavedGame(JSON.stringify(badArms), expect), null, 'arms above 15');

  const zeroArms = JSON.parse(json);
  zeroArms.board[0][0] = { type: 0, special: 'line', arms: 0 };
  assert.equal(parseSavedGame(JSON.stringify(zeroArms), expect), null, 'a beam gem must have an arm');

  const fractionalArms = JSON.parse(json);
  fractionalArms.board[0][0] = { type: 0, special: 'line', arms: 2.5 };
  assert.equal(parseSavedGame(JSON.stringify(fractionalArms), expect), null, 'fractional arms');

  const armsOnBomb = JSON.parse(json);
  armsOnBomb.board[0][0] = { type: 0, special: 'bomb', arms: 3 };
  assert.equal(parseSavedGame(JSON.stringify(armsOnBomb), expect), null, 'arms on a non-beam gem');

  const propeller = JSON.parse(json);
  propeller.board[0][0] = { type: 0, special: 'propeller', arms: null };
  assert.ok(parseSavedGame(JSON.stringify(propeller), expect), 'a propeller with no arms loads');

  const propellerArms = JSON.parse(json);
  propellerArms.board[0][0] = { type: 0, special: 'propeller', arms: 3 };
  assert.equal(parseSavedGame(JSON.stringify(propellerArms), expect), null, 'arms on a propeller');

  const negative = JSON.parse(json);
  negative.points = -5;
  assert.equal(parseSavedGame(JSON.stringify(negative), expect), null, 'negative points');

  const fractional = JSON.parse(json);
  fractional.moves = 1.5;
  assert.equal(parseSavedGame(JSON.stringify(fractional), expect), null, 'fractional moves');
});

function v1Game(cell) {
  const board = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ type: 2, special: null, direction: null }))
  );
  board[1][1] = cell;
  return JSON.stringify({ v: 1, rows: 4, cols: 4, gemTypes: 5, board, points: 40, moves: 2, maxCombo: 1, savedAt: 5 });
}

test('a v1 saved game migrates line directions to arms', () => {
  const expect = { rows: 4, cols: 4, gemTypes: 5 };
  const cases = [
    [{ type: 1, special: 'line', direction: 'horizontal' }, 10],
    [{ type: 1, special: 'line', direction: 'vertical' }, 5],
    [{ type: 1, special: 'line', direction: 'cross' }, 15],
    [{ type: 1, special: 'line', direction: null }, 10]
  ];
  for (const [cell, arms] of cases) {
    const saved = parseSavedGame(v1Game(cell), expect);
    assert.ok(saved, `v1 blob with direction ${cell.direction} must load`);
    assert.equal(saved.v, 2);
    assert.deepEqual(saved.board[1][1], { type: 1, special: 'line', arms });
    assert.deepEqual(saved.board[0][0], { type: 2, special: null, arms: null });
    assert.equal(saved.points, 40);
  }
});

test('a v1 saved game with an unknown direction or a bomb carrying a direction is rejected', () => {
  const expect = { rows: 4, cols: 4, gemTypes: 5 };
  assert.equal(parseSavedGame(v1Game({ type: 1, special: 'line', direction: 'diagonal' }), expect), null);
  assert.deepEqual(
    parseSavedGame(v1Game({ type: 1, special: 'bomb', direction: 'horizontal' }), expect)?.board[1][1],
    { type: 1, special: 'bomb', arms: null },
    'a stray direction on a non-line cell is dropped, as the old validator allowed it'
  );
});
