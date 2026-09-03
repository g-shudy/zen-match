# Zen Match Refactor: Project Log

## Decisions

| # | Date | Decision | Rationale | Decided By |
|---|------|----------|-----------|------------|
| D1 | 2026-03-19 | Zen mode is the default experience | 6/6 panel unanimous. "The game is called Zen Match." | Full panel |
| D2 | 2026-03-19 | Shapes always-on at 0.15-0.25 opacity | 6/6 unanimous. Helps everyone, not just colorblind. No toggle to disable. | Full panel |
| D3 | 2026-03-19 | Shake → gentle slide-back universally | 5/6. Punitive feedback is hostile UX for everyone. | Panel minus 1 |
| D4 | 2026-03-19 | Zen easing: cubic-bezier(0.25, 1.0, 0.5, 1) | Zero overshoot, long deceleration. "Confident and unhurried." | Graphics designer |
| D5 | 2026-03-19 | Cascade pacing (zen): 350ms start, -8%/step, floor 500ms | Middle ground between psychologist (3-4s) and game designer (keep fast) | Graphics + Game UI |
| D6 | 2026-03-19 | Contemplative juice principle: luminance, blur, timing — not scale, displacement, speed | Graphics designer framework, endorsed by panel | Graphics designer |
| D7 | 2026-03-19 | Settings as single localStorage JSON blob | Simple, no framework needed. `data-mode` attr on body for CSS selectors. | Code architect |
| D8 | 2026-03-19 | DOM particles (not canvas), capped at ~20 concurrent | Canvas is over-engineering for 6 particles per clear. Pool + animationend cleanup. | Graphics + iOS Safari |
| D9 | 2026-03-19 | Don't auto-apply slider changes | Would destroy board without confirmation. Pulse New Game button instead. | Game UI designer |
| D10 | 2026-03-19 | Rainbow gem in colorblind mode: universal white-silver spin | Alt palette colors still fail for CVD users. Universal pattern is color-independent. | Accessibility designer |

## Tech Debt

| # | Item | Added | Status | Notes |
|---|------|-------|--------|-------|
| TD1 | Google Fonts @import is render-blocking | 2026-03-19 | Open | Should preconnect+async or self-host |
| TD2 | No audio/haptic infrastructure | 2026-03-19 | Open | Noted by mindfulness + game UI |
| TD3 | gemColors JS array duplicates CSS color defs | 2026-03-19 | Open | Will be fixed by CSS custom properties + config sync |
| TD4 | No orientation lock or landscape handling | 2026-03-19 | Open | iOS Safari noted landscape edge cases |
| TD5 | Board render doesn't diff — rebuilds all 64+ gem classes | 2026-03-19 | Open | Fine at 8x8, may jank at 16x16 |

## Issues

| # | Issue | Raised By | Status | Resolution |
|---|-------|-----------|--------|------------|
| I1 | Pointer capture not released at trySwap start | iOS Safari | Open | Could leave board stuck if cascade starts during drag |
| I2 | pointerdown on abs-positioned grid children can misfire on iOS 16.x | iOS Safari | Open | Needs test pass |
| I3 | Classic palette swatch card inherited the live palette from `<html>` and changed with the selection | Jerry (iPhone) | Fixed 2026-09-01 | Card scoped with `data-palette="default"`; `tests/palette-cards.test.js` enforces self-scoping (6c4ab2e) |
| I4 | `npm test` passed against a stale `dist/engine.js`; the 2.0 build script emitted `dist/engine/index.js` | Fresh worktree | Fixed 2026-09-01 | Named esbuild entries (2b747d4) |

## Status

- Phase 1 (Ship Blockers): COMPLETE (Wave 1)
  - WP1 (T1,T2,T38): merged 72e51b9
  - WP2 (T7,T12,T20): merged 31cb1fd
  - WP3 (T3-T6): merged f410a5e
  - WP4 (T33-T35): merged 9a17898
  - WP5 (T11,T39,T40): merged 6de9a94
- Phase 2 (Code Foundation): IN PROGRESS (Wave 2)
  - WP6 (T36,T42): in progress — GATING
- Phase 3 (Accessibility): IN PROGRESS (Wave 2)
  - WP7 (T8,T9,T43): in progress
- Phase 4 (Layout Restructure): BLOCKED on WP6
  - WP13-partial (T22,T25): in progress (standalone)
- Phase 5 (Visual Polish): BLOCKED on WP6+WP7
- Phase 6 (Zen Mode): BLOCKED on WP6

## 2.0 Redesign (2026-09-01)

