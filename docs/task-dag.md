# Zen Match Refactor: Task DAG

Reference: `docs/review-synthesis.md` (46 items, 6 phases)

---

## File Ownership Map

Understanding which files each task touches is critical for parallelization.

| File | Primary tasks | Notes |
|------|---------------|-------|
| `index.html` | T1, T5, T9, T10, T21, T24, T25, T27, T38, T39, T40, T45 | High contention — HTML structure |
| `src/styles.css` | T2, T3, T5, T6, T7, T8, T11, T12, T13, T14, T16, T17, T18, T20, T22, T28, T29, T31, T37, T41 | Highest contention — nearly every visual task |
| `src/main.ts` | T4, T9, T10, T15, T19, T21, T23, T24, T25, T26, T27, T30, T32, T33, T34, T35, T36, T42, T43, T44, T45, T46 | Highest contention — most behavioral tasks |
| `src/engine/index.ts` | T15, T42 | Low contention — engine logic |

---

## Task Definitions with Dependencies and Acceptance Criteria

### Phase 1: Ship Blockers (T1-T7, T12, T20, T38)

**T1: Add `viewport-fit=cover` to viewport meta tag**
- File: `index.html`
- Depends on: `[]`
- Acceptance:
  - `<meta name="viewport">` contains `viewport-fit=cover`
  - On iPhone 15 Pro (430x932 in DevTools), the page extends behind the Dynamic Island / notch area
  - No visible change on non-notched devices

**T2: `min-height: 100vh` to `100dvh` on body**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `body` rule uses `min-height: 100dvh`
  - On iOS Safari, the page does not jump when the URL bar collapses/expands
  - Fallback: `min-height: 100vh` before `100dvh` for older browsers, or `@supports` guard

**T3: `env(safe-area-inset-*)` on all 5 fixed elements**
- File: `src/styles.css`
- Depends on: `[T1]` (viewport-fit=cover must be set first for env() to have non-zero values)
- Acceptance:
  - These 5 fixed-position selectors include safe-area padding:
    - `.combo-counter` — `top: calc(20px + env(safe-area-inset-top))`, `right: calc(20px + env(safe-area-inset-right))`
    - `.shuffle-notice` — no change needed (centered)
    - `.version-tag` — `bottom: calc(12px + env(safe-area-inset-bottom))`, `left: calc(12px + env(safe-area-inset-left))`
    - `.back-link` — `top: calc(20px + env(safe-area-inset-top))`, `left: calc(20px + env(safe-area-inset-left))`
    - `.how-to-play` — `padding-bottom: env(safe-area-inset-bottom)` on the toggle/content
  - On iPhone simulator with notch, no element is clipped behind the Dynamic Island or home indicator

**T4: Responsive board sizing**
- File: `src/main.ts` (function `updateBoardSizing`)
- Depends on: `[]`
- Acceptance:
  - `cellSize` calculation changes from `Math.floor(400 / COLS)` to `Math.floor(Math.min(window.innerWidth - 32, 500) / COLS)`
  - On a 375px-wide viewport (iPhone SE), the board fits within the screen with 16px padding on each side
  - On a 430px viewport, board is no wider than 430-32 = 398px total
  - On desktop (>500px), board is capped at 500/COLS per cell
  - Board resizes correctly on `window.resize` event (or `updateBoardSizing` is called on resize)

**T5: Controls row flex-wrap or grid layout for mobile**
- File: `src/styles.css`, `index.html` (minor restructure if grid)
- Depends on: `[]`
- Acceptance:
  - At viewport width <= 430px, controls wrap to multiple rows without overflow or clipping
  - New Game button, Avg/Move, and both sliders are all visible and tappable
  - At viewport width >= 768px, controls remain in a single row
  - No horizontal scrollbar appears at any viewport width

**T6: Slider thumb 16px to 28px, track 4px to 8px**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.gem-slider::-webkit-slider-thumb` has `width: 28px; height: 28px`
  - `.gem-slider::-moz-range-thumb` has `width: 28px; height: 28px`
  - `.gem-slider` height is `8px`
  - Thumb is easily tappable on mobile (meets 44px touch target via padding or hit area)

**T7: Gem transition: `all` to explicit properties**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.gem` rule: `transition: all 0.25s ...` becomes `transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)`
  - Gem selection/deselection animation still works (scale change animates smoothly)
  - Gem swap animation still works
  - No new jank or layout thrashing during cascades

**T12: `prefers-reduced-motion` media query** *(promoted to Phase 1)*
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - A `@media (prefers-reduced-motion: reduce)` block exists containing:
    - `.ambient::before, .ambient::after { animation: none; }`
    - `.gem { transition-duration: 0.01s; }` (effectively instant)
    - `.gem.special-bomb::before, .gem.special-bomb::after { animation: none; }`
    - `.gem.special-line::after { animation: none; }`
    - `.gem.special-rainbow::before { animation: none; }`
    - `.gem.pending-match { animation: none; }`
  - With "Reduce motion" enabled in OS settings, ambient blobs are static, gems snap into place, special gem indicators are static

