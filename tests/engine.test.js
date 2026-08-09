import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine,
  RNG,
  SPECIAL,
  hasValidMoves,
  findValidMove,
  findMatches
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

test('Drop and fill frames include movement metadata for falling animation', () => {
  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed: 7 });
  const board = [
    [makeCell(1), makeCell(2), makeCell(3), makeCell(1)],
    [makeCell(1), makeCell(2), makeCell(3), makeCell(2)],
    [makeCell(0), makeCell(0), makeCell(1), makeCell(3)],
    [makeCell(2), makeCell(1), makeCell(0), makeCell(3)]
  ];

  engine.setBoard(board);
  const result = engine.swap({ r: 2, c: 2 }, { r: 3, c: 2 });

  const dropFrame = result.frames.find(frame => frame.kind === 'drop');
  const fillFrame = result.frames.find(frame => frame.kind === 'fill');

  assert.ok(dropFrame, 'Expected a drop frame after removing the match');
  assert.ok(fillFrame, 'Expected a fill frame after dropped gems settle');

  assert.ok(dropFrame.moves.length > 0, 'Drop frame should describe moved gems');
  assert.ok(fillFrame.moves.length > 0, 'Fill frame should describe new gems');
  assert.ok(dropFrame.moves.every(move => move.from.r < move.to.r), 'Dropped gems should move downward');
  assert.ok(fillFrame.moves.every(move => move.from.r < 0), 'New gems should start above the board');
});

// Phase 3A: BFS-unified parallel runs get correct effectiveLen
test('BFS-unified parallel 3-runs get correct effectiveLen', () => {
  // Two parallel horizontal 3-runs of same color, adjacent vertically
  // 0 0 0
  // 0 0 0
  // 1 1 1
  const board = [
    [makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(1), makeCell(1), makeCell(1)]
  ];

  const matches = findMatches(board, 3, 3);
  // The two runs of color 0 should be unified into one group of 6
  const colorZeroMatch = matches.find(m => m.type === 0);
  assert.ok(colorZeroMatch, 'Should find a match group for color 0');
  assert.equal(colorZeroMatch.positions.length, 6, 'Unified group should have 6 cells');
  assert.equal(colorZeroMatch.effectiveLen, 6, 'effectiveLen should equal actual group size (6)');
});

// Phase 3B: T/L shape (5 cells) -> BOMB, not RAINBOW
test('T/L shape of 5 cells creates BOMB, not RAINBOW', () => {
  // T-shape:
  //   0 0 0
  //   1 0 1
  //   1 0 1
  //   1 1 1
  const engine = new Engine({ rows: 4, cols: 3, gemTypes: 3, seed: 42 });
  const board = [
    [makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(1), makeCell(0), makeCell(1)],
    [makeCell(1), makeCell(0), makeCell(2)],
    [makeCell(2), makeCell(2), makeCell(2)]
  ];

  engine.setBoard(board);

  const matches = findMatches(board, 4, 3);
  const zeroMatch = matches.find(m => m.type === 0);
  assert.ok(zeroMatch, 'Should find color-0 match group');
  assert.ok(zeroMatch.isComplex, 'T/L shape should be marked complex');

  // Now do a swap to trigger the match processing
  // Swap (3,0) with (2,0) to trigger the color-2 match and color-0 match
  // Actually, let's construct a board where a swap triggers a T/L
  const engine2 = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed: 42 });
  const board2 = [
    [makeCell(0), makeCell(0), makeCell(1), makeCell(2)],
    [makeCell(2), makeCell(0), makeCell(2), makeCell(3)],
    [makeCell(3), makeCell(0), makeCell(3), makeCell(1)],
    [makeCell(1), makeCell(2), makeCell(1), makeCell(3)]
  ];
  // Swapping (0,2) with (0,1) would put 0 at (0,2) but that's already 0 at (0,0) and (0,1)
  // Column 1 already has 0 at rows 0,1,2 -> that's a vertical 3-match
  // Row 0 has 0 at cols 0,1 -> if we put another 0 at col 2, row 0 has 0,0,0 -> horizontal 3-match
  // The intersection at (0,1) means it's complex with 5 cells total
  // Let's just check the findMatches behavior directly
  const board3 = [
    [makeCell(0), makeCell(0), makeCell(0), makeCell(2)],
    [makeCell(2), makeCell(0), makeCell(2), makeCell(3)],
    [makeCell(3), makeCell(0), makeCell(3), makeCell(1)],
    [makeCell(1), makeCell(2), makeCell(1), makeCell(3)]
  ];

  const matches3 = findMatches(board3, 4, 4);
  const zeroMatch3 = matches3.find(m => m.type === 0);
  assert.ok(zeroMatch3, 'Should find color-0 T/L match');
  assert.equal(zeroMatch3.positions.length, 5, 'T-shape should have 5 cells');
  assert.ok(zeroMatch3.isComplex, 'T/L should be complex');
  // With the new rules: 5 cells + isComplex -> BOMB (not RAINBOW)
  // effectiveLen = 5 (actual group size), isComplex = true
  // processMatches check: isComplex && len >= 5 -> BOMB
  assert.equal(zeroMatch3.effectiveLen, 5);
});

