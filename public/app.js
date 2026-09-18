const $ = s => document.querySelector(s);

let token = localStorage.getItem("orbit_guest_token") || "";
let guestId = localStorage.getItem("orbit_guest_id") || "";
let guestName = localStorage.getItem("orbit_guest_name") || "";
let me = null;
let servers = [];
let currentServer = null;
let channels = [];
let currentChannel = null;
let socket = null;
let typingTimer = null;
let pendingIncomingCall = null;

const callState = {
  active: false,
  startedAt: 0,
  durationTimer: null,
  statsTimer: null,
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
  mode: "video",
  roomId: null,
  peers: new Map(),
  localStream: null,
  cameraTrack: null,
  micTrack: null,
  screenTrack: null,
  settings: {
    quality: "720p",
    fps: 30,
    layout: "grid",
    frame: "soft",
    autoQuality: true,
    background: "none",
    mirror: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true
  },
  devices: {
    mic: "",
    camera: "",
    speaker: ""
  }
};

const QUALITY_PRESETS = {
  "360p": { width: 640, height: 360, frameRate: 24 },
  "480p": { width: 854, height: 480, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
  "1440p": { width: 2560, height: 1440, frameRate: 30 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60 }
};

function api(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {})
  };
  if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
  return fetch(url, opts).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}
function fmt(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function avatar(name) { return (name || "G").slice(0, 1).toUpperCase(); }
function escapeHtml(x) {
  return String(x ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function saveGuest() {
  localStorage.setItem("orbit_guest_token", token);
  localStorage.setItem("orbit_guest_id", guestId);
  localStorage.setItem("orbit_guest_name", guestName);
}
function openModal(title, body) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
function showError(message) {
  console.error(message);
  openModal("Something went wrong", '<p class="modal-error">' + escapeHtml(message) + "</p>");
}

async function enterAsGuest() {
  const data = await api("/api/guest", {
    method: "POST",
    body: JSON.stringify({ guestId: guestId || undefined, username: guestName || undefined })
  });
  token = data.token;
  guestId = data.user.id;
  guestName = data.user.username;
  me = data.user;
  saveGuest();
  $("#me-name").textContent = me.username;
  $("#me-avatar").textContent = avatar(me.username);
  $("#me-status").textContent = orbitUI.profile.status ? String(orbitUI.profile.status).toLowerCase()+" · guest" : "online · guest";
  connectRealtime();
  await loadServers();
}

function connectRealtime() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token }, transports: ["websocket", "polling"] });

  api("/api/realtime-config").then(cfg => {
    if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
      callState.iceServers = cfg.iceServers;
    }
  }).catch(() => {});

  socket.on("message:new", m => {
    if (currentChannel && String(m.channel_id) === String(currentChannel.id)) appendMessage(m);
  });
  socket.on("typing", x => {
    if (!currentChannel) return;
    $("#typing").textContent = x.isTyping ? x.username + " is typing…" : "";
  });
  socket.on("presence:update", x => {
    document.querySelectorAll("[data-user='" + x.userId + "'] .presence").forEach(n => n.textContent = x.status);
  });

  socket.on("call:participants", participants => {
    participants.forEach(p => createPeer(p.socketId, true, p));
    updateCallMeta();
  });

  socket.on("call:participant-joined", p => {
    addRemoteTile(p.socketId, p);
    if (!callState.active && p.channelId) {
      pendingIncomingCall = p;
      $("#incoming-avatar").textContent = avatar(p.username);
      $("#incoming-title").textContent = p.mode === "voice" ? "Incoming voice call" : "Incoming video call";
      const incomingChannel = channels.find(c => String(c.id) === String(p.channelId));
      $("#incoming-subtitle").textContent = (p.username || "Guest") + " wants to join #" + (incomingChannel?.name || "channel");
      $("#incoming-call").classList.remove("hidden");
    }
    updateCallMeta();
  });

  socket.on("call:participant-left", ({ socketId }) => {
    removePeer(socketId);
    updateCallMeta();
  });

  socket.on("call:media-state", ({ socketId, muted, cameraOff, screenShare }) => {
    const tile = document.querySelector('.call-tile[data-peer="' + socketId + '"]');
    if (!tile) return;
    tile.classList.toggle("remote-muted", muted);
    tile.classList.toggle("remote-camera-off", cameraOff);
    tile.classList.toggle("remote-screen", screenShare);
    const badge = tile.querySelector(".tile-badge");
    if (badge) badge.textContent = screenShare ? "SCREEN" : cameraOff ? "CAM OFF" : "LIVE";
  });

  socket.on("rtc:offer", async ({ from, fromUser, offer }) => {
    try {
      const pc = await ensurePeer(from, false, fromUser);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("rtc:answer", { to: from, answer: pc.localDescription });
    } catch (err) {
      console.error("offer handling", err);
    }
  });

  socket.on("rtc:answer", async ({ from, answer }) => {
    const item = callState.peers.get(from);
    if (!item?.pc) return;
    try { await item.pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch (err) { console.error(err); }
  });

  socket.on("rtc:ice", async ({ from, candidate }) => {
    const item = callState.peers.get(from);
    if (!item?.pc || !candidate) return;
    try { await item.pc.addIceCandidate(candidate); } catch (err) { console.error(err); }
  });

  socket.on("disconnect", () => {
    if (callState.active) setCallIndicator("RECONNECTING");
  });
}

