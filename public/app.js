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

const callState = {
  active: false,
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
  $("#me-status").textContent = "online · guest";
  connectRealtime();
  await loadServers();
}

function connectRealtime() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token }, transports: ["websocket", "polling"] });

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
    updateCallMeta();
  });

  socket.on("call:participant-left", ({ socketId }) => {
    removePeer(socketId);
    updateCallMeta();
  });

  socket.on("call:media-state", ({ socketId, muted, cameraOff, screenShare }) => {
    const tile = document.querySelector('.call-tile[data-peer="' + socketId + '"]');
    if (tile) {
      tile.classList.toggle("remote-muted", muted);
      tile.classList.toggle("voice-only", Boolean(cameraOff));
      if (screenShare) tile.classList.add("screen-sharing"); else tile.classList.remove("screen-sharing");
    }
  });

  socket.on("rtc:offer", async ({ from, fromUser, offer }) => {
    try {
      const pc = await ensurePeer(from, false, fromUser);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const item = callState.peers.get(from);
      if (item?.pendingCandidates?.length) {
        for (const candidate of item.pendingCandidates.splice(0)) {
          try { await pc.addIceCandidate(candidate); } catch (err) { console.warn("queued ICE", err); }
        }
      }
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
    try {
      await item.pc.setRemoteDescription(new RTCSessionDescription(answer));
      if (item.pendingCandidates?.length) {
        for (const candidate of item.pendingCandidates.splice(0)) {
          try { await item.pc.addIceCandidate(candidate); } catch (err) { console.warn("queued ICE", err); }
        }
      }
    } catch (err) { console.error(err); }
  });

  socket.on("rtc:ice", async ({ from, candidate }) => {
    const item = callState.peers.get(from);
    if (!item?.pc || !candidate) return;
    try {
      if (!item.pc.remoteDescription) {
        item.pendingCandidates.push(candidate);
        return;
      }
      await item.pc.addIceCandidate(candidate);
    } catch (err) { console.error("ICE candidate", err); }
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
  $("#channel-list").innerHTML = channels.map(c =>
    '<button class="channel ' + (String(currentChannel?.id) === String(c.id) ? "active" : "") +
    '" data-id="' + c.id + '"><span class="hash">#</span><span>' + escapeHtml(c.name) + "</span></button>"
  ).join("");
  document.querySelectorAll(".channel").forEach(btn => {
    btn.onclick = () => selectChannel(channels.find(c => String(c.id) === btn.dataset.id));
  });
}
async function selectChannel(channel) {
  if (callState.active && String(callState.roomId) !== String(channel.id)) leaveCall();
  currentChannel = channel;
  renderChannels();
  $("#channel-name").textContent = channel.name;
  $("#channel-meta").textContent = channel.type === "announcement" ? "Announcement channel" : "Realtime conversation";
  $("#message").placeholder = "Message #" + channel.name;
  $("#messages").innerHTML = "";
  const data = await api("/api/channels/" + channel.id + "/messages");
  data.messages.forEach(appendMessage);
  if (socket) socket.emit("channel:join", channel.id);
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
  openModal(
    "Create channel",
    '<input id="channel-name-input" placeholder="general"><select id="channel-type"><option value="text">Text</option><option value="announcement">Announcement</option></select><button class="primary" id="create-channel">Create channel</button>'
  );
};
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
let realtimeIceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" }
];
let realtimeConfigPromise = null;

async function loadRealtimeConfig() {
  if (realtimeConfigPromise) return realtimeConfigPromise;
  realtimeConfigPromise = api("/api/realtime-config").then(data => {
    if (Array.isArray(data?.iceServers) && data.iceServers.length) realtimeIceServers = data.iceServers;
    return realtimeIceServers;
  }).catch(err => {
    console.warn("realtime config fallback", err);
    return realtimeIceServers;
  });
  return realtimeConfigPromise;
}

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
  $("#call-panel").classList.remove("hidden");
  $("#call-title").textContent = currentChannel.name;
  $("#call-subtitle").textContent = mode === "voice" ? "Voice room" : "Video room";
  document.body.classList.add("call-open");

  try {
    await loadRealtimeConfig();
    await setupLocalMedia(mode);
    ensureSelfTile();
    socket.emit("call:join", { channelId: callState.roomId, mode });
    socket.emit("call:media-state", { channelId: callState.roomId, muted: false, cameraOff: mode === "voice", screenShare: false });
    setCallIndicator("LIVE");
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
    iceServers: realtimeIceServers,
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
  document.querySelectorAll(".call-tile").forEach(t => t.remove());
  $("#call-panel").classList.add("hidden");
  document.body.classList.remove("call-open");
  setCallIndicator("IDLE");
  updateCallMeta();
}

function setCallIndicator(text) {
  $("#call-quality-indicator").textContent = text;
  $("#call-quality-indicator").classList.toggle("good", text === "LIVE");
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
  el.classList.remove("frame-soft", "frame-square", "frame-cinema");
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
  if (socket && callState.roomId) socket.emit("call:media-state", { channelId: callState.roomId, muted: !callState.micTrack.enabled, cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true, screenShare: Boolean(callState.screenTrack) });
}
function toggleCamera() {
  if (!callState.cameraTrack) return;
  callState.cameraTrack.enabled = !callState.cameraTrack.enabled;
  $("#camera-btn").classList.toggle("active", callState.cameraTrack.enabled);
  $("#camera-btn").classList.toggle("off", !callState.cameraTrack.enabled);
  const selfTile = document.querySelector('.call-tile[data-peer="self"]');
  selfTile?.classList.toggle("voice-only", !callState.cameraTrack.enabled);
  if (socket && callState.roomId) socket.emit("call:media-state", { channelId: callState.roomId, muted: callState.micTrack ? !callState.micTrack.enabled : true, cameraOff: !callState.cameraTrack.enabled, screenShare: Boolean(callState.screenTrack) });
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
    if (socket && callState.roomId) socket.emit("call:media-state", { channelId: callState.roomId, muted: callState.micTrack ? !callState.micTrack.enabled : true, cameraOff: !callState.cameraTrack?.enabled, screenShare: true });
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
  if (socket && callState.roomId) socket.emit("call:media-state", { channelId: callState.roomId, muted: callState.micTrack ? !callState.micTrack.enabled : true, cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true, screenShare: false });
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
    '<button data-frame="cinema">Cinema <small>Wide cinematic tiles</small></button>';
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
  pop.innerHTML = '<div class="popover-title">Video quality</div>' + options +
    '<div class="quality-note">Higher quality uses more bandwidth.</div>';
  pop.querySelectorAll("[data-quality]").forEach(b => b.onclick = () => applyQuality(b.dataset.quality, QUALITY_PRESETS[b.dataset.quality].frameRate));
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
document.addEventListener("click", e => {
  if (!e.target.closest("#call-popover") && !e.target.closest(".call-btn")) hideCallPopover();
});

async function refreshDevicesOnPermission() {
  try { await navigator.mediaDevices?.getUserMedia({ audio: true, video: false }); } catch {}
}

/* ===========================
   ORBIT FUNCTIONAL EXTENSIONS
   =========================== */
const orbitUI = {
  view: "home",
  saved: JSON.parse(localStorage.getItem("orbit_saved") || "[]"),
  profile: JSON.parse(localStorage.getItem("orbit_profile") || "null") || {
    displayName: "",
    status: "Online",
    bio: "Building in public with Orbit.",
    accent: "#7652e8"
  }
};

function orbitToast(title, body="", kind="") {
  const stack=$("#toast-stack");
  if(!stack)return;
  const node=document.createElement("div");
  node.className="toast "+kind;
  node.innerHTML="<div><strong>"+escapeHtml(title)+"</strong>"+(body?"<span>"+escapeHtml(body)+"</span>":"")+"</div>";
  stack.appendChild(node);
  setTimeout(()=>node.remove(),3200);
}

function renderPage(view) {
  const cfg={
    home:["ORBIT / COMMAND CENTER","Home","A single control surface for communities, conversations, and live rooms."],
    discover:["DISCOVER","Discover communities","Explore spaces, categories, and new conversations."],
    dms:["DIRECT MESSAGES","Messages","Private conversations, groups, and recent contacts."],
    friends:["SOCIAL GRAPH","Friends","Online people, requests, suggestions, and connections."],
    notifications:["INBOX","Notifications","Mentions, replies, calls, requests, and system events."],
    saved:["LIBRARY","Saved","Messages and media you deliberately kept."],
    explore:["EXPLORE","Explore","Events, polls, files, media, and community activity."],
    settings:["PREFERENCES","Settings","Appearance, privacy, voice, notifications, accessibility and security."]
  }[view] || ["ORBIT","Home",""];
  $("#page-eyebrow").textContent=cfg[0];
  $("#page-title").textContent=cfg[1];
  $("#page-subtitle").textContent=cfg[2];
  $("#page-actions").innerHTML="";
  if(view==="home")renderHomePage();
  if(view==="discover")renderDiscoverPage();
  if(view==="dms")renderDMPage();
  if(view==="friends")renderFriendsPage();
  if(view==="notifications")renderNotificationsPage();
  if(view==="saved")renderSavedPage();
  if(view==="explore")renderExplorePage();
  if(view==="settings")renderSettingsPage();
}
function setView(view){
  orbitUI.view=view;
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const global=$("#global-page"),chat=$("#chat-view");
  const globalViews=["home","discover","dms","friends","notifications","saved","explore","settings"];
  if(globalViews.includes(view)){
    global.classList.remove("hidden");
    chat.classList.add("hidden");
    $("#members-panel")?.classList.add("hidden");
    $("#thread-panel")?.classList.add("hidden");
    renderPage(view);
  }else{
    global.classList.add("hidden");
    chat.classList.remove("hidden");
  }
}
function goChat(){
  setView("chat");
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.remove("active"));
}

function renderHomePage(){
  $("#page-actions").innerHTML='<button id="home-create">+ Create server</button><button id="home-search">Search</button>';
  $("#page-body").innerHTML=
  '<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">WORKSPACE</span><h2>Everything in one place.</h2><p>Chat, communities, voice rooms, calls, screen sharing, search, threads and moderation controls.</p><button class="hero-action" id="home-open-chat">Open #'+escapeHtml(currentChannel?.name||"general")+'</button></div>'+
    '<div class="hero-card"><span class="eyebrow">LIVE</span><h2>Voice & Video</h2><p>Start a high-quality room with screen sharing, layouts, quality presets and device controls.</p><button class="hero-action" id="home-call">Start video</button></div>'+
    '<div class="hero-card"><span class="eyebrow">PROFILE</span><h2>'+escapeHtml(orbitUI.profile.displayName||me?.username||"Guest")+'</h2><p>'+escapeHtml(orbitUI.profile.bio)+'</p><button class="hero-action" id="home-profile">Customize</button></div>'+
  '</div>'+
  '<div class="metric-grid">'+
    '<div class="metric"><span>Communities</span><strong>'+servers.length+'</strong><span>Connected workspaces</span></div>'+
    '<div class="metric"><span>Status</span><strong>'+escapeHtml(orbitUI.profile.status)+'</strong><span>Guest session</span></div>'+
    '<div class="metric"><span>Channel</span><strong>#'+escapeHtml(currentChannel?.name||"general")+'</strong><span>Current room</span></div>'+
    '<div class="metric"><span>Calls</span><strong>HD</strong><span>Ready for realtime</span></div>'+
  '</div>'+
  '<div class="section-block"><div class="section-heading"><h3>Quick actions</h3><span>Everything below is wired to the live app</span></div><div class="card-grid">'+
    '<button class="content-card" id="qa-search"><div class="chip">⌕</div><h4>Search</h4><p>Search users, channels, servers and messages.</p></button>'+
    '<button class="content-card" id="qa-poll"><div class="chip">◫</div><h4>Create poll</h4><p>Publish a poll directly into the current channel.</p></button>'+
    '<button class="content-card" id="qa-friends"><div class="chip">◎</div><h4>Friends</h4><p>Send and accept friend requests.</p></button>'+
  '</div></div>';
  $("#home-open-chat").onclick=goChat;
  $("#home-call").onclick=()=>{goChat();startCall("video")};
  $("#home-profile").onclick=()=>{setView("settings");renderSettingsPage("profile")};
  $("#home-create").onclick=()=>$("#new-server").click();
  $("#home-search").onclick=openCommandPalette;
  $("#qa-search").onclick=openCommandPalette;
  $("#qa-poll").onclick=openPoll;
  $("#qa-friends").onclick=()=>setView("friends");
}

function renderDiscoverPage(){
  $("#page-actions").innerHTML='<button id="discover-search-btn">Search</button>';
  const cards=[
    ["Nebula Arena","Gaming","12.4k members","1.2k online"],
    ["Build in Public","Technology","7.8k members","620 online"],
    ["Creative Lab","Art & Media","4.2k members","402 online"],
    ["Code Foundry","Programming","9.1k members","880 online"],
    ["Study Hall","Education","5.6k members","301 online"],
    ["Night Shift","Community","3.3k members","288 online"]
  ];
  $("#page-body").innerHTML='<div class="card-grid">'+cards.map(c=>
    '<div class="hero-card"><span class="eyebrow">'+c[1].toUpperCase()+'</span><h2>'+c[0]+'</h2><p>Public community preview. Connect it to a real server later from Control Center.</p><span class="chip">'+c[2]+'</span><span class="chip">'+c[3]+'</span><button class="hero-action discover-view" data-name="'+escapeHtml(c[0])+'">Open preview</button></div>'
  ).join("")+'</div>';
  $("#discover-search-btn").onclick=openCommandPalette;
  document.querySelectorAll(".discover-view").forEach(b=>b.onclick=()=>orbitToast("Community preview",b.dataset.name));
}

async function renderDMPage(){
  $("#page-actions").innerHTML='<button id="new-dm-page">New message</button><button id="refresh-dm-page">Refresh</button>';
  $("#page-body").innerHTML='<div class="list-card"><div class="content-card"><h4>Loading conversations…</h4></div></div>';
  $("#new-dm-page").onclick=()=>openModal("New direct message",'<input id="dm-target" placeholder="Exact guest username"><button class="primary" id="dm-create">Start conversation</button>');
  $("#refresh-dm-page").onclick=renderDMPage;
  try{
    const d=await api("/api/dms");
    const rows=d.dms||[];
    $("#page-body").innerHTML='<div class="list-card">'+(rows.length?rows.map(dm=>
      '<div class="list-row"><div class="avatar">'+avatar(dm.otherUser?.username||"G")+'</div><div><strong>'+escapeHtml(dm.otherUser?.username||"Group")+'</strong><span>'+escapeHtml(dm.lastMessage?.content||"No messages yet")+'</span></div><button data-open-dm="'+dm.id+'">Open</button></div>'
    ).join(""):'<div class="content-card"><h4>No direct messages</h4><p>Create a DM to start a private conversation.</p></div>')+'</div>';
    document.querySelectorAll("[data-open-dm]").forEach(b=>b.onclick=()=>openDM(b.dataset.openDm));
  }catch(e){$("#page-body").innerHTML='<div class="content-card"><h4>Could not load DMs</h4><p>'+escapeHtml(e.message)+'</p></div>'}
}
async function openDM(idValue){
  try{
    const d=await api("/api/dms/"+encodeURIComponent(idValue)+"/messages");
    const dm=(await api("/api/dms")).dms.find(x=>String(x.id)===String(idValue));
    const name=dm?.otherUser?.username||"Direct message";
    openModal("Direct message · "+name,'<div id="dm-feed" class="list-card" style="max-height:360px;overflow:auto">'+(d.messages||[]).map(m=>'<div class="list-row"><div class="avatar">'+avatar(m.username)+'</div><div><strong>'+escapeHtml(m.username)+'</strong><span>'+escapeHtml(m.content)+'</span></div></div>').join("")+'</div><form id="dm-form" class="thread-composer"><input id="dm-input" placeholder="Write a message"><button>Send</button></form>');
    socket?.emit("dm:join",idValue);
    $("#dm-form").onsubmit=async e=>{e.preventDefault();const v=$("#dm-input").value.trim();if(!v)return;try{const x=await api("/api/dms/"+encodeURIComponent(idValue)+"/messages",{method:"POST",body:JSON.stringify({content:v})});$("#dm-feed").insertAdjacentHTML("beforeend",'<div class="list-row"><div class="avatar">'+avatar(x.message.username)+'</div><div><strong>'+escapeHtml(x.message.username)+'</strong><span>'+escapeHtml(x.message.content)+'</span></div></div>');$("#dm-input").value="";$("#dm-feed").scrollTop=$("#dm-feed").scrollHeight}catch(err){orbitToast("DM failed",err.message,"error")}};
  }catch(e){orbitToast("DM failed",e.message,"error")}
}

async function renderFriendsPage(){
  $("#page-actions").innerHTML='<button id="add-friend-page">+ Add friend</button><button id="refresh-friends-page">Refresh</button>';
  $("#page-body").innerHTML='<div class="content-card"><h4>Loading friends…</h4></div>';
  $("#add-friend-page").onclick=()=>openModal("Add friend",'<input id="friend-target" placeholder="Exact guest username"><button class="primary" id="friend-create">Send request</button>');
  $("#refresh-friends-page").onclick=renderFriendsPage;
  try{
    const d=await api("/api/friends");
    $("#page-body").innerHTML=
      '<div class="section-block"><div class="section-heading"><h3>Friends</h3><span>'+d.friends.length+'</span></div><div class="list-card">'+
      (d.friends.length?d.friends.map(u=>'<div class="list-row"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.username)+'</strong><span>'+escapeHtml(u.status)+'</span></div><button data-dm-friend="'+escapeHtml(u.username)+'">Message</button></div>').join(""):'<div class="content-card"><h4>No friends yet</h4><p>Send a request to another guest.</p></div>')+
      '</div></div>'+
      '<div class="section-block"><div class="section-heading"><h3>Requests</h3><span>'+d.incoming.length+' incoming</span></div><div class="list-card">'+
      d.incoming.map(r=>'<div class="list-row"><div class="avatar">'+avatar(r.fromUser?.username)+'</div><div><strong>'+escapeHtml(r.fromUser?.username||"Guest")+'</strong><span>Friend request</span></div><button data-accept="'+r.id+'">Accept</button></div>').join("")+
      '</div></div>';
    document.querySelectorAll("[data-accept]").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+encodeURIComponent(b.dataset.accept)+"/accept",{method:"POST",body:"{}"});orbitToast("Friend added","Request accepted.","success");renderFriendsPage()}catch(err){orbitToast("Request failed",err.message,"error")}});
    document.querySelectorAll("[data-dm-friend]").forEach(b=>b.onclick=async()=>{try{await api("/api/dms",{method:"POST",body:JSON.stringify({username:b.dataset.dmFriend})});setView("dms");renderDMPage()}catch(err){orbitToast("DM failed",err.message,"error")}});
  }catch(e){$("#page-body").innerHTML='<div class="content-card"><h4>Could not load friends</h4><p>'+escapeHtml(e.message)+'</p></div>'}
}