**T20: `will-change` on animated elements** *(promoted to Phase 1)*
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.gem` has `will-change: transform, opacity`
  - `.explosion-effect` has `will-change: transform, opacity`
  - `.line-effect` has `will-change: opacity`
  - `.score-popup` has `will-change: transform, opacity`
  - No visible change in behavior; verified no layer explosion (Chrome DevTools > Layers shows reasonable count)

**T38: Google Fonts `@import` to `<link>` with preconnect** *(new from Round 2)*
- Files: `src/styles.css`, `index.html`
- Depends on: `[]`
- Acceptance:
  - `@import url('https://fonts.googleapis.com/...')` is removed from `src/styles.css`
  - `index.html` `<head>` contains:
    ```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300;400;500&display=swap" rel="stylesheet">
    ```
  - Font loads correctly (text renders in Quicksand, not fallback)
  - Lighthouse audit shows no render-blocking `@import`

---

### Phase 2: Code Foundation (T33-T36, T42, T43)

**T33: Extract `showEffects()` helper**
- File: `src/main.ts`
- Depends on: `[]`
- Acceptance:
  - A function `showEffects(effects: Effect[]): void` exists that encapsulates the explosion/line effect display logic currently duplicated at lines ~446-451 and ~500-507
  - Called in both `playSubSteps` and the else branch of the `remove` case in `playFrames`
  - Existing behavior unchanged (effects display identically)

**T34: Extract `distBarHTML()` template**
- File: `src/main.ts`
- Depends on: `[]`
- Acceptance:
  - A function `distBarHTML(dist: number[]): string` exists
  - Called in both `renderStats` (line ~204) and `liveUpdateStats` (line ~230)
  - Output HTML is identical to current inline template

**T35: Add `getEl<T>()` safe DOM lookup helper**
- File: `src/main.ts`
- Depends on: `[]`
- Acceptance:
  - A generic function `getEl<T extends HTMLElement>(id: string): T` exists
  - Throws descriptive error if element not found (e.g., `throw new Error(\`Element #\${id} not found\`)`)
  - All `document.getElementById(...) as ...` casts (lines ~47-59) replaced with `getEl<T>(id)`
  - TypeScript compiles without errors; runtime behavior unchanged

**T36: Group module-level state into `gameState` + `config` objects**
- File: `src/main.ts`
- Depends on: `[T33, T34, T35]` (cleaner to do after helper extractions)
- Acceptance:
  - A `gameState` object contains: `selected`, `isProcessing`, `runToken`, `pendingPoints`, `gamePoints`, `gameMoves`, `distHistory`, `scoreHistory`, `avgHistory`, `currentBoard`
  - A `config` object contains: `GRID_SIZE` (renamed from module var), `ROWS`, `COLS`, `GEM_TYPES`, `pendingGridSize`, `pendingGemTypes`, `seed`, `seedLocked`, `MAX_HISTORY`
  - All references updated; no new global `let` variables remain (except DOM references and `engine`)
  - TypeScript compiles; all tests pass (`npm test`)

**T42: Extract timing constants into config object**
- File: `src/main.ts`
- Depends on: `[T36]` (timing constants belong in `config`)
- Acceptance:
  - A `timing` property on `config` (or separate `timingConfig`) contains all `sleep()` durations:
    - `swapDelay: 200`, `invalidDelay: 400`, `removeDelay: 400`, `subStepPause: 150`, `subStepDelay: 300`, `boardDelay: 100`, `specialBoardDelay: 300`, `dropDelay: 250`, `fillDelay: 200`, `previewDelay: 400`, `shuffleDelay: 500/700`, `comboHideDelay: 500`, `dragThreshold: 16`, `dragTimeGate: 120`
  - All hardcoded `sleep(N)` calls reference `config.timing.X`
  - Behavior unchanged at default values

**T43: `gemColors` JS array must sync with CSS custom properties**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T8]` (T8 creates the CSS custom properties; T43 makes JS read from them)
- Acceptance:
  - `gemColors` array in `main.ts` is removed or derived from CSS custom property values
  - A function reads `getComputedStyle(document.documentElement).getPropertyValue('--gem-color-N')` for each color
  - When palette changes (T10), the JS color array updates automatically
  - Distribution bars and sparkline still render with correct colors

---

### Phase 3: Accessibility (T8-T11, T39, T40)

**T8: Move gem colors to CSS custom properties**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `:root` (or `body`) declares `--gem-color-0` through `--gem-color-9` with the current palette values
  - `.gem-0` through `.gem-9` use `background: linear-gradient(135deg, var(--gem-color-0), <darker variant>)` and `color: var(--gem-color-0)`
  - Visual output is pixel-identical to current
  - Darker gradient stop can use `color-mix()` or a second custom property per gem

**T9: Add gem shapes via inner `<span>` with `clip-path`**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T8]` (shapes layer must be aware of gem color layer structure)
- Acceptance:
  - `createGrid()` or `renderBoard()` adds `<span class="gem-shape"></span>` inside each `.gem` div
  - CSS defines 10 `clip-path` shapes: `.gem-0 .gem-shape` (circle), `.gem-1 .gem-shape` (diamond), `.gem-2 .gem-shape` (triangle), `.gem-3 .gem-shape` (square), `.gem-4 .gem-shape` (star), `.gem-5 .gem-shape` (hexagon), `.gem-6 .gem-shape` (cross), `.gem-7 .gem-shape` (heart), `.gem-8 .gem-shape` (moon), `.gem-9 .gem-shape` (drop)
  - `.gem-shape` has `position: absolute; inset: 15%; background: rgba(255,255,255,0.2); pointer-events: none`
  - Shapes are visible on default palette at standard gem size
  - Shapes do not interfere with special gem indicators (bomb ring, line glow, rainbow spin)

