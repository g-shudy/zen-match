# Zen Match: Design Review Synthesis (Final)

## Panel Members
1. **iOS Safari Engineer** — Mobile web platform specialist
2. **Game UI Designer** — 15yr match-3/casual game veteran
3. **Accessibility Designer** — Color blindness & inclusive game design
4. **Graphics/Motion Designer** — Animation, VFX, and visual polish
5. **Code Architect** — Vanilla TS refactoring specialist
6. **Mindfulness UX Psychologist** — Contemplative game design, flow states, MBSR

---

## Consensus Findings (3+ reviewers agree)

### C1: The board must own the screen
The title, stats, sliders, and chrome steal vertical real estate. On mobile, the board should be 80%+ of the visual field. The `h1` title is dead weight after the first second. Distribution bars and sparkline are developer telemetry, not player UI.

### C2: Safe areas are completely absent
No `viewport-fit=cover`, no `env(safe-area-inset-*)`, `100vh` instead of `100dvh`. Five fixed-position elements overlap the Dynamic Island or home indicator. This is a ship-blocker on iOS.

### C3: Gems need shape differentiation
Color-only rounded rectangles fail for 8% of males at 5 colors, and are unplayable at 8+. Every successful match-3 (Candy Crush, Bejeweled) uses shape+color dual encoding. Shapes should arguably be always-on, not just a colorblind toggle.

### C4: Information overload — 14 simultaneous channels
Board, selected gem, Avg/Move, two sliders, distribution bars, sparkline, score history, combo counter, score popups, New Game, How to Play, back link, version tag. During cascades, 6 channels update simultaneously. Flow requires narrowing to 1.

### C5: The combo escalation fights the zen brand
"Warm/hot/epic" temperature metaphors with escalating font sizes and a screen flash are arousal mechanics. The shake animation is punitive. The tremble at 10Hz is agitation, not anticipation. The surface says "breathe"; the mechanics say "perform."

### C6: `transition: all` on 64 gems is a free perf fix
Both the iOS Safari engineer and graphics designer flagged this independently. Switch to explicit `transform, opacity` properties. Add `will-change` to gems.

---

## Key Tensions

### T1: Zen vs. Juice
The graphics designer wants more particles, screen shake, and escalation. The mindfulness psychologist wants slower animations, no score popups, and breathing rhythm. Both are right for their domain.

**Proposed resolution:** A Zen Mode toggle. Default mode gets the juice improvements. Zen mode strips scoring UI, slows animations, replaces punitive feedback with gentle alternatives.

### T2: Simplify vs. Inform
The game UI designer wants to cut distribution bars, sparkline, and Avg/Move. Some players enjoy stats.

**Proposed resolution:** Move stats behind a panel/drawer. Main view shows only total score + last move score. Detailed stats available on demand.

### T3: Shapes always-on vs. colorblind toggle
The accessibility designer notes Candy Crush shows shapes to everyone. The graphics designer's gloss highlight uses `::after`. Shapes would need inner elements to avoid pseudo-element conflicts with special gems.

**Proposed resolution:** Shapes always-on at reduced opacity (0.25 white overlay). Toggle to increase opacity or disable. This helps everyone's readability at small gem sizes.

---

## Proposed Action Items (36 total, 6 tiers)

### Tier 1: Ship Blockers (iOS mobile)
| # | Item | Est. Effort |
|---|------|-------------|
| 1 | Add `viewport-fit=cover` to viewport meta tag | 1 line |
| 2 | `min-height: 100vh` → `100dvh` on body | 1 line |
| 3 | `env(safe-area-inset-*)` on all 5 fixed elements | ~10 lines CSS |
| 4 | Board sizing: `Math.floor(400/COLS)` → `Math.floor(min(innerWidth-32, 500)/COLS)` | ~5 lines JS |
| 5 | Controls row: add `flex-wrap` or grid layout for mobile | ~15 lines CSS |
| 6 | Slider thumb 16→28px, track 4→8px | 4 lines CSS |
| 7 | `.gem` transition: `all` → `transform 0.25s ..., opacity 0.25s ...` | 1 line CSS |