async function loadServers() {
  const data = await api("/api/servers");
  servers = data.servers;
  renderServers();
  if (!currentServer || !servers.some(s => String(s.id) === String(currentServer.id))) currentServer = servers[0] || null;
  if (currentServer) await selectServer(currentServer);
}
function renderServers() {
  $("#server-list").innerHTML = servers.map(s =>
    '<button class="server-item ' + (String(currentServer?.id) === String(s.id) ? "active" : "") +
    '" data-id="' + s.id + '" title="' + escapeHtml(s.name) + '">' +
    escapeHtml(s.name.slice(0, 2).toUpperCase()) + "</button>"
  ).join("");
  document.querySelectorAll(".server-item").forEach(btn => {
    btn.onclick = () => selectServer(servers.find(s => String(s.id) === btn.dataset.id));
  });
}
async function selectServer(serverItem) {
  currentServer = serverItem;
  if (callState.active) leaveCall();
  renderServers();
  $("#workspace-name").textContent = currentServer.name;
  const data = await api("/api/servers/" + currentServer.id + "/channels");
  channels = data.channels;
  $("#workspace-role").textContent = data.role + " · guest";
  renderChannels();
  if (channels[0]) await selectChannel(channels[0]);
  await loadMembers();
}
function renderChannels() {
  const textChannels = channels.filter(c => c.type !== "voice");
  const voiceChannels = channels.filter(c => c.type === "voice");

  $("#channel-list").innerHTML = textChannels.map(c =>
    '<button class="channel ' + (String(currentChannel?.id) === String(c.id) ? "active" : "") +
    '" data-id="' + c.id + '"><span class="hash">#</span><span>' + escapeHtml(c.name) + "</span></button>"
  ).join("");

  $("#voice-channel-list").innerHTML = voiceChannels.map(c =>
    '<button class="channel voice-channel ' + (String(currentChannel?.id) === String(c.id) ? "active" : "") +
    '" data-id="' + c.id + '"><span class="voice-icon">◉</span><span>' + escapeHtml(c.name) + '</span><span class="voice-live-count" data-voice="' + c.id + '"></span></button>'
  ).join("");

  document.querySelectorAll("#channel-list .channel").forEach(btn => {
    btn.onclick = () => selectChannel(channels.find(c => String(c.id) === btn.dataset.id));
  });

  document.querySelectorAll("#voice-channel-list .channel").forEach(btn => {
    btn.onclick = async () => {
      const channel = channels.find(c => String(c.id) === btn.dataset.id);
      await selectChannel(channel);
      if (channel) startCall("voice");
    };
  });
}
async function selectChannel(channel) {
  if (callState.active && String(callState.roomId) !== String(channel.id)) leaveCall();
  currentChannel = channel;
  renderChannels();
  $("#channel-name").textContent = channel.name;
  $("#channel-meta").textContent =
    channel.type === "announcement" ? "Announcement channel" :
    channel.type === "voice" ? "Voice room" :
    "Realtime conversation";
  $("#message").placeholder = "Message #" + channel.name;
  $("#messages").innerHTML = "";
  const data = channel.type === "voice"
    ? { messages: [] }
    : await api("/api/channels/" + channel.id + "/messages");
  data.messages.forEach(appendMessage);
  if (socket) socket.emit("channel:join", channel.id);
  if (channel.type === "voice") $("#composer").classList.add("hidden");
  else $("#composer").classList.remove("hidden");
}
function appendMessage(m) {
  const el = document.createElement("article");
  el.className = "message";
  el.innerHTML =
    '<div class="avatar">' + escapeHtml(avatar(m.username)) + '</div>' +
    '<div><div class="msg-head"><strong>' + escapeHtml(m.username) + '</strong><time>' +
    fmt(m.created_at) + '</time></div><div class="msg-body">' + escapeHtml(m.content) + "</div></div>";
  $("#messages").appendChild(el);
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

$("#composer").onsubmit = e => {
  e.preventDefault();
  const value = $("#message").value.trim();
  if (!value || !socket || !currentChannel) return;
  socket.emit("message:send", { channelId: currentChannel.id, content: value });
  $("#message").value = "";
  socket.emit("typing", { channelId: currentChannel.id, isTyping: false });
};
$("#message").oninput = () => {
  if (!socket || !currentChannel) return;
  socket.emit("typing", { channelId: currentChannel.id, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit("typing", { channelId: currentChannel.id, isTyping: false }), 900);
};

$("#new-server").onclick = () => openModal(
  "Create a server",
  '<input id="server-name" placeholder="e.g. Gaming Hub"><button class="primary" id="create-server">Create server</button>'
);
$("#new-channel").onclick = () => {
  if (!currentServer) return;
  openChannelCreator("text");
};
$("#new-voice-channel").onclick = () => {
  if (!currentServer) return;
  openChannelCreator("voice");
};
function openChannelCreator(defaultType) {
  openModal(
    "Create channel",
    '<input id="channel-name-input" placeholder="general">' +
    '<select id="channel-type">' +
    '<option value="text"' + (defaultType === "text" ? " selected" : "") + '>Text</option>' +
    '<option value="announcement">Announcement</option>' +
    '<option value="voice"' + (defaultType === "voice" ? " selected" : "") + '>Voice</option>' +
    '</select><button class="primary" id="create-channel">Create channel</button>'
  );
}
$("#rename-guest").onclick = () => openModal(
  "Change guest name",
  '<input id="guest-name-input" value="' + escapeHtml(me?.username || "") + '" maxlength="24"><button class="primary" id="save-guest-name">Save name</button>'
);
$("#modal-close").onclick = closeModal;
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

document.addEventListener("click", async e => {
  try {
    if (e.target.id === "create-server") {
      const data = await api("/api/servers", { method: "POST", body: JSON.stringify({ name: $("#server-name").value }) });
      closeModal();
      await loadServers();
      await selectServer(data.server);
      return;
    }
    if (e.target.id === "create-channel") {
      const data = await api("/api/servers/" + currentServer.id + "/channels", {
        method: "POST",
        body: JSON.stringify({ name: $("#channel-name-input").value, type: $("#channel-type").value })
      });
      closeModal();
      channels.push(data.channel);
      renderChannels();
      await selectChannel(data.channel);
      return;
    }
    if (e.target.id === "save-guest-name") {
      const value = $("#guest-name-input").value.trim();
      if (!value) return;
      const data = await api("/api/me", { method: "PATCH", body: JSON.stringify({ username: value }) });
      me = data.user;
      guestName = me.username;
      saveGuest();
      $("#me-name").textContent = me.username;
      $("#me-avatar").textContent = avatar(me.username);
      closeModal();
      return;
    }
    if (e.target.id === "invite-btn" && currentServer) {
      const data = await api("/api/servers/" + currentServer.id + "/invites", { method: "POST", body: "{}" });
      openModal("Invite link",
        '<input value="' + location.origin + '/?invite=' + encodeURIComponent(data.invite.code) + '" readonly>' +
        '<p class="hint">Valid for 7 days.</p>');
      return;
    }
    if (e.target.id === "members-btn") {
      $("#members-panel").classList.remove("hidden");
      await loadMembers();
      return;
    }
    if (e.target.id === "close-members") {
      $("#members-panel").classList.add("hidden");
      return;
    }
    if (e.target.id === "admin-btn" && currentServer) {
      openModal("Control center",
        '<div class="control-grid">' +
        '<div class="control-row"><strong>Server</strong><span>' + escapeHtml(currentServer.name) + '</span></div>' +
        '<div class="control-row"><strong>Access</strong><span>No account required — guest sessions only</span></div>' +
        '<div class="control-row"><strong>Voice / Video</strong><span>WebRTC mesh, screen share and quality presets</span></div>' +
        '<div class="control-row"><strong>Storage</strong><span>Live memory mode until PostgreSQL is connected</span></div>' +
        '</div>');
      return;
    }
  } catch (err) { showError(err.message); }
});

async function loadMembers() {
  if (!currentServer) return;
  const data = await api("/api/servers/" + currentServer.id + "/members");
  $("#member-list").innerHTML = data.members.map(m =>
    '<div class="member" data-user="' + m.id + '">' +
    '<div class="avatar">' + escapeHtml(avatar(m.username)) + '</div>' +
    '<div class="member-info"><strong>' + escapeHtml(m.username) + '</strong>' +
    '<span class="presence">' + m.status + " · " + m.role + "</span></div></div>"
  ).join("");
}

/* ============================
   WebRTC Call System
   ============================ */

async function startCall(mode = "video") {
  if (!currentChannel) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    return showError("Your browser does not expose camera/microphone APIs here. Use HTTPS and allow permissions.");
  }

  if (callState.active) {
    if (callState.roomId === currentChannel.id) return;
    leaveCall();
  }

  callState.mode = mode;
  callState.roomId = currentChannel.id;
  callState.active = true;
  callState.startedAt = Date.now();
  $("#call-panel").classList.remove("hidden");
  $("#call-title").textContent = currentChannel.name;
  $("#call-subtitle").textContent = mode === "voice" ? "Voice room" : "Video room";
  document.body.classList.add("call-open");

  try {
    await setupLocalMedia(mode);
    ensureSelfTile();
    socket.emit("call:join", { channelId: callState.roomId, mode: callState.mode });
    socket.emit("call:media-state", {
      channelId: callState.roomId,
      muted: callState.micTrack ? !callState.micTrack.enabled : true,
      cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true,
      screenShare: false
    });
    setCallIndicator("LIVE");
    startCallClock();
    startStatsMonitor();
    $("#voice-dock").classList.toggle("hidden", mode !== "voice");
    $("#voice-dock-name").textContent = currentChannel.name;
    updateCallMeta();
  } catch (err) {
    leaveCall();
    showError(err.name === "NotAllowedError" ? "Permission denied. Allow your camera/microphone in the browser." : err.message);
  }
}

async function setupLocalMedia(mode) {
  if (callState.localStream) {
    callState.localStream.getTracks().forEach(t => t.stop());
  }

  const preset = QUALITY_PRESETS[callState.settings.quality] || QUALITY_PRESETS["720p"];
  const audio = {
    echoCancellation: callState.settings.echoCancellation,
    noiseSuppression: callState.settings.noiseSuppression,
    autoGainControl: callState.settings.autoGainControl
  };

  const video = mode === "voice" ? false : {
    width: { ideal: preset.width, max: preset.width },
    height: { ideal: preset.height, max: preset.height },
    frameRate: { ideal: Number(callState.settings.fps), max: Number(callState.settings.fps) },
    facingMode: "user"
  };

  callState.localStream = await navigator.mediaDevices.getUserMedia({
    audio,
    video
  });

  callState.micTrack = callState.localStream.getAudioTracks()[0] || null;
  callState.cameraTrack = callState.localStream.getVideoTracks()[0] || null;
  if (callState.cameraTrack) callState.cameraTrack.enabled = true;
  if (callState.micTrack) callState.micTrack.enabled = true;
  $("#mic-btn").classList.add("active");
  $("#camera-btn").classList.toggle("active", Boolean(callState.cameraTrack));
  $("#camera-btn").classList.toggle("off", !callState.cameraTrack);
}

function ensureSelfTile() {
  let tile = document.querySelector('.call-tile[data-peer="self"]');
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "call-tile self-tile";
    tile.dataset.peer = "self";
    tile.innerHTML =
      '<div class="tile-video-wrap"><video autoplay muted playsinline></video>' +
      '<div class="tile-overlay"><strong>' + escapeHtml(me?.username || "You") + '</strong><span class="tile-badge">YOU</span></div></div>';
    $("#call-stage").appendChild(tile);
  }
  const video = tile.querySelector("video");
  video.srcObject = callState.localStream || null;
  video.classList.toggle("mirror", callState.settings.mirror);
  tile.classList.toggle("voice-only", !callState.cameraTrack);
  applyFrameClass(tile);
  applyLayout();
}

async function ensurePeer(socketId, initiator, info = {}) {
  if (callState.peers.has(socketId)) return callState.peers.get(socketId).pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  });

  const peerState = { pc, user: info || {}, pendingCandidates: [] };
  callState.peers.set(socketId, peerState);

  if (callState.localStream) {
    callState.localStream.getTracks().forEach(track => pc.addTrack(track, callState.localStream));
  }

  pc.onicecandidate = ev => {
    if (ev.candidate && socket) socket.emit("rtc:ice", { to: socketId, candidate: ev.candidate });
  };

  pc.ontrack = ev => {
    const stream = ev.streams[0];
    addRemoteStream(socketId, stream, info || {});
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === "connected") setCallIndicator("LIVE");
    if (["failed", "closed", "disconnected"].includes(state)) {
      if (state !== "disconnected") removePeer(socketId);
    }
  };

  if (initiator) {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      socket.emit("rtc:offer", { to: socketId, offer: pc.localDescription });
    } catch (err) {
      console.error("offer create", err);
    }
  }
  return pc;
}

