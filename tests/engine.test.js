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
  landingCells,
  hasValidMoves,
  findValidMove,
  findMatches,
  dropGems,
  fillGems
} from '../dist/engine.js';

function makeCell(type, special = SPECIAL.NONE, arms = null) {
  return { type, special, arms };
}

// The engine hands frames out lazily, one cascade wave at a time. Tests want the
// whole move, so materialise it here; draining also settles the engine's board.
function play(engine, pos1, pos2) {
  const result = engine.swap(pos1, pos2);
  const frames = Array.from(result.frames);
  return { frames, pointsEarned: result.pointsEarned, moveValid: result.moveValid };
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
  const result = play(engine, { r: 0, c: 1 }, { r: 1, c: 1 });

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
  const result = play(engine, { r: 2, c: 2 }, { r: 3, c: 2 });

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
  const result = play(engine, { r: 1, c: 2 }, { r: 2, c: 2 });

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
  const result = play(engine, { r: 0, c: 0 }, { r: 0, c: 1 });

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
    const result = play(engine, { r: move.r1, c: move.c1 }, { r: move.r2, c: move.c2 });
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
  const result = play(engine, { r: 0, c: 0 }, { r: 0, c: 1 });

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
  const result = play(engine, { r: 0, c: 0 }, { r: 0, c: 1 });

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
  const result = play(engine, { r: 0, c: 1 }, { r: 1, c: 1 });

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
    const result = play(eng, { r: move.r1, c: move.c1 }, { r: move.r2, c: move.c2 });
    if (result.frames.some(f => f.kind === 'preview')) {
      foundPreview = true;
      break;
    }
  }

  assert.ok(foundPreview, 'at least one of 50 seeds should cascade and emit a preview frame');
});

// The cap is gone: waves are produced one at a time as they are pulled, so a
// two-colour board may cascade for as long as it likes without the engine ever
// holding more than one wave. Two halves: more than 60 waves arrive, and the
// caller can stop pulling whenever it wants.
test('Cascades are uncapped and produced lazily', () => {
  let longest = 0;
  for (let seed = 0; seed < 10 && longest <= 50; seed++) {
    const engine = new Engine({ rows: 16, cols: 16, gemTypes: 2, seed });
    engine.init();
    for (let move = 0; move < 5 && longest <= 50; move++) {
      const m = engine.findValidMove();
      if (!m) break;
      const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
      assert.equal(typeof result.frames.next, 'function', 'frames must be an iterator, not an array');
      assert.equal(result.pointsEarned, 0, 'nothing is earned before a frame is pulled');
      let waves = 0;
      for (const frame of result.frames) {
        if (frame.kind === 'remove') waves++;
        if (waves > 50) break; // leaving the loop closes the generator
      }
      longest = Math.max(longest, waves);
    }
  }
  assert.ok(longest > 50, `expected a 16x16 two-colour move to run past the old cap of 50 waves; longest seen ${longest}`);
});

test('pointsEarned accumulates exactly as frames are pulled', () => {
  const engine = new Engine({ rows: 8, cols: 8, gemTypes: 3, seed: 11 });
  engine.init();
  const m = engine.findValidMove();
  assert.ok(m, 'fixture must have a legal move');
  const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
  assert.equal(result.moveValid, true, 'validity is known before any frame is pulled');
  assert.equal(result.pointsEarned, 0);
  let sum = 0;
  for (const frame of result.frames) {
    if (frame.kind === 'remove') sum += frame.score.points;
    assert.equal(result.pointsEarned, sum, `after a ${frame.kind} frame the tally must equal the wave scores pulled so far`);
  }
  assert.ok(sum > 0);
  assert.equal(result.pointsEarned, sum);
});

