import {GameEngine, randomSeed} from "./game.js";
import {DuelConnection} from "./network.js";
import {TerminalRenderer} from "./render.js";

const menuScreen = document.querySelector("#menu-screen");
const gameScreen = document.querySelector("#game-screen");
const soloButton = document.querySelector("#solo-button");
const createButton = document.querySelector("#create-button");
const joinForm = document.querySelector("#join-form");
const roomInput = document.querySelector("#room-code");
const menuMessage = document.querySelector("#menu-message");
const canvas = document.querySelector("#game-canvas");
const modeLabel = document.querySelector("#mode-label");
const connectionLabel = document.querySelector("#connection-label");
const copyCodeButton = document.querySelector("#copy-code-button");
const readyButton = document.querySelector("#ready-button");
const leaveButton = document.querySelector("#leave-button");
const touchControls = document.querySelector("#touch-controls");

const renderer = new TerminalRenderer(canvas);
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SCORE_KEY = "vitetris-online-scores-v1";

let mode = "menu";
let engine = null;
let duel = null;
let pendingLeave = Promise.resolve();
let topScores = loadScores();
let soloScoreRecorded = false;
let lastFrame = performance.now();
let touchStartTimer = null;
let touchRepeatTimer = null;

function loadScores() {
  try {
    const values = JSON.parse(localStorage.getItem(SCORE_KEY) || "[]");
    return Array.isArray(values)
      ? values.filter(Number.isFinite).map(Number).sort((a, b) => b - a).slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function saveScore(score) {
  if (!Number.isFinite(score) || score <= 0) return;
  topScores.push(Math.floor(score));
  topScores.sort((a, b) => b - a);
  topScores = topScores.slice(0, 5);
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(topScores));
  } catch {
    // A private browsing policy can disable storage without affecting play.
  }
}

function makeRoomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function normalizeRoomCode(value) {
  return String(value).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
}

function sanitizeSnapshot(view) {
  if (!view || typeof view !== "object" || !Array.isArray(view.board) || view.board.length !== 20) return null;
  const board = [];
  for (const sourceRow of view.board) {
    if (!Array.isArray(sourceRow) || sourceRow.length !== 10) return null;
    const row = sourceRow.map(Number);
    if (row.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 7)) return null;
    board.push(row);
  }

  let active = null;
  if (view.active !== null && view.active !== undefined) {
    const candidate = view.active;
    const rotations = [2, 4, 4, 1, 2, 4, 2];
    if (!candidate || !Number.isInteger(candidate.type) || candidate.type < 0 || candidate.type > 6) return null;
    if (!Number.isInteger(candidate.rotation) || candidate.rotation < 0 || candidate.rotation >= rotations[candidate.type]) return null;
    if (!Number.isInteger(candidate.x) || candidate.x < -4 || candidate.x > 10) return null;
    if (!Number.isInteger(candidate.y) || candidate.y < -4 || candidate.y > 20) return null;
    active = {type: candidate.type, rotation: candidate.rotation, x: candidate.x, y: candidate.y};
  }

  const statuses = new Set(["ready", "running", "paused", "clearing", "spawning", "gameover", "roundover"]);
  if (!statuses.has(view.status)) return null;
  const nextType = Number(view.nextType);
  if (!Number.isInteger(nextType) || nextType < 0 || nextType > 6) return null;
  const clearingRows = Array.isArray(view.clearingRows)
    ? [...new Set(view.clearingRows.map(Number))].filter((row) => Number.isInteger(row) && row >= 0 && row < 20)
    : [];

  return {
    board,
    active,
    nextType,
    score: Math.max(0, Number(view.score) || 0),
    lines: Math.max(0, Math.min(9999, Number(view.lines) || 0)),
    level: Math.max(0, Math.min(99, Number(view.level) || 0)),
    stats: Array.isArray(view.stats) ? view.stats.slice(0, 7).map((value) => Math.max(0, Number(value) || 0)) : Array(7).fill(0),
    pendingGarbage: Math.max(0, Math.min(12, Number(view.pendingGarbage) || 0)),
    clearingRows,
    phaseRemaining: Math.max(0, Math.min(332, Number(view.phaseRemaining) || 0)),
    status: view.status,
    pausedStatus: ["running", "clearing", "spawning"].includes(view.pausedStatus) ? view.pausedStatus : null,
    pieceNumber: Math.max(0, Number(view.pieceNumber) || 0),
  };
}

