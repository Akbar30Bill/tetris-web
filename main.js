import {GameEngine, randomSeed} from "./game.js";
import {createRoomCode, formatRoomCode, makePeer, roomCodeFromInvite} from "./network.js";
import {TerminalRenderer} from "./render.js";

const menuScreen = document.querySelector("#menu-screen");
const connectScreen = document.querySelector("#connect-screen");
const gameScreen = document.querySelector("#game-screen");
const soloButton = document.querySelector("#solo-button");
const hostButton = document.querySelector("#host-button");
const joinButton = document.querySelector("#join-button");
const menuMessage = document.querySelector("#menu-message");
const canvas = document.querySelector("#game-canvas");
const modeLabel = document.querySelector("#mode-label");
const connectionLabel = document.querySelector("#connection-label");
const copyCodeButton = document.querySelector("#copy-code-button");
const readyButton = document.querySelector("#ready-button");
const leaveButton = document.querySelector("#leave-button");
const touchControls = document.querySelector("#touch-controls");
const connectRoleLabel = document.querySelector("#connect-role-label");
const connectStatus = document.querySelector("#connect-status");
const connectInstruction = document.querySelector("#connect-instruction");
const connectCode = document.querySelector("#connect-code");
const connectCopy = document.querySelector("#connect-copy");
const connectPaste = document.querySelector("#connect-paste");
const connectCancel = document.querySelector("#connect-cancel");

const renderer = new TerminalRenderer(canvas);
const SCORE_KEY = "vitetris-online-scores-v1";

let mode = "menu";
let engine = null;
let duel = null;
let peer = null;
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
  } catch { return []; }
}

function saveScore(score) {
  if (!Number.isFinite(score) || score <= 0) return;
  topScores.push(Math.floor(score));
  topScores.sort((a, b) => b - a);
  topScores = topScores.slice(0, 5);
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(topScores)); } catch {}
}

function showMenu(msg = "ARROWS TO MOVE   SPACE TO DROP") {
  cleanupDuel();
  mode = "menu";
  engine = null;
  gameScreen.hidden = true;
  connectScreen.hidden = true;
  menuScreen.hidden = false;
  menuMessage.textContent = msg;
  requestAnimationFrame(() => soloButton.focus());
}

function showConnect() {
  menuScreen.hidden = true;
  gameScreen.hidden = true;
  connectScreen.hidden = false;
  connectCode.value = "";
  connectCode.readOnly = false;
  connectCode.oninput = null;
  connectCopy.hidden = true;
  connectPaste.hidden = true;
}

function showGame() {
  menuScreen.hidden = true;
  connectScreen.hidden = true;
  gameScreen.hidden = false;
  lastFrame = performance.now();
  requestAnimationFrame(() => canvas.focus());
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

// --- Connection flow ---

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("Clipboard access unavailable"));
}

function copyFromField(text) {
  const fallback = document.createElement("input");
  fallback.value = text;
  fallback.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(fallback);
  fallback.select();
  fallback.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("Copy failed");
}

function inviteUrl(roomCode) {
  return `${location.origin}${location.pathname}#room=${formatRoomCode(roomCode)}`;
}

async function copyInvite(roomCode, button) {
  try {
    await copyText(inviteUrl(roomCode));
  } catch {
    copyFromField(inviteUrl(roomCode));
  }
  const original = button.textContent;
  button.textContent = "COPIED!";
  button.style.background = "#2ecc40";
  setTimeout(() => {
    button.textContent = original;
    button.style.background = "";
  }, 2000);
}

function wirePeer(role) {
  peer.onConnected = () => connected(role);
  peer.onDisconnected = () => {
    if (duel) duelDisconnected();
  };
  peer.onData = (data) => {
    if (data && data.type) receiveMessage(data);
  };
  peer.onError = (error) => {
    if (!duel) {
      connectStatus.textContent = "CONNECTION FAILED";
      connectInstruction.textContent = error?.message || "Could not connect to this room.";
    }
  };
  peer.onJoinRequest = () => {
    if (role !== "host" || duel) return;
    connectStatus.textContent = "PLAYER REQUESTING";
    connectInstruction.textContent = "PRESS ACCEPT PLAYER TO START THE DUEL";
    connectPaste.hidden = false;
    connectPaste.disabled = false;
    connectPaste.textContent = "ACCEPT PLAYER";
    connectPaste.onclick = () => {
      if (!peer?.acceptJoin()) return;
      connectStatus.textContent = "CONNECTING...";
      connectInstruction.textContent = "Opening the direct game link...";
      connectPaste.disabled = true;
      connectPaste.textContent = "ACCEPTED";
    };
  };
}