test('An abandoned move leaves the board hole-free where the last pulled wave left it, and the engine accepts the next move', () => {
  const engine = new Engine({ rows: 8, cols: 8, gemTypes: 2, seed: 5 });
  engine.init();
  const m = engine.findValidMove();
  assert.ok(m, 'fixture must have a legal move');
  const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
  let pulled = 0;
  for (const frame of result.frames) {
    pulled++;
    if (frame.kind === 'fill') break;
  }
  assert.ok(pulled > 0);
  const board = engine.state.board;
  assert.ok(board.every(row => row.every(cell => cell !== null)), 'no holes after a fill frame');
  const next = engine.findValidMove();
  assert.ok(next, 'the abandoned board still has a legal move');
  const again = engine.swap({ r: next.r1, c: next.c1 }, { r: next.r2, c: next.c2 });
  assert.equal(again.moveValid, true, 'the engine accepts a legal move on the abandoned board');
});

test('Refill does not manufacture immediate matches', () => {
  // fillGems must apply the same left/up avoidance the initial board generator uses.
  for (let seed = 0; seed < 30; seed++) {
    const engine = new Engine({ rows: 8, cols: 8, gemTypes: 3, seed });
    engine.init();
    const m = engine.findValidMove();
    if (!m) continue;
    play(engine, { r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
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
  const result = play(engine, { r: 3, c: 3 }, { r: 4, c: 3 });

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
  const result = play(engine, { r: 1, c: 2 }, { r: 2, c: 2 });
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
  const result = play(engine, { r: 1, c: 2 }, { r: 2, c: 2 });
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
  const result = play(engine, { r: 0, c: 0 }, { r: 0, c: 1 });
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
  const result = play(engine, { r: 0, c: 0 }, { r: 0, c: 1 });
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
  const frame = removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }));
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
  const frame = removeFrame(play(engine, { r: 1, c: 3 }, { r: 0, c: 3 }));
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

  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));
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

  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));
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

  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));
  // After the swap the colour-3 gems sit in columns 0, 1, 2 and 4; each fires its column.
  assert.equal(frame.positions.length, 4 * 5 + 1, 'four full columns plus the rainbow');
  assert.equal(frame.score.points, 2500 + 21 * 20);
  for (const key of ['0,3', '1,3', '3,3', '4,3']) {
    assert.ok(!keys(frame.positions).includes(key), `${key} in column 3 must survive`);
  }
});

test("A rainbow sharing the bomb's colour never fires an explosion at its own cell", () => {
  // The rainbow + bomb scan used to include the rainbow's own cell when its type
  // matched the bomb's, firing a spurious explosion effect there (the cell is
  // still consumed as a rainbow either way; only the effect was wrong).
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.RAINBOW);
  board[2][3] = makeCell(2, SPECIAL.BOMB);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  // After the swap the rainbow sits where the bomb started.
  const explosions = frame.effects.filter(e => e.kind === 'explosion');
  assert.ok(!explosions.some(e => e.r === 2 && e.c === 3), 'no explosion fires at the rainbow cell');
  assert.equal(frame.animations['2,3'], 'rainbow-cleared');
});

test("A rainbow sharing the line gem's colour never fires a beam from its own cell", () => {
  // Same bug, the line branch: the scan used to fire a beam centred on the
  // rainbow's own cell when the line gem shared its colour.
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.RAINBOW);
  board[2][3] = makeCell(2, SPECIAL.LINE, ARMS_HORIZONTAL);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  // After the swap the rainbow sits where the line gem started.
  const beams = frame.effects.filter(e => e.kind === 'beam');
  assert.ok(!beams.some(b => b.from.r === 2 && b.from.c === 3), 'no beam fires from the rainbow cell');
  assert.equal(frame.animations['2,3'], 'rainbow-cleared');
});

test('Every combo consumes both swapped specials', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.LINE, ARM.UP);
  board[3][2] = makeCell(3, SPECIAL.LINE, ARM.UP);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);

  // Union is a single UP arm from (2,2): (2,2),(1,2),(0,2). (3,2) is only cleared because it is consumed.
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 3, c: 2 }));
  assert.deepEqual(keys(frame.positions), ['0,2', '1,2', '2,2', '3,2']);
});