async function renderNotificationsPage(){
  $("#page-actions").innerHTML='<button id="mark-read">Mark all read</button><button id="refresh-notifications">Refresh</button>';
  $("#page-body").innerHTML='<div class="content-card"><h4>Loading notifications…</h4></div>';
  $("#mark-read").onclick=async()=>{try{await api("/api/notifications/read",{method:"POST",body:"{}"});orbitToast("Inbox cleared","All notifications read.","success");renderNotificationsPage()}catch(e){orbitToast("Update failed",e.message,"error")}};
  $("#refresh-notifications").onclick=renderNotificationsPage;
  try{
    const d=await api("/api/notifications");
    const items=d.notifications||[];
    $("#notification-badge").textContent=String(items.filter(n=>!n.read).length);
    $("#page-body").innerHTML='<div class="list-card">'+(items.length?items.map(n=>'<div class="list-row"><div class="chip">◇</div><div><strong>'+escapeHtml(n.title)+'</strong><span>'+escapeHtml(n.body||"")+'</span></div><span>'+new Date(n.created_at).toLocaleString()+'</span></div>').join(""):'<div class="content-card"><h4>All clear</h4><p>No new notifications.</p></div>')+'</div>';
  }catch(e){$("#page-body").innerHTML='<div class="content-card"><h4>Notifications unavailable</h4><p>'+escapeHtml(e.message)+'</p></div>'}
}

