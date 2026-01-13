# Zen Match Feature Pipeline

Future enhancements evaluated for zen/flow compatibility.

> See [zen-match-design-philosophy.md](zen-match-design-philosophy.md) for core principles.
> Key filter: **Does this reward noticing or calculating?**

---

## Phase 1: Polish (Quick Wins)

### 1.1 Breathing Rhythm
**Status:** Proposed
**Cost:** 1 (trivial CSS)
**Flow Impact:** +2

Subtle board pulse animation that slows over time, unconsciously encouraging relaxed breathing.

```css
@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.01); }
}
.game-board {
  animation: breathe 4s ease-in-out infinite;
}
```

### 1.2 Soft Transitions
**Status:** Proposed
**Cost:** 1
**Flow Impact:** +1

- **New Game:** Fade out current board, fade in new board
- **Shuffle:** Dissolve and reform rather than instant reset

### 1.3 Cascade Celebration
**Status:** Proposed
**Cost:** 1
**Flow Impact:** +2

Gentle sparkle/ripple effect when cascade chain reaches 3+. Could be CSS-only with pseudo-elements or simple particle burst.

---

## Phase 2: Audio

### 2.1 Ambient Match Sounds
**Status:** Proposed
**Cost:** 2
**Flow Impact:** +2

Each gem color produces a distinct soft chime when matched. Cascades create emergent melodies. Need 6 tuned sounds (pentatonic scale works well for pleasant random combinations).

**Considerations:**
- Volume control / mute toggle
- Sound should not be jarring
- Layer sounds gracefully during cascades

---

## Phase 3: Ice Layer Mechanic

### 3.1 Core Concept
**Status:** Design Phase
**Cost:** 2-3
**Flow Impact:** +1
**Depth Impact:** +1

Gems can be "frozen" in ice. Frozen gems cannot be swapped but CAN participate in matches. Breaking ice requires adjacent matches (1-2 matches depending on ice thickness).

### 3.2 Design Questions

**How does ice appear?**

Option A: **Natural Spawn**
- Small chance (5-10%) when new gems fall, some spawn frozen
- Creates gentle ongoing challenge without player action
- Risk: Could feel random/unfair

Option B: **Cascade Freeze** - REJECTED
- Long cascades (5+ chains) freeze 1-3 random gems at the end
- **Violates core philosophy:** Cascades should be gifts to watch, not events that trigger consequences. This would make players anxious during cascades instead of appreciating them.
- Punishes the "witness" experience we're cultivating

Option C: **Pattern Trigger**
- Specific rare patterns create ice elsewhere
- Example: Matching all 6 colors simultaneously (requires board scan)
- Risk: Too rare to matter? Complex detection

Option D: **Board State Trigger** - REJECTED
- When board has few moves remaining, some gems freeze
- **Violates core philosophy:** Adds pressure at a moment when the player may already feel stuck. Creates anxiety instead of acceptance.
- The board running low on moves should feel like a natural ending, not a penalty

**Recommendation:** Option A (natural spawn, low rate). Ice simply *exists* sometimes - not as reward, not as punishment, just as variety. Like weather. The player notices it, works around it, watches it shatter. No judgment, no consequence, just another thing to observe.

### 3.3 Ice Mechanics

```
Ice States:
- NONE: Normal gem
- THIN: 1 adjacent match to break
- THICK: 2 adjacent matches to break (optional, adds complexity)

Frozen Gem Behavior:
- Cannot be selected/swapped
- CAN be matched if adjacent gems create a line through it
- CAN be affected by special gems (bomb clears ice, line clears ice, rainbow clears ice)
- When ice breaks: satisfying crack visual/sound

Special Gem Interactions:
- Bomb hitting frozen gem: Breaks ice AND removes gem
- Line hitting frozen gem: Breaks ice AND removes gem
- Rainbow targeting frozen color: Breaks all ice of that color AND removes gems
- Frozen special gem: Cannot activate until ice broken, then activates on break
```

### 3.4 Visual Design

```
Thin Ice:
- Semi-transparent blue-white overlay
- Subtle frost texture
- Gentle shimmer animation

Thick Ice (if implemented):
- More opaque overlay
- Visible cracks after first break
- Darker blue tint

Ice Break Animation:
- Crack pattern appears
- Shatter into fragments
- Fragments fade as they fall
- Soft "crack" sound
```

### 3.5 Implementation Outline