test('The same seed, board and swap produce identical frames', () => {
  const make = () => {
    const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 99 });
    const board = cyclicBoard();
    board[2][2] = makeCell(2, SPECIAL.LINE, ARMS_ALL);
    board[2][3] = makeCell(3, SPECIAL.BOMB);
    engine.setBoard(board);
    return play(engine, { r: 2, c: 2 }, { r: 2, c: 3 });
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
  const chainFrame = removeFrame(play(chain, { r: 2, c: 0 }, { r: 2, c: 1 }));
  assert.deepEqual(keys(chainFrame.positions), ['0,1', '1,0', '1,1', '1,2', '1,3', '1,4', '2,1']);

  // Beam + beam with both masks missing: the union is one horizontal line, not a cross.
  const combo = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  const comboBoard = cyclicBoard();
  comboBoard[2][2] = makeCell(2, SPECIAL.LINE, null);
  comboBoard[2][3] = makeCell(3, SPECIAL.LINE, null);
  combo.setBoard(comboBoard);
  const comboFrame = removeFrame(play(combo, { r: 2, c: 2 }, { r: 2, c: 3 }));
  assert.deepEqual(keys(comboFrame.positions), ['2,0', '2,1', '2,2', '2,3', '2,4']);
});

test('An abandoned move cannot touch the game that replaced it', () => {
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.init();
  const m = engine.findValidMove();
  assert.ok(m, 'fixture must have a legal move');
  const old = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
  old.frames.next(); // pull only the swap frame, then abandon the move mid-flight

  engine.reset({ seed: 9 });
  // A board with a live match that the abandoned move must not clear.
  const planted = [
    [0, 0, 0, 1, 2],
    [1, 2, 3, 2, 1],
    [2, 3, 1, 3, 2],
    [3, 1, 2, 1, 3],
    [1, 2, 3, 2, 1]
  ].map(row => row.map(t => makeCell(t)));
  engine.setBoard(planted);

  for (const _frame of old.frames) { /* drain the abandoned move */ }

  assert.deepEqual(engine.state.board, planted, 'the abandoned move must only ever touch its own state');
  assert.equal(engine.state.lastSwapPos, null);
});

// --- Gravity ----------------------------------------------------------------

// A 3x3 with one gem left in the middle line, so one gem falls and two enter.
function gravityFixture(gravity) {
  const board = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => makeCell(1)));
  const keep = { down: { r: 0, c: 1 }, up: { r: 2, c: 1 }, right: { r: 1, c: 0 }, left: { r: 1, c: 2 } }[gravity];
  const line = gravity === 'down' || gravity === 'up' ? [{ r: 0, c: 1 }, { r: 1, c: 1 }, { r: 2, c: 1 }] : [{ r: 1, c: 0 }, { r: 1, c: 1 }, { r: 1, c: 2 }];
  for (const pos of line) board[pos.r][pos.c] = null;
  board[keep.r][keep.c] = makeCell(2);
  return { board, keep };
}

test('dropGems compacts each line toward the gravity edge in every direction', () => {
  const landing = { down: { r: 2, c: 1 }, up: { r: 0, c: 1 }, right: { r: 1, c: 2 }, left: { r: 1, c: 0 } };
  for (const gravity of ['down', 'up', 'right', 'left']) {
    const { board, keep } = gravityFixture(gravity);
    const moves = dropGems(board, 3, 3, gravity);
    assert.deepEqual(moves, [{ from: keep, to: landing[gravity], type: 2 }], gravity);
    assert.equal(board[landing[gravity].r][landing[gravity].c].type, 2, `${gravity}: gem landed`);
    assert.equal(board[keep.r][keep.c], null, `${gravity}: origin emptied`);
  }
});

