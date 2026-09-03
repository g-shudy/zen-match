# Zen Match

A calm match-3. Swap gems, watch the cascades unfold, and breathe.

**[Play Now](https://zen.ghsj.me)**

## Philosophy

> *Reward noticing, not calculating.*

Zen Match is different from traditional match-3 games. There's no timer, no score to beat, no pressure. Just colorful gems, satisfying cascades, and moments of calm.

When gems cascade, your role shifts from "solver" to "witness" - watching patterns emerge, colors flow, and chain reactions unfold. The game rewards presence, not optimization.

**Core principles:**
- Cascades are gifts to watch, not achievements to earn
- The board is a "concentration object" for mindfulness
- No judgment, no pressure, just observation

Read the full [Design Philosophy](docs/zen-match-design-philosophy.md).

## Playing

- **Swap** two neighbouring gems to line up three or more of a color. Drag a gem onto its neighbour, or tap one and then the other. On a keyboard, arrow keys move between gems and Enter or Space selects.
- **Cascades settle** rather than accelerate: each wave of a chain is a little slower than the last, so a long chain is something to watch.
- **Special gems**, by the size and shape of the matched group:
  - **Bomb**: a straight 4 - clears a 3x3 area
  - **Line**: a straight 5 - fires a beam each way along its line, to the edge
  - **Corner**, **Tee**, **Cross**: an L, T or plus of 5 - one beam along each leg, from the cell where the legs meet
  - **Rainbow**: any connected group of 6+ - clears every gem of one color when swapped

  Groups are counted by connected cells, not run length - two 3-matches that touch
  form a group of 6 and make a Rainbow. Swapping two specials together combines them:
  two beam gems fire every arm either had (a horizontal and a vertical line make a cross), a bomb with a beam
  gem fires each beam three wide, and a rainbow with a beam gem gives every gem of that
  color the same beams.
- **Chain reactions**: special gems caught in any explosion trigger automatically.
- **No way to lose**: if the board runs out of moves it reshuffles itself.

The score in the corner is gentle feedback, not a target. Moves, points, average per move and the longest cascade are in Settings under *This game*.

## Settings

Behind the sliders icon:

- **Board size** (6x6, 8x8, 10x10, 12x12) and **colors** (4 to 7). Changing either starts a new game; the button says so before it does.
- **Palette**: Classic, Color-blind friendly, or High contrast. Every gem also carries its own shape, so matches stay readable in any palette.

Settings and the current board are remembered, so closing the tab and coming back resumes the game where you left it.

## URL parameters

The full range is available by link, beyond what the settings sheet offers:

```
?gems=4   Fewer colors, longer cascades (2-10, default 5)
?gems=10  Rare matches
?grid=12  Bigger board (4-16, default 8)
?seed=42  Reproducible board (never resumes a saved game)
```

Cascades are bounded: refills avoid creating immediate matches, and a single move
resolves at most 50 cascade waves. At `?gems=2` that limit is reached routinely -
one move can already be over a minute of animation.

## Tech

- TypeScript + esbuild (no framework)
- Static assets served from `index.html` + `dist/` bundle
- Installable: web manifest, app icons, `theme-color`; add it to a phone's home screen for a standalone window
- Game state and settings persist in `localStorage`; `src/storage.ts` validates everything it reads back

## Build (TypeScript + esbuild)

```bash
npm install
npm run build
```

Output goes to `dist/`. The version shown in Settings comes from `package.json`.

## Local Development

```bash
# Install deps and build on change
npm install
npm run dev

# Serve the repo root
uv run python -m http.server 8080
```

Then open http://localhost:8080

## Tests

```bash
npm run test
```

Engine tests cover matching, specials, cascades and shuffles; storage tests cover settings parsing, URL overrides and saved-game validation.

## Documentation

- [Design Philosophy](docs/zen-match-design-philosophy.md) - Core principles and zen game design
- [Feature Pipeline](docs/zen-match-feature-pipeline.md) - Planned enhancements
- [Project Log](docs/project-log.md) - Decisions and tech debt

## Contributing

Ideas welcome! The game prioritizes zen/flow over complexity. When evaluating features, ask:

1. Does this reward noticing or calculating?
2. Does this create spectacle or strategy?
3. Does this add pressure or peace?

See the [Feature Pipeline](docs/zen-match-feature-pipeline.md) for the evaluation framework.

## License

MIT

---

*Make a move. Watch what happens. Appreciate the colors. Breathe. Repeat.*