```javascript
// Gem object extension
{
  type: 0-5,
  special: SPECIAL.NONE/BOMB/LINE/RAINBOW,
  direction: 'row'/'col',
  ice: 0  // 0=none, 1=thin, 2=thick
}

// Spawn logic modification
function createGem(type) {
  const gem = { type, special: SPECIAL.NONE, ice: 0 };
  if (Math.random() < 0.08) {  // 8% chance
    gem.ice = 1;
  }
  return gem;
}

// Swap validation
function canSwap(r, c) {
  return board[r][c].ice === 0;
}

// Match processing addition
function processAdjacentIce(r, c) {
  // Check 4 neighbors for ice, decrement
  for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    const gem = board[r+dr]?.[c+dc];
    if (gem?.ice > 0) {
      gem.ice--;
      if (gem.ice === 0) {
        playIceBreakAnimation(r+dr, c+dc);
      }
    }
  }
}
```

### 3.6 Open Questions

1. Should ice appear from the start, or unlock after X games/moves?
2. Should there be a "no ice" toggle for pure zen mode?
3. Visual: Overlay approach vs border approach vs filter approach?
4. Should frozen gems count toward "no valid moves" detection?

---

## Phase 4: Undo Button

### 4.1 Core Concept
**Status:** Proposed
**Cost:** 3
**Flow Impact:** +2
**Depth Impact:** -1 (reduces consequence, but appropriate for zen)

Single-move undo that lets players reverse their last swap. Removes regret and encourages experimentation.

### 4.2 Challenges

- Must snapshot entire board state before each move
- Cascades make this complex (undo to pre-cascade state)
- Special gem activations create long chains
- Animation state management

### 4.3 Implementation Approach

```javascript
let previousState = null;

function snapshotBoard() {
  return {
    board: board.map(row => row.map(gem => ({...gem}))),
    gamePoints,
    gameMoves,
    scoreHistory: [...scoreHistory]
  };
}

function trySwap(r1, c1, r2, c2) {
  previousState = snapshotBoard();
  // ... existing swap logic
}

function undo() {
  if (!previousState) return;
  board = previousState.board;
  gamePoints = previousState.gamePoints;
  gameMoves = previousState.gameMoves;
  scoreHistory = previousState.scoreHistory;
  previousState = null;
  renderBoard();
}
```

---

## Phase 5: Future Considerations

### 5.1 Magnet Gem
**Cost:** 5 (complex)
**Flow:** +2, **Depth:** +2

After each move, magnet gems pull same-color gems one space closer. Creates organic clustering and mesmerizing movement patterns.

**Why deferred:** Complex movement logic, collision handling, cascade interactions. High reward but high implementation risk.

### 5.2 Line + Rainbow Combo
**Cost:** 4
**Flow:** +1, **Depth:** +1

All gems of target color become line gems, then all activate. Spectacular cascade.

**Why deferred:** Complex sequencing, potential performance issues with many simultaneous line clears, balance concerns (possibly too powerful).

### 5.3 Seasonal Themes
**Cost:** 2
**Flow:** +1

CSS variable color schemes that rotate by season. Spring pastels, summer brights, autumn warmth, winter cool.

**Why deferred:** Nice-to-have polish, not core experience enhancement.

---

## Evaluation Criteria

### Philosophy Filter (Must Pass First)

Before scoring, every feature must answer:

1. **Does this reward noticing or calculating?** - Must reward noticing
2. **Does this create spectacle or strategy?** - Must create spectacle
3. **Does this add pressure or peace?** - Must add peace
4. **Does this judge or accept?** - Must accept

If a feature fails any of these, it's rejected regardless of other scores.

### Numeric Scoring

| Score | Flow Impact | Depth Impact | Cost |
|-------|-------------|--------------|------|
| +2 | Enhances zen significantly | Adds meaningful choices | 1 = Trivial |
| +1 | Mild enhancement | Minor addition | 2 = Easy |
| 0 | Neutral | Neutral | 3 = Moderate |
| -1 | Mild disruption | Removes choices | 4 = Complex |
| -2 | Disrupts zen | Simplifies too much | 5 = Risky |

**Decision rule:** Implement if (Flow + Depth) >= Cost, unless Flow is negative.

---

## References

- [45 Match-3 Mechanics](https://www.gamedeveloper.com/design/45-match-3-mechanics)
- [Cognitive Flow in Game Design](https://www.gamedeveloper.com/design/cognitive-flow-the-psychology-of-great-game-design)
- Panel evaluation session: 2026-01-13
