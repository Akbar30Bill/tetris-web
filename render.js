import {CLEAR_DELAY, COLS, PIECES, ROWS, cellsFor} from "./game.js";

const WIDTH = 560;
const HEIGHT = 416;
const CELL = 16;
const BOARD_Y = 64;
const BOARD_WIDTH = COLS * CELL;
const BOARD_HEIGHT = ROWS * CELL;

const COLORS = [
  "#000000",
  "#dd2222",
  "#d0d0d0",
  "#dd33dd",
  "#3333cc",
  "#11b891",
  "#d4b820",
  "#1db8b8",
];

const BG_COLORS = [
  "#000000",
  "#661111",
  "#606060",
  "#601960",
  "#141464",
  "#0a5a48",
  "#5a4d0e",
  "#0a5454",
];

const FRAME = "#3333ff";
const FRAME_DIM = "#0d0d6a";
const MAGENTA = "#ff42ff";
const YELLOW = "#ffe13a";
const WHITE = "#f0f0f0";
const GRAY = "#858595";
const RED = "#ff3030";

const EMPTY_VIEW = {
  board: Array.from({length: ROWS}, () => Array(COLS).fill(0)),
  active: null,
  nextType: 0,
  score: 0,
  lines: 0,
  level: 0,
  stats: Array(7).fill(0),
  pendingGarbage: 0,
  clearingRows: [],
  phaseRemaining: 0,
  status: "ready",
};

function pad(number, width) {
  return String(Math.max(0, number || 0)).padStart(width, "0").slice(-width);
}

function asView(source) {
  if (!source) return EMPTY_VIEW;
  const view = typeof source.snapshot === "function" ? source.snapshot() : source;
  return view && Array.isArray(view.board) ? view : EMPTY_VIEW;
}

export class TerminalRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", {alpha: false});
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = this.context;
    context.textBaseline = "top";
    context.imageSmoothingEnabled = false;
  }

  clear() {
    const context = this.context;
    context.fillStyle = "#000";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.lineWidth = 1;
  }

  text(value, x, y, color = WHITE, align = "left", size = 14, bold = true) {
    const context = this.context;
    context.fillStyle = color;
    context.font = `${bold ? "bold " : ""}${size}px "DejaVu Sans Mono", "Liberation Mono", monospace`;
    context.textAlign = align;
    context.fillText(String(value), Math.round(x), Math.round(y));
  }

  line(x1, y1, x2, y2, color = FRAME, width = 1) {
    const context = this.context;
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    context.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    context.stroke();
  }

  box(x, y, width, height, color = FRAME) {
    const context = this.context;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width - 1, height - 1);
  }