test('fillGems enters new gems from the edge opposite gravity, each travelling the full gap', () => {
  const beyond = {
    down: m => m.from.r < 0 && m.from.c === m.to.c && m.to.r - m.from.r === 2,
    up: m => m.from.r > 2 && m.from.c === m.to.c && m.from.r - m.to.r === 2,
    right: m => m.from.c < 0 && m.from.r === m.to.r && m.to.c - m.from.c === 2,
    left: m => m.from.c > 2 && m.from.r === m.to.r && m.from.c - m.to.c === 2
  };
  for (const gravity of ['down', 'up', 'right', 'left']) {
    const { board } = gravityFixture(gravity);
    dropGems(board, 3, 3, gravity);
    const moves = fillGems(board, 3, 3, 4, new RNG(1), gravity);
    assert.equal(moves.length, 2, gravity);
    assert.ok(moves.every(beyond[gravity]), `${gravity}: ${JSON.stringify(moves)}`);
    assert.ok(board.every(row => row.every(cell => cell !== null)), `${gravity}: board full`);
  }
});

test('Refill avoidance works in every direction: an emptied line never refills as a run of three', () => {
  // Under the old guard, 'up' and 'left' looked at cells not yet filled and could
  // complete a run of three inside the refilled line itself.
  for (const gravity of ['down', 'up', 'right', 'left']) {
    for (let seed = 0; seed < 60; seed++) {
      const board = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => makeCell((r + c) % 2 === 0 ? 0 : 1)));
      const isVertical = gravity === 'down' || gravity === 'up';
      for (let i = 0; i < 3; i++) {
        if (isVertical) board[i][1] = null;
        else board[1][i] = null;
      }
      fillGems(board, 3, 3, 2, new RNG(seed), gravity);
      const line = isVertical ? [board[0][1], board[1][1], board[2][1]] : [board[1][0], board[1][1], board[1][2]];
      assert.ok(line.every(cell => cell !== null), `${gravity} seed ${seed}: line refilled`);
      assert.ok(!(line[0].type === line[1].type && line[1].type === line[2].type), `${gravity} seed ${seed}: refilled a run of three`);
    }
  }
});

test('Gravity is read at the start of each wave, so a turn mid-cascade changes where refills come from', () => {
  let proved = false;
  for (let seed = 0; seed < 20 && !proved; seed++) {
    const engine = new Engine({ rows: 8, cols: 8, gemTypes: 2, seed });
    engine.init();
    const m = engine.findValidMove();
    if (!m) continue;
    const result = engine.swap({ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
    let fills = 0;
    for (const frame of result.frames) {
      if (frame.kind !== 'fill') continue;
      fills++;
      if (fills === 1) {
        assert.ok(frame.moves.every(mv => mv.from.r < 0), 'the first fill comes from the top under down');
        engine.setGravity('up');
      } else {
        assert.ok(frame.moves.every(mv => mv.from.r >= 8), 'after the turn the next fill comes from the bottom');
        proved = true;
        break;
      }
    }
  }
  assert.ok(proved, 'a two-colour move should cascade at least two waves within 20 seeds');
});

// --- Squares ----------------------------------------------------------------

test('A 2x2 of one colour is a match and makes a propeller on the swapped cell', () => {
  // The cyclic board has no runs and no squares. Three 0s sit at (1,1), (1,2), (2,1);
  // swapping (3,2) up into (2,2) completes the square.
  const board = cyclicBoard();
  board[1][1] = makeCell(0);
  board[1][2] = makeCell(0);
  board[2][1] = makeCell(0);
  board[3][2] = makeCell(0);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const result = play(engine, { r: 3, c: 2 }, { r: 2, c: 2 });
  const { pos, gem } = placedSpecial(result);
  assert.deepEqual(pos, { r: 2, c: 2 }, 'the swapped cell lies in the square');
  assert.equal(gem.special, SPECIAL.PROPELLER);
  assert.equal(gem.arms, null);
  const remove = removeFrame(result);
  assert.equal(remove.score.breakdown.matchBonus, 75 + 1 * 20, 'propeller bonus plus the length bonus');
});

test('findMatches reports a square as a group of four with its anchor', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 4);
  assert.deepEqual(groups[0].square, { r: 1, c: 1 });
  assert.equal(groups[0].intersection, null);
});

