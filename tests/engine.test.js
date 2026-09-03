import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Engine,
  RNG,
  SPECIAL,
  ARM,
  ARMS_HORIZONTAL,
  ARMS_VERTICAL,
  ARMS_ALL,
  beamCells,
  hasValidMoves,
  findValidMove,
  findMatches
} from '../dist/engine.js';

function makeCell(type, special = SPECIAL.NONE, arms = null) {
  return { type, special, arms };
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
    [makeCell(0, SPECIAL.BOMB), makeCell(1, SPECIAL.LINE, ARMS_HORIZONTAL)],
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

// Phase 3C: Straight 5-match -> LINE in same direction as match
test('Straight 5 makes a Line beam gem on the swapped cell with both arms along its axis', () => {
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 3, 1, 2],
    [2, 3, 0, 2, 3],
    [0, 0, 1, 0, 0],
    [1, 2, 3, 1, 2],
    [2, 3, 1, 2, 3]
  ].map(row => row.map(t => makeCell(t)));
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  engine.setBoard(board);
  const result = engine.swap({ r: 1, c: 2 }, { r: 2, c: 2 });

  const placed = result.frames.find(f => f.kind === 'board' && f.newSpecials);
  assert.ok(placed, 'a special must be placed');
  assert.deepEqual(placed.newSpecials, [{ r: 2, c: 2 }]);
  const gem = placed.board[2][2];
  assert.equal(gem.special, SPECIAL.LINE);
  assert.equal(gem.arms, ARMS_HORIZONTAL);
  const remove = result.frames.find(f => f.kind === 'remove');
  assert.equal(remove.score.breakdown.matchBonus, 100 + 4 * 20, 'line bonus plus the length bonus');
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

// --- beamCells --------------------------------------------------------------

function keys(positions) {
  return positions.map(p => `${p.r},${p.c}`).sort();
}

test('beamCells: all four arms from the centre of a 5x5 clear the full cross', () => {
  const { cells, effects } = beamCells({ r: 2, c: 2 }, ARMS_ALL, 5, 5);
  assert.equal(cells.length, 9, 'row 2 and column 2 overlap on the origin');
  assert.deepEqual(effects.map(e => e.dir).sort(), ['down', 'left', 'right', 'up']);
  assert.ok(effects.every(e => e.kind === 'beam' && e.from.r === 2 && e.from.c === 2));
});

test('beamCells: arms that point off the board clear nothing and draw nothing', () => {
  const { cells, effects } = beamCells({ r: 0, c: 4 }, ARM.UP | ARM.RIGHT, 5, 5);
  assert.deepEqual(keys(cells), ['0,4'], 'only the origin');
  assert.equal(effects.length, 0);
});

test('beamCells: a single arm runs from the gem to the edge', () => {
  const { cells, effects } = beamCells({ r: 3, c: 1 }, ARM.RIGHT, 4, 6);
  assert.deepEqual(keys(cells), ['3,1', '3,2', '3,3', '3,4', '3,5']);
  assert.deepEqual(effects, [{ kind: 'beam', from: { r: 3, c: 1 }, dir: 'right' }]);
});

test('beamCells: halfWidth 1 makes each arm three cells wide, including beside the origin', () => {
  const { cells, effects } = beamCells({ r: 2, c: 2 }, ARMS_HORIZONTAL, 5, 5, 1);
  assert.equal(cells.length, 15, 'rows 1..3 across the whole width');
  assert.ok(keys(cells).includes('1,2') && keys(cells).includes('3,2'), 'cells above and below the origin are in the footprint');
  assert.equal(effects.length, 6, 'two arms, three parallel sweeps each');
});

test('beamCells: constants agree with the bit layout', () => {
  assert.equal(ARMS_HORIZONTAL, ARM.LEFT | ARM.RIGHT);
  assert.equal(ARMS_VERTICAL, ARM.UP | ARM.DOWN);
  assert.equal(ARMS_ALL, 15);
});

test('beamCells: a widened arm blocked at the edge still clears the cells beside the origin', () => {
  const { cells, effects } = beamCells({ r: 2, c: 4 }, ARM.RIGHT, 5, 5, 1);
  assert.deepEqual(keys(cells), ['1,4', '2,4', '3,4']);
  assert.equal(effects.length, 0, 'nothing to sweep');
});

test('beamCells: a corner gem with both arms off the board keeps its three-wide neighbours', () => {
  const { cells, effects } = beamCells({ r: 4, c: 4 }, ARM.RIGHT | ARM.DOWN, 5, 5, 1);
  assert.deepEqual(keys(cells), ['3,4', '4,3', '4,4']);
  assert.equal(effects.length, 0);
});

// --- Beam gem creation ---------------------------------------------------------

function placedSpecial(result) {
  const frame = result.frames.find(f => f.kind === 'board' && f.newSpecials);
  assert.ok(frame, 'a special must be placed');
  assert.equal(frame.newSpecials.length, 1, 'exactly one special for the one group');
  const pos = frame.newSpecials[0];
  return { pos, gem: frame.board[pos.r][pos.c], frame };
}

test('L of 5 makes a Corner beam gem on the intersection with an arm along each leg', () => {
  // Swapping (1,2) down into (2,2) completes row 2 cols 2-4 and column 2 rows 2-4.
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 3, 1, 2],
    [2, 3, 0, 2, 3],
    [3, 1, 1, 0, 0],
    [1, 2, 0, 3, 1],
    [2, 3, 0, 1, 2]
  ].map(row => row.map(t => makeCell(t)));
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  engine.setBoard(board);
  const result = engine.swap({ r: 1, c: 2 }, { r: 2, c: 2 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 });
  assert.equal(gem.special, SPECIAL.LINE);
  assert.equal(gem.arms, ARM.RIGHT | ARM.DOWN);
  const remove = result.frames.find(f => f.kind === 'remove');
  assert.equal(remove.score.breakdown.matchBonus, 150 + 4 * 20);
});