async function createPeer(socketId, initiator, info) {
  await ensurePeer(socketId, initiator, info);
}
function addRemoteTile(socketId, info = {}) {
  if (document.querySelector('.call-tile[data-peer="' + socketId + '"]')) return;
  const tile = document.createElement("div");
  tile.className = "call-tile remote-tile connecting";
  tile.dataset.peer = socketId;
  tile.innerHTML =
    '<div class="tile-video-wrap">' +
    '<video autoplay playsinline></video>' +
    '<div class="remote-placeholder"><div class="avatar big">' + escapeHtml(avatar(info.username || "G")) + '</div>' +
    '<span>Connecting…</span></div>' +
    '<div class="tile-overlay"><strong>' + escapeHtml(info.username || "Guest") + '</strong><span class="tile-badge">LIVE</span></div>' +
    '</div>';
  $("#call-stage").appendChild(tile);
  applyFrameClass(tile);
  applyLayout();
}
function addRemoteStream(socketId, stream, info = {}) {
  addRemoteTile(socketId, info);
  const tile = document.querySelector('.call-tile[data-peer="' + socketId + '"]');
  if (!tile) return;
  const video = tile.querySelector("video");
  video.srcObject = stream;
  tile.classList.remove("connecting");
  tile.querySelector(".remote-placeholder")?.classList.add("hidden");
  bindSpeaker(video);
}
function removePeer(socketId) {
  const item = callState.peers.get(socketId);
  if (item?.pc) item.pc.close();
  callState.peers.delete(socketId);
  document.querySelector('.call-tile[data-peer="' + socketId + '"]')?.remove();
  updateCallMeta();
  applyLayout();
}
function leaveCall() {
  if (!callState.active) return;
  try { if (socket && callState.roomId) socket.emit("call:leave", callState.roomId); } catch {}
  for (const [, item] of callState.peers) item.pc.close();
  callState.peers.clear();
  if (callState.statsTimer) clearInterval(callState.statsTimer);
  if (callState.durationTimer) clearInterval(callState.durationTimer);
  callState.statsTimer = null;
  callState.durationTimer = null;
  if (callState.screenTrack) {
    callState.screenTrack.stop();
    callState.screenTrack = null;
  }
  if (callState.localStream) {
    callState.localStream.getTracks().forEach(t => t.stop());
    callState.localStream = null;
  }
  callState.cameraTrack = null;
  callState.micTrack = null;
  callState.active = false;
  callState.roomId = null;
  callState.startedAt = 0;
  $("#voice-dock").classList.add("hidden");
  document.querySelectorAll(".call-tile").forEach(t => t.remove());
  $("#call-panel").classList.add("hidden");
  document.body.classList.remove("call-open");
  setCallIndicator("IDLE");
  $("#call-network-indicator").textContent = "NETWORK —";
  $("#call-duration").textContent = "00:00";
  updateCallMeta();
}