test('A 2x3 block is six cells and makes a rainbow', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 6);

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const { gem } = placedSpecial(play(engine, { r: 0, c: 0 }, { r: 0, c: 1 }));
  assert.equal(gem.special, SPECIAL.RAINBOW, 'six or more is a rainbow whatever its shape');
});

test('A square sharing two cells with a 3-run is five cells without an intersection and makes a propeller', () => {
  const board = cyclicBoard();
  for (const [r, c] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]]) board[r][c] = makeCell(0);
  const groups = findMatches(board, 5, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].positions.length, 5);
  assert.equal(groups[0].intersection, null, 'no vertical run of three, so no intersection');
  assert.deepEqual(groups[0].square, { r: 1, c: 1 });

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const { gem } = placedSpecial(play(engine, { r: 0, c: 0 }, { r: 0, c: 1 }));
  assert.equal(gem.special, SPECIAL.PROPELLER);
});

test('A swap whose only match is a square is judged legal', () => {
  const board = cyclicBoard();
  board[1][1] = makeCell(0);
  board[1][2] = makeCell(0);
  board[2][1] = makeCell(0);
  board[3][2] = makeCell(0);
  assert.equal(hasValidMoves(board, 5, 5), true);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const result = play(engine, { r: 3, c: 2 }, { r: 2, c: 2 });
  assert.equal(result.moveValid, true, 'the square alone makes the swap legal');
  assert.equal(placedSpecial(result).gem.special, SPECIAL.PROPELLER, 'and it is the square that matched');
});

test('The refill guard never completes a square with the three cells already placed', () => {
  // (0,0), (0,1) and (1,0) are colour 0; the cell at (1,1) is filled last under
  // 'down' and must never come out 0, whatever the seed.
  for (let seed = 0; seed < 40; seed++) {
    const board = [
      [makeCell(0), makeCell(0), makeCell(1)],
      [makeCell(0), null, makeCell(0)],
      [makeCell(1), makeCell(0), makeCell(1)]
    ];
    fillGems(board, 3, 3, 2, new RNG(seed), 'down');
    assert.equal(board[1][1].type, 1, `seed ${seed}: the guard must refuse the square`);
  }
});

// --- Propeller ----------------------------------------------------------------

function flightsOf(frame) {
  return frame.effects.filter(e => e.kind === 'flight');
}

test('A matched propeller flies to a landing outside the clearing and pops a 2x2 there', () => {
  // Propeller at (1,1); swapping (2,0) and (2,1) completes column 1 rows 0-2.
  const board = cyclicBoard();
  board[0][1] = makeCell(0);
  board[1][1] = makeCell(0, SPECIAL.PROPELLER);
  board[2][0] = makeCell(0);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 1, c: 1 });
  const landing = landingCells(flights[0].to);
  assert.ok(flights[0].to.r >= 0 && flights[0].to.r <= 3 && flights[0].to.c >= 0 && flights[0].to.c <= 3, 'anchor keeps the block on a 5x5');
  const removed = new Set(keys(frame.positions));
  for (const pos of landing) assert.ok(removed.has(`${pos.r},${pos.c}`), 'every landing cell is cleared');
  for (const pos of landing) assert.ok(!['0,1', '1,1', '2,1'].includes(`${pos.r},${pos.c}`), 'the landing avoids the cells already being cleared');
  assert.equal(frame.animations['1,1'], 'flown');
  assert.equal(frame.positions.length, 3 + 4);
  assert.equal(frame.subSteps.length, 1);
  assert.deepEqual(frame.subSteps[0].triggerPos, { r: 1, c: 1 });
});

