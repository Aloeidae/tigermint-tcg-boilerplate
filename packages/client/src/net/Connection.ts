import type { Command, GameEvent, PlayerId, PlayerView } from '@tcg/shared';

/**
 * The one seam between the UI and "whatever runs the rules".
 * GameScene only ever talks to this interface — LocalAIConnection runs the
 * engine in-browser, WsConnection talks to the authoritative PvP server.
 * Implement it again for hotseat, replays, bots-vs-bots, etc.
 */
export interface Connection {
  readonly myId: PlayerId;
  /** Latest view of the game from this player's perspective. */
  readonly lastView: PlayerView | null;

  /** Fired every time the game state changes. */
  onUpdate?: (view: PlayerView, events: GameEvent[]) => void;
  /** Fired when a command is rejected (show a toast, don't crash). */
  onError?: (msg: string) => void;
  /** Fired when the match can no longer continue (opponent left, socket died). */
  onClose?: (msg: string) => void;
  /** Transient connection notices ("opponent reconnecting…"). */
  onNotice?: (msg: string) => void;

  send(cmd: Command): void;
  dispose(): void;

  /** Modes that record games expose the replay here (see ReplayConnection). */
  getReplay?(): import('./ReplayConnection.js').ReplayData | null;
}
