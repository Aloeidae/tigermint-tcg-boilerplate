import type { CardDef, PlayerId } from '../types.js';

/** The three battlefield rows of the rows game mode. */
export type RowKind = 'melee' | 'ranged' | 'siege';

export const ROW_KINDS: readonly RowKind[] = ['melee', 'ranged', 'siege'] as const;

/**
 * The rows-mode definition of a card. Cards that carry one are playable under
 * `rules.gameMode: 'rows'`; the standard fields keep the same card playable
 * under the mana engine.
 */
export interface RowsBlock {
  kind: 'unit' | 'special';

  // ---- Units ----
  /** Which row it fights in. 'agile' units pick melee or ranged when played. */
  row?: RowKind | 'agile';
  /** Base power added to the row's total. */
  power?: number;
  /** Heroes ignore weather, horns and scorch. */
  hero?: boolean;
  /**
   * Unit ability.
   * 'spy': played onto the OPPONENT's row (their points!) — you draw 2 cards.
   * 'muster': also pulls every deck unit sharing its musterTag into play.
   * 'bond': same-name copies in one row multiply each other (power × copies).
   * 'horn': doubles every OTHER unit in its row.
   */
  ability?: 'spy' | 'muster' | 'bond' | 'horn';
  /** Muster group — matched against other units' musterTag. */
  musterTag?: string;

  // ---- Specials ----
  /**
   * 'frost' | 'fog' | 'rain': weather — non-hero units in that row (both
   * sides) fight at power 1. 'clear': remove all weather. 'horn': double one
   * of your rows. 'scorch': destroy the strongest non-hero unit(s) in play.
   */
  special?: 'frost' | 'fog' | 'rain' | 'clear' | 'horn' | 'scorch';
}

/** A unit standing in a row. Its def is all it needs — power is derived. */
export interface RowsUnit {
  instanceId: string;
  def: CardDef;
}

/** One player's side of the battlefield. */
export interface RowsBoard {
  melee: RowsUnit[];
  ranged: RowsUnit[];
  siege: RowsUnit[];
  /** A commander's-horn special placed on the row (units with the ability stack on top). */
  horns: { melee: boolean; ranged: boolean; siege: boolean };
}

/** Shared round state — public information, copied into every view. */
export interface RowsRoundState {
  round: number;
  /** Rounds taken so far. */
  wins: [number, number];
  passed: [boolean, boolean];
  weather: { melee: boolean; ranged: boolean; siege: boolean };
  /** Who leads off the current round. */
  starter: PlayerId;
}

export function emptyRowsBoard(): RowsBoard {
  return { melee: [], ranged: [], siege: [], horns: { melee: false, ranged: false, siege: false } };
}

export function rowsBlock(def: CardDef): RowsBlock | null {
  return def.rows ?? null;
}

export function isRowsUnit(def: CardDef): boolean {
  return def.rows?.kind === 'unit';
}

/** Which weather special hits which row. */
export const WEATHER_ROW: Record<'frost' | 'fog' | 'rain', RowKind> = {
  frost: 'melee',
  fog: 'ranged',
  rain: 'siege',
};