### Tier 2: Accessibility
| # | Item | Est. Effort |
|---|------|-------------|
| 8 | Move gem colors to CSS custom properties (`--gem-color-N`) | ~30 lines CSS |
| 9 | Add gem shapes via inner `<span>` with `clip-path` (circle, diamond, triangle, square, star, hexagon, cross, heart, moon, drop) | ~50 lines CSS + ~10 lines JS |
| 10 | Palette selector: Default / Red-Green Friendly / High Contrast + `localStorage` | ~30 lines JS+HTML |
| 11 | Fix 4 WCAG contrast failures: `.hint-text`, `.version-tag`, `.help-col p`, `.score-history span` opacity | 4 lines CSS |
| 12 | `prefers-reduced-motion` media query (disable ambient, reduce gem transitions, stop special pulses) | ~15 lines CSS |

### Tier 3: Visual Polish
| # | Item | Est. Effort |
|---|------|-------------|
| 13 | Gem gloss highlight — gradient overlay simulating convex glass | ~5 lines CSS |
| 14 | Landing bounce on drop — overshoot easing curve | 1 line CSS |
| 15 | Cascade acceleration — each combo step ~8% faster, floor at 0.6x | ~5 lines JS |
| 16 | Score popup pop-in — initial scale from below, overshoot | ~5 lines CSS |
| 17 | `specialAppear` upgrade — rotation, brightness burst, 450ms | ~5 lines CSS |
| 18 | Line clear sweep — translateX/Y animation, not just fade | ~10 lines CSS |
| 19 | DOM particles on gem clear — ~6 colored dots scattered outward | ~30 lines JS+CSS |
| 20 | `will-change: transform, opacity` on `.gem`, `.explosion-effect`, `.line-effect`, `.score-popup` | ~4 lines CSS |

### Tier 4: Layout & UI Restructure
| # | Item | Est. Effort |
|---|------|-------------|
| 21 | Move sliders behind settings gear icon | ~40 lines |
| 22 | Move combo counter to board center overlay | ~5 lines CSS |
| 23 | Strip distribution bars and sparkline from main view | Remove code |
| 24 | Add total score display, demote Avg/Move to settings/stats | ~10 lines |
| 25 | First-visit onboarding tooltip ("Swap adjacent gems to match 3+") via localStorage | ~15 lines JS |
| 26 | Idle hint system — gentle glow on valid move after 6s inactivity | ~20 lines JS |

### Tier 5: Zen Mode
| # | Item | Est. Effort |
|---|------|-------------|
| 27 | Zen Mode toggle — hides all scoring UI (popups, combo, stats, Avg/Move) | ~20 lines |
| 28 | Gentle slide-back on invalid moves (replace shake) | ~10 lines CSS |
| 29 | Slow glow on pending matches (replace 100ms tremble with 2-3s brightness cycle) | ~5 lines CSS |
| 30 | Disable boardFlash; ambient orbs respond to combos instead | ~10 lines |
| 31 | Sinusoidal easing curves — no overshoot bounces in zen mode | ~5 lines CSS |
| 32 | Breathing-paced cascade timing — ~3-4s per cycle, smooth deceleration | ~10 lines JS |

### Tier 6: Code Quality
| # | Item | Est. Effort |
|---|------|-------------|
| 33 | Extract `showEffects()` helper (used in 3 call sites) | 5 min |
| 34 | Extract `distBarHTML()` template (used in 2 call sites) | 5 min |
| 35 | Add `getEl<T>()` safe DOM lookup helper | 5 min |
| 36 | Group module-level state into `gameState` + `config` objects | 20 min |

---

## Questions for the Panel

### For ALL reviewers:

**Q1: Priority ranking.** Rank the 6 tiers by implementation order. Would you change the tier assignments of any items?

**Q2: What's missing?** Are there items you recommended that didn't make it into this synthesis? Anything another reviewer said that you strongly disagree with?

**Q3: Zen Mode — friend or crutch?** Is a Zen Mode toggle the right resolution to the zen-vs-juice tension, or is it a cop-out that avoids making a real design decision? Should the *default* experience be zen, with a "Classic Mode" for score chasers? Or the reverse?