function setCallIndicator(text) {
  $("#call-quality-indicator").textContent = text;
  $("#call-quality-indicator").classList.toggle("good", text === "LIVE");
}
function startCallClock() {
  if (callState.durationTimer) clearInterval(callState.durationTimer);
  const tick = () => {
    const total = Math.max(0, Math.floor((Date.now() - callState.startedAt) / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    $("#call-duration").textContent = m + ":" + s;
  };
  tick();
  callState.durationTimer = setInterval(tick, 1000);
}
function startStatsMonitor() {
  if (callState.statsTimer) clearInterval(callState.statsTimer);
  callState.statsTimer = setInterval(async () => {
    if (!callState.active) return;
    let good = 0, total = 0;
    for (const [, item] of callState.peers) {
      try {
        const stats = await item.pc.getStats();
        for (const report of stats.values()) {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            good++;
          }
          if (report.type === "inbound-rtp" && report.kind === "video" && report.framesPerSecond) {
            item.fps = Math.round(report.framesPerSecond);
          }
        }
      } catch {}
      total++;
    }
    const network = total === 0 ? "NETWORK · LOCAL" : good === total ? "NETWORK · EXCELLENT" : good > 0 ? "NETWORK · GOOD" : "NETWORK · CHECK";
    $("#call-network-indicator").textContent = network;
    $("#call-network-indicator").classList.toggle("good", good === total || total === 0);
  }, 2200);
}
function updateCallMeta() {
  const count = 1 + callState.peers.size;
  $("#participant-count").textContent = String(Math.max(1, count));
  $("#call-empty").classList.toggle("hidden", count > 1);
  $("#call-stage").classList.toggle("empty-stage", count <= 1);
}
function applyLayout() {
  const stage = $("#call-stage");
  stage.classList.remove("layout-grid", "layout-stage", "layout-strip");
  stage.classList.add("layout-" + callState.settings.layout);
}
function applyFrameClass(el) {
  el.classList.remove("frame-soft", "frame-square", "frame-cinema", "frame-glow");
  el.classList.add("frame-" + callState.settings.frame);
}
function applyAllFrames() {
  document.querySelectorAll(".call-tile").forEach(applyFrameClass);
}
function toggleMic() {
  if (!callState.micTrack) return;
  callState.micTrack.enabled = !callState.micTrack.enabled;
  $("#mic-btn").classList.toggle("active", callState.micTrack.enabled);
  $("#mic-btn").classList.toggle("off", !callState.micTrack.enabled);
  if (socket && callState.roomId) socket.emit("call:media-state", {
    channelId: callState.roomId,
    muted: !callState.micTrack.enabled,
    cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true,
    screenShare: Boolean(callState.screenTrack)
  });
}
function toggleCamera() {
  if (!callState.cameraTrack) return;
  callState.cameraTrack.enabled = !callState.cameraTrack.enabled;
  $("#camera-btn").classList.toggle("active", callState.cameraTrack.enabled);
  $("#camera-btn").classList.toggle("off", !callState.cameraTrack.enabled);
  const selfTile = document.querySelector('.call-tile[data-peer="self"]');
  selfTile?.classList.toggle("voice-only", !callState.cameraTrack.enabled);
  if (socket && callState.roomId) socket.emit("call:media-state", {
    channelId: callState.roomId,
    muted: callState.micTrack ? !callState.micTrack.enabled : true,
    cameraOff: !callState.cameraTrack.enabled,
    screenShare: Boolean(callState.screenTrack)
  });
}
async function toggleScreenShare() {
  if (!callState.active) return;
  if (callState.screenTrack) {
    stopScreenShare();
    return;
  }
  try {
    const preset = QUALITY_PRESETS[callState.settings.quality] || QUALITY_PRESETS["1080p"];
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: Number(callState.settings.fps), max: Number(callState.settings.fps) }
      },
      audio: true
    });
    callState.screenTrack = display.getVideoTracks()[0];
    const selfTile = document.querySelector('.call-tile[data-peer="self"]');
    if (selfTile) {
      const video = selfTile.querySelector("video");
      video.srcObject = display;
      video.classList.remove("mirror");
      selfTile.classList.add("screen-sharing");
      const label = selfTile.querySelector(".tile-badge");
      if (label) label.textContent = "SCREEN";
    }

    for (const [, item] of callState.peers) {
      const sender = item.pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(callState.screenTrack);
    }

    callState.screenTrack.onended = stopScreenShare;
    $("#share-btn").classList.add("active");
    if (socket && callState.roomId) socket.emit("call:media-state", {
      channelId: callState.roomId,
      muted: callState.micTrack ? !callState.micTrack.enabled : true,
      cameraOff: false,
      screenShare: true
    });
  } catch (err) {
    if (err.name !== "AbortError") showError("Screen sharing failed: " + err.message);
  }
}
async function stopScreenShare() {
  if (!callState.screenTrack) return;
  callState.screenTrack.stop();
  callState.screenTrack = null;
  if (callState.cameraTrack) {
    for (const [, item] of callState.peers) {
      const sender = item.pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(callState.cameraTrack);
    }
  }
  ensureSelfTile();
  $("#share-btn").classList.remove("active");
  if (socket && callState.roomId) socket.emit("call:media-state", {
    channelId: callState.roomId,
    muted: callState.micTrack ? !callState.micTrack.enabled : true,
    cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true,
    screenShare: false
  });
}
async function applyQuality(name, fps) {
  if (name) callState.settings.quality = name;
  if (fps) callState.settings.fps = Number(fps);
  const preset = QUALITY_PRESETS[callState.settings.quality] || QUALITY_PRESETS["720p"];
  if (callState.cameraTrack) {
    try {
      await callState.cameraTrack.applyConstraints({
        width: { ideal: preset.width, max: preset.width },
        height: { ideal: preset.height, max: preset.height },
        frameRate: { ideal: Number(callState.settings.fps), max: Number(callState.settings.fps) }
      });
    } catch (err) {
      console.warn("camera quality fallback", err);
    }
  }
  $("#quality-btn").textContent = "Quality · " + callState.settings.quality;
  hideCallPopover();
}
function togglePopover(kind, anchor) {
  const pop = $("#call-popover");
  if (!pop.classList.contains("hidden") && pop.dataset.kind === kind) {
    hideCallPopover();
    return;
  }
  pop.dataset.kind = kind;
  pop.innerHTML = "";
  if (kind === "layout") renderLayoutMenu(pop);
  if (kind === "quality") renderQualityMenu(pop);
  if (kind === "frame") renderFrameMenu(pop);
  if (kind === "settings") renderSettingsMenu(pop);
  if (kind === "participants") renderParticipantsMenu(pop);
  if (kind === "more") renderMoreMenu(pop);
  pop.classList.remove("hidden");
  positionCallPopover(anchor);
}
function hideCallPopover() {
  $("#call-popover").classList.add("hidden");
}
function positionCallPopover(anchor) {
  const pop = $("#call-popover");
  const r = anchor.getBoundingClientRect();
  const parent = $("#call-panel").getBoundingClientRect();
  pop.style.left = Math.max(12, r.left - parent.left - 80) + "px";
  pop.style.bottom = "78px";
}
function renderLayoutMenu(pop) {
  pop.innerHTML = '<div class="popover-title">Layout</div>' +
    '<button data-layout="grid">▦ <span>Grid</span><small>Balanced multi-tile</small></button>' +
    '<button data-layout="stage">▰ <span>Stage</span><small>Focus one participant</small></button>' +
    '<button data-layout="strip">▥ <span>Filmstrip</span><small>Wide stage + thumbnails</small></button>';
  pop.querySelectorAll("[data-layout]").forEach(b => b.onclick = () => {
    callState.settings.layout = b.dataset.layout;
    applyLayout();
    hideCallPopover();
  });
}
function renderFrameMenu(pop) {
  pop.innerHTML = '<div class="popover-title">Video frame</div>' +
    '<button data-frame="soft">Rounded <small>Soft corners</small></button>' +
    '<button data-frame="square">Square <small>Compact professional</small></button>' +
    '<button data-frame="cinema">Cinema <small>Wide cinematic tiles</small></button>' +
    '<button data-frame="glow">Glow <small>Premium live frame</small></button>';
  pop.querySelectorAll("[data-frame]").forEach(b => b.onclick = () => {
    callState.settings.frame = b.dataset.frame;
    applyAllFrames();
    hideCallPopover();
  });
}
function renderQualityMenu(pop) {
  const options = Object.keys(QUALITY_PRESETS).map(q =>
    '<button data-quality="' + q + '">' + q + '<small>' + QUALITY_PRESETS[q].width + "×" + QUALITY_PRESETS[q].height + " · " + QUALITY_PRESETS[q].frameRate + "fps</small></button>"
  ).join("");
  pop.innerHTML = '<div class="popover-title">Video quality</div>' +
    '<button data-quality="auto">Auto <small>Adaptive to network</small></button>' + options +
    '<div class="quality-note">Higher quality uses more bandwidth. Auto adapts the capture target.</div>';
  pop.querySelectorAll("[data-quality]").forEach(b => b.onclick = () => {
    if (b.dataset.quality === "auto") {
      callState.settings.autoQuality = true;
      hideCallPopover();
      showCallToast("Adaptive quality enabled");
      return;
    }
    callState.settings.autoQuality = false;
    applyQuality(b.dataset.quality, QUALITY_PRESETS[b.dataset.quality].frameRate);
  });
}
function renderMoreMenu(pop) {
  pop.innerHTML = '<div class="popover-title">Call tools</div>' +
    '<button data-more="record">● <span>Recording</span><small>UI-ready recording slot</small></button>' +
    '<button data-more="share">↗ <span>Share room</span><small>Copy the current page link</small></button>' +
    '<button data-more="refresh">↻ <span>Refresh devices</span><small>Re-enumerate cameras and microphones</small></button>';
  pop.querySelector('[data-more="share"]').onclick = async () => {
    await navigator.clipboard?.writeText(location.href);
    showCallToast("Room link copied");
  };
  pop.querySelector('[data-more="refresh"]').onclick = async () => {
    await navigator.mediaDevices?.enumerateDevices();
    showCallToast("Devices refreshed");
    hideCallPopover();
  };
  pop.querySelector('[data-more="record"]').onclick = () => {
    showCallToast("Recording controls can be connected to server storage later");
  };
}
function showCallToast(text) {
  const t = $("#call-toast");
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(showCallToast.timer);
  showCallToast.timer = setTimeout(() => t.classList.add("hidden"), 2400);
}
function renderParticipantsMenu(pop) {
  const tiles = [...document.querySelectorAll(".call-tile")];
  pop.innerHTML = '<div class="popover-title">Participants</div>' +
    tiles.map(t => '<div class="participant-line"><span class="avatar mini">' + escapeHtml(avatar(t.querySelector(".tile-overlay strong")?.textContent)) + '</span><strong>' +
      escapeHtml(t.querySelector(".tile-overlay strong")?.textContent || "Guest") + '</strong></div>').join("") +
    '<button id="copy-call-link" class="copy-link">Copy room link</button>';
  pop.querySelector("#copy-call-link").onclick = async () => {
    await navigator.clipboard?.writeText(location.href);
    pop.querySelector("#copy-call-link").textContent = "Copied";
  };
}
async function renderSettingsMenu(pop) {
  pop.innerHTML = '<div class="popover-title">Call settings</div><div class="settings-list">' +
    '<label>Microphone<select id="setting-mic"></select></label>' +
    '<label>Camera<select id="setting-camera"></select></label>' +
    '<label>Speaker<select id="setting-speaker"></select></label>' +
    '<label class="check"><input id="setting-mirror" type="checkbox" ' + (callState.settings.mirror ? "checked" : "") + '> Mirror camera preview</label>' +
    '<label class="check"><input id="setting-ns" type="checkbox" ' + (callState.settings.noiseSuppression ? "checked" : "") + '> Noise suppression</label>' +
    '<label class="check"><input id="setting-ec" type="checkbox" ' + (callState.settings.echoCancellation ? "checked" : "") + '> Echo cancellation</label>' +
    '</div>';
  await populateDevices();
  $("#setting-mic").onchange = e => switchInputDevice("audio", e.target.value);
  $("#setting-camera").onchange = e => switchInputDevice("video", e.target.value);
  $("#setting-speaker").onchange = e => setOutputDevice(e.target.value);
  $("#setting-mirror").onchange = e => {
    callState.settings.mirror = e.target.checked;
    ensureSelfTile();
  };
  $("#setting-ns").onchange = e => callState.settings.noiseSuppression = e.target.checked;
  $("#setting-ec").onchange = e => callState.settings.echoCancellation = e.target.checked;
}
async function populateDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const groups = { audioinput: $("#setting-mic"), videoinput: $("#setting-camera"), audiooutput: $("#setting-speaker") };
  Object.entries(groups).forEach(([kind, select]) => {
    if (!select) return;
    const list = devices.filter(d => d.kind === kind);
    select.innerHTML = list.map(d => '<option value="' + escapeHtml(d.deviceId) + '">' +
      escapeHtml(d.label || (kind === "videoinput" ? "Camera" : "Microphone")) + "</option>").join("");
    if (kind === "audioinput" && callState.devices.mic) select.value = callState.devices.mic;
    if (kind === "videoinput" && callState.devices.camera) select.value = callState.devices.camera;
    if (kind === "audiooutput" && callState.devices.speaker) select.value = callState.devices.speaker;
  });
}
async function switchInputDevice(kind, deviceId) {
  callState.devices[kind === "audio" ? "mic" : "camera"] = deviceId;
  const constraints = kind === "audio"
    ? { audio: { deviceId: { exact: deviceId }, echoCancellation: callState.settings.echoCancellation, noiseSuppression: callState.settings.noiseSuppression, autoGainControl: callState.settings.autoGainControl }, video: false }
    : { audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: Number(callState.settings.fps) } } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const newTrack = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  const oldTrack = kind === "audio" ? callState.micTrack : callState.cameraTrack;
  if (oldTrack) oldTrack.stop();
  if (kind === "audio") {
    callState.micTrack = newTrack;
    callState.localStream?.addTrack(newTrack);
  } else {
    callState.cameraTrack = newTrack;
    callState.localStream?.addTrack(newTrack);
    ensureSelfTile();
  }
  for (const [, item] of callState.peers) {
    const sender = item.pc.getSenders().find(s => s.track?.kind === kind);
    if (sender) await sender.replaceTrack(newTrack);
  }
}
async function setOutputDevice(deviceId) {
  callState.devices.speaker = deviceId;
  const media = [...document.querySelectorAll("#call-stage video")];
  for (const el of media) {
    if (typeof el.setSinkId === "function") {
      try { await el.setSinkId(deviceId); } catch {}
    }
  }
}
function bindSpeaker(video) {
  const sink = callState.devices.speaker;
  if (sink && typeof video.setSinkId === "function") video.setSinkId(sink).catch(() => {});
}

function openCallPopoverFrom(btn, kind) {
  togglePopover(kind, btn);
}
function updateCallDuration() {}