function showGame() {
  menuScreen.hidden = true;
  gameScreen.hidden = false;
  lastFrame = performance.now();
  requestAnimationFrame(() => canvas.focus());
}

function showMenu(message = "ARROWS TO MOVE   SPACE TO DROP") {
  cleanupDuel();
  mode = "menu";
  engine = null;
  gameScreen.hidden = true;
  menuScreen.hidden = false;
  menuMessage.textContent = message;
  copyCodeButton.hidden = true;
  readyButton.hidden = true;
  connectionLabel.textContent = "";
  requestAnimationFrame(() => soloButton.focus());
}

function startSolo() {
  cleanupDuel();
  mode = "solo";
  soloScoreRecorded = false;
  engine = new GameEngine({mode: "solo", seed: randomSeed()});
  modeLabel.textContent = "SOLO";
  connectionLabel.textContent = "LOCAL GAME";
  copyCodeButton.hidden = true;
  readyButton.hidden = true;
  showGame();
}

function restartSolo() {
  soloScoreRecorded = false;
  engine = new GameEngine({mode: "solo", seed: randomSeed()});
  engine.start();
}

function setupDuelConnection(session) {
  const {connection} = session;
  const current = () => duel === session;

  connection.on("waiting", () => {
    if (!current()) return;
    session.stage = "connecting";
    connectionLabel.textContent = "SEARCHING PUBLIC RELAYS";
  });

  connection.on("connected", async () => {
    if (!current()) return;
    const connectedPeer = connection.peerId;
    session.connected = true;
    session.localReady = false;
    session.remoteReady = false;
    session.remote = null;
    session.stage = ["roundover", "matchover"].includes(session.resumeStage)
      ? session.resumeStage
      : session.role === "host" ? "lobby" : "syncing";
    connectionLabel.textContent = "DIRECT LINK";
    if (session.role === "host") {
      connection.sendControl({
        type: "lobby",
        wins: session.wins,
        round: session.round,
        stage: session.stage,
        lastWinner: session.lastWinner,
      });
    } else {
      connection.sendControl({type: "requestLobby"});
    }
    if (session.latency === null) {
      const latency = await connection.ping();
      if (!current() || connection.peerId !== connectedPeer || latency === null) return;
      session.latency = Math.round(latency);
      connectionLabel.textContent = `DIRECT LINK  ${session.latency}MS`;
      if (session.role === "host" && session.latency !== null) maybeStartRound(session);
    }
  });

  connection.on("state", (data) => {
    if (!current() || !data || data.round !== session.round || !data.view) return;
    const snapshot = sanitizeSnapshot(data.view);
    if (snapshot) session.remote = snapshot;
  });

  connection.on("attack", (data) => {
    if (!current() || !data || data.round !== session.round || typeof data.id !== "string") return;
    if (data.id.length > 64 || session.seenAttacks.size >= 960) return;
    if (!["countdown", "playing"].includes(session.stage) || session.seenAttacks.has(data.id)) return;
    session.seenAttacks.add(data.id);
    if (session.seenAttacks.size > 480) session.seenAttacks = new Set([...session.seenAttacks].slice(-240));
    session.seenAttacks.add(data.id);
    engine?.queueGarbage(Math.max(0, Math.min(3, Number(data.amount) || 0)));
  });

  connection.on("control", (data) => {
    if (!current()) return;
    receiveDuelControl(session, data);
  });

  connection.on("disconnected", () => {
    if (!current()) return;
    if (session.stage === "playing" && session.role === "host" && !session.topouts.has("host")) {
      registerTopout(session, "host", performance.now() - session.roundStartedAt);
    }
    session.resumeStage = ["roundover", "matchover"].includes(session.stage) ? session.stage : "lobby";
    session.connected = false;
    session.localReady = false;
    session.remoteReady = false;
    session.remote = null;
    session.latency = null;
    session.stage = "disconnected";
    engine?.finish();
    connectionLabel.textContent = "CONNECTION LOST";
  });

  connection.on("error", ({message}) => {
    if (!current()) return;
    session.error = message;
    session.localReady = false;
    session.remoteReady = false;
    session.stage = "error";
    engine?.finish();
    connectionLabel.textContent = "CONNECTION FAILED";
  });
}