**T10: Palette selector with localStorage**
- Files: `src/main.ts`, `index.html`, `src/styles.css`
- Depends on: `[T8, T9]` (palette switching requires CSS custom properties to be in place)
- Acceptance:
  - HTML has a palette picker (dropdown or button group): Default / Red-Green Friendly / High Contrast
  - Selecting a palette updates `:root` custom properties `--gem-color-0..9` to the new palette
  - Selection persists in `localStorage` under key `zen-match-palette` (or within a Settings JSON blob)
  - On page load, stored palette is applied before first render
  - Red-Green Friendly palette: no two gem colors that differ only in red-green channel
  - High Contrast palette: all 10 colors have >= 3:1 contrast ratio against the board background (#1a1a2e)

**T11: Fix 4 WCAG contrast failures**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.hint-text` color lightened from `#5a7a84` to at least 4.5:1 contrast against `#1a1a2e` background (approximately `#8ab0bc` or lighter)
  - `.version-tag` color lightened from `#4a6a74` to at least 4.5:1 contrast (approximately `#7a9ea8` or lighter)
  - `.help-col p` color `#8a9ea8` verified >= 4.5:1 against `rgba(15, 20, 40, 0.92)` — adjust if needed
  - `.score-history span` with `opacity: 0.5` — either increase base color lightness or increase opacity to meet 4.5:1
  - Verified with axe-core or WCAG contrast checker tool

**T39: `:focus-visible` indicators on gems and controls** *(new from Round 2)*
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.cell:focus-visible` shows a visible outline (e.g., `outline: 2px solid #95d5b2; outline-offset: 2px`)
  - `.new-game-btn:focus-visible` shows a visible outline
  - `.gem-slider:focus-visible` shows a visible outline
  - `.how-to-play-toggle:focus-visible` shows a visible outline
  - Focus indicators are not visible on mouse click (`:focus-visible` not `:focus`)
  - Tab navigation through controls works and shows focus ring

**T40: ARIA live regions for score announcements** *(new from Round 2)*
- Files: `index.html`, `src/main.ts`
- Depends on: `[]`
- Acceptance:
  - Score display area has `aria-live="polite"` and `role="status"`
  - Combo counter has `aria-live="assertive"` (or polite)
  - Screen reader (VoiceOver) announces score changes during gameplay
  - Announcements are not too frequent (debounce or only announce final move score, not each cascade step)

---

### Phase 4: Layout Restructure (T21-T26, T45)

**T21: Move sliders behind settings gear icon**
- Files: `index.html`, `src/main.ts`, `src/styles.css`
- Depends on: `[T36]` (settings architecture should be in place)
- Acceptance:
  - A gear icon button is visible in the controls area
  - Clicking it opens a settings panel/drawer (could be a `<details>` element or modal)
  - Panel contains: gem count slider, grid size slider (moved from controls-row)
  - Panel closes on outside click or a close button
  - Sliders still function as before (emit input events, pending values, "New Game to apply" message)
  - Controls row is visually simplified (just New Game + score display)

**T22: Move combo counter to board center overlay**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.combo-counter` changes from `position: fixed; top: 20px; right: 20px` to being positioned within or overlaying the `.board` element
  - In Classic mode: combo text appears as a semi-transparent watermark centered on the board
  - `font-size: 3rem; opacity: 0.3; pointer-events: none` centered within the board
  - Does not obscure gameplay (low opacity, behind gem z-index)
  - Does not conflict with score popups (different z-index layer)

**T23: Strip distribution bars and sparkline from main view**
- Files: `index.html`, `src/main.ts`
- Depends on: `[T21]` (stats may move to settings/stats panel instead of being deleted)
- Acceptance:
  - `#distHistory` and `#avgSparkline` are removed from the visible main view (either deleted from HTML or hidden by default)
  - `renderStats()` and `liveUpdateStats()` either removed or gated behind a stats panel toggle
  - `renderSparkline()` either removed or gated
  - No JavaScript errors from missing DOM elements
  - Main view is visually cleaner with just the board and minimal controls

**T24: Add total score display, demote Avg/Move**
- Files: `index.html`, `src/main.ts`, `src/styles.css`
- Depends on: `[T23]` (replaces the stats that were removed)
- Acceptance:
  - A total score element is visible on the main view (e.g., `<span id="totalScore">0</span>`)
  - Score updates after each move with the cumulative `gamePoints`
  - Avg/Move is either moved to the settings/stats panel or removed from the main view
  - Score display is styled subtly (not dominating, consistent with zen aesthetic)
  - `formatNumber()` is used for display

**T25: First-visit onboarding tooltip**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - On first visit (no `localStorage` key `zen-match-visited`), a tooltip/overlay appears saying "Swap adjacent gems to match 3+"
  - Tooltip dismisses on first tap/click anywhere
  - `localStorage` is set so tooltip never shows again
  - Tooltip is positioned near the board center, styled with the existing dark glass aesthetic
  - Does not interfere with the How to Play panel

**T26: Idle hint system**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T36]` (needs `gameState.isProcessing` and `config.timing`)
- Acceptance:
  - After 6 seconds of no pointer/touch activity while not processing, a valid move pair of gems gets a gentle glow animation (CSS class `hint-glow`)
  - `Engine.findValidMove()` is used to identify the target gems
  - Glow is removed on next pointer interaction
  - Timer resets on every pointerdown/pointermove
  - No hint shown during processing or when board is animating
  - `.hint-glow` CSS: subtle box-shadow pulse animation, 2s cycle, low intensity

**T45: Pulse New Game button when slider values differ** *(new from Round 2)*
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T21]` (if sliders move to settings panel, button location may change)
- Acceptance:
  - When `pendingGemTypes !== GEM_TYPES || pendingGridSize !== GRID_SIZE`, the New Game button gets class `pending-change`
  - `.new-game-btn.pending-change` has a subtle pulsing animation (border color or background pulse)
  - Pulse stops when slider returns to current value or New Game is clicked
  - Replaces or supplements the floating "New Game to apply" message

