import { customAlphabet } from 'nanoid';
import { Game, GameError } from './game/Game.js';

const roomCodeGen = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Game
  }

  createRoom() {
    let code;
    do {
      code = roomCodeGen();
    } while (this.rooms.has(code));
    const game = new Game(code);
    this.rooms.set(code, game);
    return game;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  removeIfEmpty(code) {
    const game = this.rooms.get(code);
    if (game && game.players.every((p) => !p.connected)) {
      this.rooms.delete(code);
    }
  }
}

export { GameError };
