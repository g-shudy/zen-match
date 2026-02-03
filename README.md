# Zen Match

A mindful match-3 puzzle game designed for relaxation, not competition.

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

## Features

- **8x8 board** with adjustable gem types (2-10)
- **Special gems** created by matching 4+ in a row:
  - **Bomb** (4-match): 3x3 explosion
  - **Line** (5-match): Clears entire row or column
  - **Rainbow** (6+/L/T): Clears all gems of one color
- **Chain reactions**: Special gems caught in any explosion trigger automatically
- **Live stats**: Watch your average climb in real-time as cascades unfold
- **No score pressure**: Just average points per move - a gentle metric

## Controls

- **Click/tap** two adjacent gems to swap
- **Slider** (2-10): Adjust gem variety
  - Fewer gems = more cascades = more zen
  - Default is 5 (sweet spot)
- **New Game**: Start fresh anytime (even mid-cascade)

## Try Different Modes

```
?gems=2   Chaos mode - endless cascades
?gems=5   Default - balanced zen (recommended)
?gems=10  Challenge mode - rare matches
```

## Tech

- TypeScript + esbuild (no framework)
- Static assets served from `index.html` + `dist/` bundle
- Works offline after first load

## Build (TypeScript + esbuild)

The game is now bundled from TypeScript with a minimal esbuild script. Output goes to `dist/`.

```bash
npm install
npm run build
```

## Local Development

```bash
# Install deps and build on change
npm install
npm run dev

# Serve the repo root (Python)
python -m http.server 8080
```

Then open http://localhost:8080

## Tests

```bash
npm run test
```

## Documentation

- [Design Philosophy](docs/zen-match-design-philosophy.md) - Core principles and zen game design
- [Feature Pipeline](docs/zen-match-feature-pipeline.md) - Planned enhancements

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