function renderSavedPage(){
  $("#page-actions").innerHTML='<button id="clear-saved">Clear all</button>';
  const rows=orbitUI.saved||[];
  $("#page-body").innerHTML='<div class="list-card">'+(rows.length?rows.map((m,i)=>'<div class="list-row"><div class="chip">⌑</div><div><strong>'+escapeHtml(m.title||"Message")+'</strong><span>'+escapeHtml(m.text||"")+'</span></div><button data-remove-saved="'+i+'">Remove</button></div>').join(""):'<div class="content-card"><h4>Nothing saved</h4><p>Use the bookmark action on a message.</p></div>')+'</div>';
  $("#clear-saved").onclick=()=>{orbitUI.saved=[];localStorage.setItem("orbit_saved","[]");renderSavedPage()};
  document.querySelectorAll("[data-remove-saved]").forEach(b=>b.onclick=()=>{orbitUI.saved.splice(Number(b.dataset.removeSaved),1);localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));renderSavedPage()});
}

function renderExplorePage(){
  $("#page-actions").innerHTML='<button id="explore-poll">Create poll</button><button id="explore-event">Create event</button>';
  $("#page-body").innerHTML='<div class="hero-grid">'+
  '<div class="hero-card"><span class="eyebrow">POLL</span><h2>Live questions</h2><p>Create a poll in your current text channel and collect realtime votes.</p><button class="hero-action" id="explore-poll-btn">Create</button></div>'+
  '<div class="hero-card"><span class="eyebrow">EVENT</span><h2>Community event</h2><p>Create an event card and announce it to the community.</p><button class="hero-action" id="explore-event-btn">Create</button></div>'+
  '<div class="hero-card"><span class="eyebrow">FILES</span><h2>Shared files</h2><p>Attach images, audio, video and documents directly to conversations.</p><button class="hero-action" id="explore-file-btn">Attach in chat</button></div></div>';
  $("#explore-poll").onclick=openPoll;$("#explore-poll-btn").onclick=openPoll;
  $("#explore-event").onclick=openEvent;$("#explore-event-btn").onclick=openEvent;
  $("#explore-file-btn").onclick=()=>{goChat();$("#attach").click()};
}