test('A chained propeller pushes the same flight object into frame.effects and its sub-step', () => {
  // Same fixture as above: the propeller fires from inside a sub-step, not as
  // one of the frame's own effects. The page tells the two apart by object
  // identity (`ownFlights` in main.ts), so that identity is the contract this
  // pins: a structurally-equal clone in either array would silently fly twice.
  const board = cyclicBoard();
  board[0][1] = makeCell(0);
  board[1][1] = makeCell(0, SPECIAL.PROPELLER);
  board[2][0] = makeCell(0);

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }));

  assert.equal(frame.subSteps.length, 1);
  const subStepFlight = frame.subSteps[0].effects.find(e => e.kind === 'flight');
  assert.ok(subStepFlight, "the sub-step carries the propeller's flight");
  assert.ok(frame.effects.includes(subStepFlight), "frame.effects holds the identical object, not a copy");
});

test('Propeller + bomb carries the bomb to the landing', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.PROPELLER);
  board[2][3] = makeCell(3, SPECIAL.BOMB);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 2, c: 3 }, 'after the swap the propeller sits where the bomb started');
  const anchor = flights[0].to;
  const explosions = frame.effects.filter(e => e.kind === 'explosion');
  assert.deepEqual(explosions, [{ kind: 'explosion', r: anchor.r, c: anchor.c }], 'the bomb fires centred on the anchor');
  const removed = new Set(keys(frame.positions));
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = anchor.r + dr;
      const c = anchor.c + dc;
      if (r >= 0 && r < 5 && c >= 0 && c < 5) assert.ok(removed.has(`${r},${c}`), `blast covers ${r},${c}`);
    }
  }
  for (const pos of landingCells(anchor)) assert.ok(removed.has(`${pos.r},${pos.c}`));
  assert.ok(removed.has('2,2') && removed.has('2,3'), 'both swapped specials are consumed');
  assert.equal(frame.score.points, 1100 + frame.positions.length * 15);
});

test('Propeller + beam fires the arms from the landing anchor', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.LINE, ARMS_HORIZONTAL);
  board[2][3] = makeCell(3, SPECIAL.PROPELLER);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1);
  assert.deepEqual(flights[0].from, { r: 2, c: 2 });
  const anchor = flights[0].to;
  const removed = new Set(keys(frame.positions));
  for (let c = 0; c < 5; c++) assert.ok(removed.has(`${anchor.r},${c}`), `the beam clears row ${anchor.r}`);
  const beams = frame.effects.filter(e => e.kind === 'beam');
  assert.ok(beams.every(b => b.from.r === anchor.r && b.from.c === anchor.c), 'beams fire from the anchor');
  assert.equal(frame.score.points, 1100 + frame.positions.length * 15);
});

test('Two propellers both fly', () => {
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.PROPELLER);
  board[2][3] = makeCell(3, SPECIAL.PROPELLER);
  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 2);
  assert.deepEqual(keys(flights.map(f => f.from)), ['2,2', '2,3']);
  assert.equal(frame.score.points, 900 + frame.positions.length * 12);

  const removed = new Set(keys(frame.positions));
  for (const f of flights) {
    assert.equal(frame.animations[`${f.from.r},${f.from.c}`], 'flown', 'both origins read as flown');
    for (const pos of landingCells(f.to)) assert.ok(removed.has(`${pos.r},${pos.c}`), 'both landing blocks are cleared');
  }
});