async function startDuel(role, code) {
  const leavePromise = cleanupDuel();
  mode = "duel";
  const connection = new DuelConnection({code, role});
  const session = {
    role,
    code,
    connection,
    connected: false,
    stage: "loading",
    error: "",
    remote: null,
    wins: {host: 0, guest: 0},
    round: 0,
    localReady: false,
    remoteReady: false,
    startAt: 0,
    roundStartedAt: 0,
    topouts: new Map(),
    resultTimer: null,
    lastWinner: null,
    resumeStage: "lobby",
    attackSequence: 0,
    seenAttacks: new Set(),
    lastStateSent: 0,
    latency: null,
  };
  duel = session;
  engine = new GameEngine({mode: "duel", seed: 1});
  modeLabel.textContent = "ONLINE DUEL";
  connectionLabel.textContent = "LOADING PEER NETWORK";
  copyCodeButton.hidden = false;
  copyCodeButton.textContent = "COPY INVITE LINK";
  setupDuelConnection(session);
  showGame();

  try {
    await leavePromise;
    if (duel !== session) return;
    await connection.connect();
  } catch (error) {
    if (duel !== session) return;
    session.error = error.message;
    session.stage = "error";
    connectionLabel.textContent = "CONNECTION FAILED";
  }
}

function cleanupDuel() {
  clearTouchRepeat();
  if (!duel) return pendingLeave;
  if (duel.resultTimer) clearTimeout(duel.resultTimer);
  pendingLeave = Promise.allSettled([pendingLeave, Promise.resolve(duel.connection.leave()).catch(() => {})]);
  duel = null;
  return pendingLeave;
}

function receiveDuelControl(session, data) {
  if (!data || typeof data.type !== "string") return;
  switch (data.type) {
    case "requestLobby":
      if (session.role === "host") {
        session.connection.sendControl({
          type: "lobby",
          wins: session.wins,
          round: session.round,
          stage: session.stage,
          lastWinner: session.lastWinner,
        });
      }
      break;
    case "lobby":
      if (session.role !== "guest" || ["countdown", "playing"].includes(session.stage)) break;
      if (!Number.isInteger(Number(data.round)) || Number(data.round) < session.round) break;
      session.wins = normalizeWins(data.wins);
      session.round = Number(data.round);
      session.localReady = false;
      session.lastWinner = ["host", "guest", "draw"].includes(data.lastWinner) ? data.lastWinner : null;
      session.stage = ["roundover", "matchover"].includes(data.stage) ? data.stage : "lobby";
      session.resumeStage = session.stage;
      break;
    case "ready":
      if (!["lobby", "roundover", "matchover"].includes(session.stage)) break;
      if (Number(data.round) !== session.round) break;
      session.remoteReady = true;
      if (session.role === "host") maybeStartRound(session);
      break;
    case "start":
      if (session.role !== "guest") break;
      if (!["lobby", "roundover", "matchover"].includes(session.stage)) break;
      if (Number(data.round) !== session.round + 1) break;
      if (!Number.isFinite(Number(data.startsIn))) break;
      session.wins = normalizeWins(data.wins);
      prepareRound(
        session,
        Number(data.seed) >>> 0,
        Number(data.round),
        Math.max(500, Math.min(5000, Number(data.startsIn) - Number(data.oneWay || 0))),
      );
      break;
    case "topout":
      if (session.role === "host" && data.round === session.round && session.stage === "playing") {
        registerTopout(session, "guest", Number(data.at));
      }
      break;
    case "result":
      if (session.role === "guest" && data.round === session.round && session.stage === "playing") {
        applyRoundResult(session, data);
      }
      break;
  }
}

function normalizeWins(wins) {
  return {
    host: Math.max(0, Math.min(3, Number(wins?.host) || 0)),
    guest: Math.max(0, Math.min(3, Number(wins?.guest) || 0)),
  };
}

