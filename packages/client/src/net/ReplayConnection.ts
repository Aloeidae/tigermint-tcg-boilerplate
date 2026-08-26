import {
  applyCommand,
  createGame,
  redactEventsForSpectator,
  redactForSpectator,
  type CardDef,
  type Command,
  type GameEvent,
  type PlayerId,
  type PlayerView,
  type RulesConfig,
} from '@tcg/shared';
import type { Connection } from './Connection.js';

/**
 * Everything needed to replay a game byte-for-byte: the engine is a pure,
 * seeded reducer, so setup + the accepted command log IS the game.
 * LocalAIConnection records this; the game-over screen offers it as a
 * download, and the menu's "Watch replay" plays the file back.
 */
export interface ReplayData {
  seed: number;
  names: [string, string];
  rules: Partial<RulesConfig>;
  decks: [CardDef[], CardDef[]];
  commands: Command[];
}

const STEP_MS = 900;

/**
 * Plays a recorded game back through the same Connection seam the live modes
 * use — the GameScene renders it as a spectator view and never knows the
 * difference. Auto-plays one command at a time; click anywhere to pause and
 * resume (wired by the GameScene via togglePause()).
 */
export class ReplayConnection implements Connection {
  readonly myId: PlayerId = 0;
  lastView: PlayerView | null = null;

  onUpdate?: (view: PlayerView, events: GameEvent[]) => void;
  onError?: (msg: string) => void;
  onClose?: (msg: string) => void;

  private state;
  private commands: Command[];
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private disposed = false;

  constructor(replay: ReplayData) {
    const { state } = createGame({
      decks: replay.decks,
      names: replay.names,
      rules: replay.rules,
      seed: replay.seed,
    });
    this.state = state;
    this.commands = replay.commands;
    this.lastView = redactForSpectator(state);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.disposed || this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, STEP_MS);
  }

  private step(): void {
    if (this.disposed || this.paused) return;
    if (this.cursor >= this.commands.length || this.state.gameOver) {
      if (!this.state.gameOver) this.onClose?.('End of replay');
      return;
    }
    const cmd = this.commands[this.cursor++];
    const result = applyCommand(this.state, cmd);
    if (!result.ok) {
      // A mismatched engine version can desync a replay — stop cleanly.
      this.onClose?.(`Replay desynced (${result.error}) — was it recorded on an older version?`);
      return;
    }
    this.state = result.state;
    this.lastView = redactForSpectator(this.state);
    this.onUpdate?.(this.lastView, redactEventsForSpectator(result.events));
    this.schedule();
  }

  /** Pause/resume playback. Returns the new paused state. */
  togglePause(): boolean {
    this.paused = !this.paused;
    if (!this.paused) this.schedule();
    return this.paused;
  }

  send(): void {
    // Replays are read-only.
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