function renderSettingsPage(section="appearance"){
  const sections=[["appearance","Appearance"],["profile","Profile"],["privacy","Privacy"],["voice","Voice & Video"],["notifications","Notifications"],["accessibility","Accessibility"],["performance","Performance"],["security","Security"],["advanced","Advanced"]];
  $("#page-actions").innerHTML="";
  $("#page-body").innerHTML='<div class="settings-layout"><nav class="settings-nav">'+sections.map(s=>'<button class="'+(s[0]===section?"active":"")+'" data-settings-section="'+s[0]+'">'+s[1]+'</button>').join("")+'</nav><div id="settings-card" class="settings-card"></div></div>';
  document.querySelectorAll("[data-settings-section]").forEach(b=>b.onclick=()=>renderSettingsPage(b.dataset.settingsSection));
  const card=$("#settings-card");
  if(section==="appearance"){
    const reduced=localStorage.getItem("orbit_motion")==="reduced",compact=localStorage.getItem("orbit_density")==="compact";
    card.innerHTML='<h3>Appearance</h3><p>Customize Orbit without affecting your data.</p>'+
      setting("Reduced motion","Reduce transitions and animation.",reduced,"appearance-motion")+
      setting("Compact density","Tighter chat and navigation spacing.",compact,"appearance-density")+
      '<div class="setting-row"><div><strong>Accent</strong><span>Current '+escapeHtml(orbitUI.profile.accent)+'</span></div><input id="accent-color" type="color" value="'+escapeHtml(orbitUI.profile.accent)+'" style="width:42px;height:30px"></div>';
    $("#accent-color").onchange=e=>{orbitUI.profile.accent=e.target.value;document.documentElement.style.setProperty("--accent",e.target.value);localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile))};
  }else if(section==="profile"){
    card.innerHTML='<h3>Profile</h3><p>Guest mode keeps signup optional while allowing local customization.</p><input id="profile-name" value="'+escapeHtml(orbitUI.profile.displayName||me?.username||"Guest")+'" placeholder="Display name"><textarea id="profile-bio" placeholder="Bio">'+escapeHtml(orbitUI.profile.bio||"")+'</textarea><select id="profile-status"><option>Online</option><option>Idle</option><option>Do Not Disturb</option><option>Invisible</option></select><button class="primary" id="save-profile">Save profile</button>';
    $("#profile-status").value=orbitUI.profile.status||"Online";
    $("#save-profile").onclick=()=>{orbitUI.profile.displayName=$("#profile-name").value.trim()||me?.username||"Guest";orbitUI.profile.bio=$("#profile-bio").value.trim();orbitUI.profile.status=$("#profile-status").value;localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));$("#me-name").textContent=orbitUI.profile.displayName;$("#me-status").textContent=orbitUI.profile.status.toLowerCase()+" · guest";orbitToast("Profile updated","Saved locally.","success")};
  }else if(section==="voice"){
    card.innerHTML='<h3>Voice & Video</h3><p>Configure live media capture.</p>'+setting("Noise suppression","Reduce keyboard and room noise.",true,"voice-ns")+setting("Echo cancellation","Reduce feedback.",true,"voice-ec")+setting("Auto gain","Normalize microphone volume.",true,"voice-gain")+'<div class="setting-row"><div><strong>Preferred quality</strong><span>Used for video capture.</span></div><select id="preferred-quality"><option>480p</option><option selected>720p</option><option>1080p</option><option>1080p60</option><option>1440p</option></select></div>';
    $("#preferred-quality").onchange=e=>callState.settings.quality=e.target.value;
  }else if(section==="privacy"){
    card.innerHTML=setting("Friend requests","Allow requests from guests.",true,"privacy-friends")+setting("Direct messages","Allow private messages from shared communities.",true,"privacy-dms")+setting("Read receipts","Show when messages are opened.",false,"privacy-receipts");
  }else if(section==="notifications"){
    card.innerHTML=setting("Desktop alerts","Show important alerts.",true,"notify-desktop")+setting("Mentions","Notify on mentions.",true,"notify-mentions")+setting("Calls","Notify for incoming calls.",true,"notify-calls");
  }else if(section==="accessibility"){
    card.innerHTML=setting("Reduced motion","Minimize animation.",false,"a11y-motion")+setting("High contrast","Increase contrast.",false,"a11y-contrast")+setting("Larger text","Scale the interface.",false,"a11y-large");
  }else if(section==="performance"){
    card.innerHTML=setting("Performance mode","Reduce expensive visual effects.",false,"perf-mode")+setting("Lazy media","Load rich media on demand.",true,"perf-lazy");
  }else if(section==="security"){
    card.innerHTML='<h3>Security center</h3><p>Current guest session and moderation visibility.</p><div class="list-card"><div class="list-row"><div class="chip">✓</div><div><strong>Guest session</strong><span>Signed session token</span></div><span>Active</span></div><div class="list-row"><div class="chip">◎</div><div><strong>Persistent storage</strong><span>PostgreSQL</span></div><span>Pending setup</span></div></div>';
  }else{
    card.innerHTML=setting("Command palette","Enable Ctrl+K.",true,"advanced-palette")+setting("Developer diagnostics","Expose realtime diagnostics.",false,"advanced-dev");
  }
  document.querySelectorAll("[data-setting-toggle]").forEach(b=>b.onclick=()=>{b.classList.toggle("on");if(b.dataset.settingToggle==="appearance-motion"){document.body.classList.toggle("reduced-motion",b.classList.contains("on"));localStorage.setItem("orbit_motion",b.classList.contains("on")?"reduced":"full")}if(b.dataset.settingToggle==="appearance-density"){document.body.classList.toggle("compact",b.classList.contains("on"));localStorage.setItem("orbit_density",b.classList.contains("on")?"compact":"comfortable")}});
}
function setting(title,desc,on,key){return '<div class="setting-row"><div><strong>'+title+'</strong><span>'+desc+'</span></div><button class="switch '+(on?"on":"")+'" data-setting-toggle="'+key+'"></button></div>'}

