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
let unreadChannels = JSON.parse(localStorage.getItem("orbit_unread_channels") || "{}");
let callStartedAt = 0;
let callDurationTimer = null;
let callStatsTimer = null;
const pulseState = {
  users: [],
  calls: [],
  activity: [],
  maxActivity: 14
};

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
  $("#me-name").textContent = me.display_name || me.username;
  $("#me-avatar").textContent = avatar(me.username);
  $("#me-status").textContent = "online · @" + (me.username || "guest");
  connectRealtime();
  await loadServers();
}

function connectRealtime() {
  if (socket) socket.disconnect();
  socket = io({
    auth: { token },
    path: "/socket.io",
    transports: ["polling", "websocket"],
    timeout: 10000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    withCredentials: true
  });

  socket.on("message:new", m => {
    const active = currentChannel && String(m.channel_id) === String(currentChannel.id);
    if (active) {
      appendMessage(m);
    } else if (m.channel_id) {
      unreadChannels[m.channel_id] = Number(unreadChannels[m.channel_id] || 0) + 1;
      localStorage.setItem("orbit_unread_channels", JSON.stringify(unreadChannels));
      renderChannels();
    }
  });
  socket.on("typing", x => {
    if (!currentChannel) return;
    $("#typing").textContent = x.isTyping ? x.username + " is typing…" : "";
  });
  socket.on("presence:update", x => {
    document.querySelectorAll("[data-user='" + x.userId + "'] .presence").forEach(n => n.textContent = x.status + (x.activity ? " · " + x.activity : ""));
    const user=pulseState.users.find(u=>String(u.id)===String(x.userId))||{id:x.userId,username:x.username||"Guest"};
    upsertPulseUser({...user,status:x.status,activity:x.activity||x.status},x.activity||x.status);
    if(dmState.active?.otherUser&&String(dmState.active.otherUser.id)===String(x.userId)){dmState.active.otherUser.status=x.status;if(orbitUI.view==="dms"){renderDMHeader();renderDMList()}}
    if(orbitUI.view==="home")renderPulse();
  });
  socket.on("pulse:snapshot", data => {
    pulseState.users=data?.users||[];
    pulseState.calls=data?.calls||[];
    if(orbitUI.view==="home")renderPulse();
  });
  socket.on("pulse:update", event => handlePulseEvent(event));
  socket.on("friend:request", payload => {
    orbitToast("New friend request", (payload?.request?.fromUser?.username || "Someone") + " wants to connect.", "success");
    if (orbitUI.view === "friends") renderFriendsPage();
  });
  socket.on("friend:accepted", payload => {
    orbitToast("Friend added", (payload?.friend?.username || "A request") + " accepted the connection.", "success");
    if (orbitUI.view === "friends") renderFriendsPage();
  });


  socket.on("call:incoming", call => {
    if (callState.active || String(call.userId) === String(me?.id)) return;
    pendingIncomingCall = call;
    const box = $("#incoming-call");
    const incomingChannel = channels.find(c => String(c.id) === String(call.channelId));
    $("#incoming-title").textContent = (call.username || "Guest") + " is calling";
    $("#incoming-subtitle").textContent = (call.mode === "voice" ? "Voice call" : "Video call") + " · " + (incomingChannel ? "#" + incomingChannel.name : "Orbit room");
    $("#incoming-avatar").textContent = avatar(call.username || "G");
    box.classList.remove("hidden");
  });

  socket.on("call:participants", participants => {
    participants.forEach(p => createPeer(p.socketId, true, p));
    updateCallMeta();
  });

  socket.on("call:participant-joined", async p => {
    addRemoteTile(p.socketId, p);
    try { await ensurePeer(p.socketId, false, p); } catch (err) { console.error("peer setup", err); }
    updateCallMeta();
  });

  socket.on("call:participant-left", ({ socketId }) => {
    removePeer(socketId);
    updateCallMeta();
  });

  socket.on("call:declined", ({ username }) => {
    orbitToast("Call declined", (username || "Participant") + " declined the call.");
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

  socket.on("connect", () => {
    console.log("[orbit] realtime connected", socket.id);
    if (callState.active) setCallIndicator("LIVE");
  });
  socket.on("connect_error", err => {
    console.error("[orbit] realtime connect error", err);
    if (callState.active) setCallIndicator("RECONNECTING");
  });
  socket.on("error:toast", payload => orbitToast("Server", payload?.message || "Action blocked."));\n  socket.on("server:removed", payload => {
    if (String(payload?.action || "").toLowerCase() === "ban") {
      if (callState.active) leaveCall();
      currentServer = null;
      currentChannel = null;
      channels = [];
      renderServers();
      renderChannels();
      orbitToast("Server access removed", "You have been banned from this server.", "error");
      loadServers().catch(() => {});
    }
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
  $("#channel-list").innerHTML = channels.filter(c => c.type !== "voice").map(c => {
    const unread = Number(unreadChannels[c.id] || 0);
    const icon = c.type === "announcement" ? "!" : "#";
    return '<button class="channel ' + (String(currentChannel?.id) === String(c.id) ? "active" : "") +
      '" data-id="' + c.id + '"><span class="hash">' + icon + '</span><span class="channel-name-text">' + escapeHtml(c.name) + '</span>' +
      (unread ? '<b class="channel-unread">' + (unread > 99 ? "99+" : unread) + '</b>' : '') +
      '</button>';
  }).join("");
  $("#voice-channel-list").innerHTML = channels.filter(c => c.type === "voice").map(c =>
    '<button class="channel voice-channel" data-id="' + c.id + '"><span class="voice-icon">◉</span><span class="channel-name-text">' +
    escapeHtml(c.name) + '</span></button>'
  ).join("");
  document.querySelectorAll(".channel").forEach(btn => {
    btn.onclick = () => {
      selectChannel(channels.find(c => String(c.id) === btn.dataset.id));
      $("#sidebar")?.classList.remove("open");
      document.body.classList.remove("mobile-sidebar-open");
    };
  });
}
async function selectChannel(channel) {
  if (!channel) return;
  if (channel.type === "voice") {
    if (callState.active && String(callState.roomId) === String(channel.id)) return;
    if (callState.active) leaveCall();
    currentChannel = channel;
    renderChannels();
    $("#channel-name").textContent = channel.name;
    $("#channel-meta").textContent = "Voice room";
    $("#message").placeholder = "Voice room";
    await startCall("voice");
    return;
  }
  if (callState.active && String(callState.roomId) !== String(channel.id)) leaveCall();
  currentChannel = channel;
  unreadChannels[channel.id] = 0;
  localStorage.setItem("orbit_unread_channels", JSON.stringify(unreadChannels));
  renderChannels();
  $("#channel-name").textContent = channel.name;
  $("#channel-meta").textContent = channel.type === "announcement" ? "Announcement channel" : "Realtime conversation";
  $("#message").placeholder = "Message #" + channel.name;
  $("#messages").innerHTML = "";
  const data = await api("/api/channels/" + channel.id + "/messages");
  data.messages.forEach(appendMessage);
  if (socket) socket.emit("channel:join", channel.id);
  $("#messages").scrollTop = $("#messages").scrollHeight;
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

const renameGuestBtn = $("#rename-guest");
if (renameGuestBtn) renameGuestBtn.onclick = () => openModal(
  "Change guest name",
  '<input id="guest-name-input" value="' + escapeHtml(me?.username || "") + '" maxlength="24"><button class="primary" id="save-guest-name">Save name</button>'
);

document.addEventListener("click", async e => {
  try {
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
      if (!["owner","admin","moderator"].includes(String(currentServer.role || ""))) {
        return orbitToast("Admin access", "You do not have permission to open the server control center.");
      }
      location.href = "/admin.html?server=" + encodeURIComponent(currentServer.id);
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
let pendingIncomingCall = null;

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

async function waitForSocket(timeout=5000) {
  if (socket?.connected) return true;
  if (!socket) throw new Error("Realtime connection is not ready yet.");
  await new Promise((resolve, reject) => {
    let done=false;
    const finish=(ok,err)=>{if(done)return;done=true;clearTimeout(timer);socket.off("connect",onConnect);socket.off("connect_error",onError);ok?resolve():reject(err||new Error("Realtime connection failed."));};
    const onConnect=()=>finish(true);
    const onError=err=>finish(false,err instanceof Error?err:new Error("Realtime connection failed."));
    const timer=setTimeout(()=>finish(false,new Error("Realtime connection timed out. Refresh Orbit and try again.")),timeout);
    socket.once("connect",onConnect);
    socket.once("connect_error",onError);
  });
  return true;
}

async function startCall(mode = "video") {
  if (!currentChannel) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    return showError("Camera and microphone access is unavailable here. Open Orbit over HTTPS and allow microphone/camera access.");
  }

  if (callState.active) {
    if (String(callState.roomId) === String(currentChannel.id)) return;
    leaveCall();
  }

  callState.mode = mode;
  callState.roomId = currentChannel.id;
  callStartedAt = Date.now();
  callState.active = true;
  $("#call-panel").classList.remove("hidden");
  $("#call-panel").classList.remove("minimized");
  $("#call-title").textContent = currentChannel.name;
  $("#call-subtitle").textContent = mode === "voice" ? "Voice room · live audio" : "Video room · live audio & video";
  document.body.classList.add("call-open");

  try {
    await waitForSocket();
    await loadRealtimeConfig();
    socket.emit("channel:join", currentChannel.id);
    await setupLocalMedia(mode);
    ensureSelfTile();
    socket.emit("call:join", { channelId: callState.roomId, mode });
    socket.emit("call:media-state", { channelId: callState.roomId, muted: false, cameraOff: mode === "voice", screenShare: false });
    setCallIndicator("LIVE");
    startCallTelemetry();
    updateVoiceDock();
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
    if (state === "connected") {
      setCallIndicator("LIVE");
      updateCallNetwork();
    }
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
  video.onloadedmetadata = () => video.play().catch(() => {});
  video.play?.().catch(() => {});
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
  stopCallTelemetry();
  updateVoiceDock();
  setCallIndicator("IDLE");
  updateCallMeta();
}

function startCallTelemetry() {
  stopCallTelemetry();
  callStartedAt = callStartedAt || Date.now();
  callDurationTimer = setInterval(() => {
    const elapsed = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    $("#call-duration").textContent = mm + ":" + ss;
  }, 500);
  callStatsTimer = setInterval(updateCallNetwork, 4000);
}
function stopCallTelemetry() {
  if (callDurationTimer) clearInterval(callDurationTimer);
  if (callStatsTimer) clearInterval(callStatsTimer);
  callDurationTimer = null;
  callStatsTimer = null;
  callStartedAt = 0;
  $("#call-duration").textContent = "00:00";
  $("#call-network-indicator").textContent = "NETWORK —";
}
async function updateCallNetwork() {
  if (!callState.active || !callState.peers.size) {
    $("#call-network-indicator").textContent = callState.active ? "NETWORK · READY" : "NETWORK —";
    return;
  }
  let maxRtt = 0;
  let packetsLost = 0;
  let packetsTotal = 0;
  for (const [, item] of callState.peers) {
    try {
      const stats = await item.pc.getStats();
      stats.forEach(report => {
        if (report.type === "candidate-pair" && report.state === "succeeded" && typeof report.currentRoundTripTime === "number") {
          maxRtt = Math.max(maxRtt, report.currentRoundTripTime * 1000);
        }
        if (report.type === "inbound-rtp" && typeof report.packetsLost === "number") {
          packetsLost += report.packetsLost;
          packetsTotal += report.packetsReceived || 0;
        }
      });
    } catch {}
  }
  const loss = packetsTotal ? packetsLost / (packetsLost + packetsTotal) : 0;
  let label = "NETWORK · GOOD";
  if (maxRtt > 280 || loss > 0.08) label = "NETWORK · POOR";
  else if (maxRtt > 160 || loss > 0.03) label = "NETWORK · FAIR";
  const netEl = $("#call-network-indicator");
  netEl.textContent = label + (maxRtt ? " · " + Math.round(maxRtt) + "ms" : "");
  netEl.classList.remove("call-network-good", "call-network-fair", "call-network-poor");
  netEl.classList.add(label.endsWith("GOOD") ? "call-network-good" : label.endsWith("FAIR") ? "call-network-fair" : "call-network-poor");
}
function updateVoiceDock() {
  const dock = $("#voice-dock");
  if (!dock) return;
  const active = Boolean(callState.active && currentChannel);
  dock.classList.toggle("hidden", !active);
  if (active) {
    $("#voice-dock-name").textContent = currentChannel.name;
    $("#dock-mic")?.classList.toggle("active", Boolean(callState.micTrack?.enabled));
    $("#dock-screen")?.classList.toggle("active", Boolean(callState.screenTrack));
    $("#dock-leave")?.setAttribute("aria-label", "Leave " + currentChannel.name);
  }
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
  if (!callState.active) {
    if (!currentChannel) return showError("Open a voice or video room first.");
    try { await startCall("video"); } catch {}
    if (!callState.active) return;
  }
  if (callState.screenTrack) {
    await stopScreenShare();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return showError("Screen sharing is not supported by this browser. Open Orbit over HTTPS in a modern browser.");
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

    const track = display.getVideoTracks()[0];
    if (!track) throw new Error("No screen track was returned.");
    callState.screenTrack = track;

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
      if (sender) await sender.replaceTrack(track);
    }

    track.onended = () => stopScreenShare();
    $("#share-btn")?.classList.add("active");
    $("#share-btn")?.classList.add("screen-live");
    $("#dock-screen")?.classList.add("active");
    if (socket && callState.roomId) {
      socket.emit("call:media-state", {
        channelId: callState.roomId,
        muted: callState.micTrack ? !callState.micTrack.enabled : true,
        cameraOff: !callState.cameraTrack?.enabled,
        screenShare: true
      });
    }
    orbitToast("Screen sharing started", "Your screen is now being shared with the call.", "success");
  } catch (err) {
    if (err.name !== "AbortError") showError("Screen sharing failed: " + (err.message || "permission denied"));
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
  $("#share-btn")?.classList.remove("active", "screen-live");
  $("#dock-screen")?.classList.remove("active");
  if (socket && callState.roomId) socket.emit("call:media-state", { channelId: callState.roomId, muted: callState.micTrack ? !callState.micTrack.enabled : true, cameraOff: callState.cameraTrack ? !callState.cameraTrack.enabled : true, screenShare: false });
  orbitToast("Screen sharing stopped", "Your screen is no longer shared.", "");
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

function closeIncomingCall() {
  pendingIncomingCall = null;
  $("#incoming-call").classList.add("hidden");
}
$("#incoming-accept").onclick = async () => {
  const pending = pendingIncomingCall;
  closeIncomingCall();
  if (!pending) return;
  try {
    if (pending.serverId) {
      const targetServer = servers.find(s => String(s.id) === String(pending.serverId));
      if (targetServer && String(currentServer?.id) !== String(targetServer.id)) await selectServer(targetServer);
    }
    const targetChannel = channels.find(c => String(c.id) === String(pending.channelId));
    if (!targetChannel) return showError("The calling room is no longer available.");
    if (String(currentChannel?.id) !== String(targetChannel.id) || currentChannel?.type !== targetChannel.type) {
      await selectChannel(targetChannel);
    }
    if (!callState.active) await startCall(pending.mode || "video");
  } catch (err) {
    showError(err.message || "Unable to join the call.");
  }
};
$("#incoming-decline").onclick = () => {
  const pending = pendingIncomingCall;
  closeIncomingCall();
  if (pending && socket) socket.emit("call:decline", { channelId: pending.channelId, callerSocketId: pending.socketId });
};
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
const dmState = {
  list: [],
  activeId: null,
  active: null,
  messages: [],
  query: "",
  typingTimer: null,
  drafts: JSON.parse(localStorage.getItem("orbit_dm_drafts") || "{}")
};

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
  document.body.classList.remove("mobile-sidebar-open");
  $("#sidebar")?.classList.remove("open");
}

function upsertPulseUser(user, activity){
  if(!user?.id)return;
  const normalized={...user,activity:activity||user.activity||user.status||"Online"};
  const i=pulseState.users.findIndex(x=>String(x.id)===String(normalized.id));
  if(i===-1)pulseState.users.unshift(normalized);
  else pulseState.users[i]={...pulseState.users[i],...normalized};
}
function addPulseActivity(item){
  if(!item)return;
  pulseState.activity.unshift(item);
  pulseState.activity=pulseState.activity.slice(0,pulseState.maxActivity);
}
function handlePulseEvent(event){
  if(!event)return;
  const now=event.createdAt||new Date().toISOString();
  if(event.user) upsertPulseUser(event.user,event.activity||event.user.activity);
  if(event.type==="presence"){
    if(event.user) upsertPulseUser(event.user,event.activity);
  }else if(event.type==="call-start"){
    const existing=pulseState.calls.find(c=>String(c.channelId)===String(event.channelId));
    if(existing){
      if(event.user && !existing.participants.some(p=>String(p.id)===String(event.user.id))) existing.participants.push(event.user);
    }else{
      pulseState.calls.unshift({
        roomId:event.channelId,
        channelId:event.channelId,
        serverId:event.serverId,
        channelName:event.channelName||"Voice room",
        mode:event.mode||"video",
        participants:event.user?[event.user]:[]
      });
    }
    addPulseActivity({type:event.type,createdAt:now,user:event.user,channelName:event.channelName,mode:event.mode});
  }else if(event.type==="call-end"){
    const call=pulseState.calls.find(c=>String(c.channelId)===String(event.channelId));
    if(call&&event.user){
      call.participants=call.participants.filter(p=>String(p.id)!==String(event.user.id));
      if(!call.participants.length)pulseState.calls=pulseState.calls.filter(c=>String(c.channelId)!==String(event.channelId));
    }
    addPulseActivity({type:event.type,createdAt:now,user:event.user,channelName:event.channelName});
  }else if(event.type==="screen-share"){
    addPulseActivity({type:event.type,createdAt:now,user:event.user,channelName:event.channelName});
  }else if(event.type==="message"){
    addPulseActivity({type:event.type,createdAt:now,user:event.user,channelName:event.channelName,preview:event.preview});
  }
  if(orbitUI.view==="home") renderPulse();
}
async function loadPulse(){
  try{
    const data=await api("/api/pulse");
    pulseState.users=data.users||[];
    pulseState.calls=data.calls||[];
    if(!pulseState.activity.length){
      pulseState.activity=[];
      (pulseState.calls||[]).slice(0,6).forEach(c=>{
        (c.participants||[]).forEach(u=>addPulseActivity({type:"call-start",createdAt:new Date().toISOString(),user:u,channelName:c.channelName,mode:c.mode}));
      });
    }
  }catch{}
  renderPulse();
}
function formatPulseTime(ts){
  const d=ts?new Date(ts):new Date();
  return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
function pulseUserCard(user){
  const activity=user.activity||user.status||"Online";
  const activityClass=activity==="Offline"?"offline":activity.toLowerCase().includes("screen")?"screen":activity.toLowerCase().includes("call")||activity.toLowerCase().includes("voice")||activity.toLowerCase().includes("video")?"live":"online";
  return '<button class="pulse-person" data-pulse-user="'+escapeHtml(user.id)+'">'+
    '<div class="pulse-avatar-wrap"><div class="avatar">'+escapeHtml(avatar(user.username))+'</div><i class="'+activityClass+'"></i></div>'+
    '<div class="pulse-person-copy"><strong>'+escapeHtml(user.display_name||user.username)+'</strong><span>'+escapeHtml(user.handle||("@"+user.username))+'</span></div>'+
    '<em>'+escapeHtml(activity)+'</em>'+
  '</button>';
}
function renderPulse(){
  const panel=$("#pulse-panel");
  if(!panel)return;
  const liveUsers=pulseState.users.filter(u=>(u.status||"online")!=="offline");
  const calls=pulseState.calls||[];
  const activities=pulseState.activity||[];
  const userMap=new Map(pulseState.users.map(u=>[String(u.id),u]));
  panel.innerHTML=
    '<div class="pulse-hero"><div><span class="eyebrow">ORBIT PULSE</span><h3>Everything alive, right now.</h3><p>Presence, calls, screen sharing and community activity update live.</p></div><div class="pulse-live-badge"><span></span>LIVE</div></div>'+
    '<div class="pulse-grid">'+
      '<section class="pulse-card pulse-people"><div class="pulse-card-head"><div><strong>Live now</strong><span>'+liveUsers.length+' online</span></div><button class="pulse-refresh" id="pulse-refresh">Refresh</button></div><div class="pulse-people-grid">'+
        (liveUsers.length?liveUsers.slice(0,12).map(pulseUserCard).join(""):'<div class="pulse-empty">Nobody else is online yet.</div>')+
      '</div></section>'+
      '<section class="pulse-card pulse-calls"><div class="pulse-card-head"><div><strong>Live rooms</strong><span>'+calls.length+' active</span></div><span class="pulse-signal">● Realtime</span></div><div class="pulse-call-list">'+
        (calls.length?calls.slice(0,6).map(c=>{
          const names=(c.participants||[]).slice(0,3).map(p=>escapeHtml(p.username)).join(", ");
          return '<button class="pulse-call-row" data-pulse-server="'+escapeHtml(c.serverId||"")+'" data-pulse-channel="'+escapeHtml(c.channelId||"")+'"><div class="pulse-call-icon">◉</div><div><strong>#'+escapeHtml(c.channelName||"room")+'</strong><span>'+escapeHtml(c.mode==="voice"?"Voice":"Video")+' · '+(c.participants?.length||0)+' people · '+names+'</span></div><b>Join →</b></button>';
        }).join(""):'<div class="pulse-empty">No active calls. Start the room and invite someone.</div>')+
      '</div></section>'+
      '<section class="pulse-card pulse-activity"><div class="pulse-card-head"><div><strong>Activity</strong><span>Latest events</span></div><span class="pulse-signal">LIVE FEED</span></div><div class="pulse-activity-list">'+
        (activities.length?activities.slice(0,8).map(item=>{
          const u=item.user||{};
          let text="Activity";
          if(item.type==="message")text='sent a message in #'+(item.channelName||"channel");
          if(item.type==="call-start")text='joined '+(item.mode==="voice"?"voice":"video")+' in #'+(item.channelName||"room");
          if(item.type==="call-end")text='left #'+(item.channelName||"room");
          if(item.type==="screen-share")text='started screen sharing in #'+(item.channelName||"room");
          if(item.type==="presence")text='is '+(item.activity||u.status||"online").toLowerCase();
          return '<button class="pulse-activity-row" data-pulse-user="'+escapeHtml(u.id||"")+'"><div class="avatar">'+escapeHtml(avatar(u.username||"G"))+'</div><div><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><span>'+escapeHtml(text)+(item.preview?' · '+escapeHtml(item.preview):"")+'</span></div><time>'+formatPulseTime(item.createdAt)+'</time></button>';
        }).join(""):'<div class="pulse-empty">The feed will fill as people interact.</div>')+
      '</div></section>'+
    '</div>';
  $("#pulse-refresh")?.addEventListener("click",loadPulse);
  document.querySelectorAll("[data-pulse-user]").forEach(btn=>btn.addEventListener("click",()=>openPulseProfile(btn.dataset.pulseUser)));
  document.querySelectorAll("[data-pulse-server][data-pulse-channel]").forEach(btn=>btn.addEventListener("click",async()=>{
    const s=servers.find(x=>String(x.id)===String(btn.dataset.pulseServer));
    if(s)await selectServer(s);
    const ch=channels.find(x=>String(x.id)===String(btn.dataset.pulseChannel));
    if(ch)await selectChannel(ch);
    goChat();
  }));
}
async function openPulseProfile(userId){
  const user=pulseState.users.find(u=>String(u.id)===String(userId));
  if(!user)return;
  const activity=user.activity||user.status||"Online";
  openModal("Profile",
    '<div class="pulse-profile-modal">'+
      '<div class="pulse-profile-top"><div class="pulse-big-avatar">'+escapeHtml(avatar(user.username))+'</div><div><strong>'+escapeHtml(user.display_name||user.username)+'</strong><span>'+escapeHtml(user.handle||("@"+user.username))+'</span><em>'+escapeHtml(activity)+'</em></div></div>'+
      '<div class="pulse-profile-actions"><button class="primary" id="pulse-message-user">Message</button><button id="pulse-add-user">Add friend</button></div>'+
    '</div>');
  $("#pulse-message-user").onclick=async()=>{
    try{await api("/api/dms",{method:"POST",body:JSON.stringify({username:user.username})});closeModal();setView("dms");renderDMPage();orbitToast("Conversation ready","DM with @"+user.username+" is ready.","success")}catch(e){orbitToast("DM failed",e.message,"error")}
  };
  $("#pulse-add-user").onclick=async()=>{
    try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username:user.username})});closeModal();orbitToast("Friend request sent","Request sent to @"+user.username+".","success")}catch(e){orbitToast("Friend request failed",e.message,"error")}
  };
}
function renderHomePage(){
  $("#page-actions").innerHTML='<button id="home-create">+ Create server</button><button id="home-search">Search</button>';
  $("#page-body").innerHTML=
  '<div class="pulse-command"><div><span class="eyebrow">REALTIME SOCIAL OS</span><h2>Orbit Pulse</h2><p>Your community, alive in one view.</p></div><div class="pulse-command-actions"><button id="pulse-open-chat">Open chat</button><button id="pulse-open-settings">Personalize</button></div></div>'+
  '<div id="pulse-panel" class="pulse-live-surface"></div>'+
  '<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">WORKSPACE</span><h2>Everything in one place.</h2><p>Chat, communities, voice rooms, screen sharing, search, threads and moderation controls.</p><button class="hero-action" id="home-open-chat">Open #'+escapeHtml(currentChannel?.name||"general")+'</button></div>'+
    '<div class="hero-card"><span class="eyebrow">LIVE</span><h2>Voice & Video</h2><p>Jump into a room with high-quality media, screen sharing and live controls.</p><button class="hero-action" id="home-call">Start video</button></div>'+
    '<div class="hero-card"><span class="eyebrow">PROFILE</span><h2>'+escapeHtml(orbitUI.profile.displayName||me?.displayName||me?.username||"Guest")+'</h2><p>'+escapeHtml(orbitUI.profile.bio)+'</p><button class="hero-action" id="home-profile">Customize</button></div>'+
  '</div>'+
  '<div class="metric-grid">'+
    '<div class="metric"><span>Communities</span><strong>'+servers.length+'</strong><span>Connected workspaces</span></div>'+
    '<div class="metric"><span>Live now</span><strong id="home-live-count">—</strong><span>People online</span></div>'+
    '<div class="metric"><span>Active rooms</span><strong id="home-call-count">—</strong><span>Live calls</span></div>'+
    '<div class="metric"><span>Identity</span><strong>@'+escapeHtml(me?.username||"guest")+'</strong><span>Unique Orbit username</span></div>'+
  '</div>'+
  '<div class="section-block"><div class="section-heading"><h3>Quick actions</h3><span>Built into Orbit Pulse</span></div><div class="card-grid">'+
    '<button class="content-card" id="qa-search"><div class="chip">⌕</div><h4>Search Orbit</h4><p>Find people, communities, channels and messages.</p></button>'+
    '<button class="content-card" id="qa-poll"><div class="chip">◫</div><h4>Create poll</h4><p>Publish a realtime poll in the current channel.</p></button>'+
    '<button class="content-card" id="qa-friends"><div class="chip">◎</div><h4>Friends</h4><p>Meet people who are online right now.</p></button>'+
  '</div></div>';
  $("#home-open-chat").onclick=goChat;
  $("#home-call").onclick=()=>{goChat();startCall("video")};
  $("#home-profile").onclick=()=>{setView("settings");renderSettingsPage("profile")};
  $("#home-create").onclick=()=>$("#new-server").click();
  $("#home-search").onclick=()=>openSearchModal("");
  $("#pulse-open-chat").onclick=goChat;
  $("#pulse-open-settings").onclick=()=>{setView("settings");renderSettingsPage("appearance")};
  $("#qa-search").onclick=()=>openSearchModal("");
  $("#qa-poll").onclick=openPoll;
  $("#qa-friends").onclick=()=>setView("friends");
  loadPulse();
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

function formatDMTime(ts){
  if(!ts)return "";
  const d=new Date(ts), nowDate=new Date();
  if(d.toDateString()===nowDate.toDateString()) return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  return d.toLocaleDateString([], {month:"short",day:"numeric"})+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
function dmCurrentOther(){return dmState.active?.otherUser||null}
function dmUserStatus(user){
  if(!user)return "Offline";
  const live=pulseState.users.find(u=>String(u.id)===String(user.id));
  return String(live?.status||user.status||"offline").toLowerCase()==="online"?"Online":"Offline";
}
function saveDMDraft(){
  if(!dmState.activeId)return;
  const value=$("#dm-input")?.value||"";
  if(value)dmState.drafts[dmState.activeId]=value;else delete dmState.drafts[dmState.activeId];
  localStorage.setItem("orbit_dm_drafts",JSON.stringify(dmState.drafts));
}
function dmMessageMarkup(m){
  const own=String(m.user_id)===String(me?.id);
  return '<article class="dm-message '+(own?"own":"")+'" data-dm-message-id="'+escapeHtml(m.id)+'">'+
    (!own?'<div class="dm-message-avatar">'+escapeHtml(avatar(m.username))+'</div>':"")+
    '<div class="dm-message-stack"><div class="dm-message-bubble">'+escapeHtml(m.content)+'</div>'+
    '<div class="dm-message-meta">'+escapeHtml(formatDMTime(m.created_at))+(own&&m.seen_at?' · Seen':"")+(m.edited_at?' · edited':"")+'</div></div></article>';
}
function renderDMMessageFeed(scrollBottom){
  const feed=$("#dm-messages");if(!feed)return;
  const other=dmCurrentOther();
  feed.innerHTML=dmState.messages.map(dmMessageMarkup).join("")||
    '<div class="dm-empty-chat"><div class="dm-empty-icon">◌</div><strong>Start the conversation</strong><span>Send a message to '+escapeHtml(other?.display_name||other?.username||"your friend")+'.</span></div>';
  if(scrollBottom)requestAnimationFrame(()=>feed.scrollTop=feed.scrollHeight);
}
function renderDMList(){
  const root=$("#dm-list");if(!root)return;
  const q=dmState.query.trim().toLowerCase();
  const rows=dmState.list.filter(dm=>{
    const u=dm.otherUser||{};
    return !q||String(u.username||"").toLowerCase().includes(q)||String(u.display_name||"").toLowerCase().includes(q);
  });
  root.innerHTML=rows.length?rows.map(dm=>{
    const u=dm.otherUser||{},active=String(dm.id)===String(dmState.activeId),unread=Number(dm.unreadCount||0);
    const preview=dm.lastMessage?.content||"No messages yet";
    const online=dmUserStatus(u)==="Online";
    return '<button class="dm-conversation '+(active?"active":"")+'" data-dm-open="'+escapeHtml(dm.id)+'">'+
      '<div class="dm-list-avatar"><div class="avatar">'+escapeHtml(avatar(u.username))+'</div><i class="'+(online?"online":"offline")+'"></i></div>'+
      '<div class="dm-list-copy"><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><span>@'+escapeHtml(u.username||"guest")+'</span><p>'+escapeHtml(preview)+'</p></div>'+
      '<div class="dm-list-meta">'+(dm.lastMessage?.created_at?'<time>'+escapeHtml(formatDMTime(dm.lastMessage.created_at))+'</time>':"")+(unread?'<b>'+unread+'</b>':"")+'</div></button>';
  }).join(""):'<div class="dm-list-empty"><div class="dm-empty-icon">◌</div><strong>No conversations</strong><span>Start a private chat with a friend.</span></div>';
  root.querySelectorAll("[data-dm-open]").forEach(b=>b.onclick=()=>openDM(b.dataset.dmOpen));
}
function renderDMHeader(){
  const u=dmCurrentOther(),title=$("#dm-active-name"),meta=$("#dm-active-meta"),av=$("#dm-active-avatar"),dot=$("#dm-active-status");
  if(!title||!meta||!av)return;
  if(!u){title.textContent="Select a conversation";meta.textContent="Choose a friend from the left to start chatting.";av.textContent="O";dot?.classList.remove("online");return;}
  title.textContent=u.display_name||u.username||"Guest";
  meta.textContent=(dmUserStatus(u)==="Online"?"Online":"Offline")+" · @"+(u.username||"guest");
  av.textContent=avatar(u.username);
  dot?.classList.toggle("online",dmUserStatus(u)==="Online");
}
function renderDMPageShell(){
  $("#page-body").innerHTML='<div class="dm-shell">'+
    '<aside class="dm-list-pane">'+
      '<div class="dm-list-head"><div><span class="eyebrow">PRIVATE</span><strong>Messages</strong><span>1:1 conversations</span></div><button id="dm-new-inline" title="New message">+</button></div>'+
      '<label class="dm-search"><span>⌕</span><input id="dm-list-search" placeholder="Search conversations"></label>'+
      '<div id="dm-list" class="dm-list"></div>'+
    '</aside>'+
    '<section class="dm-chat-pane">'+
      '<div class="dm-chat-header"><div class="dm-active-profile"><div id="dm-active-avatar" class="dm-active-avatar"><span>O</span></div><span id="dm-active-status" class="dm-active-dot"></span><div><strong id="dm-active-name">Select a conversation</strong><span id="dm-active-meta">Choose a friend from the left to start chatting.</span></div></div><div class="dm-chat-actions"><button id="dm-refresh-inline" title="Refresh">↻</button><button id="dm-profile-inline" title="Profile">◉</button></div></div>'+
      '<div id="dm-messages" class="dm-messages"><div class="dm-empty-chat"><div class="dm-empty-icon">◌</div><strong>Your private space</strong><span>Select a conversation and start talking.</span></div></div>'+
      '<div id="dm-typing" class="dm-typing"></div>'+
      '<form id="dm-form" class="dm-composer"><textarea id="dm-input" rows="1" maxlength="4000" placeholder="Write a message…"></textarea><div class="dm-composer-bottom"><span class="dm-hint">Enter to send · Shift+Enter for a new line</span><div><button type="button" id="dm-emoji" class="dm-tool" title="Quick emoji">☺</button><button class="dm-send" type="submit">Send ↗</button></div></div></form>'+
    '</section></div>';
}
function bindDMPage(){
  $("#dm-new-inline")?.addEventListener("click",()=>openModal("New direct message",'<input id="dm-target" placeholder="Exact guest username"><button class="primary" id="dm-create">Start conversation</button>'));
  $("#dm-refresh-inline")?.addEventListener("click",()=>renderDMPage());
  $("#dm-list-search")?.addEventListener("input",e=>{dmState.query=e.target.value;renderDMList()});
  $("#dm-profile-inline")?.addEventListener("click",()=>{const u=dmCurrentOther();if(u)openPulseProfile(u.id)});
  $("#dm-emoji")?.addEventListener("click",()=>{const input=$("#dm-input");if(!input)return;const start=input.selectionStart??input.value.length;input.value=input.value.slice(0,start)+"🙂"+input.value.slice(input.selectionEnd??start);input.focus();input.selectionStart=input.selectionEnd=start+2;saveDMDraft()});
  $("#dm-input")?.addEventListener("input",()=>{
    const input=$("#dm-input");saveDMDraft();input.style.height="auto";input.style.height=Math.min(input.scrollHeight,130)+"px";
    if(!dmState.activeId||!socket)return;
    socket.emit("dm:typing",{dmId:dmState.activeId,isTyping:true});
    clearTimeout(dmState.typingTimer);
    dmState.typingTimer=setTimeout(()=>socket?.emit("dm:typing",{dmId:dmState.activeId,isTyping:false}),900);
  });
  $("#dm-input")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#dm-form")?.requestSubmit()}});
  $("#dm-form")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const input=$("#dm-input"),value=input?.value.trim();
    if(!dmState.activeId)return orbitToast("Choose a conversation","Select your friend first.","error");
    if(!value)return;
    try{
      await api("/api/dms/"+encodeURIComponent(dmState.activeId)+"/messages",{method:"POST",body:JSON.stringify({content:value})});
      delete dmState.drafts[dmState.activeId];localStorage.setItem("orbit_dm_drafts",JSON.stringify(dmState.drafts));
      input.value="";input.style.height="auto";
      socket?.emit("dm:typing",{dmId:dmState.activeId,isTyping:false});
    }catch(err){orbitToast("Message failed",err.message,"error")}
  });
}
async function renderDMPage(selectId=null){
  $("#page-actions").innerHTML='<button id="new-dm-page">+ New message</button><button id="refresh-dm-page">Refresh</button>';
  renderDMPageShell();bindDMPage();
  $("#new-dm-page").onclick=()=>$("#dm-new-inline")?.click();
  $("#refresh-dm-page").onclick=renderDMPage;
  try{
    const d=await api("/api/dms");dmState.list=d.dms||[];renderDMList();
    const preferred=selectId||dmState.activeId||dmState.list[0]?.id;
    if(preferred)await openDM(preferred);else renderDMHeader();
  }catch(e){$("#dm-list").innerHTML='<div class="dm-list-empty"><strong>Could not load conversations</strong><span>'+escapeHtml(e.message)+'</span></div>'}
}
async function openDM(idValue){
  try{
    const dm=dmState.list.find(x=>String(x.id)===String(idValue));if(!dm)return;
    if(dmState.activeId&&String(dmState.activeId)!==String(idValue))socket?.emit("dm:typing",{dmId:dmState.activeId,isTyping:false});
    dmState.activeId=dm.id;dmState.active=dm;dmState.messages=[];
    renderDMList();renderDMHeader();
    const d=await api("/api/dms/"+encodeURIComponent(idValue)+"/messages");
    dmState.messages=d.messages||[];renderDMMessageFeed(true);
    socket?.emit("dm:join",idValue);socket?.emit("dm:read",idValue);
    api("/api/dms/"+encodeURIComponent(idValue)+"/read",{method:"POST",body:"{}"}).catch(()=>{});
    const input=$("#dm-input"),draft=dmState.drafts[idValue]||"";
    if(input){input.value=draft;input.style.height="auto";input.style.height=Math.min(input.scrollHeight,130)+"px";requestAnimationFrame(()=>input.focus())}
    dmState.active.unreadCount=0;renderDMList();
  }catch(e){orbitToast("DM failed",e.message,"error")}
}
async function renderFriendsPage(){
  $("#page-actions").innerHTML='<button id="add-friend-page">+ Add friend</button><button id="refresh-friends-page">Refresh</button>';
  $("#page-body").innerHTML='<div class="content-card"><h4>Loading friends…</h4></div>';
  $("#add-friend-page").onclick=()=>openModal("Add friend",
  '<div class="friend-modal">'+
    '<div class="friend-hero"><div class="friend-icon">◎</div><div><strong>Add a new friend</strong><span>Search for a live Orbit guest by username.</span></div></div>'+
    '<label class="friend-search-box"><span>⌕</span><input id="friend-target" list="friend-user-options" placeholder="Search username..." autocomplete="off"><datalist id="friend-user-options"></datalist><kbd>Enter</kbd></label>'+
    '<div id="friend-search-results" class="friend-results"><div class="friend-empty">Start typing to search live guests.</div></div>'+
    '<button class="primary friend-send-btn" id="friend-create" disabled>Send friend request</button>'+
  '</div>'
);
  $("#refresh-friends-page").onclick=renderFriendsPage;
  try{
    const d=await api("/api/friends");
    $("#page-body").innerHTML=
      '<div class="section-block"><div class="section-heading"><h3>Friends</h3><span>'+d.friends.length+'</span></div><div class="list-card">'+
      (d.friends.length?d.friends.map(u=>'<div class="list-row"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.username)+'</strong><span>'+escapeHtml(u.status)+'</span></div><button data-dm-friend="'+escapeHtml(u.username)+'">Message</button></div>').join(""):'<div class="content-card"><h4>No friends yet</h4><p>Send a request to another guest.</p></div>')+
      '</div></div>'+
      '<div class="section-block"><div class="section-heading"><h3>Requests</h3><span>'+d.incoming.length+' incoming</span></div><div class="list-card">'+
      d.incoming.map(r=>'<div class="list-row"><div class="avatar">'+avatar(r.fromUser?.username)+'</div><div><strong>'+escapeHtml(r.fromUser?.username||"Guest")+'</strong><span>Friend request · incoming</span></div><div class="row-actions"><button data-accept="'+r.id+'">Accept</button><button data-reject="'+r.id+'">Decline</button></div></div>').join("")+
      '</div></div>'+
      '<div class="section-block"><div class="section-heading"><h3>Outgoing</h3><span>'+d.outgoing.length+' pending</span></div><div class="list-card">'+
      (d.outgoing.length?d.outgoing.map(r=>'<div class="list-row"><div class="avatar">'+avatar(r.toUser?.username)+'</div><div><strong>'+escapeHtml(r.toUser?.username||"Guest")+'</strong><span>Friend request · waiting</span></div><span class="chip">Pending</span></div>').join(""):'<div class="content-card"><p>No pending outgoing requests.</p></div>')+
      '</div></div>';
    document.querySelectorAll("[data-accept]").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+encodeURIComponent(b.dataset.accept)+"/accept",{method:"POST",body:"{}"});orbitToast("Friend added","Request accepted.","success");renderFriendsPage()}catch(err){orbitToast("Request failed",err.message,"error")}});
    document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+encodeURIComponent(b.dataset.reject)+"/reject",{method:"POST",body:"{}"});orbitToast("Request declined","The request was rejected.","");renderFriendsPage()}catch(err){orbitToast("Request failed",err.message,"error")}});
    const friendSearch=$("#friend-target");
    if(friendSearch){
      const sendBtn=$("#friend-create");
      const loadFriendSuggestions=async()=>{
        const q=friendSearch.value.trim();
        if(sendBtn) sendBtn.disabled=true;
        if(q.length<1){
          const results=$("#friend-search-results");
          if(results) results.innerHTML='<div class="friend-empty">Start typing to search live guests.</div>';
          return;
        }
        try{
          const found=await api("/api/search?q="+encodeURIComponent(q));
          const users=(found.users||[]).filter(u=>String(u.id)!==String(me?.id)).slice(0,8);
          const options=$("#friend-user-options"), results=$("#friend-search-results");
          if(options)options.innerHTML=users.map(u=>'<option value="'+escapeHtml(u.username)+'">').join("");
          if(results)results.innerHTML=users.length?users.map(u=>'<button type="button" class="list-row friend-pick" data-friend-name="'+escapeHtml(u.username)+'"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.username)+'</strong><span>'+escapeHtml(u.status)+' · guest</span></div><span>Use</span></button>').join(""):'<div class="friend-empty">No matching live guest.</div>';
          if(sendBtn) sendBtn.disabled=users.length===0;
          document.querySelectorAll("[data-friend-name]").forEach(btn=>btn.onclick=()=>{
            friendSearch.value=btn.dataset.friendName;
            if(sendBtn) sendBtn.disabled=false;
            document.querySelectorAll("[data-friend-name]").forEach(x=>x.classList.remove("selected"));
            btn.classList.add("selected");
          });
        }catch(err){orbitToast("Search failed",err.message,"error")}
      };
      friendSearch.oninput=loadFriendSuggestions;
    }
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

const ORBIT_ACCENTS = {
  purple: { accent: "#7652e8", accent2: "#a184ff" },
  ocean: { accent: "#3278e8", accent2: "#5aa8ff" },
  cyan: { accent: "#159fa8", accent2: "#45d6de" },
  emerald: { accent: "#1e9a68", accent2: "#5ce0a6" },
  rose: { accent: "#c74e78", accent2: "#f18cae" },
  amber: { accent: "#b77a21", accent2: "#f0bb59" }
};
function applyAccentTheme(nameOrHex){
  let theme=ORBIT_ACCENTS[nameOrHex] || Object.values(ORBIT_ACCENTS).find(v=>v.accent===nameOrHex) || ORBIT_ACCENTS.purple;
  const name=Object.keys(ORBIT_ACCENTS).find(k=>ORBIT_ACCENTS[k]===theme) || "purple";
  document.documentElement.style.setProperty("--accent",theme.accent);
  document.documentElement.style.setProperty("--accent2",theme.accent2);
  localStorage.setItem("orbit_theme",name);
  if(orbitUI?.profile){orbitUI.profile.accent=theme.accent;localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));}
  document.querySelectorAll("[data-accent-theme]").forEach(b=>b.classList.toggle("active",b.dataset.accentTheme===name));
}
const ORBIT_BACKGROUNDS = {
  midnight: "linear-gradient(135deg,#05070c 0%,#0b1020 48%,#171026 100%)",
  aurora: "radial-gradient(circle at 18% 18%,rgba(90,160,255,.24),transparent 28%),radial-gradient(circle at 82% 12%,rgba(161,88,255,.24),transparent 30%),linear-gradient(135deg,#05070c,#0d1420 52%,#171026)",
  violet: "radial-gradient(circle at 70% 20%,rgba(144,89,255,.25),transparent 32%),linear-gradient(140deg,#07070d,#1c1235 55%,#0b0d16)",
  ocean: "radial-gradient(circle at 18% 25%,rgba(40,164,255,.24),transparent 30%),linear-gradient(145deg,#041017,#071b2a 58%,#09131d)",
  emerald: "radial-gradient(circle at 78% 28%,rgba(58,210,150,.20),transparent 30%),linear-gradient(145deg,#06100e,#0d2119 58%,#0a1011)",
  sunset: "radial-gradient(circle at 76% 18%,rgba(255,120,80,.20),transparent 28%),linear-gradient(145deg,#12090b,#29131f 48%,#0d0c15)"
};
function applyOrbitBackground(kind, value){
  const root=document.documentElement;
  const type=kind==="image"?"image":"preset";
  if(type==="image"){
    const safe=String(value||"").replace(/'/g,"\\'");
    root.style.setProperty("--orbit-wallpaper","url('"+safe+"')");
    localStorage.setItem("orbit_background_type","image");
    localStorage.setItem("orbit_background_value",String(value||""));
  }else{
    const bg=ORBIT_BACKGROUNDS[value]||ORBIT_BACKGROUNDS.midnight;
    root.style.setProperty("--orbit-wallpaper",bg);
    localStorage.setItem("orbit_background_type","preset");
    localStorage.setItem("orbit_background_value",value||"midnight");
  }
  document.querySelectorAll("[data-bg-preset]").forEach(b=>b.classList.toggle("active",type==="preset"&&b.dataset.bgPreset===(value||"midnight")));
}
function applySavedOrbitBackground(){
  const type=localStorage.getItem("orbit_background_type")||"preset";
  const value=localStorage.getItem("orbit_background_value")||"midnight";
  if(type==="image"&&value){applyOrbitBackground("image",value)}
  else{applyOrbitBackground("preset",value)}
  const opacity=localStorage.getItem("orbit_bg_overlay")||"72";
  document.documentElement.style.setProperty("--orbit-overlay-opacity",(Number(opacity)||72)/100);
}
function renderSettingsPage(section="appearance"){
  const sections=[["appearance","Appearance"],["profile","Profile"],["privacy","Privacy"],["voice","Voice & Video"],["notifications","Notifications"],["accessibility","Accessibility"],["performance","Performance"],["security","Security"],["advanced","Advanced"]];
  $("#page-actions").innerHTML="";
  $("#page-body").innerHTML='<div class="settings-layout"><nav class="settings-nav">'+sections.map(s=>'<button class="'+(s[0]===section?"active":"")+'" data-settings-section="'+s[0]+'">'+s[1]+'</button>').join("")+'</nav><div id="settings-card" class="settings-card"></div></div>';
  document.querySelectorAll("[data-settings-section]").forEach(b=>b.onclick=()=>renderSettingsPage(b.dataset.settingsSection));
  const card=$("#settings-card");
  if(section==="appearance"){
    const reduced=localStorage.getItem("orbit_motion")==="reduced",compact=localStorage.getItem("orbit_density")==="compact";
    const bgType=localStorage.getItem("orbit_background_type")||"preset";
    const bgValue=localStorage.getItem("orbit_background_value")||"midnight";
    const bgOverlay=Math.round((Number(localStorage.getItem("orbit_bg_overlay")||"72")/100)*100);
    card.innerHTML='<h3>Appearance</h3><p>Customize Orbit colors, spacing and the background of the whole app.</p>'+
      setting("Reduced motion","Reduce transitions and animation.",reduced,"appearance-motion")+
      setting("Compact density","Tighter chat and navigation spacing.",compact,"appearance-density")+
      '<div class="setting-row"><div><strong>Theme color</strong><span>Choose an Orbit accent.</span></div></div>'+
      '<div class="accent-palette">'+Object.entries(ORBIT_ACCENTS).map(([name,t])=>'<button type="button" class="accent-swatch '+((localStorage.getItem("orbit_theme")||"purple")===name?"active":"")+'" data-accent-theme="'+name+'" style="--swatch:'+t.accent+'"><span></span><strong>'+name+'</strong></button>').join("")+'</div>'+
      '<div class="setting-row"><div><strong>Custom accent</strong><span>Choose any color.</span></div><input id="accent-color" type="color" value="'+escapeHtml(orbitUI.profile.accent)+'" style="width:42px;height:30px"></div>'+
      '<div class="appearance-divider"></div>'+
      '<div class="setting-row"><div><strong>Background</strong><span>Pick a preset or use your own image.</span></div></div>'+
      '<div class="background-palette">'+Object.entries(ORBIT_BACKGROUNDS).map(([name])=>'<button type="button" class="background-swatch '+(bgType==="preset"&&bgValue===name?"active":"")+'" data-bg-preset="'+name+'" style="--bg-sample:'+ORBIT_BACKGROUNDS[name]+'"><strong>'+name+'</strong></button>').join("")+'</div>'+
      '<div class="background-tools"><label class="background-url"><span>Image URL</span><input id="bg-url" placeholder="https://example.com/background.jpg" value="'+(bgType==="image"?escapeHtml(bgValue):"")+'"></label><button type="button" id="bg-apply-url">Use image</button><button type="button" id="bg-upload">Upload</button><button type="button" id="bg-reset">Reset</button></div>'+
      '<div class="setting-row bg-opacity-row"><div><strong>Background darkness</strong><span>More darkness keeps text easy to read.</span></div><input id="bg-overlay" type="range" min="35" max="90" value="'+bgOverlay+'"><b id="bg-overlay-value">'+bgOverlay+'%</b></div>';
    $("#accent-color").onchange=e=>{document.documentElement.style.setProperty("--accent",e.target.value);document.documentElement.style.setProperty("--accent2",e.target.value);orbitUI.profile.accent=e.target.value;localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));document.querySelectorAll("[data-accent-theme]").forEach(b=>b.classList.remove("active"));};
    document.querySelectorAll("[data-accent-theme]").forEach(b=>b.onclick=()=>applyAccentTheme(b.dataset.accentTheme));
    document.querySelectorAll("[data-bg-preset]").forEach(b=>b.onclick=()=>applyOrbitBackground("preset",b.dataset.bgPreset));
    $("#bg-apply-url").onclick=()=>{const url=$("#bg-url").value.trim();if(!/^https?:\/\//i.test(url))return orbitToast("Background","Enter a valid image URL.","error");applyOrbitBackground("image",url);orbitToast("Background updated","Custom image applied.","success");renderSettingsPage("appearance");};
    $("#bg-reset").onclick=()=>{applyOrbitBackground("preset","midnight");localStorage.removeItem("orbit_background_type");localStorage.removeItem("orbit_background_value");renderSettingsPage("appearance");orbitToast("Background reset","Orbit's default background is back.","success");};
    $("#bg-overlay").oninput=e=>{const v=Number(e.target.value);document.documentElement.style.setProperty("--orbit-overlay-opacity",v/100);localStorage.setItem("orbit_bg_overlay",String(v));$("#bg-overlay-value").textContent=v+"%";};
    $("#bg-upload").onclick=()=>{
      const input=document.createElement("input");input.type="file";input.accept="image/*";
      input.onchange=()=>{const file=input.files?.[0];if(!file)return;if(file.size>1500000)return orbitToast("Background","Image must be 1.5 MB or smaller.","error");const fr=new FileReader();fr.onload=()=>{applyOrbitBackground("image",String(fr.result));renderSettingsPage("appearance");orbitToast("Background updated","Your image is now the Orbit background.","success")};fr.readAsDataURL(file)};
      input.click();
    };
  }else if(section==="profile"){
    card.innerHTML='<h3>Profile</h3><p>Your username is your unique Orbit identity. Friends can find you with it.</p>'+
      '<div class="username-field"><span>@</span><input id="profile-username" value="'+escapeHtml(me?.username||"")+'" maxlength="20" placeholder="username"><button id="check-username" type="button">Check</button></div>'+
      '<div id="username-status" class="field-note">Use 4–20 letters, numbers, dots, underscores or dashes.</div>'+
      '<input id="profile-name" value="'+escapeHtml(orbitUI.profile.displayName||me?.display_name||me?.username||"Guest")+'" placeholder="Display name">'+
      '<textarea id="profile-bio" placeholder="Bio">'+escapeHtml(orbitUI.profile.bio||"")+'</textarea><select id="profile-status"><option>Online</option><option>Idle</option><option>Do Not Disturb</option><option>Invisible</option></select><button class="primary" id="save-profile">Save profile</button>';
    $("#profile-status").value=orbitUI.profile.status||"Online";
    $("#check-username").onclick=async()=>{try{const name=$("#profile-username").value.trim();if(!name)return;const r=await api("/api/search?q="+encodeURIComponent(name));const exact=(r.users||[]).find(u=>u.username.toLowerCase()===name.replace(/^@/,"").toLowerCase()&&String(u.id)!==String(me?.id));$("#username-status").textContent=exact?"Username is taken.":"Username looks available.";$("#username-status").classList.toggle("is-good",!exact);$("#username-status").classList.toggle("is-bad",!!exact)}catch{}};
    $("#save-profile").onclick=async()=>{try{
      const username=$("#profile-username").value.trim().replace(/^@+/,"").toLowerCase();
      const displayName=$("#profile-name").value.trim()||username||"Guest";
      const bio=$("#profile-bio").value.trim();
      const status=$("#profile-status").value;
      const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({username,displayName})});
      me=updated.user; guestName=me.username; saveGuest();
      orbitUI.profile.displayName=displayName;orbitUI.profile.bio=bio;orbitUI.profile.status=status;
      localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));
      $("#me-name").textContent=displayName;$("#me-status").textContent=status.toLowerCase()+" · @"+me.username;
      orbitToast("Profile updated","Your unique @"+me.username+" is saved.","success");
    }catch(err){
      if(err.message==="Username is already taken"&&err.suggested) $("#username-status").textContent="Taken. Try @"+err.suggested;
      else orbitToast("Profile update failed",err.message,"error");
    }}
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
  if(a==="search")return openSearchModal("");
}
async function runGlobalSearch(q){
  const query=String(q||"").trim();
  if(!query){openSearchModal("");return}
  try{
    const d=await api("/api/search?q="+encodeURIComponent(query));
    const users=d.users||[], serversFound=d.servers||[], channelsFound=d.channels||[], messages=d.messages||[];
    const empty='<div class="search-empty"><div class="search-empty-icon">⌕</div><strong>No results</strong><span>Try another word, username or channel.</span></div>';
    const section=(title,count,body,cls="")=>'<section class="search-section '+cls+'"><div class="search-section-head"><strong>'+title+'</strong><span>'+count+'</span></div>'+(body||empty)+'</section>';
    const bodyUsers=users.map(u=>'<button class="search-result user-result" data-search-user="'+escapeHtml(u.username)+'"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.display_name||u.username)+'</strong><span>'+escapeHtml(u.handle||("@"+u.username))+' · '+escapeHtml(u.status)+'</span></div><b>Profile</b></button>').join("");
    const bodyServers=serversFound.map(x=>'<div class="search-result"><div class="search-type-icon">◈</div><div><strong>'+escapeHtml(x.name)+'</strong><span>'+x.memberCount+' members</span></div></div>').join("");
    const bodyChannels=channelsFound.map(x=>'<div class="search-result"><div class="search-type-icon">'+(x.type==="voice"?"◉":"#")+'</div><div><strong>'+escapeHtml(x.name)+'</strong><span>'+escapeHtml(x.type)+' channel</span></div></div>').join("");
    const bodyMessages=messages.map(m=>'<div class="search-result"><div class="search-type-icon">◫</div><div><strong>'+escapeHtml(m.username)+'</strong><span>'+escapeHtml(m.content)+'</span></div></div>').join("");
    openModal("Search Orbit",'<div class="search-shell"><label class="search-input-box"><span>⌕</span><input id="global-search-input" value="'+escapeHtml(query)+'" placeholder="Search users, servers, channels, messages..."><kbd>Enter</kbd></label><div id="global-search-results">'+
      section("People",users.length,bodyUsers,"people")+
      section("Servers",serversFound.length,bodyServers)+
      section("Channels",channelsFound.length,bodyChannels)+
      section("Messages",messages.length,bodyMessages)+
      '</div></div>');
    const input=$("#global-search-input");
    input?.focus();
    input?.setSelectionRange(query.length,query.length);
    input?.addEventListener("keydown",e=>{if(e.key==="Enter")runGlobalSearch(input.value)});
    document.querySelectorAll("[data-search-user]").forEach(btn=>btn.onclick=()=>openDMForUsername(btn.dataset.searchUser));
  }catch(e){orbitToast("Search failed",e.message,"error")}
}
function openSearchModal(seed=""){
  openModal("Search Orbit",
    '<div class="search-shell"><label class="search-input-box"><span>⌕</span><input id="global-search-input" value="'+escapeHtml(seed)+'" placeholder="Search users, servers, channels, messages..."><kbd>Enter</kbd></label><div id="global-search-results"><div class="search-empty"><div class="search-empty-icon">⌕</div><strong>Search everything in Orbit</strong><span>People, servers, channels and messages.</span></div></div></div>');
  const input=$("#global-search-input");
  input?.focus();
  input?.addEventListener("keydown",e=>{if(e.key==="Enter")runGlobalSearch(input.value)});
}
async function openDMForUsername(username){
  try{
    const result=await api("/api/dms",{method:"POST",body:JSON.stringify({username})});
    closeModal();setView("dms");await renderDMPage(result.dm?.id);
    orbitToast("Conversation ready","Direct message with @"+username+".","success");
  }catch(e){orbitToast("Could not open DM",e.message,"error")}
}

function wireEnhancedControls() {
  $("#quick-screen-share-btn")?.addEventListener("click", async () => {
    if (!callState.active) {
      if (!currentChannel) return orbitToast("Open a room", "Choose a voice room before sharing your screen.", "error");
      goChat();
      await startCall("video");
    }
    await toggleScreenShare();
  });
  $("#quick-share-btn")?.addEventListener("click", async () => {
    if (!currentChannel) return;
    const link = location.origin + "/?server=" + encodeURIComponent(currentServer?.id || "") + "&channel=" + encodeURIComponent(currentChannel.id);
    try {
      await navigator.clipboard.writeText(link);
      orbitToast("Channel link copied", "Share it with anyone using Orbit.", "success");
    } catch {
      openModal("Share channel", '<input value="' + escapeHtml(link) + '" readonly><p class="hint">Copy this link to share the current channel.</p>');
    }
  });
  $("#workspace-menu")?.addEventListener("click", () => {
    if (!currentServer) return;
    openModal("Community controls",
      '<div class="control-grid">' +
      '<div class="control-row"><strong>' + escapeHtml(currentServer.name) + '</strong><span>Workspace</span></div>' +
      '<div class="control-row"><strong>Members</strong><span>Open the Members panel from chat.</span></div>' +
      '<div class="control-row"><strong>Invite</strong><span>Create a 7-day invite link.</span></div>' +
      '<button class="primary" id="workspace-open-settings">Open settings</button>' +
      '</div>');
    $("#workspace-open-settings").onclick = () => { closeModal(); setView("settings"); };
  });
  $("#more-call-btn")?.addEventListener("click", e => togglePopover("participants", e.currentTarget));
  $("#dock-mic")?.addEventListener("click", toggleMic);
  $("#dock-screen")?.addEventListener("click", toggleScreenShare);
  $("#dock-leave")?.addEventListener("click", leaveCall);
  $("#poll-btn")?.addEventListener("click", openPoll);
}
function bindPremiumNavigation(){
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.onclick=()=>{
    setView(b.dataset.view);
    document.body.classList.remove("mobile-sidebar-open");
    $("#sidebar")?.classList.remove("open");
  });
  $("#mobile-sidebar-btn")?.addEventListener("click",()=>{
    const sidebar=$("#sidebar");
    if(!sidebar)return;
    sidebar.classList.toggle("open");
    document.body.classList.toggle("mobile-sidebar-open",sidebar.classList.contains("open"));
  });
  $("#settings-nav")?.addEventListener("click",()=>setView("settings"));
  $("#profile-card-btn")?.addEventListener("click",()=>{setView("settings");renderSettingsPage("profile")});
  $("#sidebar-search")?.addEventListener("click",()=>openSearchModal($("#quick-search")?.value||""));
$("#quick-search")?.addEventListener("focus",()=>$("#sidebar-search")?.classList.add("focused"));
$("#quick-search")?.addEventListener("blur",()=>$("#sidebar-search")?.classList.remove("focused"));
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
    if(e.target.id==="dm-create"){try{const result=await api("/api/dms",{method:"POST",body:JSON.stringify({username:$("#dm-target").value.trim()})});closeModal();setView("dms");await renderDMPage(result.dm?.id);orbitToast("DM created","Conversation is ready.","success")}catch(err){orbitToast("DM failed",err.message,"error")}}
    if(e.target.id==="friend-create"){
      try{
        const username=$("#friend-target").value.trim();
        if(!username)return orbitToast("Add friend","Choose a username first.","error");
        await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});
        closeModal();
        orbitToast("Friend request sent",username+" will see it in their live inbox.","success");
      }catch(err){orbitToast("Friend request failed",err.message,"error")}
    }
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
  socket.on("dm:typing",x=>{
    if(!x||String(x.dmId)!==String(dmState.activeId))return;
    const typing=$("#dm-typing");if(typing)typing.textContent=x.isTyping?(x.username||"Your friend")+" is typing…":"";
  });
  socket.on("dm:message",m=>{
    const existing=dmState.list.find(d=>String(d.id)===String(m.dm_id));
    if(existing){existing.lastMessage=m;if(String(m.user_id)!==String(me?.id)&&String(dmState.activeId)!==String(m.dm_id))existing.unreadCount=Number(existing.unreadCount||0)+1;}
    if(String(dmState.activeId)===String(m.dm_id)){
      if(!dmState.messages.some(x=>String(x.id)===String(m.id))){dmState.messages.push(m);renderDMMessageFeed(true);}
      if(String(m.user_id)!==String(me?.id)){socket?.emit("dm:read",m.dm_id);api("/api/dms/"+encodeURIComponent(m.dm_id)+"/read",{method:"POST",body:"{}"}).catch(()=>{});}
    }else if(String(m.user_id)!==String(me?.id)){
      orbitToast("New message",(m.username||"Your friend")+": "+String(m.content||"").slice(0,90),"success");
    }
    if(orbitUI.view==="dms")renderDMList();
  });
  socket.on("dm:read",event=>{
    if(!event||String(event.dmId)!==String(dmState.activeId))return;
    dmState.messages.forEach(m=>{if(String(m.user_id)===String(me?.id)&&String(event.readerId)!==String(me?.id))m.seen_at=event.readAt});
    renderDMMessageFeed(false);
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
  if(!channel) return;
  if(channel?.type==="voice") $("#composer")?.classList.add("hidden");
  else {$("#composer")?.classList.remove("hidden");await loadPolls();}
  updateVoiceDock();
};

// Join/create voice support uses the server's "voice" channel type.
function openChannelModal(defaultType){
  if(!currentServer)return;
  openModal("Create channel",'<input id="channel-name-input" placeholder="general"><select id="channel-type-input"><option value="text" '+(defaultType==="text"?"selected":"")+'>Text</option><option value="announcement">Announcement</option><option value="voice" '+(defaultType==="voice"?"selected":"")+'>Voice</option></select><button class="primary" id="create-channel-now">Create channel</button>');
  $("#create-channel-now").onclick=async()=>{try{const d=await api("/api/servers/"+currentServer.id+"/channels",{method:"POST",body:JSON.stringify({name:$("#channel-name-input").value,type:$("#channel-type-input").value})});closeModal();await selectServer(currentServer);await selectChannel(d.channel)}catch(e){orbitToast("Channel creation failed",e.message,"error")}};
}

// Ensure create server has a real post-create channel/voice refresh.
document.addEventListener("click",async e=>{
  if(e.target.id==="create-server-now"){try{const d=await api("/api/servers",{method:"POST",body:JSON.stringify({name:$("#server-name-input").value})});closeModal();await loadServers();const s=servers.find(x=>String(x.id)===String(d.server.id));if(s)await selectServer(s);orbitToast("Server created",d.server.name+" is ready.","success")}catch(err){orbitToast("Server creation failed",err.message,"error")}}
});

// Boot premium nav after DOM is parsed, then launch guest session.
applySavedOrbitBackground();
bindPremiumNavigation();
wireEnhancedControls();
updateVoiceDock();

applyAccentTheme(localStorage.getItem("orbit_theme")||"purple");
applySavedOrbitBackground();

(async()=>{
  try{
    await enterAsGuest();
    const invite=new URLSearchParams(location.search).get("invite");
    if(invite){await api("/api/invites/"+encodeURIComponent(invite)+"/accept",{method:"POST",body:"{}"}).catch(()=>{});await loadServers();}
    const params = new URLSearchParams(location.search);
    const serverParam = params.get("server");
    const channelParam = params.get("channel");
    if (serverParam) {
      const linkedServer = servers.find(s => String(s.id) === String(serverParam));
      if (linkedServer && String(linkedServer.id) !== String(currentServer?.id)) await selectServer(linkedServer);
    }
    if (channelParam && currentServer) {
      const target = channels.find(c => String(c.id) === String(channelParam));
      if (target) {
        await selectChannel(target);
        goChat();
      } else {
        setView("home");
      }
    } else {
      setView("home");
    }
  }catch(err){
    console.error("Orbit boot failed",err);
    showError(err.message||"Unable to start Orbit");
  }
})();