**Q4: Shapes always-on — yes or no?** The accessibility designer says always-on. The graphics designer wants gem gloss (which also uses overlays). Can both coexist? Should shapes be on by default and togglable off?

### Specialist questions:

**For iOS Safari Engineer:**
- Q5: Should we add `position: fixed; width: 100%; height: 100dvh` to body for a bulletproof scroll lock, or is `overflow: hidden` + `overscroll-behavior: none` sufficient?
- Q6: The ambient blur blobs (300x300, `filter: blur(80px)`, continuous animation) — kill them on mobile, or just add `will-change: transform`?

**For Game UI Designer:**
- Q7: The combo counter relocation (top-right corner → board center overlay) — does this conflict with score popups that also appear on the board? How do you prevent visual collision?
- Q8: Should New Game auto-apply slider changes (immediate restart) instead of the current two-step "change then click New Game" pattern?

**For Accessibility Designer:**
- Q9: The rainbow gem's conic-gradient uses hardcoded palette colors. In colorblind mode, should it use the alternative palette colors, or switch to a universal spinning pattern (e.g., white/gray)?
- Q10: At what gem count (2-10) does shape differentiation become essential vs. nice-to-have? Is there a threshold below which shapes add visual noise without accessibility benefit?

**For Graphics/Motion Designer:**
- Q11: The mindfulness psychologist wants sinusoidal easing (no overshoot) in zen mode. Your recommendations use bouncy cubic-beziers (`0.34, 1.56, 0.64, 1`) extensively. What easing would you recommend for a "calm but not dead" feel?
- Q12: DOM particles vs. canvas overlay for gem clear effects — which would you use given this is a small vanilla-TS project with no build complexity?

**For Code Architect:**
- Q13: If we're adding Zen Mode, palette switching, shapes, and a settings panel — does the "split into 3-4 modules" recommendation become a prerequisite rather than optional?
- Q14: What's the simplest state management approach for toggleable modes (zen/classic, shapes on/off, palette selection) that persists across sessions?

**For Mindfulness Psychologist:**
- Q15: The graphics designer's particle effects and screen shake are juice that improves game feel. In Zen Mode, should ALL juice be stripped, or is there a "contemplative juice" — effects that feel satisfying without being arousing?
- Q16: Alto's Odyssey's Zen Mode removes scoring but keeps the core mechanics identical. Should Zen Match's Zen Mode also change the *pacing* of animations (breathing-rate cascades), or just hide the UI chrome?

---

## Round 2: Panel Responses

### Unanimous Decisions (6/6)

- **Zen is the default.** The game is called "Zen Match." Classic/Score mode is the opt-in. "If a user has to opt into the zen experience, the name is a lie."
- **Shapes always-on.** No toggle to disable. 0.15-0.25 opacity white overlay via inner `<span>` with `clip-path`. Helps everyone at small gem sizes, not just colorblind users.

### Strong Consensus (4-5/6)

