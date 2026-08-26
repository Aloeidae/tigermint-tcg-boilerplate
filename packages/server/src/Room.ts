import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  applyCommand,
  createGame,
  mergeRules,
  padDeck,
  redactEvents,
  redactEventsForSpectator,
  redactFor,
  redactForSpectator,
  type CardDef,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type RulesConfig,
} from '@tcg/shared';

/** How long a dropped player's seat is held before the game concedes. */
const RECONNECT_GRACE_MS = 30_000;

interface Seat {
  /** Null while the player is disconnected (inside the grace window). */
  ws: WebSocket | null;
  name: string;
  deck: CardDef[];
  /** Secret handed to the client at join; proves seat ownership on rejoin. */
  token: string;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * One PvP match. The server is authoritative: it owns the real GameState,
 * validates every command with the shared engine, and sends each client only
 * its redacted view. Spectators receive a no-hidden-info view and can never
 * send commands. A dropped player has RECONNECT_GRACE_MS to come back with
 * their seat token before the disconnect becomes a concession.
 *
 * NOTE (hardening): decks are submitted by the clients and trusted as-is.
 * For a production game, verify NFT ownership server-side (query the chain
 * for the wallet the client proves it owns via TonConnect) and re-derive the
 * CardDefs on the server with the same mapper the client uses.
 */
export class Room {
  readonly code: string;
  private seats: (Seat | null)[] = [null, null];
  private spectators = new Set<WebSocket>();
  private state: GameState | null = null;
  private onEmpty: () => void;
  /** Sanitized rules chosen by the room's creator. */
  private rules: RulesConfig;

  constructor(code: string, onEmpty: () => void, rules?: Partial<RulesConfig>) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.rules = mergeRules(rules);
  }

  get isFull(): boolean {
    return this.seats[0] !== null && this.seats[1] !== null;
  }

  addPlayer(ws: WebSocket, name: string, deck: CardDef[]): void {
    const seatIndex = (this.seats[0] === null ? 0 : 1) as PlayerId;
    const seat: Seat = { ws, name, deck: sanitizeDeck(deck), token: randomUUID(), graceTimer: null };
    this.seats[seatIndex] = seat;
    this.wire(ws, seatIndex);
    // The seat token lets this client reclaim its seat after a drop.
    ws.send(JSON.stringify({ t: 'seat', code: this.code, seatToken: seat.token }));
    if (this.isFull) this.startGame();
  }

  /** Reclaim a seat with its token (within the grace window, or any time the game is live). */
  rejoin(ws: WebSocket, token: string): boolean {
    const seatIndex = this.seats.findIndex((s) => s?.token === token) as PlayerId | -1;
    if (seatIndex === -1) return false;
    const seat = this.seats[seatIndex]!;
    if (seat.graceTimer) {
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
    }
    try {
      seat.ws?.close();
    } catch {
      // replacing a stale socket
    }
    seat.ws = ws;
    this.wire(ws, seatIndex as PlayerId);
    ws.send(JSON.stringify({ t: 'seat', code: this.code, seatToken: seat.token }));
    if (this.state) {
      ws.send(
        JSON.stringify({ t: 'start', playerId: seatIndex, view: redactFor(this.state, seatIndex as PlayerId) })
      );
      this.sendTo(other(seatIndex as PlayerId), { t: 'opponentBack' });
    }
    return true;
  }

  addSpectator(ws: WebSocket): void {
    this.spectators.add(ws);
    ws.on('close', () => this.spectators.delete(ws));
    if (this.state) {
      ws.send(JSON.stringify({ t: 'start', playerId: 0, view: redactForSpectator(this.state) }));
    } else {
      ws.send(JSON.stringify({ t: 'waiting' }));
    }
  }