Jerry's brief: "It still looks a little bit like I wrote it ... make it look like a much more
professional app, not just the UI but the user experience." Delivered as a single pass on
`claude/app-polish`.

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | One experience: zen pacing only. Classic mode, hints, combo counter, score popups and board flash removed. | The toggles were developer options, not player choices. D1 already made zen the game; a mode switch made the name a question again. |
| D12 | Score is a quiet live counter in the header; detailed stats live in Settings under *This game*. | Statistics inform, not judge (philosophy doc). A number that ticks during a cascade is feedback without arousal mechanics. |
| D13 | Settings and help are native `<dialog>` sheets (bottom sheet on phones, centered on desktop). Board size and colors are segmented presets; palettes are swatch cards. Changing size or colors relabels Done to "Start new game". | Sliders with 13 stops and native checkboxes read as a control panel. Nothing applies silently. |
| D14 | The game resumes after reload. Board, points, moves and longest cascade are saved after every settled move; `src/storage.ts` validates the blob against the current board shape before trusting it. | A toy you can put down and pick up is the whole point. Validation keeps a stale or hand-edited blob from breaking engine invariants. |
| D15 | Session hue drift applies to the ambient orbs only, never the page. | The old `body` filter recoloured the gems themselves after 20 minutes and forced a full-page composite on every frame. |
| D16 | Installable: SVG favicon, Apple touch icon, manifest, theme-color, Open Graph card, security headers in `vercel.json`. | The difference between a page and an app on a phone's home screen. |

Tech debt closed: TD1 (fonts now preconnect + swap), TD3 (JS reads gem colours from CSS custom
properties; swatch previews reuse the same variables), TD4 (landscape-phone layout moves the rail
beside the board), I1/I2 superseded by the pointer-capture handling kept from 1.x.

## 2.1 Arm gems (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part A.

| # | Decision | Rationale |
|---|----------|-----------|
| D17 | L, T and plus matches make a beam gem placed on the intersection, carrying a 4-bit arm mask; the straight-five line gem is the two-opposite-arms case. `Cell.arms` is typed `Arms \| null` rather than the spec's optional `arms?: Arms`, since an explicit `null` on every non-line cell is what lets the validator reject arms on a cell that isn't a line gem. | Shapes had no identity (an L made the same bomb as a straight four) and the engine activated a `cross` direction nothing created. One arm model replaces three direction branches, and every combo is derived from `beamCells` instead of hand-written. |
| D18 | Saved games are v2 and migrate v1 line directions to arm masks. | A game in progress should survive the upgrade; the validator still rejects any blob the engine could not run. |

## 2.2 Lazy waves and hold-to-start (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part B.

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | A move's frames are a generator; each cascade wave is computed when the page pulls it, and the 50-wave cap is gone. The swap itself is applied eagerly so `moveValid` is known before the first frame. | The cap only existed because every wave was computed and stored up front (one 2-colour move once blocked the page for seven seconds and 2.4 GB). One wave of work per pull and one board of memory make an endless cascade cheap, and the design doc calls cascades the gift. |
| D20 | New Game is a one-second hold with a ring that fills over the second; a plain-tap Start new game lives in the settings sheet. | With no cap, a stray tap could throw away minutes of watching. The hold is the guard; the sheet button keeps a no-hold path behind a deliberate step. |
| D21 | Colours 2 and 3 join the sheet. | They were always reachable by URL; they are where the long cascades live, and the sheet should offer them. |

## 2.3 Turning boards (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-shapes-boards-cascades-design.md`, Part C.

| # | Decision | Rationale |
|---|----------|-----------|
| D22 | The board is a rectangle glued to the device body; `cols` is the short side, `rows` the long side, and it renders unrotated at zero turns on every device, so a Tall board on a desktop is upright until turned. | One frame of reference everywhere; the turn count persists, so a desktop player turns once. |
| D23 | Gravity is a four-way engine parameter read at the start of each wave; drop and fill run along fall lines from the landing edge inward, so `'down'` reproduces 2.2 exactly. | A physical toy: gems fall toward the ground, whichever board edge that is. |
| D24 | The pose comes from `screen.orientation.angle` plus manual turns through one pure function with a 16-case truth table; the sign is confirmed on an iPhone before release. | Platforms disagree on the API's sign; a single place to correct. |
| D25 | Effects, falls and drags are computed in board-local coordinates from cell indices. | A translate applied inside a rotated element is rotated with it; client rects lie. |
| D26 | Sides go to 40 by URL and 24 in the sheet; the render diffs. | Big boards are for tablets and desktops; the toy still works small. |
