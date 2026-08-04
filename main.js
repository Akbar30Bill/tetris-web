import {GameEngine, randomSeed} from "./game.js";
import {makePeer, encodeSDP, decodeSDP} from "./network.js";
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
const connectTextarea = document.querySelector("#connect-textarea");
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
  connectTextarea.value = "";
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
  return navigator.clipboard.writeText(text);
}

function copyFromTextarea(ta) {
  const range = document.createRange();
  range.selectNodeContents(ta);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  ta.setSelectionRange(0, ta.value.length);
  const ok = document.execCommand("copy");
  sel.removeAllRanges();
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}

async function startHost() {
  cleanupDuel();
  mode = "duel";
  showConnect();
  connectRoleLabel.textContent = "HOST";
  connectStatus.textContent = "CREATING OFFER...";
  connectInstruction.textContent = "Creating a direct connection offer...";
  connectTextarea.placeholder = "Generating...";
  connectCopy.hidden = true;
  connectPaste.hidden = true;

  peer = makePeer();
  let offerSdp;
  try {
    offerSdp = await peer.createOffer();
  } catch (err) {
    connectStatus.textContent = "FAILED: " + err.message;
    return;
  }

  const encoded = encodeSDP(offerSdp);
  connectStatus.textContent = "OFFER READY";
  connectInstruction.textContent = "COPY THIS TEXT AND SEND IT TO THE OTHER PLAYER";
  connectTextarea.value = encoded;
  connectTextarea.readOnly = false;
  connectCopy.hidden = false;
  connectCopy.textContent = "COPY";
  connectCopy.onclick = async () => {
    try {
      await copyText(encoded);
    } catch {
      connectTextarea.select();
      connectTextarea.setSelectionRange(0, encoded.length);
      await copyFromTextarea(connectTextarea);
    }
    connectCopy.textContent = "COPIED!";
    connectCopy.style.background = "#2ecc40";
    connectInstruction.textContent = "NOW PASTE THE ANSWER YOU RECEIVED AND CLICK 'I GOT THE ANSWER'";
    connectTextarea.value = "";
    connectTextarea.placeholder = "Paste the answer here...";
    setTimeout(() => {
      if (connectCopy) {
        connectCopy.textContent = "COPY";
        connectCopy.style.background = "";
      }
    }, 2000);
  };

  connectPaste.hidden = false;
  connectPaste.disabled = true;
  connectPaste.textContent = "I GOT THE ANSWER";
  const checkPaste = () => {
    const val = connectTextarea.value.trim();
    connectPaste.disabled = !val || val === encoded;
  };
  connectTextarea.oninput = checkPaste;
  connectTextarea.onpaste = checkPaste;

  connectPaste.onclick = () => {
    const pasted = connectTextarea.value.trim();
    if (!pasted || pasted === encoded) return;
    let sdp;
    try { sdp = decodeSDP(pasted); } catch {}
    if (!sdp || !sdp.startsWith("v=")) {
      connectStatus.textContent = "INVALID ANSWER - TRY AGAIN";
      return;
    }
    connectStatus.textContent = "CONNECTING...";
    connectInstruction.textContent = "Establishing connection...";
    connectPaste.disabled = true;
    connectCopy.hidden = true;

    peer.onConnected = () => connected("host");
    peer.onDisconnected = () => {
      if (duel) duelDisconnected();
    };
    peer.onData = (data) => {
      if (data && data.type) receiveMessage(data);
    };
    peer.acceptAnswer(sdp).catch((err) => {
      connectStatus.textContent = "FAILED: " + err.message;
    });
  };

  connectCancel.onclick = showMenu;
}

