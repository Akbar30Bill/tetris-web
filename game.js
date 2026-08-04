export const COLS = 10;
export const ROWS = 20;
export const SPAWN_DELAY = 166;
export const LOCK_DELAY = 166;
export const CLEAR_DELAY = 332;
export const MAX_GARBAGE = 12;

export const PIECES = Object.freeze([
  {name: "I", masks: [0x0f00, 0x2222], color: 1, texture: "<>"},
  {name: "J", masks: [0x0470, 0x0322, 0x0071, 0x0226], color: 2, texture: "{}"},
  {name: "L", masks: [0x0170, 0x0223, 0x0074, 0x0622], color: 3, texture: "()"},
  {name: "O", masks: [0x0066], color: 4, texture: "[]"},
  {name: "S", masks: [0x0360, 0x0231], color: 5, texture: "%%"},
  {name: "T", masks: [0x0270, 0x0232, 0x0072, 0x0262], color: 6, texture: "##"},
  {name: "Z", masks: [0x0630, 0x0132], color: 7, texture: "@@"},
]);

const LINE_SCORES = [0, 40, 100, 300, 1200];

export class SeededRandom {
  constructor(seed) {
    this.state = (Number(seed) >>> 0) || 0x6d2b79f5;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }

  int(max) {
    return Math.floor(this.next() * max);
  }
}

export function randomSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export function fallTimeForLevel(level) {
  let fallTime = 799;
  for (let current = 1; current <= level; current += 1) {
    if (current < 9) fallTime -= 83;
    else if (current === 9) fallTime = 100;
    else if (current === 10) fallTime = 83;
    else if (current < 20) fallTime -= 5 + (current % 2);
    else if (current < 30) fallTime -= 2;
  }
  return Math.max(13, fallTime);
}

export function garbageForLines(lines) {
  return Math.max(0, Math.min(4, lines) - 1);
}

export function cellsFor(piece) {
  if (!piece) return [];
  const definition = PIECES[piece.type];
  const mask = definition?.masks?.[piece.rotation];
  if (!Number.isInteger(mask) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return [];
  const cells = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if (mask & (1 << (row * 4 + column))) {
        cells.push({x: piece.x + column, y: piece.y + row});
      }
    }
  }
  return cells;
}

function blankBoard() {
  return Array.from({length: ROWS}, () => Array(COLS).fill(0));
}

function clonePiece(piece) {
  return piece ? {...piece} : null;
}

export class GameEngine {
  constructor({mode = "solo", startLevel = 0, seed = randomSeed()} = {}) {
    this.mode = mode;
    this.startLevel = Math.max(0, Math.min(9, startLevel));
    this.prepare(seed);
  }

  prepare(seed = randomSeed()) {
    this.seed = Number(seed) >>> 0;
    this.pieceRandom = new SeededRandom(this.seed);
    this.garbageRandom = new SeededRandom(this.seed ^ 0xa5a5a5a5);
    this.board = blankBoard();
    this.active = null;
    this.nextType = this.pieceRandom.int(PIECES.length);
    this.score = 0;
    this.lines = 0;
    this.level = this.startLevel;
    this.fallTime = fallTimeForLevel(this.level);
    this.stats = Array(PIECES.length).fill(0);
    this.pendingGarbage = 0;
    this.garbageHole = -1;
    this.garbageHoleAge = 8;
    this.clearingRows = [];
    this.phaseRemaining = 0;
    this.pausedStatus = null;
    this.gravityElapsed = 0;
    this.lockState = null;
    this.deferLock = false;
    this.status = "ready";
    this.events = [];
    this.pieceNumber = 0;
    return this;
  }

  start() {
    if (this.status !== "ready") return false;
    this.status = "running";
    return this.spawnPiece();
  }

  pause() {
    if (this.mode === "solo" && ["running", "clearing", "spawning"].includes(this.status)) {
      this.pausedStatus = this.status;
      this.status = "paused";
      return true;
    }
    if (this.mode === "solo" && this.status === "paused") {
      this.status = this.pausedStatus || "running";
      this.pausedStatus = null;
      return true;
    }
    return false;
  }

  finish() {
    if (this.clearingRows.length) {
      const rows = new Set(this.clearingRows);
      const kept = this.board.filter((_, index) => !rows.has(index));
      while (kept.length < ROWS) kept.unshift(Array(COLS).fill(0));
      this.board = kept;
    }
    if (this.status !== "gameover") this.status = "roundover";
    this.active = null;
    this.lockState = null;
    this.clearingRows = [];
    this.phaseRemaining = 0;
    this.pausedStatus = null;
  }

  isOccupied(piece) {
    for (const cell of cellsFor(piece)) {
      if (cell.x < 0 || cell.x >= COLS || cell.y >= ROWS) return true;
      if (cell.y >= 0 && this.board[cell.y][cell.x]) return true;
    }
    return false;
  }