  private wire(ws: WebSocket, seatIndex: PlayerId): void {
    ws.on('close', () => this.onDisconnect(seatIndex, ws));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { t: string; cmd?: Command };
        if (msg.t === 'cmd' && msg.cmd) this.onCommand(seatIndex, msg.cmd);
      } catch {
        this.sendTo(seatIndex, { t: 'error', msg: 'Malformed message' });
      }
    });
  }

  private startGame(): void {
    const [a, b] = this.seats as [Seat, Seat];
    const { state } = createGame({
      decks: [a.deck, b.deck],
      names: [a.name, b.name],
      rules: this.rules,
    });
    this.state = state;
    for (const id of [0, 1] as const) {
      this.sendTo(id, { t: 'start', playerId: id, view: redactFor(state, id) });
    }
    for (const ws of this.spectators) {
      ws.send(JSON.stringify({ t: 'start', playerId: 0, view: redactForSpectator(state) }));
    }
  }

  private onCommand(player: PlayerId, cmd: Command): void {
    if (!this.state) return;
    // The player field is server-assigned — a client can't act as its opponent.
    const result = applyCommand(this.state, { ...cmd, player });
    if (!result.ok) {
      this.sendTo(player, { t: 'error', msg: result.error });
      return;
    }
    this.state = result.state;
    // Include the accepted command so clients can record replays.
    this.broadcast(result.events, { ...cmd, player });
  }

  private broadcast(events: GameEvent[], cmd?: Command): void {
    if (!this.state) return;
    for (const id of [0, 1] as const) {
      this.sendTo(id, {
        t: 'update',
        view: redactFor(this.state, id),
        events: redactEvents(events, id),
        cmd,
      });
    }
    const specMsg = JSON.stringify({
      t: 'update',
      view: redactForSpectator(this.state),
      events: redactEventsForSpectator(events),
      cmd,
    });
    for (const ws of this.spectators) {
      if (ws.readyState === ws.OPEN) ws.send(specMsg);
    }
  }

  private onDisconnect(player: PlayerId, ws: WebSocket): void {
    const seat = this.seats[player];
    // Ignore closes from sockets that were already replaced by a rejoin.
    if (!seat || seat.ws !== ws) return;
    seat.ws = null;

    if (this.state && !this.state.gameOver) {
      // Hold the seat: the player may come back within the grace window.
      this.sendTo(other(player), { t: 'opponentReconnecting', seconds: RECONNECT_GRACE_MS / 1000 });
      seat.graceTimer = setTimeout(() => {
        seat.graceTimer = null;
        if (seat.ws !== null) return; // came back
        this.seats[player] = null;
        if (this.state && !this.state.gameOver) {
          const result = applyCommand(this.state, { type: 'concede', player });
          if (result.ok) {
            this.state = result.state;
            this.broadcast(result.events);
          }
        }
        this.checkEmpty();
      }, RECONNECT_GRACE_MS);
      return;
    }

    this.seats[player] = null;
    if (!this.state) this.sendTo(other(player), { t: 'opponentLeft' });
    this.checkEmpty();
  }

  private checkEmpty(): void {
    // A seat inside its grace window still counts as alive.
    const anyAlive = this.seats.some((s) => s && (s.ws !== null || s.graceTimer !== null));
    if (!anyAlive) {
      for (const s of this.seats) {
        if (s?.graceTimer) clearTimeout(s.graceTimer);
      }
      this.onEmpty();
    }
  }

  private sendTo(player: PlayerId, msg: object): void {
    const seat = this.seats[player];
    if (seat?.ws && seat.ws.readyState === seat.ws.OPEN) {
      seat.ws.send(JSON.stringify(msg));
    }
  }
}

function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** Basic shape-check of a client-submitted deck, padded/trimmed to legal size. */
function sanitizeDeck(deck: unknown): CardDef[] {
  if (!Array.isArray(deck)) return padDeck([]);
  const clean = deck.filter(
    (c): c is CardDef =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as CardDef).id === 'string' &&
      typeof (c as CardDef).name === 'string' &&
      ['creature', 'equipment', 'spell'].includes((c as CardDef).type) &&
      typeof (c as CardDef).cost === 'number'
  );
  return padDeck(clean);
}