$("#voice-call-btn").onclick = () => startCall("voice");
$("#video-call-btn").onclick = () => startCall("video");
$("#hangup-btn").onclick = leaveCall;
$("#close-call").onclick = leaveCall;
$("#minimize-call").onclick = () => {
  $("#call-panel").classList.toggle("minimized");
};
$("#mic-btn").onclick = toggleMic;
$("#camera-btn").onclick = toggleCamera;
$("#share-btn").onclick = toggleScreenShare;
$("#layout-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "layout");
$("#quality-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "quality");
$("#frames-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "frame");
$("#settings-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "settings");
$("#participants-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "participants");
$("#incoming-decline").onclick = () => {
  pendingIncomingCall = null;
  $("#incoming-call").classList.add("hidden");
};
$("#incoming-accept").onclick = async () => {
  const incoming = pendingIncomingCall;
  pendingIncomingCall = null;
  $("#incoming-call").classList.add("hidden");
  if (!incoming) return;
  const targetChannel = channels.find(c => String(c.id) === String(incoming.channelId));
  if (targetChannel) currentChannel = targetChannel;
  await startCall(incoming.mode === "voice" ? "voice" : "video");
};
$("#more-call-btn").onclick = e => openCallPopoverFrom(e.currentTarget, "more");
$("#quick-share-btn").onclick = () => {
  if (!callState.active) return startCall("video");
  toggleScreenShare();
};
$("#dock-mic").onclick = toggleMic;
$("#dock-screen").onclick = toggleScreenShare;
$("#dock-leave").onclick = leaveCall;
document.addEventListener("click", e => {
  if (!e.target.closest("#call-popover") && !e.target.closest(".call-btn")) hideCallPopover();
});

async function refreshDevicesOnPermission() {
  try { await navigator.mediaDevices?.getUserMedia({ audio: true, video: false }); } catch {}
}

(async () => {
  try {
    await enterAsGuest();
    const invite = new URLSearchParams(location.search).get("invite");
    if (invite) {
      await api("/api/invites/" + encodeURIComponent(invite) + "/accept", { method: "POST", body: "{}" }).catch(() => {});
      await loadServers();
    }
  } catch (err) {
    showError(err.message);
  }
})();
/* ===========================
   ORBIT PREMIUM PRODUCT LAYER
   =========================== */
const orbitUI = {
  view: "home",
  searchTimer: null,
  commandIndex: 0,
  commandItems: [],
  settingsSection: "appearance",
  saved: JSON.parse(localStorage.getItem("orbit_saved") || "[]"),
  notes: JSON.parse(localStorage.getItem("orbit_notes") || "[]"),
  profile: JSON.parse(localStorage.getItem("orbit_profile") || "null") || {
    displayName: "",
    status: "Online",
    bio: "Building in public with Orbit.",
    theme: "Midnight",
    accent: "#7652e8"
  }
};

const pageConfig = {
  home:{eyebrow:"ORBIT / COMMAND CENTER",title:"Home",subtitle:"A single control surface for your communities, conversations, and live rooms."},
  discover:{eyebrow:"DISCOVER",title:"Discover communities",subtitle:"Explore featured spaces, categories, and new conversations."},
  dms:{eyebrow:"DIRECT MESSAGES",title:"Messages",subtitle:"Private conversations, groups, and recent contacts."},
  friends:{eyebrow:"SOCIAL GRAPH",title:"Friends",subtitle:"Online people, requests, suggestions, and blocked users."},
  notifications:{eyebrow:"INBOX",title:"Notifications",subtitle:"Mentions, replies, calls, requests, and system events."},
  saved:{eyebrow:"LIBRARY",title:"Saved",subtitle:"Everything you deliberately kept for later."},
  explore:{eyebrow:"EXPLORE",title:"Explore",subtitle:"Media, events, polls, files, and community activity."},
  settings:{eyebrow:"PREFERENCES",title:"Settings",subtitle:"Fine-grained control over appearance, privacy, voice, and performance."}
};

function orbitToast(title, body="", kind="") {
  const stack=$("#toast-stack");
  if(!stack) return;
  const node=document.createElement("div");
  node.className="toast "+kind;
  node.innerHTML='<div><strong>'+escapeHtml(title)+'</strong>'+(body?'<span>'+escapeHtml(body)+'</span>':'')+'</div>';
  stack.appendChild(node);
  setTimeout(()=>node.remove(),3200);
}
function setView(view) {
  orbitUI.view=view;
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const global=$("#global-page"), chat=$("#chat-view");
  if(view==="home" && !servers?.length) view="home";
  if(["home","discover","dms","friends","notifications","saved","explore","settings"].includes(view)) {
    global.classList.remove("hidden");
    chat.classList.add("hidden");
    $("#members-panel").classList.add("hidden");
    $("#thread-panel").classList.add("hidden");
    renderPage(view);
  } else {
    global.classList.add("hidden");
    chat.classList.remove("hidden");
  }
}
function navigateChat() {
  setView("chat");
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.remove("active"));
}
function renderPage(view) {
  const cfg=pageConfig[view]||pageConfig.home;
  $("#page-eyebrow").textContent=cfg.eyebrow;
  $("#page-title").textContent=cfg.title;
  $("#page-subtitle").textContent=cfg.subtitle;
  $("#page-actions").innerHTML="";
  if(view==="home") renderHome();
  if(view==="discover") renderDiscover();
  if(view==="dms") renderDMs();
  if(view==="friends") renderFriends();
  if(view==="notifications") renderNotifications();
  if(view==="saved") renderSaved();
  if(view==="explore") renderExplore();
  if(view==="settings") renderSettings();
}
function safeName() {
  return me?.username || "Guest";
}
function demoPeople() {
  const base=(servers||[]).flatMap(s=>s.id?[]:[]);
  const known=document.querySelectorAll("#member-list .member");
  const names=[...known].map(x=>x.querySelector("strong")?.textContent).filter(Boolean);
  return [...new Set([safeName(),"Nova","Apex","Luna","Mika","Rex",...names])].map((name,i)=>({
    name,status:i%4===0?"Idle":i%5===0?"Do Not Disturb":"Online",role:i===0?"owner":"member",initial:avatar(name)
  }));
}
function metricCard(label,value,detail){return '<div class="metric"><span>'+label+'</span><strong>'+value+'</strong><span>'+detail+'</span></div>'}
function renderHome() {
  const active=(servers||[]).length;
  $("#page-actions").innerHTML='<button id="home-create-server">+ Create server</button><button id="home-search">Search</button>';
  $("#page-body").innerHTML=
  '<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">CONTROL YOUR COMMUNITY</span><h2>Connect. Create. Belong.</h2><p>Orbit combines chat, communities, live voice, video, discovery, and power-user controls in one focused workspace.</p><button class="hero-action" id="home-open-chat">Open #'+escapeHtml(currentChannel?.name||"general")+'</button></div>'+
    '<div class="hero-card"><span class="eyebrow">LIVE NOW</span><h2>'+escapeHtml(currentChannel?.name||"Lounge")+'</h2><p>Start a private voice or video room, share your screen, and tune quality in real time.</p><button class="hero-action" id="home-start-call">Start video</button></div>'+
    '<div class="hero-card"><span class="eyebrow">YOUR PROFILE</span><h2>'+escapeHtml(orbitUI.profile.displayName||safeName())+'</h2><p>'+escapeHtml(orbitUI.profile.bio||"Make your profile feel like you.")+'</p><button class="hero-action" id="home-profile">Customize</button></div>'+
  '</div>'+
  '<div class="metric-grid" id="home-metrics">'+metricCard("Communities",active,"Connected workspaces")+metricCard("Your status",orbitUI.profile.status,"Presence")+metricCard("Unread",String(3),"Notifications")+metricCard("Call quality","HD","Ready for live rooms")+'</div>'+
  '<div class="section-block"><div class="section-heading"><h3>Quick actions</h3><span>Designed for keyboard-first power users</span></div><div class="card-grid">'+
   quickCard("⌕","Search everything","Find people, channels, messages, and servers.","home-search")+
   quickCard("◫","Create a poll","Ask your community with live results.","home-poll")+
   quickCard("◎","Open friends","See who is online and start a DM.","home-friends")+
  '</div></div>'+
  '<div class="section-block"><div class="section-heading"><h3>Recent activity</h3><span>Live workspace signal</span></div><div class="list-card">'+
    activityRow("◉","Nova joined Orbit Lobby","2 minutes ago","View")+
    activityRow("✦","A new event is ready to schedule","10 minutes ago","Open")+
    activityRow("↗","Screen sharing is ready in Lounge","18 minutes ago","Join")+
  '</div></div>';
  bindHomeActions();
}
function quickCard(icon,title,desc,id){return '<button class="content-card quick-action" data-action="'+id+'"><div class="chip">'+icon+'</div><h4>'+title+'</h4><p>'+desc+'</p></button>'}
function activityRow(icon,title,detail,action){return '<div class="list-row"><div class="chip">'+icon+'</div><div><strong>'+title+'</strong><span>'+detail+'</span></div><button class="activity-action">'+action+'</button></div>'}
function bindHomeActions(){
  $("#home-open-chat")?.addEventListener("click",navigateChat);
  $("#home-start-call")?.addEventListener("click",()=>{navigateChat();startCall("video")});
  $("#home-profile")?.addEventListener("click",()=>openProfileSettings());
  $("#home-create-server")?.addEventListener("click",()=>$("#new-server").click());
  $("#home-search")?.addEventListener("click",openCommandPalette);
  document.querySelectorAll(".quick-action").forEach(el=>el.addEventListener("click",()=>{
    const a=el.dataset.action;
    if(a==="home-search") openCommandPalette();
    if(a==="home-poll") openPollComposer();
    if(a==="home-friends") setView("friends");
  }));
}
function renderDiscover(){
  $("#page-actions").innerHTML='<button id="discover-search">Search communities</button><button id="discover-category">All categories</button>';
  const cards=[
    ["Nebula Arena","Gaming","12.4k","1.2k","Competitive matches and community events."],
    ["Build in Public","Technology","7.8k","620","Founders, makers, and shipping every week."],
    ["Creative Lab","Art & Media","4.2k","402","Design critiques, media nights, and showcases."],
    ["Code Foundry","Programming","9.1k","880","Projects, Q&A, pair programming, and help."],
    ["Study Hall","Education","5.6k","301","Focused study rooms with live accountability."],
    ["Night Shift","Community","3.3k","288","Late-night chats, music, and casual calls."]
  ];
  $("#page-body").innerHTML='<div class="card-grid">'+cards.map((x,i)=>
    '<div class="hero-card community-card"><span class="eyebrow">'+x[1].toUpperCase()+'</span><h2>'+x[0]+'</h2><p>'+x[4]+'</p><div><span class="chip">'+x[2]+' members</span><span class="chip">'+x[3]+' online</span></div><button class="hero-action discover-join" data-name="'+x[0]+'">View community</button></div>'
  ).join("")+'</div>';
  document.querySelectorAll(".discover-join").forEach(btn=>btn.onclick=()=>orbitToast("Preview opened",btn.dataset.name+" can be joined when public discovery is enabled.","success"));
  $("#discover-search")?.addEventListener("click",openCommandPalette);
}
function renderDMs(){
  const people=["Nova","Apex","Luna","Mika"];
  $("#page-actions").innerHTML='<button id="new-dm">New message</button><button id="new-group">New group</button>';
  $("#page-body").innerHTML='<div class="list-card">'+people.map((p,i)=>
    '<div class="list-row"><div class="avatar">'+avatar(p)+'</div><div><strong>'+p+'</strong><span>'+(i===0?"Online · playing a game":i===1?"Last seen 4 min ago":"Online · idle")+'</span></div><button class="dm-open" data-person="'+p+'">Open</button></div>'
  ).join("")+'</div><div class="section-block"><div class="section-heading"><h3>Group conversations</h3><span>Private rooms</span></div><div class="card-grid">'+
    quickCard("◉","Studio","5 members · project room","group-studio")+quickCard("◎","Night Crew","8 members · voice + text","group-night")+quickCard("✦","Creators","12 members · media sharing","group-creators")+
  '</div></div>';
  document.querySelectorAll(".dm-open").forEach(btn=>btn.onclick=()=>orbitToast("DM ready","Opening a private conversation with "+btn.dataset.person+".","success"));
  $("#new-dm")?.addEventListener("click",()=>openModal("New direct message",'<input placeholder="Search username"><button class="primary" id="modal-dm-start">Start conversation</button>'));
  $("#new-group")?.addEventListener("click",()=>openModal("Create group DM",'<input placeholder="Group name"><textarea placeholder="Invite usernames"></textarea><button class="primary" id="modal-group-create">Create group</button>'));
}
function renderFriends(){
  const tabs=["All","Online","Pending","Suggestions","Blocked"];
  $("#page-actions").innerHTML='<button id="add-friend">+ Add friend</button><button id="friend-search">Search users</button>';
  $("#page-body").innerHTML='<div class="settings-nav friend-tabs">'+tabs.map((t,i)=>'<button class="'+(i===0?"active":"")+'">'+t+'</button>').join("")+'</div><div class="section-block"><div class="list-card">'+demoPeople().map((p,i)=>
    '<div class="list-row"><div class="avatar">'+p.initial+'</div><div><strong>'+escapeHtml(p.name)+'</strong><span>'+p.status+' · '+(p.role==="owner"?"Owner":"Mutual server")+'</span></div><button data-friend="'+escapeHtml(p.name)+'">'+(i===0?"Profile":"Message")+'</button></div>'
  ).join("")+'</div></div>';
  $("#add-friend")?.addEventListener("click",()=>openModal("Add friend",'<input id="friend-name" placeholder="Username"><button class="primary" id="send-friend-request">Send request</button>'));
  $("#friend-search")?.addEventListener("click",openCommandPalette);
  document.querySelectorAll("[data-friend]").forEach(b=>b.onclick=()=>openProfilePopup(b.dataset.friend));
}
function renderNotifications(){
  const items=[
    ["Mentions","Nova mentioned you in #general","2 min ago","◇"],
    ["Friend request","Apex sent you a friend request","8 min ago","◎"],
    ["Call","Luna started a video room in Lounge","16 min ago","▣"],
    ["Event","Community night starts tomorrow","1 hr ago","★"],
    ["Security","New guest session detected on this device","Today","!"]
  ];
  $("#page-actions").innerHTML='<button id="mark-all-read">Mark all read</button><button id="notification-settings">Preferences</button>';
  $("#page-body").innerHTML='<div class="list-card">'+items.map((x,i)=>'<div class="list-row"><div class="chip">'+x[3]+'</div><div><strong>'+x[0]+'</strong><span>'+x[1]+' · '+x[2]+'</span></div><button class="notification-open" data-i="'+i+'">Open</button></div>').join("")+'</div>';
  $("#mark-all-read")?.addEventListener("click",()=>{$("#notification-badge").textContent="0";orbitToast("Inbox cleared","All notifications marked as read.","success")});
  $("#notification-settings")?.addEventListener("click",()=>renderSettings("notifications"));
}
function renderSaved(){
  const saved=orbitUI.saved.length?orbitUI.saved:[{title:"Product roadmap",meta:"#general · saved just now",text:"Build a community platform that feels premium and fast."},{title:"Voice quality checklist",meta:"Call settings",text:"720p, 30fps, echo cancellation, noise suppression."}];
  $("#page-actions").innerHTML='<button id="clear-saved">Clear all</button>';
  $("#page-body").innerHTML='<div class="list-card">'+saved.map((x,i)=>'<div class="list-row"><div class="chip">⌑</div><div><strong>'+escapeHtml(x.title)+'</strong><span>'+escapeHtml(x.meta||"Saved")+'</span></div><button data-unsave="'+i+'">Remove</button></div>').join("")+'</div>';
  $("#clear-saved")?.addEventListener("click",()=>{orbitUI.saved=[];localStorage.setItem("orbit_saved","[]");renderSaved();orbitToast("Saved cleared")});
}
function renderExplore(){
  $("#page-actions").innerHTML='<button id="explore-media">Media gallery</button><button id="explore-event">Create event</button>';
  $("#page-body").innerHTML='<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">EVENTS</span><h2>Community Night</h2><p>Friday · 20:00 · Lounge</p><button class="hero-action" id="explore-event-open">View event</button></div>'+
    '<div class="hero-card"><span class="eyebrow">MEDIA</span><h2>Server gallery</h2><p>Images, videos, documents, and links organized by channel.</p><button class="hero-action" id="explore-media-open">Open gallery</button></div>'+
    '<div class="hero-card"><span class="eyebrow">POLLS</span><h2>Live opinion</h2><p>Ask, vote, and visualize results in the conversation.</p><button class="hero-action" id="explore-poll-open">Create poll</button></div>'+
  '</div>';
  $("#explore-media")?.addEventListener("click",()=>orbitToast("Gallery ready","Connect storage to enable persistent uploads.","success"));
  $("#explore-event")?.addEventListener("click",()=>openEventComposer());
  $("#explore-event-open")?.addEventListener("click",()=>openEventComposer());
  $("#explore-media-open")?.addEventListener("click",()=>orbitToast("Media gallery","Preview mode is ready."));
  $("#explore-poll-open")?.addEventListener("click",openPollComposer);
}
function renderSettings(section=orbitUI.settingsSection){
  orbitUI.settingsSection=section;
  const sections=[["account","Account"],["profile","Profile"],["privacy","Privacy"],["appearance","Appearance"],["voice","Voice & Video"],["notifications","Notifications"],["accessibility","Accessibility"],["performance","Performance"],["advanced","Advanced"],["security","Security"]];
  $("#page-body").innerHTML='<div class="settings-layout"><nav class="settings-nav">'+sections.map(([id,label])=>'<button class="'+(id===section?"active":"")+'" data-settings="'+id+'">'+label+'</button>').join("")+'</nav><div id="settings-card" class="settings-card"></div></div>';
  document.querySelectorAll("[data-settings]").forEach(b=>b.onclick=()=>renderSettings(b.dataset.settings));
  renderSettingsCard(section);
}
function settingRow(title,desc,key,value) {
  const on=value?" on":"";
  return '<div class="setting-row"><div><strong>'+title+'</strong><span>'+desc+'</span></div><button class="switch'+on+'" data-toggle="'+key+'"></button></div>';
}
function renderSettingsCard(section){
  const card=$("#settings-card");
  if(section==="appearance"){
    const dark=localStorage.getItem("orbit_theme")!=="light", reduced=localStorage.getItem("orbit_motion")==="reduced", compact=localStorage.getItem("orbit_density")==="compact", blur=localStorage.getItem("orbit_blur")!=="off";
    card.innerHTML='<h3>Appearance</h3><p>Shape the visual system without losing the premium Orbit feel.</p>'+
      settingRow("Dark theme","Deep graphite UI with electric accents.","theme",dark)+
      settingRow("Reduced motion","Keep transitions subtle and efficient.","motion",reduced)+
      settingRow("Compact density","Tighter message and navigation spacing.","density",compact)+
      settingRow("Glass blur","Use backdrop blur in overlays and panels.","blur",blur)+
      '<div class="setting-row"><div><strong>Accent</strong><span>Current '+escapeHtml(orbitUI.profile.accent)+'</span></div><input id="accent-picker" type="color" value="'+escapeHtml(orbitUI.profile.accent)+'" style="width:44px;height:30px"></div>';
  } else if(section==="voice"){
    card.innerHTML='<h3>Voice & Video</h3><p>Professional capture, quality, and connection controls.</p>'+
      settingRow("Noise suppression","Reduce fan, keyboard, and room noise.","noise",true)+
      settingRow("Echo cancellation","Avoid feedback while speaking.","echo",true)+
      settingRow("Automatic gain","Normalize microphone levels.","gain",true)+
      settingRow("Adaptive quality","Adjust capture based on network conditions.","autoQuality",true)+
      '<div class="setting-row"><div><strong>Preferred quality</strong><span>Used when starting a video room.</span></div><select id="global-quality" style="background:#0d131a;border:1px solid #2a3340;color:#fff;border-radius:8px;padding:8px"><option>720p</option><option>1080p</option><option>1080p60</option><option>1440p</option></select></div>';
  } else if(section==="profile"){
    card.innerHTML='<h3>Profile</h3><p>Guest mode keeps sign-up optional while still letting you look distinct.</p>'+
      '<input id="profile-display" value="'+escapeHtml(orbitUI.profile.displayName||safeName())+'" placeholder="Display name">'+
      '<textarea id="profile-bio" placeholder="Bio">'+escapeHtml(orbitUI.profile.bio||"")+'</textarea>'+
      '<select id="profile-status"><option>Online</option><option>Idle</option><option>Do Not Disturb</option><option>Invisible</option></select>'+
      '<button class="primary" id="save-profile-settings">Save profile</button>';
    $("#profile-status").value=orbitUI.profile.status||"Online";
    $("#save-profile-settings").onclick=()=>{orbitUI.profile.displayName=$("#profile-display").value.trim()||safeName();orbitUI.profile.bio=$("#profile-bio").value.trim();orbitUI.profile.status=$("#profile-status").value;localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));$("#me-name").textContent=orbitUI.profile.displayName;orbitToast("Profile updated","Your guest profile is ready.","success");};
  } else if(section==="account"){
    card.innerHTML='<h3>Account</h3><p>Orbit is currently using frictionless guest mode, so no account is required.</p><div class="content-card"><h4>Guest session</h4><p>Stored locally on this browser and protected by a signed session token.</p><span class="chip">Guest mode</span><span class="chip">30 day session</span></div>';
  } else if(section==="privacy"){
    card.innerHTML='<h3>Privacy</h3><p>Control how others can interact with you.</p>'+settingRow("Friend requests","Allow others to send requests.","friendReq",true)+settingRow("Direct messages","Allow DMs from shared communities.","dm",true)+settingRow("Read receipts","Show when you have opened a message.","receipts",false);
  } else if(section==="notifications"){
    card.innerHTML='<h3>Notifications</h3><p>Decide what deserves your attention.</p>'+settingRow("Desktop alerts","Show important alerts outside the app.","desktop",true)+settingRow("Mentions","Notify when someone mentions you.","mentions",true)+settingRow("DMs","Notify for private messages.","dmNotify",true)+settingRow("Calls","Notify when someone starts a call.","calls",true);
  } else if(section==="accessibility"){
    card.innerHTML='<h3>Accessibility</h3><p>Make Orbit easier to scan and operate.</p>'+settingRow("Reduced motion","Minimize transitions and micro-animation.","a11yMotion",false)+settingRow("High contrast","Boost borders and text contrast.","contrast",false)+settingRow("Larger text","Increase the app UI scale.","largeText",false)+settingRow("Reduced transparency","Remove glass blur layers.","reducedTransparency",false);
  } else if(section==="performance"){
    card.innerHTML='<h3>Performance</h3><p>Prefer smooth interaction over visual effects.</p>'+settingRow("Performance mode","Limit blur and reduce expensive effects.","perf",false)+settingRow("Hardware acceleration","Prefer GPU accelerated rendering.","gpu",true)+settingRow("Lazy media","Load rich media on demand.","lazy",true);
  } else if(section==="security"){
    card.innerHTML='<h3>Security center</h3><p>Visibility into the current guest session.</p><div class="list-card">'+activityRow("✓","Current browser session","Active now","Keep")+activityRow("◎","Signed guest token","Valid","Details")+activityRow("⚠","Persistent storage","Not connected","Setup")+'</div>';
  } else {
    card.innerHTML='<h3>Advanced</h3><p>Power-user switches and diagnostics.</p>'+settingRow("Developer mode","Expose debug information and connection status.","dev",false)+settingRow("Keyboard shortcuts","Enable global shortcuts.","shortcuts",true)+settingRow("Command palette","Use Ctrl+K to navigate faster.","palette",true);
  }
  document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>{
    b.classList.toggle("on");
    const key=b.dataset.toggle;
    if(key==="theme"){localStorage.setItem("orbit_theme",b.classList.contains("on")?"dark":"light");document.body.classList.toggle("light-theme",!b.classList.contains("on"))}
    if(key==="motion"){localStorage.setItem("orbit_motion",b.classList.contains("on")?"reduced":"full");document.body.classList.toggle("reduced-motion",b.classList.contains("on"))}
    if(key==="density"){localStorage.setItem("orbit_density",b.classList.contains("on")?"compact":"comfortable");document.body.classList.toggle("compact",b.classList.contains("on"))}
    if(key==="blur"){localStorage.setItem("orbit_blur",b.classList.contains("on")?"on":"off")}
    orbitToast("Preference updated");
  });
  $("#accent-picker")?.addEventListener("change",e=>{orbitUI.profile.accent=e.target.value;document.documentElement.style.setProperty("--accent",e.target.value);localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));});
}
function openProfilePopup(name){
  openModal(name+" · profile",'<div class="hero-card"><span class="eyebrow">PROFILE</span><h2>'+escapeHtml(name)+'</h2><p>Online community member with shared spaces and mutual conversations.</p><span class="chip">Online</span><span class="chip">2 mutual servers</span><span class="chip">Guest</span></div><div class="list-card" style="margin-top:10px">'+activityRow("✦","Activity","Playing in Orbit","View")+activityRow("◌","Mutual server","Orbit Lobby","Open")+'</div>');
}
function openProfileSettings(){setView("settings");renderSettings("profile");}
function openModal(title,body,subtitle=""){ $("#modal-title").textContent=title;$("#modal-subtitle").textContent=subtitle;$("#modal-body").innerHTML=body;$("#modal").classList.remove("hidden"); }
function closeOrbitModal(){ $("#modal").classList.add("hidden"); }
$("#modal-close")?.addEventListener("click",closeOrbitModal);
$("#modal")?.addEventListener("click",e=>{if(e.target.id==="modal")closeOrbitModal()});