function startHost() {
  cleanupDuel();
  mode = "duel";
  showConnect();
  connectRoleLabel.textContent = "HOST";
  const roomCode = createRoomCode();
  peer = makePeer({roomCode, role: "host"});
  wirePeer("host");
  connectStatus.textContent = "ROOM READY";
  connectInstruction.textContent = "SHARE THIS CODE OR COPY THE INVITE LINK";
  connectCode.value = formatRoomCode(roomCode);
  connectCode.readOnly = true;
  connectCopy.hidden = false;
  connectCopy.textContent = "COPY INVITE";
  connectCopy.onclick = () => copyInvite(roomCode, connectCopy).catch(() => {
    connectStatus.textContent = "COPY FAILED";
  });
  connectPaste.hidden = true;
  connectCancel.onclick = showMenu;
}

function showJoin() {
  showConnect();
  connectRoleLabel.textContent = "GUEST";
  connectStatus.textContent = "ENTER ROOM CODE";
  connectInstruction.textContent = "PASTE AN INVITE LINK OR TYPE THE HOST'S CODE";
  connectCode.value = "";
  connectCode.placeholder = "ABC-DEFG-HIJ";
  connectCode.readOnly = false;
  connectCopy.hidden = true;
  connectPaste.hidden = false;
  connectPaste.textContent = "JOIN GAME";
  const updateJoin = () => {
    connectPaste.disabled = !roomCodeFromInvite(connectCode.value);
  };
  connectCode.oninput = updateJoin;
  updateJoin();
  connectPaste.onclick = () => startJoin(connectCode.value);
  connectCancel.onclick = showMenu;
}

function startJoin(rawRoomCode) {
  const roomCode = roomCodeFromInvite(rawRoomCode);
  if (!roomCode) {
    connectStatus.textContent = "INVALID ROOM CODE";
    return;
  }
  cleanupDuel();
  mode = "duel";
  showConnect();
  connectRoleLabel.textContent = "GUEST";
  connectStatus.textContent = "JOINING ROOM...";
  connectInstruction.textContent = "WAITING FOR THE HOST TO ACCEPT";
  connectCode.value = formatRoomCode(roomCode);
  connectCode.readOnly = true;
  connectCopy.hidden = true;
  connectPaste.hidden = true;
  peer = makePeer({roomCode, role: "guest"});
  wirePeer("guest");
  connectCancel.onclick = showMenu;
}

// --- Duel game session ---

function connected(role) {
  if (!duel) {
    const session = createSession(role, peer);
    duel = session;
  }
  duel.connected = true;
  duel.stage = duel.role === "host" ? "lobby" : "syncing";
  connectionLabel.textContent = `ROOM ${formatRoomCode(peer.roomCode)}`;
  copyCodeButton.hidden = false;
  copyCodeButton.textContent = "COPY INVITE";
  copyCodeButton.onclick = () => copyInvite(peer.roomCode, copyCodeButton).catch(() => {
    connectionLabel.textContent = "COPY FAILED";
  });
  readyButton.hidden = false;
  showGame();
  modeLabel.textContent = "ONLINE DUEL";
  if (duel.role === "host") {
    peer.send({type: "lobby", wins: duel.wins, round: duel.round, stage: duel.stage, lastWinner: duel.lastWinner});
  } else {
    peer.send({type: "requestLobby"});
  }
}

function createSession(role, p) {
  const session = {
    role,
    peer: p,
    roomCode: p.roomCode,
    connected: false,
    stage: "loading",
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
  };
  engine = new GameEngine({mode: "duel", seed: 1});
  return session;
}

function duelDisconnected() {
  if (!duel) return;
  if (duel.stage === "playing" && duel.role === "host" && !duel.topouts.has("host")) {
    registerTopout(duel, "host", performance.now() - duel.roundStartedAt);
  }
  duel.resumeStage = ["roundover", "matchover"].includes(duel.stage) ? duel.stage : "lobby";
  duel.connected = false;
  duel.localReady = false;
  duel.remoteReady = false;
  duel.remote = null;
  duel.stage = "disconnected";
  engine?.finish();
  connectionLabel.textContent = "LINK LOST";
}

