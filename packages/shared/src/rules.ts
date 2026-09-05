import { DECK_SIZE, MAX_HAND, MAX_MANA, MAX_ROW, OPENING_HAND, STARTING_LIFE } from './constants.js';

/**
 * Every rules knob the engine reads at runtime. Rules travel inside GameState,
 * so the server, both clients, and the AI always agree on them. Tweak these —
 * or add your own fields and read them in engine/combat/helpers — to shape
 * your game after whichever TCG you're channeling.
 */
export interface RulesConfig {
  startingLife: number;
  deckSize: number;
  openingHand: number;
  maxHand: number;
  maxRow: number;
  manaCap: number;
  /** Does the player who goes first also draw on turn 1? (MTG: no) */
  firstPlayerDraws: boolean;
  /** Creatures can't attack the turn they are summoned. */
  summoningSickness: boolean;
  /** How many attacks each creature can make per turn. */
  attacksPerTurn: number;
  /**
   * Enemy creatures "guard" their player: while any are on the row, you must
   * attack creatures — the face is off-limits. (Think taunt-everything.)
   */
  mustAttackCreaturesFirst: boolean;
  /** Defending creatures strike back when attacked. */
  retaliation: boolean;
  /**
   * Drawing from an empty deck: 'lose' the game instantly (MTG-style), or
   * take 'damage' that grows by 1 with every empty draw (Hearthstone-style).
   */
  fatigue: 'lose' | 'damage';
  /**
   * Each player may shuffle back their opening hand once, during the first
   * round, and redraw the same number of cards (a free mulligan).
   */
  mulligan: boolean;
  /**
   * How combat works.
   * 'targeted': the attacker picks each attack's target — an enemy creature
   *   or the face (Hearthstone-style).
   * 'blockers': MTG-style — attacks are declared against the PLAYER, the
   *   defender assigns blockers, blocked attackers fight their blocker and
   *   unblocked ones hit the face. Attackers never choose creature targets.
   */
  combatStyle: 'targeted' | 'blockers';
  /**
   * Which engine runs the game.
   * 'standard': the mana/creature engine above (all knobs apply).
   * 'pokemon': Pokémon-TCG-style rules (pokemon/engine.ts) — Active + Bench,
   *   energy attachment, prizes, evolution, retreat, weakness/resistance.
   *   Cards need a `game` block; mana, combatStyle, and the standard combat
   *   knobs are ignored. Slot 0 of the row is the Active, the rest the Bench.
   */
  gameMode: 'standard' | 'pokemon';
  /** Pokemon mode: prize cards per player (take the last one to win). */
  prizes: number;
  /** Pokemon mode: prizes awarded for knocking out a star sticker. */
  starPrizes: number;
  /** Pokemon mode: the first player cannot attack on turn 1. */
  firstTurnNoAttack: boolean;
  /** Pokemon mode: the first player cannot play a Supporter on turn 1. */
  firstTurnNoSupporter: boolean;
  /** Pokemon mode: weakness multiplies move damage (×2). */
  weaknessMultiplier: number;
  /** Pokemon mode: resistance subtracts from move damage (−20). */
  resistanceAmount: number;
}

export const DEFAULT_RULES: RulesConfig = {
  startingLife: STARTING_LIFE,
  deckSize: DECK_SIZE,
  openingHand: OPENING_HAND,
  maxHand: MAX_HAND,
  maxRow: MAX_ROW,
  manaCap: MAX_MANA,
  firstPlayerDraws: false,
  summoningSickness: true,
  attacksPerTurn: 1,
  mustAttackCreaturesFirst: false,
  retaliation: true,
  fatigue: 'lose',
  mulligan: false,
  combatStyle: 'targeted',
  gameMode: 'standard',
  prizes: 6,
  starPrizes: 2,
  firstTurnNoAttack: true,
  firstTurnNoSupporter: true,
  weaknessMultiplier: 2,
  resistanceAmount: 20,
};

/**
 * Pokemon-mode baselines. `maxRow` is 1 Active + the Bench; the row array
 * gets one slot of headroom so a benchSize +1 Stadium (Megagroup) fits.
 */
export const POKEMON_STANDARD: RulesConfig = {
  ...DEFAULT_RULES,
  gameMode: 'pokemon',
  deckSize: 60,
  openingHand: 7,
  maxHand: 99,
  maxRow: 6, // Active + Bench 5
  prizes: 6,
  firstPlayerDraws: true,
  fatigue: 'lose',
};