async function openSearch(query){
  const q=String(query||"").trim();
  if(!q) return openCommandPalette();
  try{
    const data=await api("/api/search?q="+encodeURIComponent(q));
    openModal("Search results","<div class=\"list-card\">"+
      data.users.map(u=>activityRow("◎",u.username,"User · "+(u.guest?"Guest":"Member"),"Open")).join("")+
      data.servers.map(s=>activityRow("◈",s.name,s.memberCount+" members","Open")).join("")+
      data.channels.map(c=>activityRow(c.type==="voice"?"◉":"#","#"+c.name,c.type,"Open")).join("")+
      data.messages.map(m=>activityRow("◫",m.content.slice(0,55),m.username,"Open")).join("")+
    "</div>");
  }catch(err){orbitToast("Search failed",err.message,"error")}
}

const commands=[
  ["⌂","Open Home","home"],["✦","Discover communities","discover"],["◌","Direct messages","dms"],["◎","Friends","friends"],["◇","Notifications","notifications"],["⌑","Saved","saved"],["⌖","Explore","explore"],["⚙","Settings","settings"],
  ["+","Create server","create-server"],["#","Create channel","create-channel"],["◉","Join voice room","voice"],["▣","Start video call","video"],["↗","Share screen","share"],["⌕","Search","search"],["⚡","Toggle performance mode","performance"]
];
function openCommandPalette(){
  $("#command-palette").classList.remove("hidden");$("#command-input").value="";orbitUI.commandIndex=0;renderCommandResults("");setTimeout(()=>$("#command-input").focus(),30);
}
function closeCommandPalette(){$("#command-palette").classList.add("hidden")}
function renderCommandResults(query){
  const q=String(query||"").toLowerCase();
  orbitUI.commandItems=commands.filter(c=>(c[1]+" "+c[2]).toLowerCase().includes(q));
  $("#command-results").innerHTML=(orbitUI.commandItems.length?orbitUI.commandItems: [["⌕","No command matches","none"]]).map((c,i)=>'<button class="command-item '+(i===orbitUI.commandIndex?"selected":"")+'" data-command="'+i+'"><span class="command-icon">'+c[0]+'</span><div><strong>'+c[1]+'</strong><span>'+c[2]+'</span></div><span>↵</span></button>').join("");
  document.querySelectorAll(".command-item").forEach((b,i)=>b.onclick=()=>runCommand(i));
}
function runCommand(i){
  const item=orbitUI.commandItems[i]; if(!item) return;
  closeCommandPalette();
  const act=item[2];
  if(pageConfig[act]) return setView(act);
  if(act==="create-server") return $("#new-server").click();
  if(act==="create-channel") return $("#new-channel").click();
  if(act==="voice") return navigateChat(),startCall("voice");
  if(act==="video") return navigateChat(),startCall("video");
  if(act==="share") return navigateChat(),callState.active?toggleScreenShare():startCall("video");
  if(act==="search") return openSearch("");
  if(act==="performance"){document.body.classList.toggle("reduced-motion");orbitToast("Performance mode",document.body.classList.contains("reduced-motion")?"Enabled":"Disabled");}
}
$("#command-input")?.addEventListener("input",e=>renderCommandResults(e.target.value));
$("#command-palette")?.addEventListener("click",e=>{if(e.target.id==="command-palette")closeCommandPalette()});
window.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette();return}
  if(e.key==="Escape"){closeCommandPalette();hideCallPopover();$("#context-menu").classList.add("hidden");return}
  if((e.ctrlKey||e.metaKey)&&e.key==="/"){setView("settings");renderSettings("advanced");return}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="m"){e.preventDefault();toggleMic();return}
});
$("#quick-search")?.addEventListener("keydown",e=>{if(e.key==="Enter")openSearch(e.target.value)});
$("#sidebar-search")?.addEventListener("click",()=>openCommandPalette());
document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));

