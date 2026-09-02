import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The palette swatch cards preview their colours through the same CSS custom
// properties the board uses. A card that carries no data-palette scope of its
// own inherits whatever palette is active on <html>, so its preview silently
// changes to match the current selection instead of showing its own colours.
// Every card must therefore be self-scoped, and every scope must exist in CSS.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function paletteCards() {
  const cards = [];
  const re = /<label class="palette-card"([^>]*)>\s*<input type="radio" name="palette" value="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const scope = /data-palette="([^"]+)"/.exec(m[1]);
    cards.push({ value: m[2], scope: scope ? scope[1] : null });
  }
  return cards;
}

test('index.html declares one card per palette', () => {
  const cards = paletteCards();
  assert.deepEqual(cards.map(c => c.value), ['default', 'redgreen', 'highcontrast']);
});

test('every palette card is scoped to the palette it previews', () => {
  for (const card of paletteCards()) {
    assert.equal(card.scope, card.value, `card "${card.value}" must carry data-palette="${card.value}"`);
  }
});

test('styles.css defines colour variables for every palette scope', () => {
  for (const card of paletteCards()) {
    const selector = `[data-palette="${card.value}"]`;
    const idx = css.indexOf(selector);
    assert.notEqual(idx, -1, `missing ${selector} rule`);
    const block = css.slice(idx, css.indexOf('}', idx));
    for (let i = 0; i < 5; i++) {
      assert.match(block, new RegExp(`--gem-color-${i}:`), `${selector} must set --gem-color-${i}`);
    }
  }
});