- **Shake → gentle slide-back is universal**, not zen-mode-only. Punitive feedback is hostile UX for everyone. (5/6 — game UI, mindfulness, accessibility, graphics, iOS all agree)
- **Tier 6 (code quality) moves to position 2**, right after Tier 1 ship blockers. 35 min of cleanup prevents hours of rework. (4/6)
- **Promote `will-change` (#20) and `prefers-reduced-motion` (#12) to Tier 1.** Both are one-liner ship blockers. (4/6)

### Resolved Tensions

**Cascade pacing (zen mode):**
- Psychologist proposed 3-4s per cycle. Game UI designer said "would kill the game." Graphics designer proposed middle ground:
- **Start at 350ms per step, decelerate 8% per step, floor at 500ms.** A 5-chain takes ~2s total. Reads as "settling" not "frozen."

**Contemplative juice (zen mode):**
- Graphics designer coined the framework: **luminance, blur, and timing — not scale, displacement, and speed.**
- Explosion: `scale(1.05)` + soft blur dissolve over 450ms ("breath on cold glass")
- Board flash → slow border glow over 1.2s ("border brightens like a slow inhale")
- Tremble → brightness breathing at 2s cycle
- Particles drift like embers, not explode

**Combo counter (zen mode):**
- Game UI: move to board center as translucent watermark in Classic mode
- Mindfulness: remove entirely in Zen mode, replace with ambient visual response (board hue shift, orb breathing)
- **Resolution:** Two behaviors. Classic mode: board-center watermark. Zen mode: ambient-only response, no numbers.

**Zen easing curve:**
- Graphics designer: `cubic-bezier(0.25, 1.0, 0.5, 1)` — zero overshoot, long deceleration. "Confident and unhurried."
- For landing specifically: `cubic-bezier(0.22, 0.95, 0.36, 1)` — barely perceptible ease-past gives weight. "What iOS uses for sheet presentations."

### New Items from Round 2

| # | Item | Source | Tier |
|---|------|--------|------|
| 37 | Touch feedback: subtle 1.05x scale-up on pointerdown (80ms) | Game UI | T3 |
| 38 | Google Fonts `@import` → `<link rel="preconnect">` + async load or self-host | iOS Safari | T1 |
| 39 | `:focus-visible` indicators on gems and controls | Accessibility | T2 |
| 40 | ARIA live regions for score announcements (screen reader support) | Accessibility | T2 |
| 41 | Fill entrance stagger: 15-20ms column stagger on new gem appearance | Graphics | T3 |
| 42 | Extract timing constants into config object (prerequisite for zen pacing) | Code Architect | T6 |
| 43 | `gemColors` JS array must sync with CSS custom properties (single source of truth) | Code Architect | T2 |
| 44 | Session-length awareness: background hue shifts subtly over 15-20 min | Mindfulness | T5 |
| 45 | Pulse New Game button when slider values differ from current game | Game UI | T4 |
| 46 | Cap DOM particles at ~20 concurrent with pool/`animationend` cleanup | iOS Safari | T3 |

### Final Revised Implementation Order

```
Phase 1: Ship Blockers (Tier 1 + promoted items)
  Items 1-7, 12, 20, 38
  ~30 lines of CSS/HTML changes

Phase 2: Code Foundation (Tier 6 + timing extraction)
  Items 33-36, 42, 43
  ~35 min mechanical refactoring
  Establishes gameState, config, Settings interface, timing constants

Phase 3: Accessibility (Tier 2 + new items)
  Items 8-11, 39, 40
  CSS custom properties, shapes, palette selector, contrast fixes

Phase 4: Layout Restructure (Tier 4)
  Items 21-26, 45
  Settings panel, combo counter relocation, stats simplification

Phase 5: Visual Polish (Tier 3)
  Items 13-19, 37, 41, 46
  Gloss, bounce, particles, effects upgrades

Phase 6: Zen Mode (Tier 5 + session awareness)
  Items 27-32, 44
  Mode toggle, contemplative juice, pacing, ambient responses
```

### Settings Architecture (from Code Architect)

```typescript
interface Settings {
  mode: 'zen' | 'classic';
  shapes: boolean;     // always true by default
  palette: 'default' | 'redgreen' | 'highcontrast';
  gridSize: number;
  gemTypes: number;
}
```

- Persisted as single JSON blob in `localStorage`
- Applied via `data-mode` attribute on `<body>`
- All zen mode visual toggles become pure CSS: `body[data-mode="zen"] .combo-counter { display: none }`
- URL params (`?grid=`, `?gems=`) override localStorage when present
- Shapes default to `true`, no toggle exposed in UI

### Pseudo-Element Coexistence Plan (from Accessibility + Graphics)

```
Layer 1: .gem element — background gradient (gem color)
Layer 2: <span class="gem-shape"> — clip-path shape, white fill, opacity 0.2
Layer 3: <span class="gem-gloss"> — gradient highlight, simulates convex glass
Layer 4: .gem::before / .gem::after — reserved for special indicators (bomb ring, line glow, rainbow spin)
```

For special gems, gloss folds into `background-image` stacking on the `.gem` element itself.
