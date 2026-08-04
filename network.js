const PROTOCOL_VERSION = 1;

export class DuelConnection {
  constructor({code, role}) {
    this.code = String(code).trim().toUpperCase();
    this.role = role;
    this.listeners = new Map();
    this.pc = null;
    this.channel = null;
    this.connected = false;
    this.closed = false;
    this.connectedPeerId = null;
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) listener(detail);
  }

  async connect() {
    if (!globalThis.RTCPeerConnection) throw new Error("This browser does not support WebRTC.");
    if (this.closed) return;
    this.emit("waiting", {code: this.code});
  }

  async createOffer() {
    this.pc = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]});
    this.channel = this.pc.createDataChannel("game", {ordered: true});
    this.setupChannel();
    this.pc.onicecandidate = () => {};
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitGathering();
    return this.pc.localDescription.sdp;
  }

  async acceptOffer(sdp) {
    this.pc = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]});
    this.pc.ondatachannel = (event) => {
      this.channel = event.channel;
      this.setupChannel();
    };
    this.pc.onicecandidate = () => {};
    const init = {type: "offer", sdp};
    await this.pc.setRemoteDescription(new RTCSessionDescription(init));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitGathering();
    return this.pc.localDescription.sdp;
  }

  async acceptAnswer(sdp) {
    const init = {type: "answer", sdp};
    await this.pc.setRemoteDescription(new RTCSessionDescription(init));
  }

  waitGathering() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === "complete") resolve();
      };
    });
  }

  setupChannel() {
    if (!this.channel) return;
    this.channel.onopen = () => {
      this.connected = true;
      this.connectedPeerId = "peer";
      this.emit("connected", {peerId: "peer", role: this.role === "host" ? "guest" : "host"});
    };
    this.channel.onclose = () => {
      this.connected = false;
      this.connectedPeerId = null;
      this.emit("disconnected", {});
    };
    this.channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.type) this.emit(msg.type, msg);
      } catch {}
    };
  }

  safeSend(data, critical = false) {
    if (!this.channel || this.channel.readyState !== "open") return Promise.resolve(false);
    try {
      this.channel.send(JSON.stringify(data));
      return Promise.resolve(true);
    } catch {
      if (critical) this.emit("error", {message: "The peer connection has closed."});
      return Promise.resolve(false);
    }
  }

  sendState(state) {
    this.safeSend({type: "state", ...state});
  }

  sendAttack(attack) {
    this.safeSend({type: "attack", ...attack});
  }

  sendControl(control, critical = false) {
    this.safeSend({type: "control", ...control}, critical);
  }

  async ping() {
    return null;
  }

  leave() {
    this.closed = true;
    this.connected = false;
    if (this.channel) { this.channel.close(); this.channel = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
  }
}

export function minifySDP(sdp) {
  return sdp.replace(/\r?\n/g, "|").replace(/ +/g, " ");
}

export function expandSDP(minified) {
  return minified.replace(/\|/g, "\r\n");
}

export function encodeOffer(sdp) {
  return btoa(minifySDP(sdp));
}

export function decodeOffer(encoded) {
  try {
    return expandSDP(atob(encoded));
  } catch {
    return null;
  }
}