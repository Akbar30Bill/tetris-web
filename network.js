import {joinRoom} from "https://esm.run/trystero@0.25.3";

const APP_ID = "vitetris-online-v1";
const ACTION_ID = "duel-v1";
const ROOM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ROOM_CODE_LENGTH = 10;

export function createRoomCode() {
  const values = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => ROOM_ALPHABET[value & 31]).join("").toLowerCase();
}

export function formatRoomCode(value) {
  const code = normalizeRoomCode(value);
  if (!code) return "";
  const upper = code.toUpperCase();
  return `${upper.slice(0, 3)}-${upper.slice(3, 7)}-${upper.slice(7)}`;
}

export function normalizeRoomCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (normalized.length !== ROOM_CODE_LENGTH) return null;
  if (![...normalized].every((char) => ROOM_ALPHABET.includes(char))) return null;
  return normalized.toLowerCase();
}

export function roomCodeFromInvite(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const hashMatch = raw.match(/^#room=(.+)$/i);
  if (hashMatch) {
    try { return normalizeRoomCode(decodeURIComponent(hashMatch[1])); } catch { return null; }
  }
  try {
    const url = new URL(raw, location.origin);
    const match = url.hash.match(/^#room=(.+)$/i);
    if (match) return normalizeRoomCode(decodeURIComponent(match[1]));
  } catch {}
  return normalizeRoomCode(raw);
}

export function makePeer({roomCode, role}) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) throw new Error("Invalid room code");
  if (!['host', 'guest'].includes(role)) throw new Error("Invalid duel role");

  let closed = false;
  let connected = false;
  let remotePeerId = null;
  let onConnected = null;
  let onData = null;
  let onDisconnected = null;
  let onError = null;
  const pendingMessages = [];
  const pendingHandshakes = new Set();
  const admittedPeers = new Set();

  const room = joinRoom({appId: APP_ID}, normalizedRoomCode, {
    onJoinError({error}) {
      if (!closed) onError?.(error instanceof Error ? error : new Error(String(error)));
    },
    async onPeerHandshake(peerId, send, receive) {
      if (closed || remotePeerId || pendingHandshakes.size || admittedPeers.size) {
        throw new Error("This duel already has a player");
      }
      pendingHandshakes.add(peerId);
      try {
        await send({protocol: ACTION_ID, role});
        const {data} = await receive();
        const expectedRole = role === "host" ? "guest" : "host";
        if (data?.protocol !== ACTION_ID || data?.role !== expectedRole) {
          throw new Error("Incompatible duel peer");
        }
        admittedPeers.add(peerId);
      } finally {
        pendingHandshakes.delete(peerId);
      }
    },
  });
  const action = room.makeAction(ACTION_ID);

  function sendNow(data) {
    if (closed || !remotePeerId) return;
    action.send(data, {target: remotePeerId}).catch(() => {});
  }

  action.onMessage = (data, {peerId}) => {
    if (!closed && peerId === remotePeerId) onData?.(data);
  };

  room.onPeerJoin = (peerId) => {
    if (closed || remotePeerId || !admittedPeers.has(peerId)) return;
    remotePeerId = peerId;
    connected = true;
    for (const message of pendingMessages.splice(0)) sendNow(message);
    onConnected?.();
  };

  room.onPeerLeave = (peerId) => {
    if (peerId !== remotePeerId) return;
    connected = false;
    remotePeerId = null;
    onDisconnected?.();
  };

  return {
    roomCode: normalizedRoomCode,
    send(data) {
      if (closed) return;
      if (remotePeerId) sendNow(data);
      else pendingMessages.push(data);
    },
    close() {
      if (closed) return;
      closed = true;
      connected = false;
      remotePeerId = null;
      pendingMessages.length = 0;
      room.leave();
    },
    set onConnected(fn) { onConnected = fn; },
    set onData(fn) { onData = fn; },
    set onDisconnected(fn) { onDisconnected = fn; },
    set onError(fn) { onError = fn; },
    get connected() { return connected; },
  };
}