  isGrounded(piece = this.active) {
    if (!piece) return false;
    return this.isOccupied({...piece, y: piece.y + 1});
  }

  spawnPiece() {
    const type = this.nextType;
    this.nextType = this.pieceRandom.int(PIECES.length);
    const spawnY = type === 0 ? -4 : type === 3 ? -2 : -3;
    const piece = {type, rotation: 0, x: 3, y: spawnY};
    this.active = piece;
    this.stats[type] += 1;
    this.pieceNumber += 1;
    this.gravityElapsed = 0;
    this.lockState = null;

    if (!this.tryMove(0, 1, false) || !this.tryMove(0, 1, false)) {
      this.gameOver();
      return false;
    }
    this.status = "running";
    this.emit("spawn", {pieceNumber: this.pieceNumber});
    return true;
  }

  tick(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    let remaining = Math.min(elapsed, 120000);
    let safety = 0;

    while (remaining > 0 && safety < 10000) {
      safety += 1;
      if (this.status === "clearing" || this.status === "spawning") {
        const used = Math.min(remaining, this.phaseRemaining);
        this.phaseRemaining -= used;
        remaining -= used;
        if (this.phaseRemaining > 0) break;
        if (this.status === "clearing") this.finishLineClear();
        else this.spawnPiece();
        continue;
      }

      if (this.status !== "running" || !this.active) break;

      if (this.isGrounded()) {
        if (!this.lockState) {
          if (this.deferLock) {
            this.deferLock = false;
            remaining -= Math.max(1, Math.min(remaining, this.fallTime));
            this.gravityElapsed = 0;
            continue;
          }
          this.beginLockDelay();
        }
        const untilLock = LOCK_DELAY - this.lockState.elapsed;
        const used = Math.min(remaining, untilLock);
        this.lockState.elapsed += used;
        remaining -= used;
        if (this.lockState.elapsed >= LOCK_DELAY) this.lockPiece();
        else break;
        continue;
      }

      this.lockState = null;
      const untilFall = this.fallTime - this.gravityElapsed;
      const used = Math.min(remaining, untilFall);
      this.gravityElapsed += used;
      remaining -= used;
      if (this.gravityElapsed >= this.fallTime) {
        this.gravityElapsed = 0;
        if (!this.tryMove(0, 1, false)) this.beginLockDelay();
      } else {
        break;
      }
    }
  }

  input(action) {
    if (this.status !== "running" || !this.active) return false;
    switch (action) {
      case "left":
        return this.tryMove(-1, 0, true);
      case "right":
        return this.tryMove(1, 0, true);
      case "rotateCW":
        return this.tryRotate(1);
      case "rotateCCW":
        return this.tryRotate(-1);
      case "softDrop":
        if (this.tryMove(0, 1, false)) {
          if (this.mode === "solo") this.score += 1;
          this.gravityElapsed = 0;
          return true;
        }
        this.lockPiece();
        return true;
      case "hardDrop": {
        let distance = 0;
        while (this.tryMove(0, 1, false)) distance += 1;
        if (this.mode === "solo") this.score += distance;
        this.lockPiece();
        return true;
      }
      default:
        return false;
    }
  }

  tryMove(dx, dy, manipulation) {
    if (!this.active) return false;
    const before = clonePiece(this.active);
    const moved = {...this.active, x: this.active.x + dx, y: this.active.y + dy};
    if (this.isOccupied(moved)) return false;
    this.active = moved;
    if (manipulation) this.handleManipulation(before);
    return true;
  }

  tryRotate(direction) {
    if (!this.active) return false;
    const piece = PIECES[this.active.type];
    if (piece.masks.length === 1) return false;
    const before = clonePiece(this.active);
    const count = piece.masks.length;
    const rotation = (this.active.rotation + direction + count) % count;
    const rotated = {...this.active, rotation};
    if (this.isOccupied(rotated)) return false;
    this.active = rotated;
    this.handleManipulation(before);
    return true;
  }

  beginLockDelay() {
    if (!this.active || this.lockState) return;
    this.lockState = {
      elapsed: 0,
      originalX: this.active.x,
      lastX: this.active.x,
      originalRotation: this.active.rotation,
      lastRotation: this.active.rotation,
    };
  }