async function startJoin(offerSdp) {
  cleanupDuel();
  mode = "duel";
  showConnect();
  connectRoleLabel.textContent = "GUEST";
  connectStatus.textContent = "CONNECTING...";
  connectInstruction.textContent = "Connecting...";
  connectTextarea.placeholder = "Processing offer...";
  connectCopy.hidden = true;
  connectPaste.hidden = true;

  peer = makePeer();
  let answerSdp;
  try {
    answerSdp = await peer.acceptOffer(offerSdp);
  } catch (err) {
    connectStatus.textContent = "FAILED: " + err.message;
    return;
  }

  const encoded = encodeSDP(answerSdp);
  connectStatus.textContent = "ANSWER READY";
  connectInstruction.textContent = "COPY THIS ANSWER AND SEND IT BACK TO THE HOST";
  connectTextarea.value = encoded;
  connectTextarea.readOnly = true;
  connectCopy.hidden = false;
  connectCopy.textContent = "COPY";
  connectCopy.onclick = async () => {
    try {
      await copyText(encoded);
    } catch {
      connectTextarea.select();
      connectTextarea.setSelectionRange(0, encoded.length);
      await copyFromTextarea(connectTextarea);
    }
    connectCopy.textContent = "COPIED!";
    connectCopy.style.background = "#2ecc40";
    setTimeout(() => {
      if (connectCopy) {
        connectCopy.textContent = "COPY";
        connectCopy.style.background = "";
      }
    }, 2000);
  };
  connectPaste.hidden = true;

  peer.onConnected = () => connected("guest");
  peer.onDisconnected = () => {
    if (duel) duelDisconnected();
  };
  peer.onData = (data) => {
    if (data && data.type) receiveMessage(data);
  };

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
  connectionLabel.textContent = "DIRECT LINK";
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
joinButton.addEventListener("click", () => {
  showConnect();
  connectRoleLabel.textContent = "GUEST";
  connectStatus.textContent = "PASTE THE OFFER";
  connectInstruction.textContent = "PASTE THE OFFER YOU RECEIVED FROM THE HOST";
  connectTextarea.value = "";
  connectTextarea.readOnly = false;
  connectTextarea.placeholder = "Paste the host's offer here...";
  connectCopy.hidden = true;
  connectPaste.hidden = false;
  connectPaste.textContent = "CONNECT";
  connectPaste.disabled = false;

  connectPaste.onclick = () => {
    const raw = connectTextarea.value.trim();
    if (!raw) return;
    let sdp;
    try { sdp = decodeSDP(raw); } catch {}
    if (!sdp || !sdp.startsWith("v=")) {
      connectStatus.textContent = "INVALID OFFER - TRY AGAIN";
      return;
    }
    startJoin(sdp);
  };
});

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

// --- URL hash auto-detect ---

function handleHash() {
  const offerMatch = location.hash.match(/^#offer=(.+)$/i);
  const answerMatch = location.hash.match(/^#answer=(.+)$/i);

  if (offerMatch) {
    const encoded = decodeURIComponent(offerMatch[1]);
    let sdp;
    try { sdp = decodeSDP(encoded); } catch { return; }
    if (sdp && sdp.startsWith("v=")) {
      history.replaceState(null, "", location.pathname);
      // Auto-fill the guest join flow
      connectTextarea.value = encoded;
      startJoin(sdp);
    }
    return;
  }

  if (answerMatch && peer && !peer.connected) {
    const encoded = decodeURIComponent(answerMatch[1]);
    let sdp;
    try { sdp = decodeSDP(encoded); } catch { return; }
    if (sdp && sdp.startsWith("v=")) {
      history.replaceState(null, "", location.pathname);
      // Auto-fill answer on host side
      connectTextarea.value = encoded;
      connectStatus.textContent = "CONNECTING...";
      connectInstruction.textContent = "Establishing connection...";
      peer.onConnected = () => connected("host");
      peer.onDisconnected = () => { if (duel) duelDisconnected(); };
      peer.onData = (data) => { if (data && data.type) receiveMessage(data); };
      peer.acceptAnswer(sdp).catch(() => {});
    }
    return;
  }
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

requestAnimationFrame(frame);