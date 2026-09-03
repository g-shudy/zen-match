import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPECIAL, ARM } from '../dist/engine.js';

// The help sheet's legend is the only place a player learns what each special does.
// Every special the engine can create must have an entry, the beam gem must show all
// four of its shapes, and every class a sample uses must exist in the stylesheet.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function legendEntries() {
  const entries = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  const spanRe = /<span class="gem ([^"]*)"[^>]*aria-hidden="true">/;
  const strongRe = /<strong>([^<]+)<\/strong>/;
  let li;
  while ((li = liRe.exec(html)) !== null) {
    const block = li[1];
    const spanMatch = spanRe.exec(block);
    const strongMatch = strongRe.exec(block);
    if (!spanMatch || !strongMatch) continue;
    const classes = spanMatch[1].split(/\s+/).filter(Boolean);
    if (classes.includes('sample')) entries.push({ name: strongMatch[1], classes });
  }
  return entries;
}

function armMask(classes) {
  let arms = 0;
  if (classes.includes('arm-up')) arms |= ARM.UP;
  if (classes.includes('arm-right')) arms |= ARM.RIGHT;
  if (classes.includes('arm-down')) arms |= ARM.DOWN;
  if (classes.includes('arm-left')) arms |= ARM.LEFT;
  return arms;
}

function bitCount(n) {
  let count = 0;
  for (let b = n; b > 0; b >>= 1) count += b & 1;
  return count;
}

test('every special the engine can create has a legend entry', () => {
  const entries = legendEntries();
  for (const special of Object.values(SPECIAL)) {
    if (special === null) continue;
    assert.ok(entries.some(e => e.classes.includes(`special-${special}`)), `no legend entry for ${special}`);
  }
});

test('the legend shows a line, a corner, a tee and a cross', () => {
  const masks = legendEntries().filter(e => e.classes.includes('special-line')).map(e => armMask(e.classes));
  assert.ok(masks.every(m => m > 0), 'every beam sample must show at least one arm');
  const opposite = m => m === (ARM.LEFT | ARM.RIGHT) || m === (ARM.UP | ARM.DOWN);
  assert.ok(masks.some(m => bitCount(m) === 2 && opposite(m)), 'a Line: two opposite arms');
  assert.ok(masks.some(m => bitCount(m) === 2 && !opposite(m)), 'a Corner: two adjacent arms');
  assert.ok(masks.some(m => bitCount(m) === 3), 'a Tee: three arms');
  assert.ok(masks.some(m => m === 15), 'a Cross: four arms');
});

test('every class a legend sample uses has a stylesheet rule', () => {
  for (const entry of legendEntries()) {
    for (const cls of entry.classes) {
      if (cls === 'gem' || cls === 'sample') continue;
      assert.ok(css.includes(`.${cls}`), `legend "${entry.name}" uses .${cls}, which styles.css never defines`);
    }
  }
});
