import { createBonusGrid, createEmptyBoard, BOARD_SIZE, CENTER } from './board.js';
import { createTileBag, letterValue } from './tiles.js';
import { isValidWord } from './dictionary.js';

const MAX_RACK = 7;
const BINGO_BONUS = 50;

export class GameError extends Error {}

export class Game {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.status = 'lobby'; // lobby | playing | finished
    this.board = createEmptyBoard();
    this.bonusGrid = createBonusGrid();
    this.bag = createTileBag();
    this.players = []; // { id, name, rack: [], score, connected }
    this.turnIndex = 0;
    this.consecutivePasses = 0;
    this.log = [];
    this.hostId = null;
    this.winnerId = null;
  }

  addPlayer(token, socketId, name) {
    if (this.status !== 'lobby') throw new GameError('Game already in progress.');
    if (this.players.length >= 4) throw new GameError('Room is full (4 players max).');
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError('That name is already taken in this room.');
    }
    const player = { id: token, socketId, name, rack: [], score: 0, connected: true };
    this.players.push(player);
    if (!this.hostId) this.hostId = token;
    return player;
  }

  reconnect(token, newSocketId) {
    const player = this.players.find((p) => p.id === token);
    if (!player) return null;
    player.socketId = newSocketId;
    player.connected = true;
    return player;
  }

  markDisconnected(token) {
    const player = this.players.find((p) => p.id === token);
    if (player) player.connected = false;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  get currentPlayer() {
    return this.players[this.turnIndex];
  }

  start() {
    if (this.status !== 'lobby') throw new GameError('Game already started.');
    if (this.players.length < 2) throw new GameError('Need at least 2 players to start.');
    for (const player of this.players) {
      this._fillRack(player);
    }
    this.status = 'playing';
    this.turnIndex = 0;
    this._addLog({ type: 'start', detail: 'Game started.' });
  }

  _fillRack(player) {
    while (player.rack.length < MAX_RACK && this.bag.length > 0) {
      player.rack.push(this.bag.pop());
    }
  }

  _addLog(entry) {
    this.log.push({ ...entry, ts: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  _advanceTurn() {
    if (this.players.length === 0) return;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  _assertTurn(playerId) {
    if (this.status !== 'playing') throw new GameError('Game is not in progress.');
    const player = this.getPlayer(playerId);
    if (!player) throw new GameError('You are not in this game.');
    if (this.currentPlayer.id !== playerId) throw new GameError("It's not your turn.");
    return player;
  }

  passTurn(playerId) {
    const player = this._assertTurn(playerId);
    this.consecutivePasses += 1;
    this._addLog({ type: 'pass', playerName: player.name, detail: 'Passed.' });
    this._advanceTurn();
    this._maybeEndByStall();
    return this._publicState();
  }

  exchangeTiles(playerId, letters) {
    const player = this._assertTurn(playerId);
    if (!letters || letters.length === 0) throw new GameError('Select at least one tile to exchange.');
    if (this.bag.length === 0) throw new GameError('The bag is empty; you cannot exchange.');
    const rackCopy = player.rack.slice();
    for (const letter of letters) {
      const idx = rackCopy.indexOf(letter);
      if (idx === -1) throw new GameError(`You don't have a "${letter}" tile to exchange.`);
      rackCopy.splice(idx, 1);
    }
    // Remove from rack, return to bag, draw replacements, then shuffle bag.
    for (const letter of letters) {
      const idx = player.rack.indexOf(letter);
      player.rack.splice(idx, 1);
      this.bag.push(letter);
    }
    this.bag = shuffleInPlace(this.bag);
    this._fillRack(player);
    this.consecutivePasses += 1;
    this._addLog({ type: 'exchange', playerName: player.name, detail: `Exchanged ${letters.length} tile(s).` });
    this._advanceTurn();
    this._maybeEndByStall();
    return this._publicState();
  }

  _maybeEndByStall() {
    if (this.status !== 'playing') return;
    const threshold = this.players.length * 2;
    if (this.consecutivePasses >= threshold) {
      this._finishGame({ wentOutPlayerId: null });
    }
  }

  placeTiles(playerId, placements) {
    const player = this._assertTurn(playerId);
    if (!Array.isArray(placements) || placements.length === 0) {
      throw new GameError('No tiles placed.');
    }

    // Normalize & validate bounds / no overlap with existing tiles / no duplicate cells.
    const seen = new Set();
    for (const p of placements) {
      if (!Number.isInteger(p.row) || !Number.isInteger(p.col)) throw new GameError('Invalid placement.');
      if (p.row < 0 || p.row >= BOARD_SIZE || p.col < 0 || p.col >= BOARD_SIZE) {
        throw new GameError('Placement out of bounds.');
      }
      const key = `${p.row},${p.col}`;
      if (seen.has(key)) throw new GameError('Duplicate cell in placement.');
      seen.add(key);
      if (this.board[p.row][p.col]) throw new GameError('That square is already occupied.');
      if (!p.letter || typeof p.letter !== 'string' || !/^[A-Z]$/.test(p.letter)) {
        throw new GameError('Invalid letter in placement.');
      }
    }

    // Verify rack contains the required tiles.
    const rackCopy = player.rack.slice();
    for (const p of placements) {
      const needed = p.isBlank ? '#' : p.letter;
      const idx = rackCopy.indexOf(needed);
      if (idx === -1) throw new GameError(`You don't have the tile for "${p.letter}".`);
      rackCopy.splice(idx, 1);
    }

    const isFirstMove = this._isBoardEmpty();

    // Determine orientation.
    const rows = new Set(placements.map((p) => p.row));
    const cols = new Set(placements.map((p) => p.col));
    let orientation;
    if (placements.length === 1) {
      orientation = 'single';
    } else if (rows.size === 1) {
      orientation = 'horizontal';
    } else if (cols.size === 1) {
      orientation = 'vertical';
    } else {
      throw new GameError('Tiles must be placed in a single row or column.');
    }

    // Build a temp board overlay.
    const overlay = (r, c) => {
      const placed = placements.find((p) => p.row === r && p.col === c);
      if (placed) return { letter: placed.letter, isBlank: !!placed.isBlank, isNew: true };
      const existing = this.board[r][c];
      if (existing) return { ...existing, isNew: false };
      return null;
    };

    if (isFirstMove) {
      const coversCenter = placements.some((p) => p.row === CENTER && p.col === CENTER);
      if (!coversCenter) throw new GameError('The first word must cover the center square.');
    }

    // Check contiguity (no gaps) along the main line, and gather main word span.
    let mainWordCells;
    if (orientation === 'horizontal') {
      const row = [...rows][0];
      const colsArr = placements.map((p) => p.col).sort((a, b) => a - b);
      let start = colsArr[0];
      let end = colsArr[colsArr.length - 1];
      for (let c = start; c <= end; c++) {
        if (!overlay(row, c)) throw new GameError('Placed tiles must be contiguous (no gaps).');
      }
      while (start > 0 && overlay(row, start - 1)) start--;
      while (end < BOARD_SIZE - 1 && overlay(row, end + 1)) end++;
      mainWordCells = [];
      for (let c = start; c <= end; c++) mainWordCells.push([row, c]);
    } else if (orientation === 'vertical') {
      const col = [...cols][0];
      const rowsArr = placements.map((p) => p.row).sort((a, b) => a - b);
      let start = rowsArr[0];
      let end = rowsArr[rowsArr.length - 1];
      for (let r = start; r <= end; r++) {
        if (!overlay(r, col)) throw new GameError('Placed tiles must be contiguous (no gaps).');
      }
      while (start > 0 && overlay(start - 1, col)) start--;
      while (end < BOARD_SIZE - 1 && overlay(end + 1, col)) end++;
      mainWordCells = [];
      for (let r = start; r <= end; r++) mainWordCells.push([r, col]);
    } else {
      // Single tile: try both directions; prefer whichever forms a multi-letter word,
      // otherwise treat as horizontal for word-extraction purposes.
      const [pr, pc] = [placements[0].row, placements[0].col];
      const hCells = this._extendLine(pr, pc, 'horizontal', overlay);
      const vCells = this._extendLine(pr, pc, 'vertical', overlay);
      if (hCells.length === 1 && vCells.length === 1) {
        mainWordCells = hCells;
      } else if (hCells.length > 1) {
        mainWordCells = hCells;
      } else {
        mainWordCells = vCells;
      }
    }

    // Connectivity: must touch an existing tile unless first move.
    if (!isFirstMove) {
      const touchesExisting = placements.some((p) => this._hasAdjacentExisting(p.row, p.col));
      const partOfLongerWord = mainWordCells.length > placements.length;
      if (!touchesExisting && !partOfLongerWord) {
        throw new GameError('New tiles must connect to existing tiles on the board.');
      }
    }

    // Gather all words formed (main + any perpendicular words through newly placed tiles).
    const words = [];
    if (mainWordCells.length > 1) {
      words.push(this._buildWord(mainWordCells, overlay));
    }

    for (const p of placements) {
      // For horizontal/vertical main moves, cross-check the opposite axis for every placed tile.
      const crossOrientation = orientation === 'horizontal' ? 'vertical'
        : orientation === 'vertical' ? 'horizontal'
        : (mainWordCells[0][0] === mainWordCells[mainWordCells.length - 1][0] ? 'vertical' : 'horizontal');
      const crossCells = this._extendLine(p.row, p.col, crossOrientation, overlay);
      if (crossCells.length > 1) {
        words.push(this._buildWord(crossCells, overlay));
      }
    }

    if (words.length === 0) {
      throw new GameError('That does not form a word.');
    }

    // Validate every formed word against the dictionary.
    for (const w of words) {
      if (!isValidWord(w.text)) {
        throw new GameError(`"${w.text}" is not a valid word.`);
      }
    }

    // Score the move.
    let totalScore = 0;
    for (const w of words) {
      totalScore += this._scoreWord(w);
    }
    if (placements.length === MAX_RACK) totalScore += BINGO_BONUS;

    // Commit: place tiles on board.
    for (const p of placements) {
      this.board[p.row][p.col] = { letter: p.letter, isBlank: !!p.isBlank };
    }
    // Remove used tiles from rack.
    for (const p of placements) {
      const needed = p.isBlank ? '#' : p.letter;
      const idx = player.rack.indexOf(needed);
      player.rack.splice(idx, 1);
    }
    this._fillRack(player);

    player.score += totalScore;
    this.consecutivePasses = 0;
    this._addLog({
      type: 'move',
      playerName: player.name,
      detail: `${words.map((w) => w.text).join(', ')} (+${totalScore})`,
    });

    if (this.bag.length === 0 && player.rack.length === 0) {
      this._finishGame({ wentOutPlayerId: player.id });
    } else {
      this._advanceTurn();
    }

    return this._publicState();
  }

  _extendLine(row, col, orientation, overlay) {
    let start, end;
    if (orientation === 'horizontal') {
      start = col; end = col;
      while (start > 0 && overlay(row, start - 1)) start--;
      while (end < BOARD_SIZE - 1 && overlay(row, end + 1)) end++;
      const cells = [];
      for (let c = start; c <= end; c++) cells.push([row, c]);
      return cells;
    }
    start = row; end = row;
    while (start > 0 && overlay(start - 1, col)) start--;
    while (end < BOARD_SIZE - 1 && overlay(end + 1, col)) end++;
    const cells = [];
    for (let r = start; r <= end; r++) cells.push([r, col]);
    return cells;
  }

  _hasAdjacentExisting(row, col) {
    const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    return deltas.some(([dr, dc]) => {
      const r = row + dr, c = col + dc;
      return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && this.board[r][c];
    });
  }

  _buildWord(cells, overlay) {
    const letters = cells.map(([r, c]) => overlay(r, c));
    return {
      text: letters.map((t) => t.letter).join(''),
      cells,
      tiles: letters,
    };
  }

  _scoreWord(word) {
    let wordMultiplier = 1;
    let sum = 0;
    for (let i = 0; i < word.cells.length; i++) {
      const [r, c] = word.cells[i];
      const tile = word.tiles[i];
      const base = tile.isBlank ? 0 : letterValue(tile.letter);
      if (tile.isNew) {
        const bonus = this.bonusGrid[r][c];
        if (bonus === 'DL') sum += base * 2;
        else if (bonus === 'TL') sum += base * 3;
        else sum += base;
        if (bonus === 'DW') wordMultiplier *= 2;
        else if (bonus === 'TW') wordMultiplier *= 3;
      } else {
        sum += base;
      }
    }
    return sum * wordMultiplier;
  }

  _isBoardEmpty() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.board[r][c]) return false;
      }
    }
    return true;
  }

  _finishGame({ wentOutPlayerId }) {
    this.status = 'finished';
    let leftoverTotal = 0;
    for (const p of this.players) {
      const rackValue = p.rack.reduce((sum, l) => sum + letterValue(l), 0);
      if (p.id === wentOutPlayerId) continue;
      p.score -= rackValue;
      leftoverTotal += rackValue;
    }
    if (wentOutPlayerId) {
      const winner = this.getPlayer(wentOutPlayerId);
      if (winner) winner.score += leftoverTotal;
    }
    const best = this.players.reduce((a, b) => (b.score > a.score ? b : a), this.players[0]);
    this.winnerId = best?.id ?? null;
    this._addLog({ type: 'end', detail: 'Game over.' });
  }

  _publicState(forPlayerId) {
    return {
      roomCode: this.roomCode,
      status: this.status,
      board: this.board,
      bonusGrid: this.bonusGrid,
      bagCount: this.bag.length,
      turnPlayerId: this.status === 'playing' ? this.currentPlayer?.id ?? null : null,
      hostId: this.hostId,
      winnerId: this.winnerId,
      log: this.log.slice(-50),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        rackCount: p.rack.length,
        connected: p.connected,
        rack: p.id === forPlayerId ? p.rack : undefined,
      })),
    };
  }

  stateFor(playerId) {
    return this._publicState(playerId);
  }
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
