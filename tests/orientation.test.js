import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPose, toBoardDelta, normalizeRotation } from '../dist/orientation.js';

// Truth table. deviceAngle is screen.orientation.angle (counter-clockwise from the
// natural orientation, per the W3C spec); rotation is the board's CSS rotation
// (clockwise). The board is glued to the device, so it turns the way the device
// turned: the negative of the API angle, plus a quarter turn clockwise per manual
// turn. Gravity is screen-down expressed in board coordinates. This table is
// what must be confirmed on a real iPhone before the release ships.
const TABLE = [
  // angle, turns, rotation, gravity
  [0, 0, 0, 'down'], [0, 1, 90, 'right'], [0, 2, 180, 'up'], [0, 3, 270, 'left'],
  [90, 0, 270, 'left'], [90, 1, 0, 'down'], [90, 2, 90, 'right'], [90, 3, 180, 'up'],
  [180, 0, 180, 'up'], [180, 1, 270, 'left'], [180, 2, 0, 'down'], [180, 3, 90, 'right'],
  [270, 0, 90, 'right'], [270, 1, 180, 'up'], [270, 2, 270, 'left'], [270, 3, 0, 'down']
];

test('boardPose maps every device angle and turn count per the truth table', () => {
  for (const [angle, turns, rotation, gravity] of TABLE) {
    assert.deepEqual(boardPose(angle, turns), { rotation, gravity }, `angle ${angle}, turns ${turns}`);
  }
});

test('normalizeRotation wraps into 0..270 on quarter turns', () => {
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-450), 270);
});

test('toBoardDelta rotates a screen delta into board space', () => {
  // Screen right (dx 1) and screen down (dy 1) under each board rotation.
  const right = { 0: { dr: 0, dc: 1 }, 90: { dr: -1, dc: 0 }, 180: { dr: 0, dc: -1 }, 270: { dr: 1, dc: 0 } };
  const down = { 0: { dr: 1, dc: 0 }, 90: { dr: 0, dc: 1 }, 180: { dr: -1, dc: 0 }, 270: { dr: 0, dc: -1 } };
  // Negating a literal 0 gives -0, which strict deep-equal distinguishes from 0.
  const flip = d => ({ dr: d.dr === 0 ? 0 : -d.dr, dc: d.dc === 0 ? 0 : -d.dc });
  for (const rotation of [0, 90, 180, 270]) {
    assert.deepEqual(toBoardDelta(1, 0, rotation), right[rotation], `right at ${rotation}`);
    assert.deepEqual(toBoardDelta(0, 1, rotation), down[rotation], `down at ${rotation}`);
    assert.deepEqual(toBoardDelta(-1, 0, rotation), flip(right[rotation]), `left at ${rotation}`);
    assert.deepEqual(toBoardDelta(0, -1, rotation), flip(down[rotation]), `up at ${rotation}`);
  }
});

test('screen-down under a rotation is the pose gravity', () => {
  const name = { '1,0': 'down', '-1,0': 'up', '0,1': 'right', '0,-1': 'left' };
  for (const [angle, turns, rotation, gravity] of TABLE) {
    const d = toBoardDelta(0, 1, rotation);
    assert.equal(name[`${d.dr},${d.dc}`], gravity, `angle ${angle}, turns ${turns}`);
  }
});