---

### Phase 5: Visual Polish (T13-T19, T37, T41, T46)

**T13: Gem gloss highlight**
- File: `src/styles.css`
- Depends on: `[T9]` (must not conflict with gem-shape span layer)
- Acceptance:
  - Each `.gem` has a gloss overlay — either via `<span class="gem-gloss">` or `background-image` stacking
  - Gloss is a `linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 50%)` overlay
  - Visible on all gem types, including specials
  - Gives a "convex glass" appearance — brighter top-left, transparent bottom-right

**T14: Landing bounce on drop**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.gem` transition easing includes overshoot for the `transform` property: `cubic-bezier(0.34, 1.56, 0.64, 1)` (already present, verify drop frames trigger it)
  - Alternatively, a `.gem.landing` class with a keyframe animation that overshoots by ~5% on Y axis
  - Gems visually "bounce" slightly when landing after a drop
  - Bounce is subtle (3-5% overshoot), not cartoonish

**T15: Cascade acceleration**
- File: `src/main.ts`
- Depends on: `[T42]` (timing constants must be extracted first)
- Acceptance:
  - In `playFrames`, the `remove` case sleep duration decreases by ~8% per combo step
  - Formula: `baseDelay * Math.max(0.6, Math.pow(0.92, combo - 1))`
  - Combo 1: 400ms, Combo 2: 368ms, Combo 5: ~290ms, floor at 240ms (0.6 * 400)
  - Long cascades feel like they're accelerating, not dragging

**T16: Score popup pop-in animation**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `@keyframes scoreFloat` updated: starts with `transform: translateX(-50%) translateY(10px) scale(0.5)` at 0%, pops up to `scale(1.1)` at 20%, then settles to current float-away
  - Score popups appear from slightly below, scale up with a slight overshoot, then float away
  - Duration remains ~1s total

**T17: `specialAppear` animation upgrade**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `@keyframes specialAppear` updated to 450ms duration
  - Includes rotation (`rotate(0deg)` to `rotate(15deg)` and back) and brightness burst (`filter: brightness(1.5)` at 30%)
  - New specials feel more impactful when created
  - Does not interfere with gem position (only uses scale, rotate, filter)

**T18: Line clear sweep animation**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `@keyframes lineClear` updated: horizontal line clears get `translateX(±50px)` sweep; vertical get `translateY(±50px)` sweep
  - Gems swept in the direction of the line clear, not just fade
  - Two variants: `.gem.line-cleared.sweep-left`, `.gem.line-cleared.sweep-right` (or direction determined by position relative to trigger)
  - Fallback: single direction sweep is acceptable for v1

**T19: DOM particles on gem clear**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T46]` (particle pool/cap must be in place)
- Acceptance:
  - When gems are cleared, ~6 small colored dots (4-6px circles) scatter outward from each cleared position
  - Particles match the cleared gem's color
  - Particles animate: `transform: translate(Xpx, Ypx) scale(0)` over 400-600ms with random X/Y offsets
  - Particles are DOM elements (not canvas), cleaned up via `animationend` listener
  - Performance: no frame drops on 8x8 board cascade (test on mobile DevTools throttle)