function openPoll(){
  if(!currentChannel || currentChannel.type==="voice"){orbitToast("Open a text channel","Polls are posted inside text channels.","error");return}
  openModal("Create poll",'<input id="poll-q" placeholder="Question"><input id="poll-a" placeholder="Option A"><input id="poll-b" placeholder="Option B"><input id="poll-c" placeholder="Option C (optional)"><button class="primary" id="publish-poll">Publish poll</button>');
}
function openEvent(){
  openModal("Create event",'<input id="event-title" placeholder="Event title"><input id="event-time" placeholder="Date & time"><select id="event-type"><option>Voice</option><option>Video</option><option>Community</option></select><textarea id="event-description" placeholder="Description"></textarea><button class="primary" id="publish-event">Create event</button>');
}
function openCommandPalette(){
  $("#command-palette").classList.remove("hidden");
  const input=$("#command-input");input.value="";renderCommandResults("");setTimeout(()=>input.focus(),20);
}
function closeCommandPalette(){$("#command-palette").classList.add("hidden")}
function renderCommandResults(q){
  const commands=[
    ["⌂","Home","home"],["✦","Discover","discover"],["◌","Direct messages","dms"],["◎","Friends","friends"],["◇","Notifications","notifications"],["⌑","Saved","saved"],["⌖","Explore","explore"],["⚙","Settings","settings"],["+","Create server","create-server"],["#","Create channel","create-channel"],["☎","Start voice call","voice"],["▣","Start video call","video"],["↗","Share screen","share"],["⌕","Search","search"]
  ].filter(x=>(x[1]+" "+x[2]).toLowerCase().includes(String(q||"").toLowerCase()));
  $("#command-results").innerHTML=(commands.length?commands:[["⌕","No matches",""]]).map((x,i)=>'<button class="command-item" data-command-index="'+i+'"><span class="command-icon">'+x[0]+'</span><div><strong>'+x[1]+'</strong><span>'+x[2]+'</span></div><span>↵</span></button>').join("");
  document.querySelectorAll("[data-command-index]").forEach((b,i)=>b.onclick=()=>runCommand(commands[i]));
}
function runCommand(item){
  if(!item)return;
  closeCommandPalette();
  const a=item[2];
  if(["home","discover","dms","friends","notifications","saved","explore","settings"].includes(a))return setView(a);
  if(a==="create-server")return $("#new-server").click();
  if(a==="create-channel")return $("#new-channel").click();
  if(a==="voice")return goChat(),startCall("voice");
  if(a==="video")return goChat(),startCall("video");
  if(a==="share")return goChat(),callState.active?toggleScreenShare():startCall("video");
  if(a==="search")return runGlobalSearch("");
}
async function runGlobalSearch(q){
  const query=String(q||"").trim();
  if(!query){openCommandPalette();return}
  try{
    const d=await api("/api/search?q="+encodeURIComponent(query));
    openModal("Search results",'<div class="list-card">'+
      (d.users||[]).map(u=>'<div class="list-row"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.username)+'</strong><span>User · '+u.status+'</span></div></div>').join("")+
      (d.servers||[]).map(s=>'<div class="list-row"><div class="chip">◈</div><div><strong>'+escapeHtml(s.name)+'</strong><span>Server · '+s.memberCount+' members</span></div></div>').join("")+
      (d.channels||[]).map(c=>'<div class="list-row"><div class="chip">'+(c.type==="voice"?"◉":"#")+'</div><div><strong>'+escapeHtml(c.name)+'</strong><span>Channel · '+c.type+'</span></div></div>').join("")+
      (d.messages||[]).map(m=>'<div class="list-row"><div class="chip">◫</div><div><strong>'+escapeHtml(m.username)+'</strong><span>'+escapeHtml(m.content)+'</span></div></div>').join("")+
      '</div>');
  }catch(e){orbitToast("Search failed",e.message,"error")}
}

function bindPremiumNavigation(){
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $("#settings-nav")?.addEventListener("click",()=>setView("settings"));
  $("#profile-card-btn")?.addEventListener("click",()=>{setView("settings");renderSettingsPage("profile")});
  $("#sidebar-search")?.addEventListener("click",openCommandPalette);
  $("#quick-search")?.addEventListener("keydown",e=>{if(e.key==="Enter")runGlobalSearch(e.target.value)});
  $("#join-server")?.addEventListener("click",()=>openModal("Join server",'<input id="invite-code" placeholder="Invite code or full invite URL"><button class="primary" id="join-by-invite">Join community</button>'));
  $("#command-input")?.addEventListener("input",e=>renderCommandResults(e.target.value));
  $("#command-palette")?.addEventListener("click",e=>{if(e.target.id==="command-palette")closeCommandPalette()});
  $("#modal-close")?.addEventListener("click",closeModal);
  $("#modal")?.addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
  $("#close-thread")?.addEventListener("click",()=>$("#thread-panel").classList.add("hidden"));
  $("#member-filter")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("#member-list .member").forEach(m=>m.classList.toggle("hidden",!m.textContent.toLowerCase().includes(q)))});
  document.addEventListener("click",async e=>{
    if(e.target.id==="join-by-invite"){
      const raw=$("#invite-code").value.trim();
      let code=raw;
      try{if(raw.includes("invite="))code=new URL(raw).searchParams.get("invite")||raw}catch{}
      try{await api("/api/invites/"+encodeURIComponent(code)+"/accept",{method:"POST",body:"{}"});closeModal();await loadServers();orbitToast("Joined community","Server added to your workspace.","success")}catch(err){orbitToast("Invite failed",err.message,"error")}
    }
    if(e.target.id==="dm-create"){try{await api("/api/dms",{method:"POST",body:JSON.stringify({username:$("#dm-target").value.trim()})});closeModal();renderDMPage();orbitToast("DM created","Conversation is ready.","success")}catch(err){orbitToast("DM failed",err.message,"error")}}
    if(e.target.id==="friend-create"){try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username:$("#friend-target").value.trim()})});closeModal();orbitToast("Friend request sent","Waiting for acceptance.","success")}catch(err){orbitToast("Friend request failed",err.message,"error")}}
    if(e.target.id==="publish-poll"){
      const options=["#poll-a","#poll-b","#poll-c"].map(s=>$(s)?.value.trim()).filter(Boolean);
      try{const d=await api("/api/channels/"+currentChannel.id+"/polls",{method:"POST",body:JSON.stringify({question:$("#poll-q").value.trim(),options})});closeModal();orbitToast("Poll published","Vote collection is live.","success");renderPoll(d.poll)}catch(err){orbitToast("Poll failed",err.message,"error")}
    }
    if(e.target.id==="publish-event"){closeModal();orbitToast("Event created","Event controls are ready in Explore.","success")}
  });
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette()}
    if(e.key==="Escape"){closeCommandPalette();hideCallPopover()}
  });
}
async function renderPoll(p){
  if(!p||!currentChannel)return;
  const card=document.createElement("div");
  card.className="content-card poll-card";
  card.dataset.pollId=p.id;
  card.innerHTML='<div class="eyebrow">LIVE POLL</div><h4>'+escapeHtml(p.question)+'</h4>'+
    p.options.map(o=>'<button class="poll-option" data-option-id="'+o.id+'"><span>'+escapeHtml(o.text)+'</span><b>'+o.votes+'</b></button>').join("");
  $("#messages").appendChild(card);
  card.querySelectorAll("[data-option-id]").forEach(btn=>btn.onclick=async()=>{try{const d=await api("/api/polls/"+p.id+"/vote",{method:"POST",body:JSON.stringify({optionId:btn.dataset.optionId})});d.poll.options.forEach((o,i)=>card.querySelectorAll(".poll-option")[i].querySelector("b").textContent=o.votes);orbitToast("Vote saved","Your vote is recorded.","success")}catch(err){orbitToast("Vote failed",err.message,"error")}});
}
async function loadPolls(){
  if(!currentChannel||currentChannel.type==="voice")return;
  try{const d=await api("/api/channels/"+currentChannel.id+"/polls");(d.polls||[]).forEach(renderPoll)}catch{}
}