$("#profile-card-btn")?.addEventListener("click",()=>openProfileSettings());
$("#join-server")?.addEventListener("click",()=>openModal("Join server",'<input id="invite-code" placeholder="Invite code or full invite URL"><button class="primary" id="accept-invite">Join community</button>'));
document.addEventListener("click",async e=>{
  if(e.target.id==="accept-invite"){
    const raw=$("#invite-code").value.trim();
    const code=raw.includes("invite=")?new URL(raw).searchParams.get("invite"):raw;
    try{await api("/api/invites/"+encodeURIComponent(code)+"/accept",{method:"POST",body:"{}"});closeOrbitModal();await loadServers();orbitToast("Joined community","The server is now in your workspace.","success")}
    catch(err){orbitToast("Invite failed",err.message,"error")}
  }
  if(e.target.id==="poll-btn")openPollComposer();
  if(e.target.id==="send-friend-request"){orbitToast("Friend request sent","The user will see it in Notifications.","success");closeOrbitModal()}
  if(e.target.id==="modal-dm-start"){orbitToast("Conversation created","Your DM is ready.","success");closeOrbitModal()}
  if(e.target.id==="modal-group-create"){orbitToast("Group created","Your group DM is ready.","success");closeOrbitModal()}
});

function openPollComposer(){
  openModal("Create poll",'<input id="poll-question" placeholder="Ask your community a question"><input id="poll-a" placeholder="Option A"><input id="poll-b" placeholder="Option B"><input id="poll-c" placeholder="Option C (optional)"><button class="primary" id="create-poll">Publish poll</button>');
}
function openEventComposer(){
  openModal("Create community event",'<input placeholder="Event title"><input placeholder="Date & time"><select><option>Voice</option><option>Video</option><option>Gaming</option><option>Meeting</option></select><textarea placeholder="Description"></textarea><button class="primary" id="create-event">Create event</button>');
}
document.addEventListener("click",e=>{
  if(e.target.id==="create-poll"){closeOrbitModal();orbitToast("Poll published","Live results are ready in the channel.","success")}
  if(e.target.id==="create-event"){closeOrbitModal();orbitToast("Event created","Members can now mark Interested or Going.","success")}
});

