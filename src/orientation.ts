// Where the board points and which way gems fall, from the device orientation and
// the player's manual turns. Pure, so the truth table is unit-tested; the sign
// convention below is the W3C one and is confirmed on a real iPhone before each
// release that touches it.
//
// screen.orientation.angle is the screen's rotation counter-clockwise from its
// natural orientation. The board is glued to the device body, so it must turn the
// way the device turned: the negative of that angle, as a CSS (clockwise)
// rotation. Each manual turn adds a quarter turn clockwise.

import type { Gravity } from './engine/index';

export type Rotation = 0 | 90 | 180 | 270;

export const GRAVITY_BY_ROTATION: Record<Rotation, Gravity> = {
  0: 'down',
  90: 'right',
  180: 'up',
  270: 'left'
};

export function normalizeRotation(deg: number): Rotation {
  const wrapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return wrapped as Rotation;
}

export function boardPose(deviceAngle: number, turns: number): { rotation: Rotation; gravity: Gravity } {
  const rotation = normalizeRotation(-deviceAngle + 90 * turns);
  return { rotation, gravity: GRAVITY_BY_ROTATION[rotation] };
}

// A screen-space delta (x right, y down) expressed in board rows and columns.
// The board appears rotated clockwise by `rotation`, so a screen vector is the
// board vector rotated the other way. Results are normalised so a negated zero
// never leaks out as -0.
export function toBoardDelta(dx: number, dy: number, rotation: Rotation): { dr: number; dc: number } {
  const zero = (v: number): number => (v === 0 ? 0 : v);
  switch (rotation) {
    case 90:
      return { dr: zero(-dx), dc: zero(dy) };
    case 180:
      return { dr: zero(-dy), dc: zero(-dx) };
    case 270:
      return { dr: zero(dx), dc: zero(-dy) };
    default:
      return { dr: zero(dy), dc: zero(dx) };
  }
}