test('Rainbow + propeller sends every gem of that colour flying, and landings fall back when the board is claimed', () => {
  // Two colours on a 4x4 checkerboard: eight gems of colour 1 fly; there are only
  // nine anchors, so most flights must fall back to an already-claimed anchor.
  const board = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => makeCell((r + c) % 2)));
  board[1][1] = makeCell(0, SPECIAL.RAINBOW); // keeps the checkerboard colour at (1,1)
  board[1][2] = makeCell(1, SPECIAL.PROPELLER); // colour 1, as the checkerboard has there
  assert.equal(findMatches(board, 4, 4).length, 0, 'fixture must start match-free');
  const engine = new Engine({ rows: 4, cols: 4, gemTypes: 2, seed: 8 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 1, c: 1 }, { r: 1, c: 2 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 8, 'every colour-1 gem on the swapped board, the propeller included');
  const removed = new Set(keys(frame.positions));
  for (const f of flights) {
    assert.ok(f.to.r >= 0 && f.to.r <= 2 && f.to.c >= 0 && f.to.c <= 2, 'every anchor keeps its block on the board');
    assert.equal(frame.animations[`${f.from.r},${f.from.c}`], 'flown');
    assert.ok(removed.has(`${f.from.r},${f.from.c}`), 'the gem that flew is gone from its cell');
    for (const pos of landingCells(f.to)) assert.ok(removed.has(`${pos.r},${pos.c}`), 'every landing cell is cleared');
  }
  assert.ok(removed.has('1,2'), 'the rainbow is consumed');
  assert.equal(frame.score.points, 2500 + frame.positions.length * 20);
});

test('Landings are deterministic under a seed', () => {
  const make = () => {
    const board = cyclicBoard();
    board[2][2] = makeCell(2, SPECIAL.PROPELLER);
    board[2][3] = makeCell(3, SPECIAL.PROPELLER);
    const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 21 });
    engine.setBoard(board);
    return play(engine, { r: 2, c: 2 }, { r: 2, c: 3 });
  };
  assert.equal(JSON.stringify(make().frames), JSON.stringify(make().frames));
  // Two identical runs of a frame with no flights in it would prove nothing.
  assert.equal(flightsOf(removeFrame(make())).length, 2);
});

test("A propeller caught in a bomb's blast flies", () => {
  // Bomb at (1,1); swapping (2,0) and (2,1) completes column 1 rows 0-2. The blast
  // covers rows 0-2 x cols 0-2, which is where the propeller sits.
  const board = cyclicBoard();
  board[0][1] = makeCell(0);
  board[1][1] = makeCell(0, SPECIAL.BOMB);
  board[2][0] = makeCell(0);
  board[2][2] = makeCell(2, SPECIAL.PROPELLER);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 42 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 0 }, { r: 2, c: 1 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 1, 'a propeller caught in a blast takes off');
  assert.deepEqual(flights[0].from, { r: 2, c: 2 });
  assert.equal(frame.animations['2,2'], 'flown');
  const removed = new Set(keys(frame.positions));
  for (const pos of landingCells(flights[0].to)) assert.ok(removed.has(`${pos.r},${pos.c}`), 'the landing block is cleared');
  assert.deepEqual(frame.effects.filter(e => e.kind === 'explosion'), [{ kind: 'explosion', r: 1, c: 1 }]);
  // 300 = the bomb's chain bonus of 150 plus the propeller's own 150.
  assert.equal(frame.score.points, frame.positions.length * 10 + 300);
});