function receiveMessage(data) {
  if (!duel) return;
  switch (data.type) {
    case "state":
      if (data.round !== duel.round || !data.view) return;
      const snapshot = sanitizeSnapshot(data.view);
      if (snapshot) duel.remote = snapshot;
      break;
    case "attack":
      if (data.round !== duel.round || typeof data.id !== "string") return;
      if (data.id.length > 64 || duel.seenAttacks.size >= 960) return;
      if (!["countdown", "playing"].includes(duel.stage) || duel.seenAttacks.has(data.id)) return;
      duel.seenAttacks.add(data.id);
      if (duel.seenAttacks.size > 480) duel.seenAttacks = new Set([...duel.seenAttacks].slice(-240));
      engine?.queueGarbage(Math.max(0, Math.min(3, Number(data.amount) || 0)));
      break;
    case "control":
    case "ready":
    case "start":
    case "topout":
    case "result":
      receiveControl(data);
      break;
    case "requestLobby":
      if (duel.role === "host") {
        peer.send({type: "lobby", wins: duel.wins, round: duel.round, stage: duel.stage, lastWinner: duel.lastWinner});
      }
      break;
    case "lobby":
      if (duel.role !== "guest" || ["countdown", "playing"].includes(duel.stage)) break;
      if (!Number.isInteger(Number(data.round)) || Number(data.round) < duel.round) break;
      duel.wins = normalizeWins(data.wins);
      duel.round = Number(data.round);
      duel.localReady = false;
      duel.lastWinner = ["host", "guest", "draw"].includes(data.lastWinner) ? data.lastWinner : null;
      duel.stage = ["roundover", "matchover"].includes(data.stage) ? data.stage : "lobby";
      duel.resumeStage = duel.stage;
      break;
  }
}

function receiveControl(data) {
  if (!duel) return;
  switch (data.type) {
    case "ready":
      if (!["lobby", "roundover", "matchover"].includes(duel.stage)) break;
      if (Number(data.round) !== duel.round) break;
      duel.remoteReady = true;
      if (duel.role === "host") maybeStartRound();
      break;
    case "start":
      if (duel.role !== "guest") break;
      if (!["lobby", "roundover", "matchover"].includes(duel.stage)) break;
      if (Number(data.round) !== duel.round + 1) break;
      if (!Number.isFinite(Number(data.startsIn))) break;
      duel.wins = normalizeWins(data.wins);
      prepareRound(Number(data.seed) >>> 0, Number(data.round), Math.max(500, Math.min(5000, Number(data.startsIn))));
      break;
    case "topout":
      if (duel.role === "host" && data.round === duel.round && duel.stage === "playing") {
        registerTopout(duel, "guest", Number(data.at));
      }
      break;
    case "result":
      if (duel.role === "guest" && data.round === duel.round && duel.stage === "playing") {
        applyResult(data);
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
  peer.send({type: "ready", round: duel.round});
  if (duel.role === "host") maybeStartRound();
}

function maybeStartRound() {
  if (duel.role !== "host" || !duel.localReady || !duel.remoteReady) return;
  if (!["lobby", "roundover", "matchover"].includes(duel.stage)) return;
  if (duel.stage === "matchover") duel.wins = {host: 0, guest: 0};
  const seed = randomSeed();
  const startsIn = 2000;
  const nextRound = duel.round + 1;
  peer.send({type: "start", seed, round: nextRound, startsIn, wins: duel.wins});
  prepareRound(seed, nextRound, startsIn);
}

function prepareRound(seed, round, startsIn) {
  if (!Number.isInteger(round) || round !== duel.round + 1) return;
  if (duel.resultTimer) clearTimeout(duel.resultTimer);
  duel.resultTimer = null;
  duel.round = round;
  duel.stage = "countdown";
  duel.localReady = false;
  duel.remoteReady = false;
  duel.remote = null;
  duel.topouts = new Map();
  duel.lastWinner = null;
  duel.attackSequence = 0;
  duel.seenAttacks = new Set();
  duel.startAt = performance.now() + startsIn;
  duel.roundStartedAt = duel.startAt;
  duel.lastStateSent = 0;
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
    const winner = Math.abs(entries[0][1] - entries[1][1]) <= 80 ? "draw" : entries[0][0] === "host" ? "guest" : "host";
    finishRound(session, winner);
    return;
  }
  const wait = Math.min(1000, Math.max(350, 200));
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
  peer.send({type: "result", round: session.round, winner, wins: session.wins, matchOver: session.stage === "matchover"});
}

function applyResult(data) {
  if (duel.resultTimer) clearTimeout(duel.resultTimer);
  duel.resultTimer = null;
  duel.wins = normalizeWins(data.wins);
  duel.lastWinner = ["host", "guest", "draw"].includes(data.winner) ? data.winner : "draw";
  duel.stage = data.matchOver ? "matchover" : "roundover";
  duel.resumeStage = duel.stage;
  duel.localReady = false;
  duel.remoteReady = false;
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
    if (mode !== "duel" || !duel || !peer?.connected) continue;
    if (event.type === "lines" && event.detail.garbage > 0 && duel.stage === "playing") {
      duel.attackSequence += 1;
      peer.send({type: "attack", round: duel.round, amount: event.detail.garbage, id: `${duel.round}:${duel.role}:${duel.attackSequence}`});
    }
    if (event.type === "gameover" && duel.stage === "playing") {
      sendState(true);
      const at = performance.now() - duel.roundStartedAt;
      if (duel.role === "host") registerTopout(duel, "host", at);
      else peer.send({type: "topout", round: duel.round, at});
    }
    if (event.type === "lock") sendState(true);
  }
}

