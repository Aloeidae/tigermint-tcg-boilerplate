import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { mergeRules, type CardDef, type RulesConfig } from '@tcg/shared';
import { Room } from './Room.js';

const PORT = Number(process.env.PORT ?? 8081);

const rooms = new Map<string, Room>();

/** Players waiting for an automatic match, bucketed by their exact rules. */
interface QueueEntry {
  ws: WebSocket;
  name: string;
  deck: CardDef[];
  rules: Partial<RulesConfig> | undefined;
  rulesKey: string;
}
const queue: QueueEntry[] = [];

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(rules?: Partial<RulesConfig>): Room {
  const code = makeCode();
  const room = new Room(code, () => rooms.delete(code), rules);
  rooms.set(code, room);
  return room;
}

function dequeue(ws: WebSocket): void {
  const i = queue.findIndex((q) => q.ws === ws);
  if (i !== -1) queue.splice(i, 1);
}

function tryMatch(entry: QueueEntry): void {
  const i = queue.findIndex((q) => q.rulesKey === entry.rulesKey && q.ws !== entry.ws);
  if (i === -1) {
    queue.push(entry);
    entry.ws.send(JSON.stringify({ t: 'queued' }));
    return;
  }
  const [opponent] = queue.splice(i, 1);
  const room = makeRoom(opponent.rules);
  console.log(`queue matched ${opponent.name} vs ${entry.name} -> room ${room.code}`);
  room.addPlayer(opponent.ws, opponent.name, opponent.deck);
  room.addPlayer(entry.ws, entry.name, entry.deck);
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`Tigermint TCG server — ${rooms.size} open room(s), ${queue.length} queued\n`);
});

const wss = new WebSocketServer({ server: httpServer });

interface HelloMessage {
  t: 'create' | 'join' | 'rejoin' | 'spectate' | 'queue' | 'cancelQueue';
  code?: string;
  name?: string;
  deck?: CardDef[];
  /** Creator's rules preset — sanitized by the Room via mergeRules(). */
  rules?: Partial<RulesConfig>;
  /** Seat token from the original join, for `rejoin`. */
  seatToken?: string;
}

wss.on('connection', (ws: WebSocket) => {
  // The first message from a client declares what it wants.
  ws.once('message', (raw) => {
    let msg: HelloMessage;
    try {
      msg = JSON.parse(String(raw)) as HelloMessage;
    } catch {
      ws.send(JSON.stringify({ t: 'error', msg: 'Malformed message' }));
      ws.close();
      return;
    }

    const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 24) : 'Player';

    switch (msg.t) {
      case 'create': {
        const room = makeRoom(msg.rules);
        room.addPlayer(ws, name, msg.deck ?? []);
        ws.send(JSON.stringify({ t: 'created', code: room.code }));
        console.log(`room ${room.code} created by ${name}`);
        return;
      }
      case 'join': {
        const room = msg.code ? rooms.get(msg.code.toUpperCase()) : undefined;
        if (!room) {
          ws.send(JSON.stringify({ t: 'error', msg: `Room ${msg.code ?? ''} not found` }));
          return;
        }
        if (room.isFull) {
          ws.send(JSON.stringify({ t: 'error', msg: 'That room is already full' }));
          return;
        }
        room.addPlayer(ws, name, msg.deck ?? []);
        console.log(`${name} joined room ${room.code}`);
        return;
      }
      case 'rejoin': {
        const room = msg.code ? rooms.get(msg.code.toUpperCase()) : undefined;
        if (!room || !msg.seatToken || !room.rejoin(ws, msg.seatToken)) {
          ws.send(JSON.stringify({ t: 'error', msg: 'That seat is gone — the game ended or timed out' }));
          return;
        }
        console.log(`a player rejoined room ${room.code}`);
        return;
      }
      case 'spectate': {
        const room = msg.code ? rooms.get(msg.code.toUpperCase()) : undefined;
        if (!room) {
          ws.send(JSON.stringify({ t: 'error', msg: `Room ${msg.code ?? ''} not found` }));
          return;
        }
        room.addSpectator(ws);
        console.log(`spectator joined room ${room.code}`);
        return;
      }
      case 'queue': {
        const entry: QueueEntry = {
          ws,
          name,
          deck: msg.deck ?? [],
          rules: msg.rules,
          // Sanitized-rules identity: only identical rule sets get matched.
          rulesKey: JSON.stringify(mergeRules(msg.rules)),
        };
        ws.on('close', () => dequeue(ws));
        // A second message may cancel the search.
        ws.on('message', (raw2) => {
          try {
            const m2 = JSON.parse(String(raw2)) as { t?: string };
            if (m2.t === 'cancelQueue') {
              dequeue(ws);
              ws.send(JSON.stringify({ t: 'queueCancelled' }));
            }
          } catch {
            // ignore
          }
        });
        tryMatch(entry);
        return;
      }
      default:
        ws.send(JSON.stringify({ t: 'error', msg: 'Expected a create, join, rejoin, spectate, or queue message' }));
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Tigermint TCG PvP server listening on ws://localhost:${PORT}`);
});
