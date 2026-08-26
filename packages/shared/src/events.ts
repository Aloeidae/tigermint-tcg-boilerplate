import type { CardDef, CardType, Phase, PlayerId } from './types.js';

/**
 * Events describe what happened as a result of a command. The client uses them
 * for the battle log and animation cues; the redacted view is the source of
 * truth for rendering.
 */
export type GameEvent =
  | { type: 'gameStarted' }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'phaseChanged'; player: PlayerId; phase: Phase }
  | { type: 'cardDrawn'; player: PlayerId; cardName?: string }
  | { type: 'cardPlayed'; player: PlayerId; cardName: string; cardType: CardType; def: CardDef }
  | { type: 'creatureSummoned'; player: PlayerId; instanceId: string; slot: number; cardName: string }
  | { type: 'equipmentAttached'; player: PlayerId; targetInstanceId: string; cardName: string }
  | { type: 'spellCast'; player: PlayerId; cardName: string }
  | { type: 'attacked'; player: PlayerId; attackerId: string; attackerName: string; targetKind: 'creature' | 'face'; targetId?: string; targetName?: string }
  | { type: 'attackerDeclared'; player: PlayerId; instanceId: string; cardName: string; declared: boolean }
  | { type: 'blocksDeclared'; player: PlayerId; count: number }
  | { type: 'creatureDamaged'; player: PlayerId; instanceId: string; amount: number }
  | { type: 'creatureHealed'; player: PlayerId; instanceId: string; amount: number }
  | { type: 'creatureBuffed'; player: PlayerId; instanceId: string }
  | { type: 'creatureDied'; player: PlayerId; instanceId: string; cardName: string }
  | { type: 'skillTriggered'; player: PlayerId; instanceId: string; cardName: string; skill: string; icon: string }
  | { type: 'statusApplied'; player: PlayerId; instanceId: string; cardName: string; status: string; icon: string; value?: number }
  | { type: 'statusExpired'; player: PlayerId; instanceId: string; status: string; icon: string }
  | { type: 'lifeChanged'; player: PlayerId; life: number; delta: number }
  | { type: 'mulligan'; player: PlayerId; count: number }
  | { type: 'fatigue'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId; reason: string };

/**
 * Strip information a given player shouldn't learn from the event stream
 * (currently: names of cards the opponent draws).
 */
export function redactEvents(events: GameEvent[], forPlayer: PlayerId): GameEvent[] {
  return events.map((ev) => {
    if (ev.type === 'cardDrawn' && ev.player !== forPlayer) {
      return { type: 'cardDrawn' as const, player: ev.player };
    }
    return ev;
  });
}

/** Spectators learn nobody's drawn cards. */
export function redactEventsForSpectator(events: GameEvent[]): GameEvent[] {
  return events.map((ev) =>
    ev.type === 'cardDrawn' ? { type: 'cardDrawn' as const, player: ev.player } : ev
  );
}