document.addEventListener("contextmenu",e=>{
  const message=e.target.closest(".message");
  if(!message) return;
  e.preventDefault();
  const menu=$("#context-menu");
  menu.style.left=Math.min(e.clientX,window.innerWidth-210)+"px";
  menu.style.top=Math.min(e.clientY,window.innerHeight-260)+"px";
  menu.innerHTML='<button data-context="react">React</button><button data-context="reply">Reply</button><button data-context="thread">Create thread</button><button data-context="save">Bookmark</button><button data-context="copy">Copy message</button><button class="danger" data-context="delete">Delete</button>';
  menu.classList.remove("hidden");
  menu.querySelectorAll("[data-context]").forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.context;
    if(action==="copy") {await navigator.clipboard?.writeText(message.querySelector(".msg-body")?.textContent||"");orbitToast("Copied","Message copied to clipboard.","success");}
    if(action==="save"){orbitUI.saved.push({title:message.querySelector(".msg-head strong")?.textContent||"Message",meta:"#"+(currentChannel?.name||"channel")+" · saved",text:message.querySelector(".msg-body")?.textContent||""});localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));orbitToast("Saved","Message added to your library.","success");}
    if(action==="thread")openThreadFromElement(message);
    if(action==="reply"){ $("#message").value="@"+(message.querySelector(".msg-head strong")?.textContent||"user")+" "; $("#message").focus(); }
    menu.classList.add("hidden");
  });
});
window.addEventListener("click",e=>{if(!e.target.closest("#context-menu"))$("#context-menu")?.classList.add("hidden")});

function openThreadFromElement(el){
  $("#thread-panel").classList.remove("hidden");
  $("#thread-root").innerHTML='<div class="content-card"><strong>'+escapeHtml(el.querySelector(".msg-head strong")?.textContent||"Message")+'</strong><p>'+escapeHtml(el.querySelector(".msg-body")?.textContent||"")+'</p></div>';
  $("#thread-meta").textContent="0 replies";
  orbitUI.threadReplies=[];
}
$("#close-thread")?.addEventListener("click",()=>$("#thread-panel").classList.add("hidden"));
$("#thread-composer")?.addEventListener("submit",e=>{e.preventDefault();const v=$("#thread-input").value.trim();if(!v)return;$("#thread-messages").insertAdjacentHTML("beforeend",'<div class="message"><div class="avatar">'+avatar(safeName())+'</div><div><div class="msg-head"><strong>'+escapeHtml(safeName())+'</strong><time>now</time></div><div class="msg-body">'+escapeHtml(v)+'</div></div></div>');$("#thread-input").value="";$("#thread-meta").textContent=document.querySelectorAll("#thread-messages .message").length+" replies"});

document.addEventListener("click",e=>{
  const quick=e.target.closest("[data-action]");
  if(quick && !quick.closest("#page-body")) return;
});

// Patch message renderer for hover actions when the original function exists.
if(typeof appendMessage==="function"){
  const originalAppendMessage=appendMessage;
  appendMessage=function(m){
    const before=document.querySelectorAll("#messages .message").length;
    originalAppendMessage(m);
    const all=document.querySelectorAll("#messages .message");
    const el=all[all.length-1];
    if(!el)return;
    el.dataset.messageId=m.id||"";
    el.insertAdjacentHTML("afterbegin",'<div class="msg-actions"><button class="msg-action" data-msg-action="react">☺</button><button class="msg-action" data-msg-action="reply">↩</button><button class="msg-action" data-msg-action="thread">◫</button><button class="msg-action" data-msg-action="save">⌑</button><button class="msg-action" data-msg-action="more">⋯</button></div>');
    el.querySelectorAll("[data-msg-action]").forEach(b=>b.onclick=async()=>{
      const a=b.dataset.msgAction;
      if(a==="reply"){$("#message").value="@"+m.username+" ";$("#message").focus();}
      if(a==="thread")openThreadFromElement(el);
      if(a==="save"){orbitUI.saved.push({title:m.username,meta:"#"+(currentChannel?.name||"channel")+" · saved",text:m.content});localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));orbitToast("Saved","Message bookmarked.","success");}
      if(a==="react")orbitToast("Reaction added","👍");
      if(a==="more")openModal("Message actions",'<div class="list-card">'+activityRow("↩","Reply","Continue the conversation","Reply")+activityRow("◫","Thread","Open a focused thread","Open")+activityRow("⌑","Bookmark","Save for later","Save")+'</div>');
    });
  };
}
if(typeof selectChannel==="function"){
  const originalSelect=selectChannel;
  selectChannel=async function(channel){
    await originalSelect(channel);
    if(channel?.type==="voice"){startCall("voice").catch(()=>{});}
  };
}
if(typeof selectServer==="function"){
  const originalSelectServer=selectServer;
  selectServer=async function(s){navigateChat();await originalSelectServer(s);$("#workspace-avatar").textContent=avatar(s.name);};
}

window.addEventListener("load",()=>{
  const theme=localStorage.getItem("orbit_theme");
  const motion=localStorage.getItem("orbit_motion");
  const density=localStorage.getItem("orbit_density");
  const accent=orbitUI.profile.accent;
  if(theme==="light")document.body.classList.add("light-theme");
  if(motion==="reduced")document.body.classList.add("reduced-motion");
  if(density==="compact")document.body.classList.add("compact");
  document.documentElement.style.setProperty("--accent",accent||"#7652e8");
  setView("home");
});
