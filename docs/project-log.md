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
