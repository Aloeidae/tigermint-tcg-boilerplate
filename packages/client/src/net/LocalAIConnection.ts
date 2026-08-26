import {
  actingPlayer,
  applyCommand,
  chooseCommand,
  createGame,
  redactFor,
  redactEvents,
  type CardDef,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerView,
  type RulesConfig,
} from '@tcg/shared';
import type { Connection } from './Connection.js';
import type { ReplayData } from './ReplayConnection.js';

const AI_STEP_DELAY_MS = 550;

/**
 * Runs the shared engine entirely in the browser against the built-in AI.
 * The human is always player 0.
 */
export class LocalAIConnection implements Connection {
  readonly myId: PlayerId = 0;
  lastView: PlayerView | null = null;

  onUpdate?: (view: PlayerView, events: GameEvent[]) => void;
  onError?: (msg: string) => void;
  onClose?: (msg: string) => void;

  private state: GameState;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Setup + accepted commands = a byte-for-byte replay (pure seeded engine). */
  private replay: ReplayData;

  constructor(playerDeck: CardDef[], aiDeck: CardDef[], playerName = 'You', rules?: Partial<RulesConfig>) {
    const { state } = createGame({
      decks: [playerDeck, aiDeck],
      names: [playerName, 'AI Opponent'],
      rules,
    });
    this.state = state;
    this.lastView = redactFor(state, this.myId);
    this.replay = {
      seed: state.seed,
      names: [playerName, 'AI Opponent'],
      rules: state.rules,
      decks: [structuredClone(playerDeck), structuredClone(aiDeck)],
      commands: [],
    };
  }

  /** The finished (or in-progress) game as downloadable replay data. */
  getReplay(): ReplayData {
    return this.replay;
  }

  send(cmd: Command): void {
    if (this.disposed) return;
    const result = applyCommand(this.state, cmd);
    if (!result.ok) {
      this.onError?.(result.error);
      return;
    }
    this.state = result.state;
    this.replay.commands.push(cmd);
    this.emit(result.events);
    this.scheduleAI();
  }

  private scheduleAI(): void {
    if (this.aiTimer || this.disposed) return;
    // The AI acts whenever the game is waiting on IT — its own turn, or the
    // block step of the human's combat (blockers-style rules).
    if (this.state.gameOver || actingPlayer(this.state) === this.myId) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      this.stepAI();
    }, AI_STEP_DELAY_MS);
  }

  private stepAI(): void {
    if (this.disposed || this.state.gameOver || actingPlayer(this.state) === this.myId) return;
    const cmd = chooseCommand(this.state, actingPlayer(this.state));
    const result = applyCommand(this.state, cmd);
    if (!result.ok) {
      // The AI should never issue illegal commands; bail out safely if it does.
      const fallbackCmd: Command = { type: 'endTurn', player: this.state.active };
      const fallback = applyCommand(this.state, fallbackCmd);
      if (fallback.ok) {
        this.state = fallback.state;
        this.replay.commands.push(fallbackCmd);
        this.emit(fallback.events);
      }
      return;
    }
    this.state = result.state;
    this.replay.commands.push(cmd);
    this.emit(result.events);
    this.scheduleAI();
  }

  private emit(events: GameEvent[]): void {
    this.lastView = redactFor(this.state, this.myId);
    this.onUpdate?.(this.lastView, redactEvents(events, this.myId));
  }

  dispose(): void {
    this.disposed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = null;
  }
}