  handleManipulation(before) {
    if (!this.lockState || !this.active) return;
    if (!this.isGrounded()) {
      this.lockState = null;
      this.gravityElapsed = 0;
      this.tryMove(0, 1, false);
      if (this.isGrounded()) this.deferLock = true;
      return;
    }

    if (this.active.x !== before.x) {
      if (this.active.x === this.lockState.originalX) {
        this.lockPiece();
        return;
      }
      this.lockState.originalX = this.lockState.lastX;
      this.lockState.lastX = this.active.x;
      this.lockState.elapsed = 0;
    } else if (this.active.rotation !== before.rotation) {
      if (this.active.rotation === this.lockState.originalRotation) {
        this.lockPiece();
        return;
      }
      this.lockState.lastRotation = this.active.rotation;
      this.lockState.elapsed = 0;
    }
  }

  lockPiece() {
    if (!this.active || !["running", "paused"].includes(this.status)) return;
    const piece = this.active;
    const cells = cellsFor(piece);
    if (cells.some((cell) => cell.y < 0)) {
      this.gameOver();
      return;
    }

    for (const cell of cells) this.board[cell.y][cell.x] = piece.type + 1;
    this.active = null;
    this.lockState = null;
    this.gravityElapsed = 0;
    this.clearingRows = [];
    for (let row = 0; row < ROWS; row += 1) {
      if (this.board[row].every(Boolean)) this.clearingRows.push(row);
    }

    const count = this.clearingRows.length;
    if (count) {
      const levelBefore = this.level;
      if (this.mode === "solo") this.score += LINE_SCORES[count] * (levelBefore + 1);
      this.updateLinesAndLevel(count);
      this.status = "clearing";
      this.phaseRemaining = CLEAR_DELAY;
      this.emit("lines", {count, garbage: garbageForLines(count)});
    } else {
      this.beginSpawnDelay();
    }
    this.emit("lock", {pieceNumber: this.pieceNumber});
  }

  updateLinesAndLevel(count) {
    const previousLines = this.lines;
    this.lines += count;
    if (this.level === this.startLevel) {
      if (this.lines >= 10 * this.startLevel + 10 || this.lines >= 100) {
        this.level += 1;
      }
    } else if (Math.floor(this.lines / 10) !== Math.floor(previousLines / 10)) {
      this.level += 1;
    }
    this.fallTime = fallTimeForLevel(this.level);
  }

  finishLineClear() {
    const rows = new Set(this.clearingRows);
    const kept = this.board.filter((_, index) => !rows.has(index));
    while (kept.length < ROWS) kept.unshift(Array(COLS).fill(0));
    this.board = kept;
    this.clearingRows = [];
    this.beginSpawnDelay();
  }

  beginSpawnDelay() {
    if (!this.applyPendingGarbage()) return;
    this.status = "spawning";
    this.phaseRemaining = SPAWN_DELAY;
  }

  queueGarbage(rows) {
    if (!Number.isFinite(rows) || rows <= 0 || this.status === "gameover") return 0;
    const previous = this.pendingGarbage;
    this.pendingGarbage = Math.min(MAX_GARBAGE, previous + Math.floor(rows));
    this.emit("garbageQueued", {count: this.pendingGarbage});
    return this.pendingGarbage - previous;
  }

  applyPendingGarbage() {
    while (this.pendingGarbage > 0) {
      if (this.board[0].some(Boolean)) {
        this.gameOver();
        return false;
      }
      this.board.shift();
      this.board.push(this.makeGarbageRow());
      this.pendingGarbage -= 1;
    }
    return true;
  }

  makeGarbageRow() {
    if (this.garbageHole < 0 || this.garbageHoleAge >= 8) {
      let nextHole;
      do nextHole = this.garbageRandom.int(COLS);
      while (nextHole === this.garbageHole);
      this.garbageHole = nextHole;
      this.garbageHoleAge = 0;
    }
    this.garbageHoleAge += 1;

    const reference = this.board[ROWS - 2] || [];
    const garbageColor = reference.find(Boolean) || 1;
    return Array.from({length: COLS}, (_, column) =>
      column === this.garbageHole ? 0 : garbageColor,
    );
  }

  gameOver() {
    if (this.status === "gameover") return;
    this.status = "gameover";
    this.active = null;
    this.lockState = null;
    this.phaseRemaining = 0;
    this.emit("gameover", {
      score: this.score,
      lines: this.lines,
      pieceNumber: this.pieceNumber,
    });
  }

  emit(type, detail = {}) {
    this.events.push({type, detail});
  }

  drainEvents() {
    return this.events.splice(0);
  }

  snapshot() {
    return {
      board: this.board.map((row) => row.slice()),
      active: clonePiece(this.active),
      nextType: this.nextType,
      score: this.score,
      lines: this.lines,
      level: this.level,
      stats: this.stats.slice(),
      pendingGarbage: this.pendingGarbage,
      clearingRows: this.clearingRows.slice(),
      phaseRemaining: this.phaseRemaining,
      status: this.status,
      pausedStatus: this.pausedStatus || null,
      pieceNumber: this.pieceNumber,
    };
  }
}