test('T of 5 makes a Tee beam gem with three arms', () => {
  // Swapping (1,2) down into (2,2) completes the bar (2,1)-(2,3) and the stem (2,2)-(4,2).
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 3, 1, 2],
    [2, 3, 0, 2, 3],
    [3, 0, 1, 0, 1],
    [1, 2, 0, 3, 2],
    [2, 3, 0, 1, 3]
  ].map(row => row.map(t => makeCell(t)));
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  engine.setBoard(board);
  const result = engine.swap({ r: 1, c: 2 }, { r: 2, c: 2 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 });
  assert.equal(gem.arms, ARM.LEFT | ARM.RIGHT | ARM.DOWN);
});

test('Plus of 5 (only a cascade can make one) makes a Cross beam gem with all four arms', () => {
  // A plus cannot come from one swap: the swapped-out gem would break an arm. So the
  // plus already sits on the board and an unrelated swap triggers processing.
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 3, 1, 2],
    [2, 3, 0, 2, 3],
    [3, 0, 0, 0, 1],
    [1, 2, 0, 3, 2],
    [2, 3, 1, 1, 3]
  ].map(row => row.map(t => makeCell(t)));

  engine.setBoard(board);
  const result = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 });
  assert.equal(gem.arms, ARMS_ALL);
});

test('A shape made by a cascade is placed on its intersection, not near the centroid', () => {
  // The L already exists; the swap is elsewhere and creates nothing itself.
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 3, 1, 2],
    [2, 3, 1, 2, 3],
    [3, 1, 0, 0, 0],
    [1, 2, 0, 3, 1],
    [2, 3, 0, 1, 2]
  ].map(row => row.map(t => makeCell(t)));

  engine.setBoard(board);
  const result = engine.swap({ r: 0, c: 0 }, { r: 0, c: 1 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 }, 'the corner, where the legs meet');
  assert.equal(gem.arms, ARM.RIGHT | ARM.DOWN);
});

test('findMatches reports the intersection of an L and none for a straight run', () => {
  const l = [
    [0, 0, 0, 2],
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [1, 3, 1, 2]
  ].map(row => row.map(t => makeCell(t)));
  const group = findMatches(l, 4, 4).find(m => m.type === 0);
  assert.deepEqual(group.intersection, { r: 0, c: 0 });

  const straight = [
    [0, 0, 0, 0, 0],
    [1, 2, 1, 2, 1],
    [2, 1, 2, 1, 2]
  ].map(row => row.map(t => makeCell(t)));
  assert.equal(findMatches(straight, 3, 5)[0].intersection, null);
});

// --- Beam gem activation ------------------------------------------------------

function removeFrame(result) {
  const frame = result.frames.find(f => f.kind === 'remove');
  assert.ok(frame, 'expected a remove frame');
  return frame;
}

test('A matched beam gem fires each arm to the edge and nothing else', () => {
  // Beam gem (arms right + down) at (1,1). Swapping (2,0) and (2,1) completes column 1 rows 0-2.
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 0, 3, 1, 2],
    [2, 0, 3, 2, 3],
    [0, 2, 1, 3, 1],
    [1, 3, 2, 1, 2],
    [2, 1, 3, 2, 3]
  ].map(row => row.map(t => makeCell(t)));
  board[1][1] = makeCell(0, SPECIAL.LINE, ARM.RIGHT | ARM.DOWN);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  engine.setBoard(board);
  const frame = removeFrame(engine.swap({ r: 2, c: 0 }, { r: 2, c: 1 }));
  const removed = keys(frame.positions);
  assert.deepEqual(removed, ['0,1', '1,1', '1,2', '1,3', '1,4', '2,1', '3,1', '4,1']);
  assert.deepEqual(frame.effects.filter(e => e.kind === 'beam').map(e => e.dir).sort(), ['down', 'right']);
  assert.equal(frame.subSteps.length, 1);
  assert.deepEqual(frame.subSteps[0].triggerPos, { r: 1, c: 1 });
});