**T37: Touch feedback scale-up on pointerdown** *(new from Round 2)*
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - On `pointerdown` on a gem, the gem scales to 1.05x over 80ms
  - Scale resets on `pointerup` or `pointercancel`
  - CSS: `.gem.touching { transform: scale(1.05); transition: transform 80ms ease-out; }`
  - JS: adds/removes `touching` class on pointer events
  - Does not interfere with drag detection or selection logic

**T41: Fill entrance stagger** *(new from Round 2)*
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - When new gems fill in from the top, each column staggers its appearance by 15-20ms
  - Implementation: set `transition-delay` or `animation-delay` per column on fill frames
  - Gems appear to "rain in" from left to right (or per-column)
  - Stagger is subtle (max total delay ~160ms for 8 columns), doesn't slow perceived gameplay

**T46: Cap DOM particles with pool and `animationend` cleanup** *(new from Round 2)*
- Files: `src/main.ts`
- Depends on: `[]` (should be implemented before T19 but is logically a constraint)
- Acceptance:
  - A particle pool/counter limits concurrent particle DOM elements to ~20
  - Each particle registers an `animationend` listener that removes it and decrements the counter
  - If counter at cap, oldest particles are force-removed (or new particles are not created)
  - No particle DOM leak (elements accumulate indefinitely)

---

### Phase 6: Zen Mode (T27-T32, T44)

**T27: Zen Mode toggle**
- Files: `index.html`, `src/main.ts`, `src/styles.css`
- Depends on: `[T36, T42, T21]` (needs gameState/config architecture and settings panel)
- Acceptance:
  - A toggle (switch or button) exists in the settings panel: "Zen Mode" / "Classic Mode"
  - Default is Zen Mode (per unanimous panel decision)
  - `body` element gets `data-mode="zen"` or `data-mode="classic"` attribute
  - In Zen Mode, these CSS rules activate:
    - `.score-popup { display: none }` (or opacity: 0)
    - `.combo-counter { display: none }`
    - Stats section hidden
    - Avg/Move hidden
  - In Classic Mode, all scoring UI is visible
  - Mode persists in `localStorage`
  - Toggle is accessible (keyboard operable, labeled)

**T28: Gentle slide-back on invalid moves (universal)**
- Files: `src/styles.css`, `src/main.ts`
- Depends on: `[]` (consensus: this is universal, not zen-only)
- Acceptance:
  - `@keyframes shake` is replaced with a gentle slide-back animation
  - New animation: gem slides 8px in the attempted swap direction, then slides back over 300ms with ease-out
  - No abrupt left-right oscillation
  - `.gem.invalid` uses the new animation
  - JS may need to pass swap direction via a data attribute or additional class (`.invalid-left`, `.invalid-right`, `.invalid-up`, `.invalid-down`)

**T29: Slow glow on pending matches (replace 10Hz tremble)**
- File: `src/styles.css`
- Depends on: `[]`
- Acceptance:
  - `.gem.pending-match` animation changes from `tremble 0.1s ... infinite` to a `brightness` breathing cycle
  - New: `animation: pendingGlow 2s ease-in-out infinite; filter: brightness(1.0)` with keyframes cycling brightness between 1.0 and 1.3
  - No positional displacement (no translate)
  - Feels like "breathing" not "vibrating"

**T30: Disable boardFlash; ambient orbs respond to combos**
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T27]` (behavior differs by mode)
- Acceptance:
  - In Zen Mode: `boardFlash` animation is not triggered (JS guard: `if (config.mode !== 'zen')`)
  - Instead, ambient blobs (`::before` / `::after`) get a class that briefly increases opacity or shifts hue
  - `.ambient.combo-response::before { opacity: 0.5; transition: opacity 1.2s; }`
  - In Classic Mode: boardFlash continues to work as before
  - Ambient response is subtle and lasts 1-2s

**T31: Sinusoidal easing curves in zen mode**
- File: `src/styles.css`
- Depends on: `[T27]` (zen mode must exist)
- Acceptance:
  - `body[data-mode="zen"] .gem` uses `transition-timing-function: cubic-bezier(0.25, 1.0, 0.5, 1)` (no overshoot)
  - `body[data-mode="zen"] .gem.just-created` uses `cubic-bezier(0.22, 0.95, 0.36, 1)` for landing
  - Gems move with "confident and unhurried" motion — long deceleration, no bounce
  - In Classic Mode: bouncy `cubic-bezier(0.34, 1.56, 0.64, 1)` is preserved

**T32: Breathing-paced cascade timing (zen mode)**
- File: `src/main.ts`
- Depends on: `[T27, T42]` (needs mode awareness and timing config)
- Acceptance:
  - In Zen Mode: cascade step base delay starts at 350ms, decelerates 8% per step, floor at 500ms
  - Formula: `baseDelay * Math.min(1.43, Math.pow(1.08, combo - 1))` where baseDelay=350
  - Combo 1: 350ms, Combo 2: 378ms, Combo 5: 476ms, capped at 500ms
  - A 5-chain takes approximately 2s total
  - In Classic Mode: cascade acceleration (T15) applies instead
  - Reads as "settling" — each step slightly slower than the last

**T44: Session-length awareness (ambient hue shift)** *(new from Round 2)*
- Files: `src/main.ts`, `src/styles.css`
- Depends on: `[T27]` (zen mode feature)
- Acceptance:
  - A timer tracks session duration since page load
  - Every 60s, the background gradient hue shifts by a small amount (2-3 degrees)
  - Over 15-20 minutes, the total shift is noticeable but gentle (30-45 degrees)
  - Implementation: `document.body.style.filter = \`hue-rotate(\${degrees}deg)\`` or update CSS custom property
  - Active only in Zen Mode
  - Shift resets on New Game or page reload