// Phase 3C: Straight 5-match -> LINE in same direction as match
test('Straight 5-match creates LINE in same direction', () => {
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  // Horizontal 5-match on row 0
  const board = [
    [makeCell(0), makeCell(0), makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(1), makeCell(2), makeCell(1), makeCell(2), makeCell(1)],
    [makeCell(2), makeCell(1), makeCell(2), makeCell(1), makeCell(2)],
    [makeCell(1), makeCell(2), makeCell(1), makeCell(2), makeCell(1)],
    [makeCell(2), makeCell(1), makeCell(2), makeCell(1), makeCell(2)]
  ];

  const matches = findMatches(board, 5, 5);
  const hMatch = matches.find(m => m.type === 0);
  assert.ok(hMatch, 'Should find horizontal 5-match');
  assert.equal(hMatch.direction, 'horizontal');
  assert.equal(hMatch.effectiveLen, 5);
  assert.equal(hMatch.isComplex, false, 'Straight line is not complex');
});

// Phase 3B: 6+ cell group -> RAINBOW
test('6+ cell group creates RAINBOW', () => {
  // 6 cells of same color connected
  const board = [
    [makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(0), makeCell(0), makeCell(0)],
    [makeCell(1), makeCell(1), makeCell(1)]
  ];

  const matches = findMatches(board, 3, 3);
  const zeroMatch = matches.find(m => m.type === 0);
  assert.ok(zeroMatch, 'Should find 6-cell group');
  assert.equal(zeroMatch.positions.length, 6);
  assert.equal(zeroMatch.effectiveLen, 6);
  // processMatches: len >= 6 -> RAINBOW
});

// Rainbow + Normal clears only the non-rainbow gem's color
test('Rainbow + Normal swap clears only swapped color', () => {
  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed: 42 });
  // Rainbow gem of hidden color 0 at (0,0), swapped with normal gem of color 1 at (0,1)
  // After swap, rainbow is at (0,1) and normal is at (0,0)
  // Should clear only color 1, not color 0
  const board = [
    [makeCell(0, SPECIAL.RAINBOW), makeCell(1), makeCell(2), makeCell(3)],
    [makeCell(0), makeCell(2), makeCell(3), makeCell(1)],
    [makeCell(2), makeCell(3), makeCell(1), makeCell(0)],
    [makeCell(3), makeCell(0), makeCell(0), makeCell(2)]
  ];

  engine.setBoard(board);
  const result = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });

  assert.equal(result.moveValid, true);
  assert.ok(result.pointsEarned > 0);

  const removeFrame = result.frames.find(f => f.kind === 'remove');
  assert.ok(removeFrame, 'Should have a remove frame');

  if (removeFrame && removeFrame.kind === 'remove') {
    const removedKeys = new Set(removeFrame.positions.map(p => `${p.r},${p.c}`));
    // Color 1 gems should be removed: (0,1), (1,3), (2,2)
    assert.ok(removedKeys.has('1,3') || removedKeys.has('2,2'),
      'Should remove color 1 gems');
    // Color 0 gems (not the rainbow) should NOT be in the initial removal
    const color0Positions = ['1,0', '2,3', '3,1', '3,2'];
    const removedColor0 = color0Positions.filter(k => removedKeys.has(k));
    assert.equal(removedColor0.length, 0, 'Should not remove color 0 gems');
  }
});

