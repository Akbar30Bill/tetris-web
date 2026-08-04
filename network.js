export function makePeer() {
  const pc = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]});
  const pending = [];
  let channel = null;
  let channelReady = false;
  let onConnected = null;
  let onData = null;
  let onDisconnected = null;

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
      onDisconnected?.();
    }
  };

  function setupChannel(ch) {
    channel = ch;
    channel.onopen = () => {
      channelReady = true;
      for (const msg of pending) channel.send(msg);
      pending.length = 0;
      onConnected?.();
    };
    channel.onclose = () => onDisconnected?.();
    channel.onmessage = (e) => {
      try { onData?.(JSON.parse(e.data)); } catch {}
    };
  }

  return {
    async createOffer() {
      channel = pc.createDataChannel("game", {ordered: true});
      setupChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gathering(pc);
      return pc.localDescription.sdp;
    },

    async acceptAnswer(sdp) {
      await pc.setRemoteDescription({type: "answer", sdp});
    },

    async acceptOffer(sdp) {
      pc.ondatachannel = (e) => setupChannel(e.channel);
      await pc.setRemoteDescription({type: "offer", sdp});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gathering(pc);
      return pc.localDescription.sdp;
    },

    send(data) {
      const msg = JSON.stringify(data);
      if (channelReady) channel.send(msg);
      else pending.push(msg);
    },

    close() {
      channelReady = false;
      if (channel) { channel.close(); channel = null; }
      pc.close();
    },

    set onConnected(fn) { onConnected = fn; },
    set onData(fn) { onData = fn; },
    set onDisconnected(fn) { onDisconnected = fn; },
    get connected() { return channelReady; },
  };
}

function gathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, 2000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); }
    };
  });
}

export function encodeSDP(sdp) {
  return btoa(sdp.replace(/\r?\n/g, "|").replace(/ +/g, " "));
}

export function decodeSDP(encoded) {
  return atob(encoded).replace(/\|/g, "\r\n");
}