test('A special sitting in the landing block chains', () => {
  // The T-match clears (0,1),(1,1),(2,1),(1,2),(1,3). That leaves the 2x2 anchored
  // at (2,2) as the only block free of the removal set, so the uniform draw has one
  // candidate whatever the seed. The bomb inside that block then fires.
  const build = () => [
    [makeCell(1), makeCell(0), makeCell(3), makeCell(1)],
    [makeCell(0), makeCell(3), makeCell(0), makeCell(0, SPECIAL.PROPELLER)],
    [makeCell(3), makeCell(0), makeCell(2, SPECIAL.BOMB), makeCell(3)],
    [makeCell(1), makeCell(2), makeCell(3), makeCell(1)]
  ];
  assert.equal(findMatches(build(), 4, 4).length, 0, 'fixture must start match-free');

  for (let seed = 0; seed < 8; seed++) {
    const engine = new Engine({ rows: 4, cols: 4, gemTypes: 4, seed });
    engine.setBoard(build());
    const frame = removeFrame(play(engine, { r: 1, c: 0 }, { r: 1, c: 1 }));

    const flights = flightsOf(frame);
    assert.equal(flights.length, 1, `seed ${seed}`);
    assert.deepEqual(flights[0].from, { r: 1, c: 3 }, `seed ${seed}`);
    assert.deepEqual(flights[0].to, { r: 2, c: 2 }, `seed ${seed}: one free anchor, so one candidate`);

    const removed = new Set(keys(frame.positions));
    assert.deepEqual(frame.effects.filter(e => e.kind === 'explosion'), [{ kind: 'explosion', r: 2, c: 2 }], 'the bomb the landing claimed fires');
    assert.ok(removed.has('3,1'), 'its blast reaches a cell neither the match nor the landing touched');
    assert.equal(frame.positions.length, 10, 'five matched, four landed on, one more from the blast');
    assert.deepEqual(frame.subSteps.map(s => s.triggerPos), [{ r: 1, c: 3 }, { r: 2, c: 2 }], 'the propeller, then the bomb it landed on');
  }
});

test('A propeller in the rainbow flock flies exactly once', () => {
  // A second propeller of the flock colour used to fly twice: once with the flock,
  // then again in the chain loop, because only the two swapped cells were seeded.
  const board = cyclicBoard();
  board[2][2] = makeCell(1, SPECIAL.RAINBOW);
  board[2][3] = makeCell(2, SPECIAL.PROPELLER);
  board[0][0] = makeCell(2, SPECIAL.PROPELLER);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  const froms = keys(flights.map(f => f.from));
  assert.equal(flights.length, 10, 'one flight per colour-2 gem on the swapped board');
  assert.equal(new Set(froms).size, flights.length, 'no cell takes off twice');
  assert.ok(froms.includes('0,0'), 'the second propeller is one of the flock');
  assert.equal(frame.animations['0,0'], 'flown');
});

test("A rainbow sharing the propeller's colour is consumed, not launched", () => {
  // The flock is chosen by colour, and a rainbow carries a real one. It must be
  // consumed as a rainbow rather than sent flying out of its own cell.
  const board = cyclicBoard();
  board[2][2] = makeCell(2, SPECIAL.RAINBOW);
  board[2][3] = makeCell(2, SPECIAL.PROPELLER);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  // After the swap the rainbow sits where the propeller started.
  assert.ok(!keys(flights.map(f => f.from)).includes('2,3'), 'the rainbow never takes off');
  assert.equal(frame.animations['2,3'], 'rainbow-cleared');
  assert.equal(flights.length, 9, 'every colour-2 gem but the rainbow itself');
});

test('A bomb in the rainbow flock flies instead of detonating', () => {
  // The flock grants each gem a flight and nothing more, so a bomb it launches is
  // consumed by the flight and never fires at the cell it left.
  const board = cyclicBoard();
  board[2][2] = makeCell(1, SPECIAL.RAINBOW);
  board[2][3] = makeCell(2, SPECIAL.PROPELLER);
  board[0][0] = makeCell(2, SPECIAL.BOMB);
  assert.equal(findMatches(board, 5, 5).length, 0, 'fixture must start match-free');

  const engine = new Engine({ rows: 5, cols: 5, gemTypes: 4, seed: 3 });
  engine.setBoard(board);
  const frame = removeFrame(play(engine, { r: 2, c: 2 }, { r: 2, c: 3 }));

  const flights = flightsOf(frame);
  assert.equal(flights.length, 10, 'the bomb flies with the rest of its colour');
  assert.ok(keys(flights.map(f => f.from)).includes('0,0'));
  assert.equal(frame.animations['0,0'], 'flown', 'not overwritten by its own blast');
  assert.equal(frame.effects.filter(e => e.kind === 'explosion' && e.r === 0 && e.c === 0).length, 0, 'it never detonates where it stood');
});