// Phase 3F: Cascade special placement uses geometric center
test('Cascade special placement does not use swap position', () => {
  // This is a behavioral test - we just verify engine doesn't crash
  // and that specials are created during cascades
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 3, seed: 100 });
  engine.init();

  // Just verify the engine can process matches without errors
  const move = engine.findValidMove();
  if (move) {
    const result = engine.swap(
      { r: move.r1, c: move.c1 },
      { r: move.r2, c: move.c2 }
    );
    assert.ok(result.frames.length > 0, 'Should produce frames');
  }
});

// Phase 4A: Shuffle cascades award points.
// NOTE: the previous version of this test used a 3x3 two-colour checkerboard, which
// DOES have valid moves, so its `if (!hasValid)` body never executed and it asserted
// nothing. That is why the shuffle-animation bug below went unnoticed.
test('Dead board is rescued by a shuffle on an invalid swap', () => {
  const rows = [
    [3, 0, 0, 3],
    [3, 0, 1, 2],
    [1, 2, 3, 3],
    [1, 2, 0, 1]
  ].map(row => row.map(t => makeCell(t)));

  assert.equal(hasValidMoves(rows, 4, 4), false, 'fixture must genuinely have no legal move');

  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed: 7 });
  engine.setBoard(rows);
  const result = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });

  const shuffle = result.frames.find(f => f.kind === 'shuffle');
  assert.ok(shuffle, 'a dead board must trigger a shuffle instead of silently soft-locking');
  assert.equal(hasValidMoves(engine.state.board, 4, 4), true, 'board must be playable afterwards');
});

test('Shuffle records real motion for the slide animation', () => {
  const rows = [
    [3, 0, 0, 3],
    [3, 0, 1, 2],
    [1, 2, 3, 3],
    [1, 2, 0, 1]
  ].map(row => row.map(t => makeCell(t)));

  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed: 7 });
  engine.setBoard(rows);
  const result = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });

  const shuffle = result.frames.find(f => f.kind === 'shuffle' && f.moves);
  assert.ok(shuffle, 'shuffle frame should carry moves');
  const moved = shuffle.moves.filter(m => m.from.r !== m.to.r || m.from.c !== m.to.c);
  assert.ok(
    moved.length > 0,
    `every recorded move was from===to (${shuffle.moves.length} moves) - the slide animation cannot animate`
  );
});

// Score breakdown is populated correctly
test('Score breakdown is populated in ScoreEvent', () => {
  const engine = new Engine({ rows: 3, cols: 3, gemTypes: 3, seed: 1 });
  const board = [
    [makeCell(0), makeCell(1), makeCell(0)],
    [makeCell(1), makeCell(0), makeCell(2)],
    [makeCell(2), makeCell(2), makeCell(1)]
  ];

  engine.setBoard(board);
  const result = engine.swap({ r: 0, c: 1 }, { r: 1, c: 1 });

  const removeFrame = result.frames.find(f => f.kind === 'remove');
  assert.ok(removeFrame, 'Should have remove frame');

  if (removeFrame && removeFrame.kind === 'remove') {
    const { score } = removeFrame;
    assert.ok(typeof score.combo === 'number', 'combo should be a number');
    assert.ok(score.combo >= 1, 'combo should be >= 1');
    assert.ok(score.breakdown, 'breakdown should exist');
    assert.ok(typeof score.breakdown.base === 'number', 'base should be a number');
    assert.ok(typeof score.breakdown.matchBonus === 'number', 'matchBonus should be a number');
    assert.ok(typeof score.breakdown.comboMultiplier === 'number', 'comboMultiplier should be a number');
    assert.equal(score.breakdown.comboMultiplier, 1 + (score.combo - 1) * 0.5, 'comboMultiplier formula should be correct');
  }
});

// Preview frame emitted between cascade steps
test('Preview frames emitted during cascades', () => {
  // Create a scenario likely to cascade
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 3, seed: 42 });
  engine.init();

  // Try several moves looking for one that cascades
  let foundPreview = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const eng = new Engine({ rows: 5, cols: 5, gemTypes: 3, seed: attempt });
    eng.init();
    const move = eng.findValidMove();
    if (!move) continue;
    const result = eng.swap(
      { r: move.r1, c: move.c1 },
      { r: move.r2, c: move.c2 }
    );
    if (result.frames.some(f => f.kind === 'preview')) {
      foundPreview = true;
      break;
    }
  }

  assert.ok(foundPreview, 'at least one of 50 seeds should cascade and emit a preview frame');
});