$("#new-server").onclick=()=>openModal("Create server",'<input id="server-name-input" placeholder="Community name"><button class="primary" id="create-server-now">Create server</button>');
$("#new-channel").onclick=()=>openChannelModal("text");
$("#new-voice-channel").onclick=()=>openChannelModal("voice");
$("#modal-close").onclick=closeModal;

// Add realtime message management to the original socket.
const __connectRealtimeBase=connectRealtime;
connectRealtime=function(){
  __connectRealtimeBase();
  if(!socket)return;
  socket.on("message:update",m=>{
    const el=document.querySelector('[data-message-id="'+m.id+'"]');
    if(!el)return;
    const body=el.querySelector(".msg-body");if(body)body.textContent=m.content;
    const time=el.querySelector(".msg-head time");if(time&&!time.textContent.includes("edited"))time.textContent+=" · edited";
  });
  socket.on("message:delete",({messageId})=>document.querySelector('[data-message-id="'+messageId+'"]')?.remove());
  socket.on("message:reaction",({messageId,reactions})=>{
    const el=document.querySelector('[data-message-id="'+messageId+'"]');if(!el)return;
    let box=el.querySelector(".reaction-row");if(!box){box=document.createElement("div");box.className="reaction-row";el.appendChild(box)}
    box.innerHTML=Object.entries(reactions||{}).map(([emoji,ids])=>'<button class="reaction-chip">'+escapeHtml(emoji)+' '+ids.length+'</button>').join("");
  });
  socket.on("poll:new",p=>renderPoll(p));
  socket.on("dm:message",m=>{
    const feed=$("#dm-feed");if(feed)feed.insertAdjacentHTML("beforeend",'<div class="list-row"><div class="avatar">'+avatar(m.username)+'</div><div><strong>'+escapeHtml(m.username)+'</strong><span>'+escapeHtml(m.content)+'</span></div></div>');
  });
};