---

## Dependency DAG (Text Format)

```
T1  → T3
T8  → T9 → T13
T8  → T10
T8  → T43
T33, T34, T35 → T36 → T42 → T15
                  T36 → T26
                  T36 → T27 → T30, T31, T32, T44
                  T36 → T21 → T23 → T24
                              T21 → T45
                              T21 → T27
T46 → T19

All others have depends_on: [] (independent)
```

### Full Dependency Table

| Task | Depends On | Phase |
|------|-----------|-------|
| T1 | — | P1 |
| T2 | — | P1 |
| T3 | T1 | P1 |
| T4 | — | P1 |
| T5 | — | P1 |
| T6 | — | P1 |
| T7 | — | P1 |
| T8 | — | P3 |
| T9 | T8 | P3 |
| T10 | T8, T9 | P3 |
| T11 | — | P3 |
| T12 | — | P1 |
| T13 | T9 | P5 |
| T14 | — | P5 |
| T15 | T42 | P5 |
| T16 | — | P5 |
| T17 | — | P5 |
| T18 | — | P5 |
| T19 | T46 | P5 |
| T20 | — | P1 |
| T21 | T36 | P4 |
| T22 | — | P4 |
| T23 | T21 | P4 |
| T24 | T23 | P4 |
| T25 | — | P4 |
| T26 | T36 | P4 |
| T27 | T36, T42, T21 | P6 |
| T28 | — | P6 |
| T29 | — | P6 |
| T30 | T27 | P6 |
| T31 | T27 | P6 |
| T32 | T27, T42 | P6 |
| T33 | — | P2 |
| T34 | — | P2 |
| T35 | — | P2 |
| T36 | T33, T34, T35 | P2 |
| T37 | — | P5 |
| T38 | — | P1 |
| T39 | — | P3 |
| T40 | — | P3 |
| T41 | — | P5 |
| T42 | T36 | P2 |
| T43 | T8 | P2 |
| T44 | T27 | P6 |
| T45 | T21 | P4 |
| T46 | — | P5 |

---

## Critical Path

The longest dependency chain determines the minimum time to complete all work:

```
T33/T34/T35 (5 min each, parallel)
  → T36 (20 min)
    → T42 (15 min)
      → T27 + T21 (concurrent, ~30 min each, T27 needs both T42 and T21)
        → T32 (10 min)  [end of chain]
        → T30 (10 min)
        → T44 (15 min)

Total critical path: ~5 + 20 + 15 + 30 + 15 = ~85 min
```

Secondary critical path:
```
T8 (30 min) → T9 (30 min) → T10 (30 min) → T13 (15 min)
Total: ~105 min
```

The accessibility chain (T8 → T9 → T10) is actually the longest wall-clock path. It should start as early as possible, ideally in parallel with Phase 2 code quality work.

---

## Work Packages (Parallelizable Units)

### WP1: HTML/Viewport Fixes (1 engineer, ~15 min)
**Tasks:** T1, T2, T38
**Files touched:** `index.html`, `src/styles.css` (line 1 only for @import removal, line 12 for 100dvh)
**Merge risk:** Low. Touches only `<head>` in HTML and 2 isolated CSS lines.
**Acceptance gate:** iOS Safari on notched device shows no clipping. Font still loads. `100dvh` works.

### WP2: CSS Performance & Safety (1 engineer, ~15 min)
**Tasks:** T7, T12, T20
**Files touched:** `src/styles.css` (`.gem` transition line, new `@media` block, `will-change` additions)
**Merge risk:** Low. All are additive CSS changes in non-overlapping areas.
**Acceptance gate:** `transition: all` gone from `.gem`. `prefers-reduced-motion` block exists. `will-change` on 4 selectors.

### WP3: Mobile Layout Fixes (1 engineer, ~20 min)
**Tasks:** T3, T4, T5, T6
**Files touched:** `src/styles.css` (5 fixed elements, slider thumb, controls-row), `src/main.ts` (board sizing calc)
**Merge risk:** Medium. T3 touches multiple CSS selectors; T5 may restructure `.controls-row`.
**Acceptance gate:** iPhone SE (375px) viewport — board fits, controls wrap, sliders tappable, no element behind notch.

### WP4: Code Quality Helpers (1 engineer, ~15 min)
**Tasks:** T33, T34, T35
**Files touched:** `src/main.ts` (extract functions, replace call sites)
**Merge risk:** Medium-High with any other WP touching `main.ts`. Run after or before WP3's T4 change.
**Acceptance gate:** `npm test` passes. `npm run typecheck` passes. No behavioral change.

