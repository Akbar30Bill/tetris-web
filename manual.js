export class ManualPair {
  constructor({role}) {
    this.role = role;
    this.peerConnection = null;
    this.dataChannel = null;
    this.connected = false;
    this.listeners = new Map();
    this.pendingCandidates = [];
    this.candidateBuffer = [];
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) listener(detail);
  }

  configuration() {
    return {iceServers: [{urls: "stun:stun.l.google.com:19302"}]};
  }

  async createOffer() {
    if (!globalThis.RTCPeerConnection) throw new Error("This browser does not support WebRTC.");
    this.peerConnection = new RTCPeerConnection(this.configuration());
    this.dataChannel = this.peerConnection.createDataChannel("game", {ordered: true});
    this.setupDataChannel();
    this.setupIceGathering();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const sdp = await this.waitForCompleteSDP();
    return {sdp, type: "offer"};
  }

  async acceptOffer(offerSdp) {
    if (!globalThis.RTCPeerConnection) throw new Error("This browser does not support WebRTC.");
    this.peerConnection = new RTCPeerConnection(this.configuration());
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    };
    this.setupIceGathering();
    await this.peerConnection.setRemoteDescription({type: "offer", sdp: offerSdp});
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    const sdp = await this.waitForCompleteSDP();
    return {sdp, type: "answer"};
  }

  async acceptAnswer(answerSdp) {
    if (!this.peerConnection) throw new Error("No active offer session.");
    await this.peerConnection.setRemoteDescription({type: "answer", sdp: answerSdp});
  }

  setupDataChannel() {
    if (!this.dataChannel) return;
    this.dataChannel.onopen = () => {
      this.connected = true;
      this.emit("connected", {});
    };
    this.dataChannel.onclose = () => {
      this.connected = false;
      this.emit("disconnected", {});
    };
    this.dataChannel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && parsed.type) {
          this.emit(parsed.type, parsed);
        }
      } catch {
        // Ignore unparseable messages
      }
    };
  }

  setupIceGathering() {
    if (!this.peerConnection) return;
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.candidateBuffer.push(event.candidate.toJSON());
      }
    };
    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection?.iceConnectionState === "disconnected") {
        this.connected = false;
        this.emit("disconnected", {});
      }
    };
  }

  waitForCompleteSDP() {
    return new Promise((resolve) => {
      if (!this.peerConnection) return;
      if (this.peerConnection.iceGatheringState === "complete") {
        resolve(this.peerConnection.localDescription.sdp);
        return;
      }
      this.peerConnection.onicegatheringstatechange = () => {
        if (this.peerConnection?.iceGatheringState === "complete") {
          resolve(this.peerConnection.localDescription.sdp);
        }
      };
    });
  }

  async send(type, data, _target) {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") return;
    try {
      this.dataChannel.send(JSON.stringify({type, ...data}));
    } catch {
      // Connection might have closed
    }
  }

  sendState(state) {
    return this.send("state", state);
  }

  sendAttack(attack) {
    return this.send("attack", attack);
  }

  sendControl(control) {
    return this.send("control", control);
  }

  async ping() {
    return null;
  }

  leave() {
    this.connected = false;
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}