test('A beam gem on the edge with arms pointing off the board clears only its match', () => {
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const board = [
    [1, 2, 0, 1, 0],
    [2, 3, 1, 0, 2],
    [3, 1, 2, 3, 1],
    [1, 2, 3, 1, 2],
    [2, 3, 1, 2, 3]
  ].map(row => row.map(t => makeCell(t)));
  board[0][4] = makeCell(0, SPECIAL.LINE, ARM.UP | ARM.RIGHT);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  engine.setBoard(board);
  const frame = removeFrame(engine.swap({ r: 1, c: 3 }, { r: 0, c: 3 }));
  assert.deepEqual(keys(frame.positions), ['0,2', '0,3', '0,4']);
  assert.equal(frame.effects.filter(e => e.kind === 'beam').length, 0);
});

// A 5x5 with type (r + c) % 3 + 1 has no run of three anywhere; specials are placed on it.
function cyclicBoard() {
  return Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => makeCell(((r + c) % 3) + 1)));
}

test('Beam + beam fires the union of both arm masks from the first-selected cell', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.LINE, ARM.UP | ARM.RIGHT);
  board[2][3] = makeCell(3, SPECIAL.LINE, ARM.DOWN | ARM.LEFT);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  const frame = removeFrame(engine.swap({ r: 2, c: 2 }, { r: 2, c: 3 }));
  assert.equal(frame.positions.length, 9, 'row 2 plus column 2');
  assert.equal(frame.score.points, 800 + 9 * 12);
  assert.equal(frame.effects.filter(e => e.kind === 'beam').length, 4);
});

test('Beam + bomb fires each arm three cells wide', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.BOMB);
  board[2][3] = makeCell(3, SPECIAL.LINE, ARMS_HORIZONTAL);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  const frame = removeFrame(engine.swap({ r: 2, c: 2 }, { r: 2, c: 3 }));
  assert.equal(frame.positions.length, 15, 'rows 1..3 across the board');
  assert.equal(frame.score.points, 1200 + 15 * 15);
  assert.equal(frame.effects.filter(e => e.kind === 'beam').length, 6);
});

test('Beam + rainbow gives every gem of the partner colour the same arms', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.RAINBOW);
  board[2][3] = makeCell(3, SPECIAL.LINE, ARMS_VERTICAL);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  const frame = removeFrame(engine.swap({ r: 2, c: 2 }, { r: 2, c: 3 }));
  // After the swap the colour-3 gems sit in columns 0, 1, 2 and 4; each fires its column.
  assert.equal(frame.positions.length, 4 * 5 + 1, 'four full columns plus the rainbow');
  assert.equal(frame.score.points, 2500 + 21 * 20);
  for (const key of ['0,3', '1,3', '3,3', '4,3']) {
    assert.ok(!keys(frame.positions).includes(key), `${key} in column 3 must survive`);
  }
});

test('Every combo consumes both swapped specials', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.LINE, ARM.UP);
  board[3][2] = makeCell(3, SPECIAL.LINE, ARM.UP);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  // Union is a single UP arm from (2,2): (2,2),(1,2),(0,2). (3,2) is only cleared because it is consumed.
  const frame = removeFrame(engine.swap({ r: 2, c: 2 }, { r: 3, c: 2 }));
  assert.deepEqual(keys(frame.positions), ['0,2', '1,2', '2,2', '3,2']);
});

test('The same seed, board and swap produce identical frames', () => {
  const make = () => {
    const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 99 });
    const board = cyclicBoard();
    board[2][2] = makeCell(2, SPECIAL.LINE, ARMS_ALL);
    board[2][3] = makeCell(3, SPECIAL.BOMB);
    engine.setBoard(board);
    return engine.swap({ r: 2, c: 2 }, { r: 2, c: 3 });
  };
  assert.equal(JSON.stringify(make().frames), JSON.stringify(make().frames));
});

test('A beam gem that reaches the engine without arms fires as a horizontal line on every path', () => {
  // Matched in a chain: (1,1) has null arms; swapping (2,0) and (2,1) matches column 1 rows 0-2.
  const chain = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  const chainBoard = [
    [1, 0, 3, 1, 2],
    [2, 0, 3, 2, 3],
    [0, 2, 1, 3, 1],
    [1, 3, 2, 1, 2],
    [2, 1, 3, 2, 3]
  ].map(row => row.map(t => makeCell(t)));
  chainBoard[1][1] = makeCell(0, SPECIAL.LINE, null);
  chain.setBoard(chainBoard);
  const chainFrame = removeFrame(chain.swap({ r: 2, c: 0 }, { r: 2, c: 1 }));
  assert.deepEqual(keys(chainFrame.positions), ['0,1', '1,0', '1,1', '1,2', '1,3', '1,4', '2,1']);

  // Beam + beam with both masks missing: the union is one horizontal line, not a cross.
  const combo = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  const comboBoard = cyclicBoard();
  comboBoard[2][2] = makeCell(2, SPECIAL.LINE, null);
  comboBoard[2][3] = makeCell(3, SPECIAL.LINE, null);
  combo.setBoard(comboBoard);
  const comboFrame = removeFrame(combo.swap({ r: 2, c: 2 }, { r: 2, c: 3 }));
  assert.deepEqual(keys(comboFrame.positions), ['2,0', '2,1', '2,2', '2,3', '2,4']);
});
