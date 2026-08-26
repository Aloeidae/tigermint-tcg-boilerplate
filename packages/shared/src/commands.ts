import type { EffectTarget, PlayerId } from './types.js';

export type AttackTarget =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'face' };

/**
 * Commands are the only way to mutate a game. The client sends these to
 * whatever runs the engine (local AI match or the PvP server), which validates
 * them with applyCommand().
 */
export type Command =
  | {
      type: 'playCard';
      player: PlayerId;
      instanceId: string;
      /** Creature only: which row slot to summon into (first free slot if omitted). */
      slot?: number;
      /** Spell/equipment only: what the effect points at. */
      target?: EffectTarget;
    }
  /**
   * Targeted combat: attack the chosen target now. Blockers combat: TOGGLE
   * this creature as a declared attacker (target is ignored; attacks always
   * aim at the player and resolve after the block step).
   */
  | { type: 'attack'; player: PlayerId; attackerId: string; target: AttackTarget }
  /**
   * Blockers combat only, during the block phase, sent by the DEFENDER:
   * assign blockers (1:1 with attackers; empty = take it all to the face),
   * which resolves combat immediately.
   */
  | { type: 'declareBlockers'; player: PlayerId; blocks: { blocker: string; attacker: string }[] }
  | { type: 'advancePhase'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }
  /** Shuffle back the opening hand and redraw (rules.mulligan, first round only). */
  | { type: 'mulligan'; player: PlayerId }
  | { type: 'concede'; player: PlayerId };