function markReady() {
  if (!duel?.connected || !["lobby", "roundover", "matchover"].includes(duel.stage)) return;
  if (duel.localReady) return;
  duel.localReady = true;
  duel.connection.sendControl({type: "ready", round: duel.round});
  if (duel.role === "host") maybeStartRound(duel);
}

function maybeStartRound(session) {
  if (session.role !== "host" || !session.localReady || !session.remoteReady) return;
  if (!["lobby", "roundover", "matchover"].includes(session.stage)) return;
  if (session.latency === null) return;
  if (session.stage === "matchover") session.wins = {host: 0, guest: 0};

  const seed = randomSeed();
  const startsIn = 2000;
  const nextRound = session.round + 1;
  const oneWay = Math.round((session.latency || 0) / 2);
  session.connection.sendControl({
    type: "start",
    seed,
    round: nextRound,
    startsIn,
    oneWay,
    wins: session.wins,
  }, true);
  prepareRound(session, seed, nextRound, startsIn);
}

function prepareRound(session, seed, round, startsIn) {
  if (!Number.isInteger(round) || round !== session.round + 1) return;
  if (session.resultTimer) clearTimeout(session.resultTimer);
  session.resultTimer = null;
  session.round = round;
  session.stage = "countdown";
  session.localReady = false;
  session.remoteReady = false;
  session.remote = null;
  session.topouts = new Map();
  session.lastWinner = null;
  session.attackSequence = 0;
  session.seenAttacks = new Set();
  session.startAt = performance.now() + startsIn;
  session.roundStartedAt = session.startAt;
  session.lastStateSent = 0;
  engine = new GameEngine({mode: "duel", seed});
}

function registerTopout(session, role, reportedAt = performance.now() - session.roundStartedAt) {
  if (session.stage !== "playing" || session.topouts.has(role)) return;
  const at = Number.isFinite(reportedAt) ? Math.max(0, reportedAt) : performance.now() - session.roundStartedAt;
  session.topouts.set(role, at);
  if (session.topouts.size > 1) {
    if (session.resultTimer) clearTimeout(session.resultTimer);
    session.resultTimer = null;
    const entries = [...session.topouts.entries()].sort((a, b) => a[1] - b[1]);
    const winner = Math.abs(entries[0][1] - entries[1][1]) <= 80
      ? "draw"
      : entries[0][0] === "host" ? "guest" : "host";
    finishRound(session, winner);
    return;
  }
  const wait = Math.min(1000, Math.max(350, (session.latency || 0) * 2 + 100));
  session.resultTimer = setTimeout(() => {
    session.resultTimer = null;
    if (duel !== session || session.stage !== "playing") return;
    finishRound(session, role === "host" ? "guest" : "host");
  }, wait);
}

function finishRound(session, winner) {
  if (session.role !== "host" || session.stage !== "playing") return;
  if (winner === "host" || winner === "guest") session.wins[winner] += 1;
  session.lastWinner = winner;
    session.stage = winner !== "draw" && session.wins[winner] >= 3 ? "matchover" : "roundover";
    session.resumeStage = session.stage;
    session.localReady = false;
    session.remoteReady = false;
    engine?.finish();
    const result = {
      type: "result",
      round: session.round,
      winner,
      wins: session.wins,
      matchOver: session.stage === "matchover",
    };
    session.connection.sendControl(result, true);
}

function applyRoundResult(session, data) {
  if (session.resultTimer) clearTimeout(session.resultTimer);
  session.resultTimer = null;
  session.wins = normalizeWins(data.wins);
  session.lastWinner = ["host", "guest", "draw"].includes(data.winner) ? data.winner : "draw";
  session.stage = data.matchOver ? "matchover" : "roundover";
  session.resumeStage = session.stage;
  session.localReady = false;
  session.remoteReady = false;
  engine?.finish();
}