fillBox(x, y, width, height, color) {
    const context = this.context;
    context.fillStyle = color;
    context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  drawBlockCell(value, x, y) {
    const piece = PIECES[value - 1];
    if (!piece) return;
    const context = this.context;
    const rx = Math.round(x);
    const ry = Math.round(y);

    context.fillStyle = BG_COLORS[value];
    context.fillRect(rx, ry, CELL, CELL);

    context.fillStyle = COLORS[value];
    context.fillRect(rx, ry, CELL, 1);
    context.fillRect(rx, ry, 1, CELL);

    context.fillStyle = WHITE;
    context.font = "bold 13px monospace";
    context.textAlign = "center";
    context.fillText(piece.texture, rx + 8, ry + 2);
    context.textAlign = "left";
  }

  drawBoardBackground(x) {
    const context = this.context;
    const bx = Math.round(x);
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLS; column += 1) {
        const cellX = bx + column * CELL;
        const cellY = BOARD_Y + row * CELL;
        context.fillStyle = FRAME_DIM;
        context.fillRect(cellX + (column % 2 ? 11 : 4), cellY + 9, 1, 1);
      }
    }
  }

  drawBoard(source, x, {message = "", showMarker = true} = {}) {
    const view = asView(source);
    const activeCells = new Map();
    for (const cell of cellsFor(view.active)) {
      if (cell.y >= 0) activeCells.set(`${cell.x},${cell.y}`, view.active.type + 1);
    }

    this.drawBoardBackground(x);

    const isClearing = view.status === "clearing"
      || (view.status === "paused" && view.pausedStatus === "clearing");
    const clearProgress = isClearing
      ? Math.min(1, Math.max(0, 1 - view.phaseRemaining / CLEAR_DELAY))
      : 0;
    const clearStep = Math.floor(clearProgress * 5);

    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLS; column += 1) {
        const cellX = x + column * CELL;
        const cellY = BOARD_Y + row * CELL;
        const clearing = isClearing && Array.isArray(view.clearingRows) && view.clearingRows.includes(row)
          && column >= 4 - clearStep
          && column <= 5 + clearStep;
        const active = activeCells.get(`${column},${row}`);
        const value = clearing ? 0 : active || view.board?.[row]?.[column] || 0;
        if (value) {
          this.drawBlockCell(value, cellX, cellY);
        }
      }
    }

    this.box(x - 2, BOARD_Y - 2, BOARD_WIDTH + 4, BOARD_HEIGHT + 4, FRAME);

    this.drawNext(view.nextType, x + 48, 4);
    if (showMarker) this.drawDropMarker(view.active, x);
    if (message) this.drawMessage(message, x, BOARD_Y + 116, BOARD_WIDTH);
  }

  drawDropMarker(piece, boardX) {
    const cells = cellsFor(piece);
    if (!cells.length) return;
    const columns = [...new Set(cells.map((cell) => cell.x).filter((x) => x >= 0 && x < COLS))];
    const y = BOARD_Y + BOARD_HEIGHT + 4;
    for (let column = 0; column < COLS; column += 1) {
      this.text(columns.includes(column) ? "==" : "**", boardX + column * CELL, y, FRAME, "left", 12);
    }
  }

  drawNext(type, x, y) {
    this.fillBox(x - 8, y, 80, 52, "#050510");
    this.box(x - 8, y, 80, 52, FRAME);
    this.fillBox(x - 6, y, 76, 16, "#050510");
    this.text("NEXT", x + 32, y + 3, MAGENTA, "center", 10);
    const piece = {type: Number.isInteger(type) && PIECES[type] ? type : 0, rotation: 0, x: 0, y: 0};
    const cells = cellsFor(piece);
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    const pieceWidth = (maxX - minX + 1) * CELL;
    const pieceHeight = (maxY - minY + 1) * CELL;
    const offsetX = Math.round(x + 32 - pieceWidth / 2);
    const availableY = y + 21;
    const offsetY = Math.round(availableY + (50 - availableY - pieceHeight) / 2);
    for (const cell of cells) {
      this.drawBlockCell(piece.type + 1, offsetX + (cell.x - minX) * CELL, offsetY + (cell.y - minY) * CELL);
    }
  }

  drawMessage(message, x, y, width) {
    const value = String(message).toUpperCase();
    const boxWidth = Math.min(width - 16, Math.max(88, value.length * 8 + 20));
    const boxX = x + (width - boxWidth) / 2;
    this.fillBox(Math.round(boxX), y, boxWidth, 34, "#000");
    this.box(boxX, y, boxWidth, 34, MAGENTA);
    this.text(value, boxX + boxWidth / 2, y + 10, MAGENTA, "center", 12);
  }

  renderSolo(source, {message = "", topScores = []} = {}) {
    const view = asView(source);
    this.clear();
    this.drawBoard(view, 200, {message});
    this.drawSoloPanel(view, 88, 80);
    this.drawTopScores(topScores, 390, 82);
    this.drawStats(view.stats, 394, 202);
  }

  drawSoloPanel(view, x, y) {
    const color = COLORS[(view.level % 6) + 1];
    const values = [pad(view.score % 1000000, 6), pad(view.level, 2), pad(view.lines, 3)];
    const labels = ["Score", "Level", "Lines"];
    this.fillBox(x, y, 82, 192, "#050510");
    this.box(x, y, 82, 192, color);
    for (let index = 0; index < 3; index += 1) {
      const top = y + index * 64;
      if (index) this.line(x, top, x + 81, top, color);
      this.text(labels[index], x + 41, top + 6, MAGENTA, "center", 11);
      this.text(values[index], x + 41, top + 32, WHITE, "center", 14);
    }
  }

  drawTopScores(scores, x, y) {
    this.text("Top Scores", x, y - 2, MAGENTA, "left", 12);
    const normalized = scores.length ? scores.slice(0, 5) : [0, 0, 0, 0, 0];
    normalized.forEach((score, index) => {
      this.text(`${index + 1}. ${pad(score % 1000000, 6)}`, x, y + 18 + index * 17, WHITE, "left", 11, false);
    });
  }

  drawStats(stats = [], x, y) {
    let sum = 0;
    PIECES.forEach((piece, index) => {
      const count = stats[index] || 0;
      sum += count;
      this.text(piece.texture[0] + piece.name + piece.texture[1], x, y - 2 + index * 17, COLORS[index + 1], "left", 11);
      this.text(pad(count, 3), x + 47, y - 2 + index * 17, WHITE, "left", 11, false);
    });
    this.text("  -----", x, y + 118, GRAY, "left", 11, false);
    this.text(`SUM ${pad(sum, 4)}`, x, y + 136, WHITE, "left", 11, false);
  }

  renderDuel(localSource, remoteSource, {
    localWins = 0,
    remoteWins = 0,
    localMessage = "",
    remoteMessage = "",
  } = {}) {
    const local = asView(localSource);
    const remote = asView(remoteSource);
    this.clear();
    this.drawBoard(local, 56, {message: localMessage});
    this.drawBoard(remote, 344, {message: remoteMessage, showMarker: false});
    this.drawDuelPanel(local, remote, 240, 82, localWins, remoteWins);
    this.drawGarbageMeter(local.pendingGarbage || 0, 222, 256, false);
    this.drawGarbageMeter(remote.pendingGarbage || 0, 330, 256, true);
  }

  drawDuelPanel(local, remote, x, y, localWins, remoteWins) {
    const labels = ["Wins", "Level", "Lines"];
    const leftValues = [localWins, local.level || 0, local.lines || 0];
    const rightValues = [remoteWins, remote.level || 0, remote.lines || 0];
    this.fillBox(x, y, 80, 192, "#050510");
    this.box(x, y, 80, 192, FRAME);
    this.line(x + 40, y, x + 40, y + 192, FRAME_DIM);
    for (let index = 0; index < 3; index += 1) {
      const top = y + index * 64;
      if (index) this.line(x, top, x + 79, top, FRAME);
      this.fillBox(x + 13, top + 3, 54, 17, "#000");
      this.text(labels[index], x + 40, top + 4, MAGENTA, "center", 10);
      const width = index === 0 ? 1 : 2;
      this.text(pad(leftValues[index], width), x + 21, top + 30, WHITE, "center", 13);
      this.text(pad(rightValues[index], width), x + 60, top + 30, WHITE, "center", 13);
    }
  }

  drawGarbageMeter(count, x, bottom, faceRight) {
    const shown = Math.min(7, count);
    for (let index = 0; index < 7; index += 1) {
      const filled = index < shown;
      this.text(filled ? "^^" : "  ", x, bottom - index * 16, RED, faceRight ? "left" : "right", 11);
    }
    if (count) this.text(pad(count, 2), x + (faceRight ? 0 : -16), bottom + 6, RED, "left", 10);
  }
}