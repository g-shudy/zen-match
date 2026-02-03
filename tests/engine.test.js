import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine,
  RNG,
  SPECIAL,
  hasValidMoves,
  findValidMove
} from '../dist/engine.js';

function makeCell(type, special = SPECIAL.NONE, direction = null) {
  return { type, special, direction };
}

test('RNG is deterministic for a seed', () => {
  const rng1 = new RNG(123456);
  const rng2 = new RNG(123456);
  const seq1 = Array.from({ length: 5 }, () => rng1.int(1000));
  const seq2 = Array.from({ length: 5 }, () => rng2.int(1000));
  assert.deepEqual(seq1, seq2);
});

test('Special swap counts as a valid move', () => {
  const board = [
    [makeCell(0, SPECIAL.BOMB), makeCell(1, SPECIAL.LINE, 'horizontal')],
    [makeCell(2), makeCell(3)]
  ];
  assert.equal(hasValidMoves(board, 2, 2), true);
  const move = findValidMove(board, 2, 2);
  assert.deepEqual(move, { r1: 0, c1: 0, r2: 0, c2: 1 });
});

test('Swap that creates a match yields points', () => {
  const engine = new Engine({ rows: 3, cols: 3, gemTypes: 3, seed: 1 });
  const board = [
    [makeCell(0), makeCell(1), makeCell(0)],
    [makeCell(1), makeCell(0), makeCell(2)],
    [makeCell(2), makeCell(2), makeCell(1)]
  ];

  engine.setBoard(board);
  const result = engine.swap({ r: 0, c: 1 }, { r: 1, c: 1 });

  assert.equal(result.moveValid, true);
  assert.ok(result.pointsEarned > 0);
});
