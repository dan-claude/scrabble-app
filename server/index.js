import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { RoomManager, GameError } from './rooms.js';
import './game/dictionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true }));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const rooms = new RoomManager();
// socket.id -> { roomCode, token }
const socketSessions = new Map();

function broadcastState(game) {
  for (const player of game.players) {
    if (!player.connected) continue;
    io.to(player.socketId).emit('state', { ...game.stateFor(player.id), youId: player.id });
  }
}

function handle(socket, fn) {
  return (payload, cb) => {
    try {
      const result = fn(payload) || {};
      if (typeof cb === 'function') cb({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof GameError ? err.message : 'Something went wrong.';
      if (!(err instanceof GameError)) console.error(err);
      if (typeof cb === 'function') cb({ ok: false, error: message });
      else socket.emit('error', { message });
    }
  };
}

io.on('connection', (socket) => {
  socket.on('room:create', handle(socket, ({ playerName }) => {
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) throw new GameError('Enter a name.');
    const game = rooms.createRoom();
    const token = nanoid();
    game.addPlayer(token, socket.id, name);
    socket.join(game.roomCode);
    socketSessions.set(socket.id, { roomCode: game.roomCode, token });
    broadcastState(game);
    return { roomCode: game.roomCode, token };
  }));

  socket.on('room:join', handle(socket, ({ roomCode, playerName }) => {
    const game = rooms.getRoom(roomCode);
    if (!game) throw new GameError('Room not found.');
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) throw new GameError('Enter a name.');
    const token = nanoid();
    game.addPlayer(token, socket.id, name);
    socket.join(game.roomCode);
    socketSessions.set(socket.id, { roomCode: game.roomCode, token });
    broadcastState(game);
    return { roomCode: game.roomCode, token };
  }));

  socket.on('room:rejoin', handle(socket, ({ roomCode, token }) => {
    const game = rooms.getRoom(roomCode);
    if (!game) throw new GameError('Room not found.');
    const player = game.reconnect(token, socket.id);
    if (!player) throw new GameError('Session not found; please join again.');
    socket.join(game.roomCode);
    socketSessions.set(socket.id, { roomCode: game.roomCode, token });
    broadcastState(game);
    return { roomCode: game.roomCode, token };
  }));

  socket.on('game:start', handle(socket, () => {
    const game = requireGame(socket);
    game.start();
    broadcastState(game);
  }));

  socket.on('game:place', handle(socket, ({ placements }) => {
    const { game, token } = requireGame(socket, true);
    game.placeTiles(token, placements);
    broadcastState(game);
  }));

  socket.on('game:pass', handle(socket, () => {
    const { game, token } = requireGame(socket, true);
    game.passTurn(token);
    broadcastState(game);
  }));

  socket.on('game:exchange', handle(socket, ({ letters }) => {
    const { game, token } = requireGame(socket, true);
    game.exchangeTiles(token, letters);
    broadcastState(game);
  }));

  socket.on('disconnect', () => {
    const session = socketSessions.get(socket.id);
    socketSessions.delete(socket.id);
    if (!session) return;
    const game = rooms.getRoom(session.roomCode);
    if (!game) return;
    // Only mark the player offline if this socket is still their current
    // connection — a stale socket's disconnect must not clobber a newer
    // reconnection (e.g. the player reloaded and reconnected already).
    const player = game.getPlayer(session.token);
    if (player && player.socketId === socket.id) {
      game.markDisconnected(session.token);
      broadcastState(game);
    }
    setTimeout(() => rooms.removeIfEmpty(session.roomCode), 5000);
  });

  function requireGame(sock, withToken = false) {
    const session = socketSessions.get(sock.id);
    if (!session) throw new GameError('You are not in a room.');
    const game = rooms.getRoom(session.roomCode);
    if (!game) throw new GameError('Room not found.');
    return withToken ? { game, token: session.token } : game;
  }
});

server.listen(PORT, () => {
  console.log(`Scrabble server listening on :${PORT}`);
});
