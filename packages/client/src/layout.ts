/**
 * The design space, chosen ONCE at startup by the window's orientation:
 *
 *  - landscape (desktop): 1920×1080, the original layout
 *  - portrait (phones, Telegram Mini Apps): 810×1440, rows stacked tighter,
 *    compact HUD, bigger touch targets
 *
 * Phaser's Scale.FIT letterboxes either space into the real window, so every
 * scene keeps working in absolute design coordinates — change these numbers
 * (not scene code) to retune a layout. A mid-session orientation flip keeps
 * the boot-time choice; reload to switch.
 */

export const PORTRAIT =
  typeof window !== 'undefined' && window.innerHeight > window.innerWidth;

export const W = PORTRAIT ? 810 : 1920;
export const H = PORTRAIT ? 1440 : 1080;

/** Top of the hand bench (the board is everything above it). */
export const BENCH_TOP = PORTRAIT ? 1120 : 770;

export const OPP_ROW_Y = PORTRAIT ? 210 : 300;
export const MY_ROW_Y = PORTRAIT ? 740 : 595;
// Landscape 940: card halves (112) + the fan's edge arc (23) stay inside
// the 1080 design space instead of clipping at the bottom.
export const HAND_Y = PORTRAIT ? 1305 : 940;
/** Anything above this line counts as enemy territory ("the backfield"). */
export const ENEMY_TERRITORY_Y = PORTRAIT ? 610 : (OPP_ROW_Y + MY_ROW_Y) / 2;

/**
 * Battlefield card geometry. In portrait each player's row WRAPS into a
 * grid (`cols` per line, extra lines `rowGap` further down) so the narrow
 * screen gets big, legible cards instead of six slivers in one line.
 */
export const ROW_CARD = PORTRAIT
  ? { w: 180, h: 240, spacing: 200, cols: 3, rowGap: 250 }
  : { w: 150, h: 200, spacing: 172, cols: 99, rowGap: 0 };

/** Hand fan geometry. */
export const HAND_CARD = PORTRAIT
  ? { w: 168, h: 224, maxSpread: 650, hoverLift: 84 }
  : { w: 168, h: 224, maxSpread: 1000, hoverLift: 92 };

/** Opponent's face-down hand fan. */
export const OPP_BACK = PORTRAIT ? { w: 58, h: 77 } : { w: 78, h: 104 };
export const OPP_HAND_POS = PORTRAIT ? { x: 620, y: 10 } : { x: W / 2, y: 16 };

// HUD anchor points, used as origins/targets for draw & discard animations.
// These mirror the chip positions inside Hud.ts (compact mode in portrait).
export const MY_DECK_POS = PORTRAIT ? { x: 196, y: BENCH_TOP + 52 } : { x: 232, y: BENCH_TOP + 62 };
export const OPP_DECK_POS = PORTRAIT ? { x: 272, y: 54 } : { x: 330, y: 62 };
export const MY_GRAVE_POS = PORTRAIT ? { x: 272, y: BENCH_TOP + 52 } : { x: 330, y: BENCH_TOP + 62 };
export const OPP_BURN_POS = PORTRAIT ? { x: 234, y: 54 } : { x: 255, y: 62 };

/** Battle log strip. Portrait squeezes 2 lines into the mid-board gap. */
export const LOG = PORTRAIT
  ? { x: 14, y: 560, fontSize: 13, lines: 2 }
  : { x: 28, y: BENCH_TOP - 138, fontSize: 15, lines: 7 };