// Add data-id and hover actions to every rendered chat message.
const __appendMessageBase=appendMessage;
appendMessage=function(m){
  __appendMessageBase(m);
  const list=document.querySelectorAll("#messages .message");
  const el=list[list.length-1];
  if(!el)return;
  el.dataset.messageId=m.id||"";
  let actions=el.querySelector(".msg-actions");
  if(!actions){actions=document.createElement("div");actions.className="msg-actions";el.appendChild(actions)}
  actions.innerHTML='<button class="msg-action" data-msg="react">☺</button><button class="msg-action" data-msg="reply">↩</button><button class="msg-action" data-msg="thread">◫</button><button class="msg-action" data-msg="save">⌑</button><button class="msg-action" data-msg="more">⋯</button>';
  actions.querySelector('[data-msg="react"]').onclick=async()=>{try{await api("/api/messages/"+encodeURIComponent(m.id)+"/reaction",{method:"POST",body:JSON.stringify({emoji:"👍"})})}catch(e){orbitToast("Reaction failed",e.message,"error")}};
  actions.querySelector('[data-msg="reply"]').onclick=()=>{$("#message").value="@"+m.username+" ";$("#message").focus()};
  actions.querySelector('[data-msg="thread"]').onclick=()=>openThread(el);
  actions.querySelector('[data-msg="save"]').onclick=()=>{orbitUI.saved.unshift({title:m.username,meta:"#"+(currentChannel?.name||"channel")+" · "+new Date().toLocaleString(),text:m.content});localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));orbitToast("Saved","Message added to Saved.","success")};
  actions.querySelector('[data-msg="more"]').onclick=()=>openMessageMore(el);
};
async function openThread(el){
  const idValue=el?.dataset?.messageId;if(!idValue)return;
  try{
    const d=await api("/api/messages/"+encodeURIComponent(idValue)+"/thread");
    $("#thread-panel").classList.remove("hidden");$("#thread-panel").dataset.messageId=idValue;
    $("#thread-root").innerHTML='<div class="content-card"><strong>'+escapeHtml(el.querySelector(".msg-head strong")?.textContent||"Message")+'</strong><p>'+escapeHtml(el.querySelector(".msg-body")?.textContent||"")+'</p></div>';
    $("#thread-meta").textContent=(d.thread.replies?.length||0)+" replies";
    $("#thread-messages").innerHTML=(d.thread.replies||[]).map(r=>'<div class="message"><div class="avatar">'+avatar(r.username)+'</div><div><div class="msg-head"><strong>'+escapeHtml(r.username)+'</strong><time>now</time></div><div class="msg-body">'+escapeHtml(r.content)+'</div></div></div>').join("");
  }catch(e){orbitToast("Thread failed",e.message,"error")}
}
$("#thread-composer")?.addEventListener("submit",async e=>{
  e.preventDefault();const idValue=$("#thread-panel").dataset.messageId,content=$("#thread-input").value.trim();if(!idValue||!content)return;
  try{const d=await api("/api/messages/"+encodeURIComponent(idValue)+"/thread",{method:"POST",body:JSON.stringify({content})});const r=d.reply;$("#thread-messages").insertAdjacentHTML("beforeend",'<div class="message"><div class="avatar">'+avatar(r.username)+'</div><div><div class="msg-head"><strong>'+escapeHtml(r.username)+'</strong><time>now</time></div><div class="msg-body">'+escapeHtml(r.content)+'</div></div></div>');$("#thread-input").value="";$("#thread-meta").textContent=(d.thread.replies?.length||0)+" replies"}catch(err){orbitToast("Reply failed",err.message,"error")}
});
function openMessageMore(el){
  openModal("Message actions",'<div class="list-card"><button class="list-row" id="msg-edit-action"><span>✎ Edit message</span></button><button class="list-row" id="msg-delete-action"><span>× Delete message</span></button></div>');
  $("#msg-edit-action").onclick=async()=>{closeModal();const value=prompt("Edit message",el.querySelector(".msg-body")?.textContent||"");if(value===null)return;try{await api("/api/messages/"+encodeURIComponent(el.dataset.messageId),{method:"PATCH",body:JSON.stringify({content:value})})}catch(e){orbitToast("Edit failed",e.message,"error")}};
  $("#msg-delete-action").onclick=async()=>{closeModal();if(!confirm("Delete this message?"))return;try{await api("/api/messages/"+encodeURIComponent(el.dataset.messageId),{method:"DELETE"})}catch(e){orbitToast("Delete failed",e.message,"error")}};
}
$("#attach")?.addEventListener("click",()=>{
  const input=document.createElement("input");input.type="file";input.accept="image/*,video/*,audio/*,.pdf,.zip,.txt,.doc,.docx";
  input.onchange=()=>{const file=input.files?.[0];if(!file)return;if(file.size>1500000){orbitToast("File too large","Guest mode limit is 1.5 MB.","error");return}const fr=new FileReader();fr.onload=async()=>{try{const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type,size:file.size,data:String(fr.result)})});if(socket&&currentChannel){socket.emit("message:send",{channelId:currentChannel.id,content:"📎 "+file.name,attachment:up.file});orbitToast("File sent",file.name,"success")}}catch(e){orbitToast("Upload failed",e.message,"error")}};fr.readAsDataURL(file)};
  input.click();
});

