import type { CardDef, Command, GameEvent, PlayerId, PlayerView, RulesConfig } from '@tcg/shared';
import type { Connection } from './Connection.js';

/** Messages the server sends. Mirrors packages/server/src/{index,Room}.ts. */
type ServerMessage =
  | { t: 'created'; code: string }
  | { t: 'queued' }
  | { t: 'queueCancelled' }
  | { t: 'waiting' }
  | { t: 'seat'; code: string; seatToken: string }
  | { t: 'start'; playerId: PlayerId; view: PlayerView }
  | { t: 'update'; view: PlayerView; events: GameEvent[]; cmd?: Command }
  | { t: 'error'; msg: string }
  | { t: 'opponentReconnecting'; seconds: number }
  | { t: 'opponentBack' }
  | { t: 'opponentLeft' };

const RECONNECT_TRIES = 10;

/**
 * Talks to the authoritative PvP server (packages/server) over a WebSocket.
 * Create a room with WsConnection.create(), join with .join(), find an
 * automatic match with .queue(), or watch a game with .spectate(). A dropped
 * socket mid-game auto-reconnects with the seat token the server issued
 * (also kept in sessionStorage so a tab refresh can resume the seat).
 */
export class WsConnection implements Connection {
  myId: PlayerId = 0;
  lastView: PlayerView | null = null;

  onUpdate?: (view: PlayerView, events: GameEvent[]) => void;
  onError?: (msg: string) => void;
  onClose?: (msg: string) => void;
  /** Fired (create mode only) once the server assigns a room code. */
  onRoomCode?: (code: string) => void;
  /** Fired (queue mode) when the server confirms you're in the queue. */
  onQueued?: () => void;
  /** Fired when both players are in and the game begins. */
  onGameStart?: () => void;
  /** Transient connection notices ("opponent reconnecting…"). */
  onNotice?: (msg: string) => void;

  private ws: WebSocket;
  private readonly url: string;
  private started = false;
  private disposed = false;
  private code: string | null = null;
  private seatToken: string | null = null;
  private reconnectAttempt = 0;

  private constructor(url: string, openMsg: object) {
    this.url = url;
    this.ws = this.open(openMsg);
  }

  static create(url: string, deck: CardDef[], name: string, rules?: Partial<RulesConfig>): WsConnection {
    return new WsConnection(url, { t: 'create', name, deck, rules });
  }

  static join(url: string, code: string, deck: CardDef[], name: string): WsConnection {
    return new WsConnection(url, { t: 'join', code: code.toUpperCase(), name, deck });
  }

  /** Automatic matchmaking: pairs you with the next player on the same rules. */
  static queue(url: string, deck: CardDef[], name: string, rules?: Partial<RulesConfig>): WsConnection {
    return new WsConnection(url, { t: 'queue', name, deck, rules });
  }

  /** Watch a live game: view-only, no hidden information. */
  static spectate(url: string, code: string): WsConnection {
    return new WsConnection(url, { t: 'spectate', code: code.toUpperCase() });
  }

  /** Resume a seat saved in sessionStorage (survives a tab refresh), if any. */
  static resume(url: string): WsConnection | null {
    try {
      const raw = sessionStorage.getItem('tm-seat');
      if (!raw) return null;
      const saved = JSON.parse(raw) as { url: string; code: string; seatToken: string };
      if (saved.url !== url || !saved.code || !saved.seatToken) return null;
      const conn = new WsConnection(url, { t: 'rejoin', code: saved.code, seatToken: saved.seatToken });
      conn.code = saved.code;
      conn.seatToken = saved.seatToken;
      return conn;
    } catch {
      return null;
    }
  }

  private open(openMsg: object): WebSocket {
    const ws = new WebSocket(this.url);
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      ws.send(JSON.stringify(openMsg));
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string) as ServerMessage);
    ws.onerror = () => {
      if (!this.started) {
        this.onClose?.('Could not reach the game server. Is it running? (npm run dev:server)');
      }
    };
    ws.onclose = () => {
      if (this.disposed || !this.started) return;
      if (this.lastView && !this.lastView.gameOver) this.tryReconnect();
    };
    return ws;
  }

  private tryReconnect(): void {
    if (!this.code || !this.seatToken) {
      this.onClose?.('Connection to the server was lost');
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_TRIES) {
      this.onClose?.('Connection to the server was lost');
      return;
    }
    this.reconnectAttempt += 1;
    this.onNotice?.(`Connection lost — reconnecting (${this.reconnectAttempt}/${RECONNECT_TRIES})…`);
    setTimeout(() => {
      if (this.disposed) return;
      this.ws = this.open({ t: 'rejoin', code: this.code, seatToken: this.seatToken });
    }, 1200 * this.reconnectAttempt);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'created':
        this.code = msg.code;
        this.onRoomCode?.(msg.code);
        break;
      case 'queued':
        this.onQueued?.();
        break;
      case 'queueCancelled':
        this.onClose?.('Search cancelled');
        break;
      case 'waiting':
        this.onNotice?.('Waiting for the game to start…');
        break;
      case 'seat':
        this.code = msg.code;
        this.seatToken = msg.seatToken;
        try {
          sessionStorage.setItem('tm-seat', JSON.stringify({ url: this.url, code: msg.code, seatToken: msg.seatToken }));
        } catch {
          // storage unavailable — reconnects still work within this page
        }
        break;
      case 'start': {
        const resumed = this.started;
        this.myId = msg.playerId;
        this.lastView = msg.view;
        if (resumed) {
          this.onNotice?.('Reconnected!');
          this.onUpdate?.(msg.view, []);
        } else {
          this.started = true;
          this.onGameStart?.();
        }
        break;
      }
      case 'update':
        this.lastView = msg.view;
        this.onUpdate?.(msg.view, msg.events);
        if (msg.view.gameOver) this.clearSeat();
        break;
      case 'error':
        this.onError?.(msg.msg);
        break;
      case 'opponentReconnecting':
        this.onNotice?.(`Opponent disconnected — holding their seat ${msg.seconds}s…`);
        break;
      case 'opponentBack':
        this.onNotice?.('Opponent reconnected.');
        break;
      case 'opponentLeft':
        this.clearSeat();
        this.onClose?.('Your opponent left the game');
        break;
    }
  }

  cancelQueue(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'cancelQueue' }));
    }
  }

  send(cmd: Command): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'cmd', cmd }));
    }
  }

  private clearSeat(): void {
    try {
      sessionStorage.removeItem('tm-seat');
    } catch {
      // fine
    }
  }

  dispose(): void {
    this.disposed = true;
    this.onUpdate = undefined;
    this.onClose = undefined;
    this.ws.close();
  }
}
