/**
 * THE skin file. Every color, font, and glow the game draws comes from here —
 * change these values (or swap the whole object) to reskin the game without
 * touching any scene or object code. Colors are 0xRRGGBB numbers for Phaser
 * graphics and '#rrggbb' strings for text styles.
 *
 * This default skin follows the TigerMint design system: pure black surfaces,
 * #0d0d0d panels with hairline borders, the #f97316 orange accent family,
 * Lilita One for ALL-CAPS display text, Inter for body, JetBrains Mono for
 * numbers and logs.
 */
/** One live badge's placement: an anchor region plus fine-tuning padding. */
export interface BadgeSpot {
  anchor:
    | 'topLeft'
    | 'topCenter'
    | 'topRight'
    | 'middleLeft'
    | 'center'
    | 'middleRight'
    | 'bottomLeft'
    | 'bottomCenter'
    | 'bottomRight';
  /** Horizontal padding, fraction of card width. Inward from edges; signed rightward on centered anchors. */
  padX?: number;
  /** Vertical padding, fraction of card width. Inward from edges; signed downward on centered anchors. */
  padY?: number;
  /** Optional per-badge diameter override (fraction of card width). */
  size?: number;
}

export const THEME = {
  fonts: {
    // Loaded from Google Fonts in index.html; BootScene waits for them.
    // Lilita One is single-weight and designed for uppercase display text.
    display: '"Lilita One", "Arial Black", sans-serif',
    body: '"Inter", Verdana, sans-serif',
    mono: '"JetBrains Mono", Consolas, monospace',
  },

  /** Battle screen backdrop. */
  board: {
    skyTop: 0x000000,
    skyBottom: 0x180b03,
    field: 0x0d0d0d,
    snow: 0xf97316, // ember specks
    slotMarker: 0xf97316,
    bench: 0x0d0d0d,
    benchEdge: 0x1f1f1f,
    benchAccent: 0xf97316,
    benchSlat: 0x000000,
  },

  /** Main menu backdrop. */
  menu: {
    skyTop: 0x000000,
    skyBottom: 0x180b03,
    title: '#f97316',
    subtitle: '#c7c7c7',
  },

  card: {
    /**
     * Live badge (cost / attack / health / equipment) placement, per card
     * style. Each badge names an ANCHOR — one of the nine card regions
     * (topLeft, topCenter, topRight, middleLeft, center, middleRight,
     * bottomLeft, bottomCenter, bottomRight) — plus padX/padY padding to
     * fine-tune from there (fractions of card WIDTH, like size). Padding
     * pushes inward from edges; on centered axes it's a signed offset
     * (right/down positive). So any badge can go anywhere: pick the nearest
     * anchor, then pad. A per-badge `size` overrides the shared one.
     */
    badges: {
      /** Badge diameter as a fraction of card width. */
      size: 0.15,
      framed: {
        cost: { anchor: 'topLeft', padX: 0.015, padY: 0.015 },
        attack: { anchor: 'bottomLeft', padX: 0.015, padY: 0.015 },
        health: { anchor: 'bottomRight', padX: 0.015, padY: 0.015 },
        equip: { anchor: 'topRight', padX: 0.015, padY: 0.015 },
      } as Record<string, BadgeSpot>,
      // Full-art defaults sit deeper so gems clear a painted border.
      fullArt: {
        cost: { anchor: 'topLeft', padX: 0.055, padY: 0.055 },
        attack: { anchor: 'bottomLeft', padX: 0.055, padY: 0.055 },
        health: { anchor: 'bottomRight', padX: 0.055, padY: 0.055 },
        equip: { anchor: 'topRight', padX: 0.055, padY: 0.055 },
      } as Record<string, BadgeSpot>,
    },
    frame: 0x000000,
    face: 0x141414,
    banner: 0x000000,
    bannerText: '#ffffff',
    bodyText: '#b8b8b8',
    skillText: '#fb923c',
    typeTints: {
      creature: 0xf97316,
      equipment: 0x9ca3af,
      spell: 0xa855f7,
    } as Record<string, number>,
    back: 0x0d0d0d,
    backEdge: 0x000000,
    backEmblem: 0xea580c,
    costGem: 0x3b82f6,
    attackGem: 0xf97316,
    healthGem: 0xef4444,
    equipChip: 0x4b5563,
    /** Status strip on board creatures (Poison, Frozen… icons). */
    statusChip: 0x000000,
    statusText: '#fdba74',
    gemText: '#ffffff',
    buffedText: '#4ade80',
    damagedText: '#f87171',
    /** Fallback art-window colors, picked by card-id hash. */
    artPalette: [0x7c2d12, 0x0f766e, 0x6d28d9, 0x0369a1, 0x854d0e, 0x9d174d, 0x374151, 0xb45309],
    artInitial: '#fff6e5',
    /** Glow tint per mint rarity tier (deck builder). Unlisted tiers get none. */
    rarityGlow: {
      COMMON: 0x9ca3af,
      RARE: 0x3b82f6,
      EPIC: 0xa855f7,
      LEGENDARY: 0xf97316,
    } as Record<string, number>,
    /**
     * Foil shine sweeping across high-rarity cards (Phaser postFX shine:
     * speed, lineWidth, gradient). Tiers absent from the map get none —
     * empty it to turn foils off entirely.
     */
    foil: {
      EPIC: { speed: 0.35, lineWidth: 0.35, gradient: 2 },
      LEGENDARY: { speed: 0.5, lineWidth: 0.5, gradient: 3 },
    } as Record<string, { speed: number; lineWidth: number; gradient: number }>,
  },

  hud: {
    panelTop: 0x0d0d0d,
    panelBench: 0x0d0d0d,
    chip: 0x1f1f1f,
    chipText: '#ffffff',
    heart: 0xef4444,
    heartStroke: '#450a0a',
    portraitRing: 0x000000,
    portraitOpp: 0x7c2d12,
    portraitMe: 0x14532d,
    mana: '#fb923c',
    bannerActive: '#f97316',
    bannerIdle: '#8a8a8a',
    bannerStroke: '#000000',
    button: 0xf97316,
    buttonEdge: 0xea580c,
    buttonText: '#000000',
    buttonDisabled: 0x1f1f1f,
    buttonDisabledText: '#4d4d4d',
    concede: '#9ca3af',
    log: '#d4d4d4',
  },

  /** Targeting & feedback. */
  fx: {
    glowPlayable: 0xf97316, // hand cards you can afford to play
    glowFriendly: 0x22c55e, // valid friendly targets (equipment, buffs, heals)
    glowEnemy: 0xef4444, // valid enemy targets (attacks, damage spells)
    arrow: 0xef4444,
    damageText: '#f87171',
    healText: '#4ade80',
    buffText: '#fb923c',
    impact: 0xfdba74,
    deathPuff: 0x3f3f46,
    toastText: '#f87171',
    toastBg: '#0d0d0dee',
    overlayPanel: 0x0d0d0d,
    overlayAccent: 0xf97316,
    overlayTitle: '#f97316',
    overlayText: '#c7c7c7',
  },
};

export type Theme = typeof THEME;