function sendState(force = false) {
  if (!duel?.connected || !peer?.connected || !engine || !["countdown", "playing"].includes(duel.stage)) return;
  const now = performance.now();
  if (!force && now - duel.lastStateSent < 90) return;
  duel.lastStateSent = now;
  peer.send({type: "state", round: duel.round, view: engine.snapshot()});
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
  const canReady = mode === "duel" && duel?.connected && ["lobby", "roundover", "matchover"].includes(duel.stage);
  readyButton.hidden = !canReady;
  readyButton.disabled = !canReady || duel?.localReady;
  readyButton.textContent = duel?.localReady ? "READY SENT" : duel?.stage === "matchover" ? "REMATCH" : "READY";
}

function frame(now) {
  const elapsed = Math.min(120000, now - lastFrame);
  lastFrame = now;

  if (mode === "duel" && duel?.stage === "countdown" && now >= duel.startAt) {
    engine.start();
    duel.stage = "playing";
    sendState(true);
  }

  if (engine) {
    engine.tick(elapsed);
    processEngineEvents();
  }
  if (mode === "duel" && duel?.stage === "playing") sendState();
  updateReadyButton();
  render(now);
  requestAnimationFrame(frame);
}

function startOrApplyAction(action) {
  if (!engine) return;
  if (mode === "solo") {
    if (engine.status === "ready") { engine.start(); return; }
    if (engine.status === "gameover") { restartSolo(); return; }
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

// --- Event handlers ---

function cleanupDuel() {
  clearTouchRepeat();
  if (duel) {
    if (duel.resultTimer) clearTimeout(duel.resultTimer);
    duel = null;
  }
  if (peer) {
    peer.close();
    peer = null;
  }
  engine = null;
}

function clearTouchRepeat() {
  clearTimeout(touchStartTimer);
  clearInterval(touchRepeatTimer);
  touchStartTimer = null;
  touchRepeatTimer = null;
  for (const button of touchControls.querySelectorAll("button")) button.classList.remove("active");
}

window.addEventListener("keydown", (event) => {
  if (mode === "menu" || event.target instanceof HTMLInputElement) return;
  if (event.target instanceof HTMLButtonElement) {
    if (event.code === "Escape") { event.preventDefault(); showMenu(); }
    return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    if (mode === "duel" || !connectScreen.hidden) showMenu();
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

// --- UI button wiring ---

soloButton.addEventListener("click", startSolo);
hostButton.addEventListener("click", startHost);
joinButton.addEventListener("click", showJoin);

connectCancel.addEventListener("click", showMenu);

leaveButton.addEventListener("click", () => showMenu());
readyButton.addEventListener("click", markReady);

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

// --- URL hash auto-join ---

function handleHash() {
  if (mode !== "menu" || peer) return;
  const roomCode = roomCodeFromInvite(location.hash);
  if (roomCode) startJoin(roomCode);
}

window.addEventListener("hashchange", handleHash);
try { handleHash(); } catch (e) { console.warn("hash handler error", e); }

// --- Sanitize remote snapshots ---

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
    board, active, nextType,
    score: Math.max(0, Number(view.score) || 0),
    lines: Math.max(0, Math.min(9999, Number(view.lines) || 0)),
    level: Math.max(0, Math.min(99, Number(view.level) || 0)),
    stats: Array.isArray(view.stats) ? view.stats.slice(0, 7).map((v) => Math.max(0, Number(v) || 0)) : Array(7).fill(0),
    pendingGarbage: Math.max(0, Math.min(12, Number(view.pendingGarbage) || 0)),
    clearingRows,
    phaseRemaining: Math.max(0, Math.min(332, Number(view.phaseRemaining) || 0)),
    status: view.status,
    pausedStatus: ["running", "clearing", "spawning"].includes(view.pausedStatus) ? view.pausedStatus : null,
    pieceNumber: Math.max(0, Number(view.pieceNumber) || 0),
  };
}

if (new URLSearchParams(location.search).has("test")) {
  window.__vitetrisTest = {
    state() {
      return {
        mode,
        stage: duel?.stage || null,
        engineStatus: engine?.status || null,
        round: duel?.round || null,
        roomCode: duel?.roomCode || peer?.roomCode || null,
      };
    },
  };
}

requestAnimationFrame(frame);