### WP5: WCAG Quick Fixes (1 engineer, ~15 min)
**Tasks:** T11, T39, T40
**Files touched:** `src/styles.css` (contrast colors, `:focus-visible`), `index.html` (ARIA attributes)
**Merge risk:** Low. Color values and new rules, no structural changes.
**Acceptance gate:** axe-core shows 0 contrast failures. Tab navigation shows focus rings. VoiceOver reads score changes.

### WP6: State Architecture (1 engineer, ~35 min)
**Tasks:** T36, T42
**Files touched:** `src/main.ts` (major refactor of module-level variables)
**Merge risk:** HIGH. Renames nearly every variable reference. Must merge before any other `main.ts` work after WP4.
**Acceptance gate:** `npm test` passes. `npm run typecheck` passes. No `let` at module scope except DOM refs and engine.
**CRITICAL:** This is a gating WP. Schedule it early and merge it before WP7-WP12.

### WP7: CSS Custom Properties + Shapes (1 engineer, ~45 min)
**Tasks:** T8, T9, T43
**Files touched:** `src/styles.css` (gem color rules rewrite), `src/main.ts` (gem creation, color sync)
**Merge risk:** HIGH with anything touching `.gem-N` rules or `gemColors` array. Must be a clean merge point.
**Acceptance gate:** Gems render with shapes visible at 0.2 opacity. Colors come from CSS custom properties. JS reads from CSS.

### WP8: Palette + Contrast (1 engineer, ~30 min)
**Tasks:** T10
**Files touched:** `index.html` (palette UI), `src/main.ts` (palette logic + localStorage), `src/styles.css` (alternate palette definitions)
**Merge risk:** Medium. Depends on WP7 being merged.
**Acceptance gate:** Three palettes selectable. Selection persists. All colors meet contrast requirements.

### WP9: Layout Restructure (1 engineer, ~45 min)
**Tasks:** T21, T23, T24, T45
**Files touched:** `index.html` (settings panel, stats removal, score display), `src/main.ts` (settings panel logic, stats removal, score display), `src/styles.css` (settings panel styles)
**Merge risk:** HIGH. Major HTML restructure. Must merge cleanly with WP6 state changes.
**Acceptance gate:** Settings gear opens panel with sliders. Stats removed from main view. Total score visible. New Game pulses when pending.

### WP10: Visual Polish - CSS Only (1 engineer, ~20 min)
**Tasks:** T13, T14, T16, T17, T18
**Files touched:** `src/styles.css` (animation keyframes and gem styles)
**Merge risk:** Medium. Touches `@keyframes` blocks and `.gem` sub-rules. Run after WP7 (gem-shape layer).
**Acceptance gate:** Gems have gloss. Drops bounce. Score popups pop-in. Special creation has rotation+brightness. Line clears sweep.

### WP11: Visual Polish - JS + CSS (1 engineer, ~30 min)
**Tasks:** T15, T19, T37, T41, T46
**Files touched:** `src/main.ts` (cascade timing, particles, touch feedback, fill stagger), `src/styles.css` (particle styles, touch scale)
**Merge risk:** HIGH with WP6 and WP9 (timing references, DOM manipulation).
**Acceptance gate:** Cascades accelerate. Particles appear on clear (capped at 20). Touch scales gems. Fill staggers by column.

### WP12: Zen Mode + Universal Feedback (1 engineer, ~45 min)
**Tasks:** T27, T28, T29, T30, T31, T32, T44
**Files touched:** `src/main.ts` (mode toggle, cascade pacing, ambient response), `src/styles.css` (zen mode CSS overrides, slide-back, pending glow, sinusoidal easing), `index.html` (toggle UI)
**Merge risk:** HIGH. Touches nearly every file. Must be the last major merge.
**Acceptance gate:** Zen toggle works. Default is zen. Invalid moves slide back. Pending matches glow. Board flash replaced by ambient response. Easing is smooth. Cascade decelerates. Background shifts over 15 min.

### WP13: Standalone Items (1 engineer, ~20 min)
**Tasks:** T22, T25, T26
**Files touched:** `src/styles.css` (combo counter relocation), `src/main.ts` (onboarding tooltip, idle hint)
**Merge risk:** Low-Medium. Each is relatively isolated.
**Acceptance gate:** Combo counter on board center. First-visit tooltip appears once. Idle hint glows after 6s.

---

## Execution Schedule

This schedule assumes 2-3 parallel engineers with worktrees.

### Wave 1 (no dependencies, all parallel)
| Engineer A | Engineer B | Engineer C |
|-----------|-----------|-----------|
| WP1 (T1,T2,T38) 15 min | WP2 (T7,T12,T20) 15 min | WP4 (T33,T34,T35) 15 min |
| WP3 (T3,T4,T5,T6) 20 min | WP5 (T11,T39,T40) 15 min | |

**Merge checkpoint:** All Wave 1 WPs merged to main. Run `npm test` + `npm run typecheck`.