// Wrap channel selection to load persisted polls and hide composer in voice rooms.
const __selectChannelBase=selectChannel;
selectChannel=async function(channel){
  await __selectChannelBase(channel);
  if(channel?.type==="voice") $("#composer")?.classList.add("hidden");
  else {$("#composer")?.classList.remove("hidden");await loadPolls();}
};

// Join/create voice support uses the server's "voice" channel type.
$("#new-channel")?.addEventListener("click",()=>openChannelModal("text"));
$("#new-voice-channel")?.addEventListener("click",()=>openChannelModal("voice"));
function openChannelModal(defaultType){
  if(!currentServer)return;
  openModal("Create channel",'<input id="channel-name-input" placeholder="general"><select id="channel-type-input"><option value="text" '+(defaultType==="text"?"selected":"")+'>Text</option><option value="announcement">Announcement</option><option value="voice" '+(defaultType==="voice"?"selected":"")+'>Voice</option></select><button class="primary" id="create-channel-now">Create channel</button>');
  $("#create-channel-now").onclick=async()=>{try{const d=await api("/api/servers/"+currentServer.id+"/channels",{method:"POST",body:JSON.stringify({name:$("#channel-name-input").value,type:$("#channel-type-input").value})});closeModal();await selectServer(currentServer);await selectChannel(d.channel)}catch(e){orbitToast("Channel creation failed",e.message,"error")}};
}

// Ensure create server has a real post-create channel/voice refresh.
$("#new-server")?.addEventListener("click",()=>openModal("Create server",'<input id="server-name-input" placeholder="Community name"><button class="primary" id="create-server-now">Create server</button>'));
document.addEventListener("click",async e=>{
  if(e.target.id==="create-server-now"){try{const d=await api("/api/servers",{method:"POST",body:JSON.stringify({name:$("#server-name-input").value})});closeModal();await loadServers();const s=servers.find(x=>String(x.id)===String(d.server.id));if(s)await selectServer(s);orbitToast("Server created",d.server.name+" is ready.","success")}catch(err){orbitToast("Server creation failed",err.message,"error")}}
});

// Boot premium nav after DOM is parsed, then launch guest session.
bindPremiumNavigation();

(async()=>{
  try{
    await enterAsGuest();
    const invite=new URLSearchParams(location.search).get("invite");
    if(invite){await api("/api/invites/"+encodeURIComponent(invite)+"/accept",{method:"POST",body:"{}"}).catch(()=>{});await loadServers();}
    setView("home");
  }catch(err){
    console.error("Orbit boot failed",err);
    showError(err.message||"Unable to start Orbit");
  }
})();