export const POKEMON_QUICK: RulesConfig = {
  ...POKEMON_STANDARD,
  deckSize: 30,
  openingHand: 5,
  maxRow: 4, // Active + Bench 3
  prizes: 3,
  firstPlayerDraws: false,
  firstTurnNoSupporter: false,
};

/**
 * Ready-made variants flavored after popular TCGs. The menu offers these;
 * add your own preset here and it appears automatically.
 */
export const RULE_PRESETS: Record<string, { label: string; description: string; rules: RulesConfig }> = {
  duel: {
    label: 'Classic Duel',
    description: 'MTG-style combat: attack the player, the defender declares blockers. Free mulligan. Empty-deck draw loses.',
    rules: { ...DEFAULT_RULES, mulligan: true, combatStyle: 'blockers' },
  },
  guarded: {
    label: 'Guarded Arena',
    description: 'Creatures guard their player: clear the row before going face. Fatigue deals growing damage. 30 life.',
    rules: { ...DEFAULT_RULES, mustAttackCreaturesFirst: true, fatigue: 'damage', startingLife: 30 },
  },
  blitz: {
    label: 'Blitz',
    description: 'No summoning sickness — creatures charge immediately. 15 life, 4-card opening hand.',
    rules: { ...DEFAULT_RULES, summoningSickness: false, startingLife: 15, openingHand: 4 },
  },
  attrition: {
    label: 'Attrition',
    description: 'The long game: 40 life, fatigue deals growing damage, defenders always strike back, free mulligan.',
    rules: { ...DEFAULT_RULES, startingLife: 40, fatigue: 'damage', mulligan: true },
  },
  league: {
    label: 'League Quick',
    description:
      'Pokémon-TCG-style: Active & Bench, energy attachment, evolution, retreat, 3 prizes. 30-card decks, Bench of 3.',
    rules: { ...POKEMON_QUICK },
  },
  leagueStandard: {
    label: 'League Standard',
    description:
      'The full league ruleset: 60-card decks, 7-card hands, Bench of 5, 6 prizes, first player cannot attack or play a Supporter on turn 1.',
    rules: { ...POKEMON_STANDARD },
  },
};

/**
 * Merge a (possibly untrusted) partial config onto the defaults, keeping only
 * known keys with sane types and clamped ranges. The PvP server runs client
 * -submitted rules through this.
 */
export function mergeRules(partial?: Partial<RulesConfig> | null): RulesConfig {
  const r = { ...DEFAULT_RULES };
  if (!partial || typeof partial !== 'object') return r;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

  r.startingLife = num(partial.startingLife, 1, 999, r.startingLife);
  r.deckSize = num(partial.deckSize, 5, 200, r.deckSize);
  r.openingHand = num(partial.openingHand, 0, 10, r.openingHand);
  r.maxHand = num(partial.maxHand, 1, 20, r.maxHand);
  r.maxRow = num(partial.maxRow, 1, 8, r.maxRow);
  r.manaCap = num(partial.manaCap, 1, 20, r.manaCap);
  r.attacksPerTurn = num(partial.attacksPerTurn, 1, 9, r.attacksPerTurn);
  r.firstPlayerDraws = bool(partial.firstPlayerDraws, r.firstPlayerDraws);
  r.summoningSickness = bool(partial.summoningSickness, r.summoningSickness);
  r.mustAttackCreaturesFirst = bool(partial.mustAttackCreaturesFirst, r.mustAttackCreaturesFirst);
  r.retaliation = bool(partial.retaliation, r.retaliation);
  r.fatigue = partial.fatigue === 'damage' ? 'damage' : partial.fatigue === 'lose' ? 'lose' : r.fatigue;
  r.mulligan = bool(partial.mulligan, r.mulligan);
  r.combatStyle =
    partial.combatStyle === 'blockers' ? 'blockers' : partial.combatStyle === 'targeted' ? 'targeted' : r.combatStyle;
  r.gameMode = partial.gameMode === 'pokemon' ? 'pokemon' : partial.gameMode === 'standard' ? 'standard' : r.gameMode;
  r.prizes = num(partial.prizes, 1, 10, r.prizes);
  r.starPrizes = num(partial.starPrizes, 1, 3, r.starPrizes);
  r.firstTurnNoAttack = bool(partial.firstTurnNoAttack, r.firstTurnNoAttack);
  r.firstTurnNoSupporter = bool(partial.firstTurnNoSupporter, r.firstTurnNoSupporter);
  r.weaknessMultiplier = num(partial.weaknessMultiplier, 1, 4, r.weaknessMultiplier);
  r.resistanceAmount = num(partial.resistanceAmount, 0, 100, r.resistanceAmount);
  return r;
}