### Wave 2 (depends on WP4)
| Engineer A | Engineer B | Engineer C |
|-----------|-----------|-----------|
| WP6 (T36,T42) 35 min | WP7 (T8,T9,T43) 45 min | WP13-partial (T22,T25) 15 min |

**Merge checkpoint:** WP6 merged first (gating). Then WP7. Then WP13-partial.

### Wave 3 (depends on WP6 and WP7)
| Engineer A | Engineer B | Engineer C |
|-----------|-----------|-----------|
| WP9 (T21,T23,T24,T45) 45 min | WP8 (T10) 30 min | WP10 (T13,T14,T16,T17,T18) 20 min |
| | WP13-rest (T26) 15 min | |

**Merge checkpoint:** WP9, WP8, WP10, WP13-rest merged. Integration test.

### Wave 4 (depends on WP6, WP9)
| Engineer A | Engineer B |
|-----------|-----------|
| WP12 (T27-T32,T44) 45 min | WP11 (T15,T19,T37,T41,T46) 30 min |

**Merge checkpoint:** WP11 merged first (less conflict surface). Then WP12. Full regression test.

### Total wall-clock time: ~3 hours with 3 engineers

---

## Risk Register

### High Merge Conflict Risk
| Risk | Tasks | Mitigation |
|------|-------|------------|
| **WP6 (state refactor) vs. everything** | T36 renames every module-level variable in `main.ts` | Merge WP6 before any post-Wave-1 work on `main.ts`. All other WPs rebase after WP6. |
| **WP7 (CSS properties) vs. WP10 (visual polish)** | Both modify `.gem-N` CSS rules | WP7 merges first. WP10 works on top of custom property syntax. |
| **WP9 (layout restructure) vs. WP12 (zen mode)** | Both modify `index.html` structure and add CSS for new UI | WP9 merges first. WP12 adds to the structure WP9 creates. |
| **WP11 (particles/timing) vs. WP12 (zen timing)** | Both modify cascade timing in `playFrames` | Engineer coordination: WP11 handles classic timing; WP12 adds zen branching on top. Merge WP11 first. |

### Integration Testing Required
| Scenario | Relevant WPs | Test |
|----------|-------------|------|
| **Palette + shapes + gloss coexistence** | WP7, WP8, WP10 | Switch palettes; verify shapes visible, gloss renders, no pseudo-element conflicts with specials |
| **Zen mode + cascade pacing + particles** | WP11, WP12 | In zen mode: verify particles don't fire, cascades decelerate, ambient orbs respond |
| **Settings panel + zen toggle + slider persistence** | WP6, WP9, WP12 | Open settings, toggle zen, change sliders, reload — all persisted correctly |
| **Mobile layout + safe areas + settings panel** | WP1, WP3, WP9 | On iPhone viewport: settings panel accessible, no overlap with safe areas, board fits |
| **Reduced motion + zen mode + shapes** | WP2, WP7, WP12 | With `prefers-reduced-motion: reduce` and zen mode: no animations, shapes visible, game playable |

### Ambiguous Acceptance Criteria
| Task | Ambiguity | Resolution Needed |
|------|-----------|-------------------|
| **T18 (line sweep)** | "sweep direction" — relative to trigger gem? Always left-to-right? | Decision: sweep outward from the trigger position. Gems left of trigger sweep left; right sweep right. |
| **T28 (slide-back)** | Requires knowing the attempted swap direction per gem. Current `invalid` class has no direction data. | JS must set `data-direction="left|right|up|down"` on the gem before adding `invalid` class. CSS uses `[data-direction]` selectors. |
| **T44 (session hue shift)** | "Noticeable but gentle" is subjective. | Quantify: 2 degrees per minute, capping at 40 degrees. Reset on New Game. |
| **T22 (combo watermark)** | Combo counter moves to board center, but board is `position: relative` with gems. Z-index stacking unclear. | Combo counter becomes a child of `.board` with `position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); z-index: 5` (gems are z-index 1, score popups z-index 100). |
| **T30 (ambient orb response)** | "Briefly increases opacity or shifts hue" — which one? | Decision: opacity pulse from 0.3 to 0.5 over 600ms, then back over 600ms. Simpler to implement, visible on all backgrounds. |

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| **`will-change` layer explosion** | T20 adds `will-change` to potentially 64+ gems. On older iOS devices, this can cause GPU memory issues. | Only apply `will-change` to `.gem` elements currently animating (add/remove with transition class), not statically on all gems. |
| **Particle DOM performance** | T19 creates 6 particles per cleared gem. A cascade clearing 20 gems = 120 particles. | T46 caps at 20. Additionally, use `requestAnimationFrame` for particle creation to batch DOM writes. |
| **CSS custom property performance** | T8 puts 10 colors on `:root`. Palette switching (T10) updates all 10 at once, triggering full style recalc. | Acceptable at this scale. Monitor with DevTools Performance panel. |
| **`getComputedStyle` sync reads** | T43 reads CSS properties into JS. If called during animation, causes forced layout. | Read once at startup and on palette change event, cache in JS array. Do not read per-frame. |
