const TRYSTERO_URL = "https://esm.run/trystero@0.25.3";
const APP_ID = "org.vitetris.online.duel.v1";
const PROTOCOL_VERSION = 1;

export class DuelConnection {
  constructor({code, role}) {
    this.code = String(code).trim().toUpperCase();
    this.role = role;
    this.room = null;
    this.peerId = null;
    this.peerRole = null;
    this.actions = null;
    this.listeners = new Map();
    this.closed = false;
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
    if (!/^[A-Z2-9]{8}$/.test(this.code)) throw new Error("Room codes contain eight letters or digits.");
    if (!globalThis.RTCPeerConnection) throw new Error("This browser does not support WebRTC.");

    let trystero;
    try {
      trystero = await import(TRYSTERO_URL);
    } catch {
      throw new Error("Could not load the peer connection module. Check your internet connection.");
    }

    if (this.closed) return;
    this.room = trystero.joinRoom(
      {
        appId: APP_ID,
        password: this.code,
        relayConfig: {redundancy: 3},
      },
      this.code,
      {
        onJoinError: ({error, peerId}) => {
          const message = typeof error === "string" ? error : error?.message;
          if (this.peerId && peerId && peerId !== this.peerId) {
            this.emit("warning", {message: message || "An unrelated peer could not connect."});
            return;
          }
          this.emit("error", {message: message || "Could not establish a direct connection."});
        },
        onPeerHandshake: async (peerId) => {
          if (this.peerId && this.peerId !== peerId) throw new Error("busy");
        },
        handshakeTimeoutMs: 15000,
      },
    );

    this.actions = {
      hello: this.room.makeAction("hello"),
      state: this.room.makeAction("state"),
      attack: this.room.makeAction("attack"),
      control: this.room.makeAction("control"),
    };

    this.actions.hello.onMessage = (data, {peerId}) => this.receiveHello(data, peerId);
    this.actions.state.onMessage = (data, {peerId}) => this.receive("state", data, peerId);
    this.actions.attack.onMessage = (data, {peerId}) => this.receive("attack", data, peerId);
    this.actions.control.onMessage = (data, {peerId}) => this.receive("control", data, peerId);

    this.room.onPeerJoin = (peerId) => {
      this.safeSend("hello", {protocol: PROTOCOL_VERSION, role: this.role}, peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      if (peerId !== this.peerId) return;
      this.peerId = null;
      this.peerRole = null;
      this.emit("disconnected", {});
    };
    this.emit("waiting", {code: this.code});
  }

  receiveHello(data, peerId) {
    if (!data || data.protocol !== PROTOCOL_VERSION) return;
    if (this.peerId && this.peerId !== peerId) return;
    if (data.role === this.role) {
      this.emit("error", {message: `Both players joined as ${this.role}.`});
      return;
    }
    const expectedRole = this.role === "host" ? "guest" : "host";
    if (data.role !== expectedRole) return;
    const firstContact = !this.peerId;
    this.peerId = peerId;
    this.peerRole = data.role;
    if (firstContact) {
      this.safeSend("hello", {protocol: PROTOCOL_VERSION, role: this.role}, peerId);
      this.emit("connected", {peerId, role: data.role});
    }
  }

  receive(type, data, peerId) {
    if (!this.peerId || peerId !== this.peerId) return;
    this.emit(type, data);
  }

  safeSend(action, data, target, critical = false) {
    if (!target) target = this.peerId;
    if (!this.actions?.[action] || !target || this.closed) return Promise.resolve(false);
    const promise = this.actions[action].send(data, {target}).then(() => true, () => false);
    if (!critical) return promise;
    promise.then((ok) => {
      if (!ok) this.emit("error", {message: "The peer connection has closed."});
    });
    return promise;
  }

  sendState(state) {
    return this.safeSend("state", state);
  }

  sendAttack(attack) {
    return this.safeSend("attack", attack);
  }

  sendControl(control, critical = false) {
    return this.safeSend("control", control, undefined, critical);
  }

  async ping() {
    if (!this.peerId || !this.room) return null;
    try {
      return await this.room.ping(this.peerId);
    } catch {
      return null;
    }
  }

  leave() {
    this.closed = true;
    this.peerId = null;
    this.peerRole = null;
    const leavePromise = this.room ? this.room.leave() : Promise.resolve();
    this.room = null;
    this.actions = null;
    return leavePromise;
  }
}