function processEngineEvents() {
  if (!engine) return;
  for (const event of engine.drainEvents()) {
    if (mode === "solo") {
      if (event.type === "gameover" && !soloScoreRecorded) {
        soloScoreRecorded = true;
        saveScore(event.detail.score);
      }
      continue;
    }

    if (mode !== "duel" || !duel) continue;
    if (event.type === "lines" && event.detail.garbage > 0 && duel.stage === "playing") {
      duel.attackSequence += 1;
      duel.connection.sendAttack({
        round: duel.round,
        amount: event.detail.garbage,
        id: `${duel.round}:${duel.role}:${duel.attackSequence}`,
      });
    }
    if (event.type === "gameover" && duel.stage === "playing") {
      sendDuelState(performance.now(), true);
      const at = performance.now() - duel.roundStartedAt;
      if (duel.role === "host") registerTopout(duel, "host", at);
      else duel.connection.sendControl({type: "topout", round: duel.round, at});
    }
    if (event.type === "lock") sendDuelState(performance.now(), true);
  }
}

function sendDuelState(now, force = false) {
  if (!duel?.connected || !engine || !["countdown", "playing"].includes(duel.stage)) return;
  if (!force && now - duel.lastStateSent < 90) return;
  duel.lastStateSent = now;
  duel.connection.sendState({round: duel.round, view: engine.snapshot()});
}

function soloMessage() {
  if (!engine) return "";
  if (engine.status === "ready") return "PRESS KEY";
  if (engine.status === "paused") return "-- PAUSE --";
  if (engine.status === "gameover") return "GAME OVER";
  return "";
}

function duelMessages(now) {
  if (!duel) return {localMessage: "", remoteMessage: ""};
  switch (duel.stage) {
    case "loading":
      return {localMessage: `ROOM ${duel.code}`, remoteMessage: "LOADING"};
    case "connecting":
      return {localMessage: `ROOM ${duel.code}`, remoteMessage: "WAITING"};
    case "error":
      return {localMessage: "CONNECTION FAILED", remoteMessage: "RETRY"};
    case "disconnected":
      return {localMessage: "LINK LOST", remoteMessage: "OFFLINE"};
    case "lobby":
    case "syncing":
      return {
        localMessage: duel.stage === "syncing" ? "SYNCING" : duel.localReady ? "READY" : "PRESS ENTER",
        remoteMessage: duel.remoteReady ? "READY" : "WAITING",
      };
    case "countdown": {
      const count = Math.max(1, Math.ceil((duel.startAt - now) / 1000));
      return {localMessage: String(count), remoteMessage: String(count)};
    }
    case "playing":
      return {
        localMessage: engine?.status === "gameover" ? "TOP OUT" : "",
        remoteMessage: duel.remote?.status === "gameover" ? "TOP OUT" : "",
      };
    case "roundover":
    case "matchover": {
      if (duel.lastWinner === "draw") return {localMessage: "DRAW", remoteMessage: "DRAW"};
      const localWon = duel.lastWinner === duel.role;
      return {
        localMessage: duel.stage === "matchover"
          ? localWon ? "MATCH WIN!" : "MATCH LOST"
          : localWon ? "YOU WIN!" : "YOU LOSE",
        remoteMessage: localWon ? "YOU LOSE" : "YOU WIN!",
      };
    }
    default:
      return {localMessage: "", remoteMessage: ""};
  }
}

function render(now) {
  if (mode === "solo" && engine) {
    renderer.renderSolo(engine, {message: soloMessage(), topScores});
    return;
  }
  if (mode === "duel" && duel && engine) {
    const messages = duelMessages(now);
    const localWins = duel.wins[duel.role];
    const remoteRole = duel.role === "host" ? "guest" : "host";
    renderer.renderDuel(engine, duel.remote, {
      localWins,
      remoteWins: duel.wins[remoteRole],
      ...messages,
    });
  }
}

function updateReadyButton() {
  const canReady = mode === "duel"
    && duel?.connected
    && ["lobby", "roundover", "matchover"].includes(duel.stage);
  readyButton.hidden = !canReady;
  readyButton.disabled = !canReady || duel?.localReady || duel?.stage === "syncing";
  readyButton.textContent = duel?.localReady ? "READY SENT" : duel?.stage === "matchover" ? "REMATCH" : "READY";
}

function frame(now) {
  const elapsed = Math.min(120000, now - lastFrame);
  lastFrame = now;

  if (mode === "duel" && duel?.stage === "countdown" && now >= duel.startAt) {
    engine.start();
    duel.stage = "playing";
    sendDuelState(now, true);
  }

  if (engine) {
    engine.tick(elapsed);
    processEngineEvents();
  }
  if (mode === "duel" && duel?.stage === "playing") sendDuelState(now);
  updateReadyButton();
  render(now);
  requestAnimationFrame(frame);
}

