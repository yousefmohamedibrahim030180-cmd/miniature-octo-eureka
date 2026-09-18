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

  socket.on("call:media-state", ({ socketId, muted }) => {
    const tile = document.querySelector('.call-tile[data-peer="' + socketId + '"]');
    if (tile) tile.classList.toggle("remote-muted", muted);
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
    await setupLocalMedia(mode);
    ensureSelfTile();
    socket.emit("call:join", callState.roomId);
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
  if (socket && callState.roomId) socket.emit("call:mute", { channelId: callState.roomId, muted: !callState.micTrack.enabled });
}
function toggleCamera() {
  if (!callState.cameraTrack) return;
  callState.cameraTrack.enabled = !callState.cameraTrack.enabled;
  $("#camera-btn").classList.toggle("active", callState.cameraTrack.enabled);
  $("#camera-btn").classList.toggle("off", !callState.cameraTrack.enabled);
  const selfTile = document.querySelector('.call-tile[data-peer="self"]');
  selfTile?.classList.toggle("voice-only", !callState.cameraTrack.enabled);
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