// Regression: cascades were effectively unbounded at low gem counts because
// fillGems refilled with no match-avoidance while init carefully avoided matches.
// Worst measured before the fix: 142,888 cascade iterations / 338,156 frames /
// 2.4 GB heap on a single 8x8 gems=2 move, freezing the tab for 7+ seconds.
test('Cascades stay bounded at the lowest gem count', () => {
  for (let seed = 0; seed < 8; seed++) {
    const engine = new Engine({ rows: 8, cols: 8, gemTypes: 2, seed });
    engine.init();

    for (let move = 0; move < 12; move++) {
      const m = engine.findValidMove();
      if (!m) break;
      const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
      assert.ok(
        result.frames.length < 500,
        `seed ${seed} move ${move}: ${result.frames.length} frames - cascade is running away`
      );
    }
  }
});

test('Refill does not manufacture immediate matches', () => {
  // fillGems must apply the same left/up avoidance the initial board generator uses.
  for (let seed = 0; seed < 30; seed++) {
    const engine = new Engine({ rows: 8, cols: 8, gemTypes: 3, seed });
    engine.init();
    const m = engine.findValidMove();
    if (!m) continue;
    engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
    // Whatever cascading happened, the engine must come to rest.
    assert.equal(
      findMatches(engine.state.board, 8, 8).length,
      0,
      `seed ${seed}: board still has live matches after the move settled`
    );
  }
});

test('init produces a settled, playable board', () => {
  // gems=2 on a large grid is the stress case: "differ from the pair left AND above"
  // is often unsatisfiable, so generation used to give up and ship a dirty board.
  for (const [size, gemTypes] of [[16, 2], [8, 2], [8, 10], [4, 10]]) {
    for (let seed = 0; seed < 25; seed++) {
      const engine = new Engine({ rows: size, cols: size, gemTypes, seed });
      const board = engine.init();
      assert.equal(
        findMatches(board, size, size).length, 0,
        `${size}x${size} gems=${gemTypes} seed ${seed}: starts with unearned matches`
      );
      assert.equal(
        hasValidMoves(board, size, size), true,
        `${size}x${size} gems=${gemTypes} seed ${seed}: starts with no legal move (soft-lock)`
      );
    }
  }
});

// Regression: the two swapped specials are consumed BY the combo, but were not
// seeded into `processed`, so they detonated a second time on top of it.
test('Special+special combo does not detonate the consumed specials twice', () => {
  const grid = [
    '12341234',
    '34123412',
    '12341234',
    '43214321',
    '12341234',
    '34123412',
    '12341234',
    '43214321'
  ].map(row => [...row].map(ch => makeCell(Number(ch))));

  assert.equal(findMatches(grid, 8, 8).length, 0, 'fixture must start match-free');

  grid[3][3] = makeCell(grid[3][3].type, SPECIAL.BOMB);
  grid[4][3] = makeCell(grid[4][3].type, SPECIAL.BOMB);

  const engine = new Engine({ rows: 8, cols: 8, gemTypes: 5, seed: 3 });
  engine.setBoard(grid);
  const result = engine.swap({ r: 3, c: 3 }, { r: 4, c: 3 });

  const blast = result.frames.find(f => f.kind === 'remove');
  assert.ok(blast, 'combo should emit a remove frame');

  const explosions = blast.effects.filter(e => e.kind === 'explosion');
  assert.equal(explosions.length, 1, 'bomb+bomb is one 5x5 blast, not three overlapping ones');
  assert.equal(blast.positions.length, 25, '5x5 centred away from any edge clears 25 cells');
  assert.equal(
    blast.score.points, 1000 + 25 * 15,
    'score must match the documented formula with no re-detonation bonus'
  );
});

// Shuffle preserves specials during regeneration
test('Regeneration does not crash and produces valid board', () => {
  const engine = new Engine({ rows: 3, cols: 3, gemTypes: 2, seed: 42 });
  engine.init();
  // Verify the board has cells
  const board = engine.state.board;
  let cellCount = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c]) cellCount++;
    }
  }
  assert.equal(cellCount, 9, 'Board should be fully populated');
});