function startOrApplyAction(action) {
  if (!engine) return;
  if (mode === "solo") {
    if (engine.status === "ready") {
      engine.start();
      return;
    }
    if (engine.status === "gameover") {
      restartSolo();
      return;
    }
    engine.input(action);
    return;
  }
  if (mode === "duel" && duel?.stage === "playing") engine.input(action);
}

function keyAction(code) {
  switch (code) {
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "ArrowDown": return "softDrop";
    case "ArrowUp":
    case "KeyA":
    case "KeyX": return "rotateCW";
    case "KeyB":
    case "KeyZ": return "rotateCCW";
    case "Space": return "hardDrop";
    default: return null;
  }
}

window.addEventListener("keydown", (event) => {
  if (mode === "menu" || event.target instanceof HTMLInputElement) return;
  if (event.target instanceof HTMLButtonElement) {
    if (event.code === "Escape") {
      event.preventDefault();
      showMenu();
    }
    return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    showMenu();
    return;
  }
if (event.code === "Enter") {
      event.preventDefault();
      if (mode === "solo") {
        if (engine.status === "ready") engine.start();
        else if (engine.status === "gameover") restartSolo();
        else if (engine.status === "paused") engine.pause();
      } else {
        markReady();
      }
    return;
  }
  if (event.code === "KeyP" && mode === "solo") {
    event.preventDefault();
    engine.pause();
    return;
  }
  const action = keyAction(event.code);
  if (!action) return;
  event.preventDefault();
  if (event.repeat && !["left", "right", "softDrop"].includes(action)) return;
  startOrApplyAction(action);
});

function clearTouchRepeat() {
  clearTimeout(touchStartTimer);
  clearInterval(touchRepeatTimer);
  touchStartTimer = null;
  touchRepeatTimer = null;
  for (const button of touchControls.querySelectorAll("button")) button.classList.remove("active");
}

touchControls.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  event.preventDefault();
  clearTouchRepeat();
  button.classList.add("active");
  button.setPointerCapture(event.pointerId);
  const action = button.dataset.action;
  startOrApplyAction(action);
  if (!["left", "right", "softDrop"].includes(action)) return;
  touchStartTimer = setTimeout(() => {
    touchRepeatTimer = setInterval(() => startOrApplyAction(action), 58);
  }, 190);
});

for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  touchControls.addEventListener(eventName, clearTouchRepeat);
}

soloButton.addEventListener("click", startSolo);
createButton.addEventListener("click", () => startDuel("host", makeRoomCode()));
joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeRoomCode(roomInput.value);
  roomInput.value = code;
  if (code.length !== 8) {
    menuMessage.textContent = "ENTER THE FULL 8-CHARACTER ROOM CODE";
    roomInput.focus();
    return;
  }
  startDuel("guest", code);
});
roomInput.addEventListener("input", () => {
  roomInput.value = normalizeRoomCode(roomInput.value);
});
leaveButton.addEventListener("click", () => showMenu());
readyButton.addEventListener("click", markReady);
copyCodeButton.addEventListener("click", async () => {
  if (!duel) return;
  const session = duel;
  const link = `${location.origin}${location.pathname}#join=${session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    if (duel !== session) return;
    copyCodeButton.textContent = "LINK COPIED";
    setTimeout(() => {
      if (duel === session) copyCodeButton.textContent = "COPY INVITE LINK";
    }, 3000);
  } catch {
    if (duel === session) copyCodeButton.textContent = "COPY INVITE LINK";
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastFrame = performance.now();
    if (mode !== "menu") canvas.focus();
    return;
  }
  if (mode === "solo" && ["running", "clearing", "spawning"].includes(engine?.status)) {
    engine.pause();
  }
});

const joinParam = location.hash.match(/^#join=([A-Z2-9]{8})$/i);
if (joinParam) {
  const code = joinParam[1].toUpperCase();
  roomInput.value = code;
  history.replaceState(null, "", location.pathname);
  requestAnimationFrame(() => startDuel("guest", code));
}

requestAnimationFrame(frame);
