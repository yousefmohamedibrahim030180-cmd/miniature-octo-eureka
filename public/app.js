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
function avatarImageUrl(user){
  return user?.avatar_url ? String(user.avatar_url) : "";
}
function avatarFrameName(user){
  const allowed=new Set(["none","halo","crown","orbit","spark","fire","ice","cyber","royal","dragon"]);
  const value=String(user?.avatar_decoration||"none").toLowerCase();
  return allowed.has(value)?value:"none";
}
function avatarCustomFrameUrl(user){
  return user?.avatar_decoration_url ? String(user.avatar_decoration_url) : "";
}
function setAvatarFrame(node, frame, customUrl=""){
  if(!node) return;
  [...node.classList].filter(c=>c.startsWith("orbit-frame-")).forEach(c=>node.classList.remove(c));
  node.querySelectorAll(".orbit-custom-frame").forEach(x=>x.remove());
  const safe=avatarFrameName({avatar_decoration:frame});
  if(customUrl){
    node.classList.add("orbit-frame-custom");
    const overlay=document.createElement("img");
    overlay.className="orbit-custom-frame";
    overlay.src=customUrl;
    overlay.alt="";
    overlay.setAttribute("aria-hidden","true");
    node.appendChild(overlay);
    node.dataset.avatarFrame="custom";
    return;
  }
  node.classList.add("orbit-frame-"+safe);
  node.dataset.avatarFrame=safe;
}
function renderOwnAvatar(){
  const node=$("#me-avatar");
  if(!node) return;
  const url=avatarImageUrl(me);
  node.innerHTML=url?'<img src="'+escapeHtml(url)+'" alt="">':escapeHtml(avatar(me?.username||"G"));
  node.classList.toggle("has-image",Boolean(url));
  setAvatarFrame(node,avatarFrameName(me),avatarCustomFrameUrl(me));
}

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
  renderOwnAvatar();
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
      if(String(m.user_id||"")!==String(me?.id||"")) playUiTone("message");
      appendMessage(m);
    } else if (m.channel_id) {
      unreadChannels[m.channel_id] = Number(unreadChannels[m.channel_id] || 0) + 1;
      localStorage.setItem("orbit_unread_channels", JSON.stringify(unreadChannels));
      renderChannels();
      playUiTone("message");
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

  const refreshSharedSurface = (view) => {
    if (orbitUI.view !== view) return;
    if (view === "events") renderEventsPage();
    if (view === "projects") renderProjectsPage();
    if (view === "live") renderLivePage();
  };
  socket.on("event:created", payload => {
    if (payload?.event) orbitToast("New event", payload.event.title + " was added.", "success");
    refreshSharedSurface("events");
  });
  socket.on("event:updated", () => refreshSharedSurface("events"));
  socket.on("event:rsvp", () => refreshSharedSurface("events"));
  socket.on("event:deleted", () => refreshSharedSurface("events"));
  socket.on("project:created", payload => {
    if (payload?.project) orbitToast("New project", payload.project.name + " is ready.", "success");
    refreshSharedSurface("projects");
  });
  socket.on("project:updated", () => refreshSharedSurface("projects"));
  socket.on("project:task-created", () => refreshSharedSurface("projects"));
  socket.on("project:task-updated", () => refreshSharedSurface("projects"));
  socket.on("project:task-deleted", () => refreshSharedSurface("projects"));
  socket.on("project:deleted", () => refreshSharedSurface("projects"));
  socket.on("live:started", payload => {
    if (payload?.session && orbitUI.view === "live") renderLivePage();
    if (payload?.session?.hostUserId && String(payload.session.hostUserId)!==String(me?.id)) {
      orbitToast("Live now", payload.session.title + " just went live.");
    }
  });
  socket.on("live:ended", () => refreshSharedSurface("live"));

  socket.on("call:incoming", call => {
    if (callState.active || String(call.userId) === String(me?.id)) return;
    pendingIncomingCall = call;
    const box = $("#incoming-call");
    const incomingChannel = channels.find(c => String(c.id) === String(call.channelId));
    $("#incoming-title").textContent = (call.username || "Guest") + " is calling";
    $("#incoming-subtitle").textContent = (call.mode === "voice" ? "Voice call" : "Video call") + " · " + (incomingChannel ? "#" + incomingChannel.name : "Orbit room");
    $("#incoming-avatar").textContent = avatar(call.username || "G");
    box.classList.remove("hidden");
    playUiTone("call");
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
  socket.on("error:toast", payload => orbitToast("Server", payload?.message || "Action blocked."));
  socket.on("server:removed", payload => {
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
  servers = data.servers || [];
  if (currentServer && !servers.some(s => String(s.id) === String(currentServer.id))) {
    currentServer = null;
    channels = [];
    currentChannel = null;
  }
  renderServers();
  if (currentServer) {
    await selectServer(currentServer);
  } else {
    closeServerSidebar();
    $("#workspace-name").textContent = "Choose a community";
    $("#workspace-role").textContent = "click a server on the left";
    $("#workspace-avatar").textContent = "O";
    $("#channel-list").innerHTML = "";
    $("#voice-channel-list").innerHTML = "";
  }
}
function openServerSidebar(open = true) {
  const app = $("#app");
  app?.classList.toggle("server-sidebar-open", Boolean(open && currentServer));
  if (open && currentServer) document.body.classList.remove("mobile-sidebar-open");
}
function closeServerSidebar() {
  $("#app")?.classList.remove("server-sidebar-open");
  $("#sidebar")?.classList.remove("open");
  document.body.classList.remove("mobile-sidebar-open");
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
  if (!serverItem) return;
  currentServer = serverItem;
  if (callState.active) leaveCall();
  openServerSidebar(true);
  renderServers();
  if (orbitUI.view !== "chat") setView("chat");
  $("#workspace-name").textContent = currentServer.name;
  $("#workspace-brand")?.classList.add("workspace-brand-ready");
  const data = await api("/api/servers/" + currentServer.id + "/channels");
  channels = data.channels;
  $("#workspace-role").textContent = data.role + " · guest";
  renderChannels();
  const firstVisibleChannel = channels.find(c => c.type === "voice" || String(c.name||"").trim().toLowerCase() !== "notifications");
  if (firstVisibleChannel) await selectChannel(firstVisibleChannel);
  await loadMembers();
}
function renderChannels() {
  const visibleTextChannels = channels.filter(c => c.type !== "voice" && String(c.name||"").trim().toLowerCase() !== "notifications");
  $("#channel-list").innerHTML = visibleTextChannels.map(c => {
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
function renderMessageAttachment(att){
  if(!att?.id) return "";
  const href="/api/uploads/"+encodeURIComponent(att.id);
  const name=escapeHtml(att.name||"file");
  const type=String(att.type||"application/octet-stream");
  const size=Math.max(0,Number(att.size||0));
  const kb=size?Math.max(1,Math.round(size/1024))+" KB":"";
  if(type.startsWith("image/")) return '<div class="message-attachment media-attachment"><a href="'+href+'" target="_blank" rel="noopener"><img src="'+href+'" alt="'+name+'" loading="lazy"></a><div><strong>'+name+'</strong><span>'+type+' · '+kb+'</span></div></div>';
  if(type.startsWith("video/")) return '<div class="message-attachment"><video controls preload="metadata" src="'+href+'"></video><a href="'+href+'" target="_blank" rel="noopener"><strong>'+name+'</strong><span>'+type+' · '+kb+'</span></a></div>';
  if(type.startsWith("audio/")) return '<div class="message-attachment"><audio controls preload="metadata" src="'+href+'"></audio><a href="'+href+'" target="_blank" rel="noopener"><strong>'+name+'</strong><span>'+type+' · '+kb+'</span></a></div>';
  const icon=type==="application/pdf"?"PDF":type.includes("zip")?"ZIP":"FILE";
  return '<div class="message-attachment file-attachment"><div class="file-badge">'+icon+'</div><div><strong>'+name+'</strong><span>'+type+' · '+kb+'</span></div><a href="'+href+'" target="_blank" rel="noopener">Open</a></div>';
}
function appendMessage(m) {
  const el = document.createElement("article");
  el.className = "message";
  const attachment=renderMessageAttachment(m.attachment);
  el.innerHTML =
    '<div class="avatar">' + escapeHtml(avatar(m.username)) + '</div>' +
    '<div><div class="msg-head"><strong>' + escapeHtml(m.username) + '</strong><time>' +
    fmt(m.created_at) + '</time></div><div class="msg-body">' + escapeHtml(m.content) + (attachment?attachment:"") + "</div></div>";
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
  playUiTone("send");
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
    playUiTone("join");
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
  playUiTone("leave");
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
      audio: localStorage.getItem("orbit_screen_audio")!=="off"
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
    playUiTone("share");
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
  playUiTone("click");
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

const workspaceBrand=$("#workspace-brand");
if(workspaceBrand) workspaceBrand.onclick=()=>{if(currentServer)setView("server-home")};

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
    accent: "#7652e8",
    avatarMotion: "aurora"
  }
};

function applyAvatarMotion(){
  const mode=String(orbitUI?.profile?.avatarMotion||"aurora");
  document.body.dataset.avatarMotion=mode;
  renderOwnAvatar();
}
applyAvatarMotion();

function orbitToast(title, body="", kind="") {
  const stack=$("#toast-stack");
  if(!stack)return;
  const node=document.createElement("div");
  node.className="toast "+kind;
  node.innerHTML="<div><strong>"+escapeHtml(title)+"</strong>"+(body?"<span>"+escapeHtml(body)+"</span>":"")+"</div>";
  stack.appendChild(node);
  setTimeout(()=>node.remove(),3200);
}

/* Orbit Sound Engine: subtle UI feedback without shipping audio assets. */
const orbitSound={
  ctx:null,
  master:Number(localStorage.getItem("orbit_sound_volume")||"0.42"),
  enabled:localStorage.getItem("orbit_sound_enabled")!=="off",
  pack:localStorage.getItem("orbit_sound_pack")||"crystal",
  duck:0
};
function ensureSoundContext(){
  if(!orbitSound.enabled) return null;
  if(!orbitSound.ctx){
    try{orbitSound.ctx=new (window.AudioContext||window.webkitAudioContext)();}catch{return null}
  }
  if(orbitSound.ctx.state==="suspended") orbitSound.ctx.resume().catch(()=>{});
  return orbitSound.ctx;
}
function playUiTone(kind="click"){
  const ctx=ensureSoundContext(); if(!ctx)return;
  const now=ctx.currentTime, g=ctx.createGain();
  g.gain.setValueAtTime(0.0001,now);
  g.gain.exponentialRampToValueAtTime(Math.max(.002,orbitSound.master*.06),now+.012);
  g.gain.exponentialRampToValueAtTime(.0001,now+0.18);
  g.connect(ctx.destination);
  const o=ctx.createOscillator();
  const wave=orbitSound.pack==="soft"?"sine":orbitSound.pack==="arcade"?"square":"triangle";
  o.type=wave;
  const tones={
    click:[520,.08],hover:[380,.045],send:[740,.11],message:[560,.14],success:[660,.18],error:[210,.16],join:[430,.18],leave:[260,.20],call:[880,.24],upload:[600,.16],share:[760,.20]
  };
  const [freq,dur]=tones[kind]||tones.click;
  o.frequency.setValueAtTime(freq,now);
  if(["success","join","call","share"].includes(kind)) o.frequency.exponentialRampToValueAtTime(freq*1.28,now+dur*.55);
  if(["error","leave"].includes(kind)) o.frequency.exponentialRampToValueAtTime(freq*.72,now+dur*.7);
  o.connect(g); o.start(now); o.stop(now+dur);
}
function setOrbitSoundSetting(key,value){
  if(key==="enabled"){orbitSound.enabled=Boolean(value);localStorage.setItem("orbit_sound_enabled",orbitSound.enabled?"on":"off");}
  if(key==="volume"){orbitSound.master=Math.max(0,Math.min(1,Number(value)||0));localStorage.setItem("orbit_sound_volume",String(orbitSound.master));}
  if(key==="pack"){orbitSound.pack=String(value||"crystal");localStorage.setItem("orbit_sound_pack",orbitSound.pack);}
}
document.addEventListener("pointerdown",()=>ensureSoundContext(),{once:true,passive:true});
function renderPage(view) {
  const cfg={
    home:["ORBIT / COMMAND CENTER","Home","A single control surface for communities, conversations, and live rooms."],
    "server-home":["SERVER / HOME",currentServer?.name||"Server Home","Your community command center, members, roles, and channels."],
    discover:["DISCOVER","Discover communities","Explore spaces, categories, and new conversations."],
    dms:["DIRECT MESSAGES","Messages","Private conversations, groups, and recent contacts."],
    friends:["SOCIAL GRAPH","Friends","Online people, requests, suggestions, and connections."],
    notifications:["INBOX","Notifications","Mentions, replies, calls, requests, and system events."],
    saved:["LIBRARY","Saved","Messages and media you deliberately kept."],
    explore:["EXPLORE","Explore","Events, polls, files, media, and community activity."],
    communities:["NETWORK","Communities","Connected communities, Spaces, roles and discovery."],
    calls:["COMMUNICATION","Calls","Voice rooms, video meetings, screen sharing and media controls."],
    live:["LIVE","Live","Live rooms, creator broadcasts and streaming architecture."],
    events:["EVENTS","Events","Community events, classes, tournaments and watch parties."],
    projects:["PROJECTS","Projects","Tasks, boards and team collaboration inside communities."],
    files:["FILES","Files","Shared workspace files and attachments."],
    ai:["ORBIT AI","AI","Your optional AI workspace assistant."],
    settings:["PREFERENCES","Settings","Appearance, privacy, voice, notifications, accessibility and security."]
  }[view] || ["ORBIT","Home",""];
  $("#page-eyebrow").textContent=cfg[0];
  $("#page-title").textContent=cfg[1];
  $("#page-subtitle").textContent=cfg[2];
  $("#page-actions").innerHTML="";
  if(view==="home")renderHomePage();
  if(view==="server-home")renderServerHomePage().catch(err=>orbitToast("Server Home",err.message,"error"));
  if(view==="communities")renderCommunitiesPage();
  if(view==="discover")renderDiscoverPage();
  if(view==="dms")renderHomePage();
  if(view==="friends")renderFriendsPage();
  if(view==="calls")renderCallsPage();
  if(view==="live")renderLivePage();
  if(view==="events")renderEventsPage();
  if(view==="projects")renderProjectsPage();
  if(view==="files")renderFilesPage();
  if(view==="ai")renderAIPage();
    if(view==="saved")renderSavedPage();
  if(view==="explore")renderExplorePage();
  if(view==="settings")renderSettingsPage();
}
function setView(view){
  if(view==="dms"){view="home";}
  orbitUI.view=view;
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const global=$("#global-page"),chat=$("#chat-view");
  const isHome=view==="home";
  document.body.classList.toggle("orbit-discord-home",isHome);
  global?.classList.toggle("discord-home-active",isHome);
  if(isHome){
    $("#app")?.classList.remove("server-sidebar-open");
    $("#sidebar")?.classList.remove("open");
    document.body.classList.remove("mobile-sidebar-open");
  }
  const globalViews=["home","server-home","communities","discover","dms","friends","calls","live","events","projects","files","ai","notifications","saved","explore","settings"];
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
  document.body.classList.remove("orbit-discord-home");
  $("#global-page")?.classList.remove("discord-home-active");
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
function applyServerTheme(theme={}){
  document.documentElement.style.setProperty("--server-accent",String(theme.accent||"#7c5cff"));
  document.documentElement.style.setProperty("--server-secondary",String(theme.secondary||"#14b8a6"));
}
function uploadServerImage(purpose){
  return new Promise((resolve,reject)=>{
    const input=document.createElement("input");
    input.type="file"; input.accept="image/png,image/jpeg,image/webp,image/gif,image/avif";
    input.onchange=()=>{
      const file=input.files?.[0];
      if(!file)return resolve(null);
      if(file.size>2_000_000)return reject(new Error("Image must be 2 MB or smaller."));
      if(!file.type.startsWith("image/"))return reject(new Error("Please choose an image file."));
      const fr=new FileReader();
      fr.onload=async()=>{
        try{
          const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type,size:file.size,data:String(fr.result),purpose})});
          resolve("/api/avatar/"+encodeURIComponent(up.file.id));
        }catch(err){reject(err)}
      };
      fr.onerror=()=>reject(new Error("Could not read image."));
      fr.readAsDataURL(file);
    };
    input.click();
  });
}
function openServerCustomizer(serverId, theme={}){
  const t=theme||{};
  openModal("Customize community",
    '<div class="server-customizer">'+
      '<div class="customizer-cover" '+(t.banner_url?'style="background-image:url(&quot;'+escapeHtml(t.banner_url)+'&quot;)"':'')+'></div>'+
      '<div class="customizer-grid">'+
        '<label><span>Accent</span><input id="server-accent" type="color" value="'+escapeHtml(t.accent||"#7c5cff")+'"></label>'+
        '<label><span>Secondary</span><input id="server-secondary" type="color" value="'+escapeHtml(t.secondary||"#14b8a6")+'"></label>'+
      '</div>'+
      '<label class="customizer-field"><span>Community description</span><textarea id="server-description" maxlength="500" placeholder="What is this community about?">'+escapeHtml(t.description||"")+'</textarea></label>'+
      '<label class="customizer-field"><span>Welcome message</span><textarea id="server-welcome" maxlength="700" placeholder="Welcome to the community…">'+escapeHtml(t.welcomeMessage||"")+'</textarea></label>'+
      '<div class="customizer-upload-row"><div><strong>Server icon</strong><small>Square image, up to 2 MB.</small></div><button id="server-icon-upload">Upload</button><button id="server-icon-clear">Clear</button></div>'+
      '<div class="customizer-upload-row"><div><strong>Server banner</strong><small>Wide image, up to 2 MB.</small></div><button id="server-banner-upload">Upload</button><button id="server-banner-clear">Clear</button></div>'+
      '<div class="customizer-preview"><div class="customizer-preview-icon" id="server-icon-preview">'+(t.icon_url?'<img src="'+escapeHtml(t.icon_url)+'" alt="">':'O')+'</div><div><strong>'+escapeHtml(currentServer?.name||"Community")+'</strong><span id="server-preview-desc">'+escapeHtml(t.description||"Your Orbit community")+'</span></div></div>'+
      '<button class="primary" id="server-customizer-save">Save changes</button>'+
    '</div>');
  let draft={...t};
  $("#server-icon-upload").onclick=async()=>{try{draft.icon_url=await uploadServerImage("server-icon");if(draft.icon_url)$("#server-icon-preview").innerHTML='<img src="'+escapeHtml(draft.icon_url)+'" alt="">';}catch(err){orbitToast("Server icon",err.message,"error")}};
  $("#server-icon-clear").onclick=()=>{draft.icon_url=null;$("#server-icon-preview").textContent=(currentServer?.name||"O").slice(0,1).toUpperCase()};
  $("#server-banner-upload").onclick=async()=>{try{draft.banner_url=await uploadServerImage("server-banner");}catch(err){orbitToast("Server banner",err.message,"error")}};
  $("#server-banner-clear").onclick=()=>{draft.banner_url=null};
  $("#server-description").oninput=e=>$("#server-preview-desc").textContent=e.target.value||"Your Orbit community";
  $("#server-customizer-save").onclick=async()=>{
    try{
      const payload={
        accent:$("#server-accent").value,
        secondary:$("#server-secondary").value,
        description:$("#server-description").value.trim(),
        welcomeMessage:$("#server-welcome").value.trim(),
        iconUrl:draft.icon_url||"",
        bannerUrl:draft.banner_url||""
      };
      const result=await api("/api/servers/"+encodeURIComponent(serverId)+"/community",{method:"PATCH",body:JSON.stringify(payload)});
      applyServerTheme(result.theme||payload);
      closeModal();
      orbitToast("Community updated","Server branding and welcome settings are saved.","success");
      renderServerHomePage();
    }catch(err){orbitToast("Community update failed",err.message,"error")}
  };
}

async function renderServerHomePage(){
  if(!currentServer){
    goChat();
    return;
  }
  const serverId=String(currentServer.id);
  const [community,data]=await Promise.all([
    api("/api/servers/"+encodeURIComponent(serverId)+"/community"),
    api("/api/servers/"+encodeURIComponent(serverId)+"/members")
  ]);
  const memberRows=(data.members||[]);
  const theme=community.theme||{};
  applyServerTheme(theme);
  const textChannels=channels.filter(c=>c.type!=="voice");
  const voiceChannels=channels.filter(c=>c.type==="voice");
  const onlineMembers=memberRows.filter(m=>String(m.status||"").toLowerCase()==="online");
  const role=String(currentServer.role||memberRows.find(m=>String(m.id)===String(me?.id))?.role||"member");
  const canManage=["owner","admin"].includes(role);
  const welcomeKey="orbit_onboarding_"+serverId+"_"+String(me?.id||"guest");
  const onboardingDone=localStorage.getItem(welcomeKey)==="done";
  const profileReady=Boolean(me?.avatar_url)||Boolean(orbitUI.profile?.bio);
  const topMembers=memberRows.slice(0,8);
  $("#page-eyebrow").textContent="SERVER / HOME";
  $("#page-title").textContent=currentServer.name;
  $("#page-subtitle").textContent="Your community command center.";
  $("#page-actions").innerHTML='<button id="server-home-chat" class="primary">Open chat</button><button id="server-home-invite">Invite</button>'+(canManage?'<button id="server-home-customize">Customize</button>':'');
  $("#page-body").innerHTML=
    '<div class="server-home-hero">'+
      '<div class="server-home-hero-copy"><span class="eyebrow">ORBIT WORLD</span><h2>'+escapeHtml(currentServer.name)+'</h2><p>'+escapeHtml(theme.description||theme.welcomeMessage||"Welcome back. Jump into the conversation, meet members, or personalize your community.")+'</p>'+
      '<div class="server-home-hero-actions"><button class="hero-action" id="server-home-open-chat">Open #'+escapeHtml(currentChannel?.name||textChannels[0]?.name||"general")+'</button><button class="hero-action soft" id="server-home-members">Browse members</button></div></div>'+
      '<div class="server-orbit-badge" '+(theme.banner_url?'style="background-image:url(&quot;'+escapeHtml(theme.banner_url)+'&quot;)"':'')+'><span>'+(theme.icon_url?'<img src="'+escapeHtml(theme.icon_url)+'" alt="">':escapeHtml(currentServer.name.slice(0,2).toUpperCase()))+'</span><i></i></div>'+
    '</div>'+
    (!onboardingDone?
      '<div class="server-onboarding"><div><span class="eyebrow">QUICK START</span><h3>Make Orbit yours</h3><p>Three small steps to get this server feeling like home.</p></div><div class="onboarding-steps">'+
      '<button class="onboarding-step" id="onboard-profile"><span>01</span><strong>Complete profile</strong><small>'+(profileReady?"Done · profile has a personal touch":"Add your bio or avatar")+'</small></button>'+
      '<button class="onboarding-step" id="onboard-chat"><span>02</span><strong>Open a channel</strong><small>Start with #'+escapeHtml(textChannels[0]?.name||"general")+'</small></button>'+
      '<button class="onboarding-step" id="onboard-invite"><span>03</span><strong>Invite friends</strong><small>Bring someone into the community</small></button>'+
      '</div><button class="onboarding-dismiss" id="onboard-done">Got it</button></div>':'')+
    '<div class="server-metrics">'+
      '<div class="metric"><span>Members</span><strong>'+memberRows.length+'</strong><span>Total community</span></div>'+
      '<div class="metric"><span>Online</span><strong>'+onlineMembers.length+'</strong><span>Currently active</span></div>'+
      '<div class="metric"><span>Channels</span><strong>'+channels.length+'</strong><span>Text & voice rooms</span></div>'+
      '<div class="metric"><span>Your role</span><strong>'+escapeHtml(role.toUpperCase())+'</strong><span>Access level in this server</span></div>'+
    '</div>'+
    '<div class="server-home-columns">'+
      '<section class="server-home-card"><div class="section-heading"><h3>Channels</h3><span>'+textChannels.length+' text · '+voiceChannels.length+' voice</span></div>'+
      '<div class="server-channel-home-list">'+channels.slice(0,10).map(c=>'<button class="server-channel-home" data-home-channel="'+escapeHtml(c.id)+'"><span class="home-channel-icon">'+(c.type==="voice"?"◉":"#")+'</span><div><strong>'+escapeHtml(c.name)+'</strong><small>'+escapeHtml(c.type==="voice"?"Voice room":"Text channel")+'</small></div><b>Open</b></button>').join("")+'</div></section>'+
      '<section class="server-home-card"><div class="section-heading"><h3>Members</h3><span>'+memberRows.length+' total</span></div>'+
      '<div class="server-member-grid">'+topMembers.map(m=>'<button class="server-member-card" data-home-user="'+escapeHtml(m.id)+'"><div class="avatar '+(m.avatar_url?"has-image":"")+'">'+(m.avatar_url?'<img src="'+escapeHtml(m.avatar_url)+'" alt="">':escapeHtml(avatar(m.username)))+'</div><div><strong>'+escapeHtml(m.display_name||m.username)+'</strong><small>@'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+'</small><em>'+escapeHtml(m.activity||"Online")+'</em></div><i class="'+(String(m.status||"").toLowerCase()==="online"?"online":"offline")+'"></i></button>').join("")+'</div></section>'+
    '</div>'+
    '<div class="server-home-card server-role-card"><div class="section-heading"><h3>Roles</h3><span>Current role: '+escapeHtml(role)+'</span></div>'+
      '<div class="role-chip-row"><span class="role-chip owner">OWNER <small>Full control</small></span><span class="role-chip admin">ADMIN <small>Manage community</small></span><span class="role-chip moderator">MODERATOR <small>Moderation tools</small></span><span class="role-chip member">MEMBER <small>Community access</small></span></div>'+
      (canManage?
        '<div class="role-manager"><div><strong>Quick role manager</strong><small>Assign a role without leaving Server Home.</small></div><div class="role-manager-controls"><select id="home-role-user">'+memberRows.filter(m=>m.role!=="owner").map(m=>'<option value="'+escapeHtml(m.id)+'">'+escapeHtml(m.username)+' · '+escapeHtml(m.role)+'</option>').join("")+'</select><select id="home-role-value"><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select><button class="primary" id="home-role-save">Save role</button></div></div>':
        '<div class="role-manager role-manager-note"><strong>Need higher access?</strong><small>Owners and admins can assign custom server roles from here.</small></div>')+
    '</div>';
  $("#server-home-chat").onclick=goChat;
  $("#server-home-open-chat").onclick=goChat;
  $("#server-home-invite").onclick=()=>$("#invite-btn")?.click();
  if($("#server-home-customize"))$("#server-home-customize").onclick=()=>openServerCustomizer(serverId,theme);
  $("#server-home-members").onclick=()=>{$("#members-panel")?.classList.remove("hidden");loadMembers().catch(()=>{})};
  document.querySelectorAll("[data-home-channel]").forEach(b=>b.onclick=async()=>{
    const ch=channels.find(c=>String(c.id)===String(b.dataset.homeChannel));
    if(ch){goChat();await selectChannel(ch);}
  });
  document.querySelectorAll("[data-home-user]").forEach(b=>b.onclick=()=>{
    const u=memberRows.find(x=>String(x.id)===String(b.dataset.homeUser));
    if(!u)return;
    openModal("Profile",
      '<div class="profile-card-pro"><div class="profile-card-cover" '+(theme.banner_url?'style="background-image:url(&quot;'+escapeHtml(theme.banner_url)+'&quot;)"':'')+'></div><div class="profile-card-avatar '+(u.avatar_url?"has-image":"")+'">'+(u.avatar_url?'<img src="'+escapeHtml(u.avatar_url)+'" alt="">':escapeHtml(avatar(u.username)))+'</div><div class="profile-card-main"><strong>'+escapeHtml(u.display_name||u.username)+'</strong><span>@'+escapeHtml(u.username)+'</span><em>'+escapeHtml(u.status||"online")+' · '+escapeHtml(u.activity||"Online")+' · '+escapeHtml(u.role)+'</em></div><div class="profile-badge-row">'+(u.badges||[]).map(b=>'<span class="profile-badge" title="'+escapeHtml(b.label)+'">'+escapeHtml(b.icon||"✦")+' '+escapeHtml(b.label)+'</span>').join("")+'</div><div class="profile-card-bio">'+escapeHtml(u.activity||"Member of "+currentServer.name)+'</div><div class="profile-card-actions"><button class="primary" id="home-profile-message">Message</button><button id="home-profile-friend">Add friend</button></div></div>');
    $("#home-profile-message").onclick=async()=>{try{await api("/api/dms",{method:"POST",body:JSON.stringify({username:u.username})});closeModal();setView("dms");renderDMPage()}catch(err){orbitToast("DM failed",err.message,"error")}};
    $("#home-profile-friend").onclick=async()=>{try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username:u.username})});closeModal();orbitToast("Friend request sent","Request sent to @"+u.username+".","success")}catch(err){orbitToast("Friend request failed",err.message,"error")}};
  });
  if($("#onboard-profile"))$("#onboard-profile").onclick=()=>{setView("settings");renderSettingsPage("profile")};
  if($("#onboard-chat"))$("#onboard-chat").onclick=goChat;
  if($("#onboard-invite"))$("#onboard-invite").onclick=()=>$("#server-home-invite")?.click();
  if($("#onboard-done"))$("#onboard-done").onclick=()=>{localStorage.setItem(welcomeKey,"done");renderServerHomePage()};
  if($("#home-role-save"))$("#home-role-save").onclick=async()=>{
    try{
      const userId=$("#home-role-user").value;
      const newRole=$("#home-role-value").value;
      await api("/api/servers/"+encodeURIComponent(serverId)+"/members/"+encodeURIComponent(userId)+"/role",{method:"PATCH",body:JSON.stringify({role:newRole})});
      orbitToast("Role updated","Member role changed to "+newRole+".","success");
      renderServerHomePage();
    }catch(err){orbitToast("Role update failed",err.message,"error")}
  };
}

function renderHomePage(){
  const body=$("#page-body");
  if(!body)return;

  const meName=me?.display_name||me?.username||"Guest";
  const initialLiveUsers=(pulseState?.users||[]).filter(u=>String(u.status||"online").toLowerCase()!=="offline");

  const avatarMarkup=(u, extra="")=>{
    const name=u?.display_name||u?.username||"Guest";
    const url=avatarImageUrl(u);
    return '<span class="od-avatar '+extra+'">'+(url?'<img src="'+escapeHtml(url)+'" alt="">':escapeHtml(avatar(name)))+'<i class="od-presence '+(String(u?.status||"online").toLowerCase()==="online"?"online":"offline")+'"></i></span>';
  };
  const empty=(title,text)=>'<div class="od-empty"><strong>'+escapeHtml(title)+'</strong><span>'+escapeHtml(text)+'</span></div>';
  const userRow=(u, kind="friend")=>{
    const name=u?.display_name||u?.username||"Guest";
    const activity=u?.activity||u?.status||"Online";
    return '<div class="od-user-row" data-od-user="'+escapeHtml(u?.id||"")+'">'+
      avatarMarkup(u)+
      '<div class="od-user-copy"><strong>'+escapeHtml(name)+'</strong><span>'+escapeHtml(activity)+(u?.username?' · @'+escapeHtml(u.username):"")+'</span></div>'+
      '<div class="od-user-actions">'+
      (kind==="friend"?'<button class="od-row-btn" data-od-message="'+escapeHtml(u?.username||"")+'">Message</button>':"")+
      '</div>'+
    '</div>';
  };

  body.innerHTML=
    '<div class="orbit-discord-home">'+
      '<aside class="od-social-sidebar">'+
        '<label class="od-quick-search"><span>⌕</span><input id="od-quick-search" placeholder="Find or start a conversation" autocomplete="off"></label>'+
        '<nav class="od-social-nav">'+
          '<button class="active" data-od-social="friends"><span class="od-nav-icon">♟</span><span>Friends</span></button>'+
          '<button data-od-social="calls"><span class="od-nav-icon">◉</span><span>Calls</span></button>'+
          '<button data-od-social="discover"><span class="od-nav-icon">✦</span><span>Discover</span></button>'+
        '</nav>'+
        '<div class="od-dm-head"><span>DIRECT MESSAGES</span><button id="od-new-dm" title="New direct message">+</button></div>'+
        '<div id="od-dm-list" class="od-dm-list"><div class="od-dm-loading">Loading conversations…</div></div>'+
        '<div class="od-social-user">'+
          '<button id="od-profile-home" class="od-profile-main">'+avatarMarkup(me||{username:meName}, "large")+'<span><strong>'+escapeHtml(meName)+'</strong><em>Online · @'+escapeHtml(me?.username||"guest")+'</em></span></button>'+
          '<button id="od-profile-settings" class="od-profile-icon" title="Settings">⚙</button>'+
        '</div>'+
      '</aside>'+
      '<main id="od-home-main" class="od-friends-main">'+
        '<header class="od-friends-head">'+
          '<div class="od-friends-label"><span class="od-friends-icon">♟</span><strong>Friends</strong></div>'+
          '<div class="od-friends-tabs">'+
            '<button data-od-tab="online" class="active">Online</button>'+
            '<button data-od-tab="all">All</button>'+
            '<button data-od-tab="pending">Pending <span class="od-tab-badge" id="od-pending-badge">0</span></button>'+
            '<button data-od-tab="suggestions">Suggestions <span class="od-tab-badge soft" id="od-suggestion-badge">0</span></button>'+
          '</div>'+
          '<button id="od-add-friend" class="od-add-friend">Add Friend</button>'+
        '</header>'+
        '<div class="od-home-notice"><span class="od-home-notice-icon">i</span><div><strong>Friends & conversations</strong><span>Choose a direct message from the left to open the chat here.</span></div><button id="od-notice-close">×</button></div>'+
        '<label class="od-friend-search"><span>⌕</span><input id="od-friend-search" placeholder="Search friends" autocomplete="off"></label>'+
        '<div id="od-tab-content" class="od-tab-content"></div>'+
      '</main>'+
      '<aside class="od-active-sidebar">'+
        '<div class="od-active-title"><strong>Active Now</strong></div>'+
        '<div id="od-active-list" class="od-active-list"></div>'+
      '</aside>'+
    '</div>';

  const loadHomeData=async()=>{
    let friendsData={friends:[],incoming:[],outgoing:[]};
    let dmData={dms:[]};
    try{friendsData=await api("/api/friends")}catch{}
    try{dmData=await api("/api/dms")}catch{}
    try{
      const pulse=await api("/api/pulse");
      pulseState.users=pulse.users||pulseState.users||[];
      pulseState.calls=pulse.calls||pulseState.calls||[];
    }catch{}
    const liveUsers=(pulseState?.users||initialLiveUsers).filter(u=>String(u.status||"online").toLowerCase()!=="offline");
    const friends=friendsData.friends||[];
    const online=friends.filter(u=>String(u.status||"").toLowerCase()!=="offline");
    const friendIds=new Set(friends.map(u=>String(u.id)));
    const suggestions=liveUsers.filter(u=>String(u.id)!==String(me?.id)&&!friendIds.has(String(u.id))).slice(0,10);
    const incoming=friendsData.incoming||[];
    const outgoing=friendsData.outgoing||[];
    const dms=dmData.dms||[];

    $("#od-pending-badge").textContent=String(incoming.length);
    $("#od-suggestion-badge").textContent=String(suggestions.length);

    const renderDMs=(term="")=>{
      const q=String(term||"").trim().toLowerCase();
      const rows=dms.filter(dm=>{
        const u=dm.otherUser||{};
        return !q||String(u.username||"").toLowerCase().includes(q)||String(u.display_name||"").toLowerCase().includes(q);
      });
      $("#od-dm-list").innerHTML=rows.length?rows.slice(0,30).map(dm=>{
        const u=dm.otherUser||{};
        const onlineNow=dmUserStatus(u)==="Online";
        return '<button class="od-dm-row '+(String(dm.id)===String(dmState.activeId)?"active":"")+'" data-od-dm="'+escapeHtml(dm.id)+'">'+
          avatarMarkup({...u,status:onlineNow?"online":"offline"})+
          '<span><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><em>'+escapeHtml(dm.lastMessage?.content||"Start a conversation")+'</em></span>'+
          (dm.unreadCount?'<b>'+escapeHtml(dm.unreadCount)+'</b>':"")+
        '</button>';
      }).join(""):'<div class="od-dm-empty">No direct messages yet.</div>';
      const dmListRoot=$("#od-dm-list");
      if(dmListRoot){
        dmListRoot.style.pointerEvents="auto";
        dmListRoot.querySelectorAll("[data-od-dm]").forEach(btn=>{
          const open=()=>{
            const id=btn.dataset.odDm;
            if(!id)return;
            openDMFromAnywhere(id);
          };
          btn.style.pointerEvents="auto";
          btn.onpointerdown=e=>{e.preventDefault();e.stopPropagation()};
          btn.onpointerup=e=>{e.preventDefault();e.stopPropagation();open()};
          btn.onclick=e=>{e.preventDefault();e.stopPropagation();open()};
        });
      }
    };

    const renderActive=()=>{
      const active=(liveUsers.length?liveUsers:online).slice(0,8);
      $("#od-active-list").innerHTML=active.length?active.map(u=>{
        return '<button class="od-active-row" data-od-active-user="'+escapeHtml(u.id||"")+'">'+avatarMarkup(u)+'<span><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><em>'+escapeHtml(u.activity||u.status||"Online")+'</em></span></button>';
      }).join(""):'<div class="od-active-empty"><strong>No one is active</strong><span>When friends come online, they will appear here.</span></div>';
      document.querySelectorAll("[data-od-active-user]").forEach(btn=>btn.onclick=()=>openPulseProfile(btn.dataset.odActiveUser));
    };

    const restoreActivePanel=()=>{
      const panel=$("#od-active-sidebar");
      if(!panel)return;
      panel.innerHTML='<div class="od-active-title"><strong>Active Now</strong></div><div id="od-active-list" class="od-active-list"></div>';
      renderActive();
    };

    const renderFriendsSurface=()=>{
      restoreActivePanel();
      const main=$("#od-home-main");
      if(!main)return;
      main.innerHTML=
        '<header class="od-friends-head">'+
          '<div class="od-friends-label"><span class="od-friends-icon">♟</span><strong>Friends</strong></div>'+
          '<div class="od-friends-tabs">'+
            '<button data-od-tab="online" class="active">Online</button>'+
            '<button data-od-tab="all">All</button>'+
            '<button data-od-tab="pending">Pending <span class="od-tab-badge" id="od-pending-badge">'+incoming.length+'</span></button>'+
            '<button data-od-tab="suggestions">Suggestions <span class="od-tab-badge soft" id="od-suggestion-badge">'+suggestions.length+'</span></button>'+
          '</div>'+
          '<button id="od-add-friend" class="od-add-friend">Add Friend</button>'+
        '</header>'+
        '<div class="od-home-notice"><span class="od-home-notice-icon">i</span><div><strong>Friends & conversations</strong><span>Choose a direct message from the left to open the chat here.</span></div><button id="od-notice-close">×</button></div>'+
        '<label class="od-friend-search"><span>⌕</span><input id="od-friend-search" placeholder="Search friends" autocomplete="off"></label>'+
        '<div id="od-tab-content" class="od-tab-content"></div>';

      const activateTab=(mode)=>{
        document.querySelectorAll("[data-od-tab]").forEach(b=>b.classList.toggle("active",b.dataset.odTab===mode));
        const slot=$("#od-tab-content"); if(!slot)return;
        let html="";
        if(mode==="online"){
          html='<div class="od-list-heading"><div><strong>Online — '+online.length+'</strong><span>Friends currently online</span></div></div>'+
            '<div class="od-user-list">'+(online.length?online.map(u=>userRow(u)).join(""):empty("Nobody is online","Your online friends will appear here."))+'</div>';
        }else if(mode==="all"){
          html='<div class="od-list-heading"><div><strong>All Friends — '+friends.length+'</strong><span>Everyone in your friends list</span></div></div>'+
            '<div class="od-user-list">'+(friends.length?friends.map(u=>userRow(u)).join(""):empty("No friends yet","Add people to build your Orbit circle."))+'</div>';
        }else if(mode==="pending"){
          html='<div class="od-list-heading"><div><strong>Pending</strong><span>Requests waiting for your response</span></div></div>'+
            '<section class="od-request-section"><div class="od-subheading">Incoming — '+incoming.length+'</div><div class="od-user-list">'+
            (incoming.length?incoming.map(r=>{
              const u=r.fromUser||{};
              return '<div class="od-user-row" data-od-user="'+escapeHtml(u.id||"")+'">'+avatarMarkup(u)+'<div class="od-user-copy"><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><span>Wants to be your friend</span></div><div class="od-user-actions"><button class="od-row-btn primary" data-od-accept="'+escapeHtml(r.id)+'">Accept</button><button class="od-row-btn" data-od-reject="'+escapeHtml(r.id)+'">Decline</button></div></div>';
            }).join(""):empty("No incoming requests","You are all caught up."))+
            '</div></section><section class="od-request-section"><div class="od-subheading">Outgoing — '+outgoing.length+'</div><div class="od-user-list">'+
            (outgoing.length?outgoing.map(r=>{
              const u=r.toUser||{};
              return '<div class="od-user-row">'+avatarMarkup(u)+'<div class="od-user-copy"><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><span>Friend request · waiting</span></div><div class="od-user-actions"><span class="od-pending-chip">Pending</span></div></div>';
            }).join(""):empty("No outgoing requests","Requests you send will appear here."))+
            '</div></section>';
        }else{
          html='<div class="od-list-heading"><div><strong>Suggestions</strong><span>People you may want to connect with</span></div></div>'+
            '<div class="od-user-list">'+(suggestions.length?suggestions.map(u=>{
              return '<div class="od-user-row">'+avatarMarkup(u)+'<div class="od-user-copy"><strong>'+escapeHtml(u.display_name||u.username||"Guest")+'</strong><span>'+escapeHtml(u.status||"online")+' · @'+escapeHtml(u.username||"guest")+'</span></div><div class="od-user-actions"><button class="od-row-btn primary" data-od-add="'+escapeHtml(u.username||"")+'">Add Friend</button></div></div>';
            }).join(""):empty("No suggestions right now","Try searching for someone by username."))+'</div>';
        }
        slot.innerHTML=html;
        slot.querySelectorAll("[data-od-message]").forEach(btn=>btn.onclick=async()=>{
          try{
            await api("/api/dms",{method:"POST",body:JSON.stringify({username:btn.dataset.odMessage})});
            const fresh=await api("/api/dms");
            dmState.list=fresh.dms||[];
            const dm=dmState.list.find(x=>String(x.otherUser?.username||"").toLowerCase()===String(btn.dataset.odMessage||"").toLowerCase());
            if(dm)await openHomeDirectMessage(dm.id);
          }catch(e){orbitToast("Message failed",e.message,"error")}
        });
        slot.querySelectorAll("[data-od-user]").forEach(btn=>btn.onclick=e=>{if(e.target.closest("button"))return;openPulseProfile(btn.dataset.odUser)});
        slot.querySelectorAll("[data-od-accept]").forEach(btn=>btn.onclick=async()=>{
          try{await api("/api/friends/request/"+encodeURIComponent(btn.dataset.odAccept)+"/accept",{method:"POST",body:"{}"});orbitToast("Friend added","Request accepted.","success");renderHomePage()}catch(e){orbitToast("Request failed",e.message,"error")}
        });
        slot.querySelectorAll("[data-od-reject]").forEach(btn=>btn.onclick=async()=>{
          try{await api("/api/friends/request/"+encodeURIComponent(btn.dataset.odReject)+"/reject",{method:"POST",body:"{}"});orbitToast("Request declined","The request was rejected.");renderHomePage()}catch(e){orbitToast("Request failed",e.message,"error")}
        });
        slot.querySelectorAll("[data-od-add]").forEach(btn=>btn.onclick=async()=>{
          try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username:btn.dataset.odAdd})});orbitToast("Friend request sent","Request sent.","success");btn.textContent="Sent";btn.disabled=true}catch(e){orbitToast("Friend request failed",e.message,"error")}
        });
        document.querySelectorAll("[data-od-tab]").forEach(b=>b.onclick=()=>activateTab(b.dataset.odTab));
        $("#od-add-friend").onclick=()=>{setView("friends");setTimeout(()=>$("#add-friend-page")?.click(),80)};
        $("#od-notice-close").onclick=e=>e.currentTarget.closest(".od-home-notice")?.remove();
        $("#od-friend-search").oninput=e=>{
          const term=e.target.value.toLowerCase().trim();
          document.querySelectorAll("#od-tab-content .od-user-row").forEach(row=>row.style.display=!term||row.innerText.toLowerCase().includes(term)?"flex":"none");
        };
      };
      activateTab("online");
    };

    const renderActiveHome=()=>{
      restoreActivePanel();
      $("#od-profile-home").onclick=()=>setView("settings");
      $("#od-profile-settings").onclick=()=>setView("settings");
      $("#od-quick-search").oninput=e=>renderDMs(e.target.value);
      $("#od-new-dm").onclick=()=>{setView("dms");setTimeout(()=>$("#dm-new-inline")?.click(),100)};
      document.querySelectorAll("[data-od-social]").forEach(btn=>btn.onclick=()=>{
        const target=btn.dataset.odSocial;
        if(target==="friends"){renderFriendsSurface();return}
        if(target==="dms"){
          const first=dms[0];
          if(first)openHomeDirectMessage(first.id);
          else $("#od-new-dm")?.click();
          return;
        }
        setView(target==="calls"?"calls":target);
      });
    };

    renderDMs();
    renderFriendsSurface();
    renderActiveHome();
  };
  loadHomeData();
}

async function openHomeDirectMessage(dmId){
  try{
    if(!dmState.list.length){
      const data=await api("/api/dms");
      dmState.list=data.dms||[];
    }
    const dm=dmState.list.find(x=>String(x.id)===String(dmId));
    if(!dm)return;

    if(dmState.activeId&&String(dmState.activeId)!==String(dmId)){
      socket?.emit("dm:typing",{dmId:dmState.activeId,isTyping:false});
    }

    dmState.activeId=dm.id;
    dmState.active=dm;
    dmState.messages=[];

    const u=dm.otherUser||{};
    const avatarUrl=avatarImageUrl(u);
    const online=dmUserStatus(u)==="Online";
    const home=$("#od-home-main");
    const side=$("#od-active-sidebar");
    if(!home||!side)return;

    home.classList.add("od-home-chat-active");
    side.classList.add("od-profile-active");

    const username=u.username||"guest";
    const displayName=u.display_name||username||"Guest";
    const bio=u.bio||"No bio added yet.";
    const statusText=online?"Online":"Offline";

    const renderProfilePanel=()=>{
      side.classList.add("od-profile-active");
      side.innerHTML=
        '<div class="od-profile-head"><div><strong>Profile</strong><span class="od-profile-sub">Direct message</span></div><button id="od-profile-close" title="Close profile">×</button></div>'+
        '<div class="od-profile-cover"></div>'+
        '<div class="od-profile-card">'+
          '<div class="od-profile-avatar-xl">'+(avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="">':escapeHtml(avatar(username)))+'<i class="'+(online?"online":"offline")+'"></i></div>'+
          '<strong class="od-profile-name">'+escapeHtml(displayName)+'</strong>'+
          '<span class="od-profile-handle">@'+escapeHtml(username)+'</span>'+
          '<div class="od-profile-status-line"><i class="'+(online?"online":"offline")+'"></i>'+statusText+'</div>'+
          '<div class="od-profile-action-row"><button id="od-profile-msg" class="od-profile-soft">Message</button><button id="od-profile-view" class="od-profile-soft">View Profile</button></div>'+
          '<div class="od-profile-divider"></div>'+
          '<div class="od-profile-section">ABOUT ME</div>'+
          '<p class="od-profile-bio">'+escapeHtml(bio)+'</p>'+
          '<div class="od-profile-section">USER INFO</div>'+
          '<div class="od-profile-info"><span>Username</span><strong>'+escapeHtml(username)+'</strong></div>'+
          '<div class="od-profile-info"><span>Status</span><strong>'+statusText+'</strong></div>'+
        '</div>';

      $("#od-profile-close").onclick=()=>{
        side.classList.remove("od-profile-active");
        side.innerHTML='<div class="od-active-title"><strong>Active Now</strong></div><div id="od-active-list" class="od-active-list"></div>';
        renderActive();
      };
      $("#od-profile-view").onclick=()=>openPulseProfile(u.id);
      $("#od-profile-msg").onclick=()=>{$("#od-home-dm-input")?.focus()};
    };

    renderProfilePanel();

    home.innerHTML=
      '<header class="od-home-dm-head">'+
        '<div class="od-home-dm-user">'+
          '<div class="od-home-dm-avatar">'+(avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="">':escapeHtml(avatar(username)))+'</div>'+
          '<div><strong>'+escapeHtml(displayName)+'</strong><span><i class="'+(online?"online":"offline")+'"></i>'+statusText+' · @'+escapeHtml(username)+'</span></div>'+
        '</div>'+
        '<div class="od-home-dm-actions">'+
          '<button id="od-home-dm-call" title="Start voice call">☎</button>'+
          '<button id="od-home-dm-video" title="Start video call">▣</button>'+
          '<button id="od-home-dm-pin" title="Pinned messages">⌖</button>'+
          '<button id="od-home-dm-add-user" title="Add friend">♙</button>'+
          '<button id="od-home-dm-search" title="Search messages">⌕</button>'+
          '<button id="od-home-dm-profile" title="Toggle profile">◉</button>'+
        '</div>'+
      '</header>'+
      '<div class="od-home-dm-messages" id="od-home-dm-messages">'+
        '<div class="od-home-dm-welcome">'+
          '<div class="od-home-dm-big-avatar">'+(avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="">':escapeHtml(avatar(username)))+'</div>'+
          '<strong>'+escapeHtml(displayName)+'</strong>'+
          '<span>That’s the beginning of your direct message with @'+escapeHtml(username)+'.</span>'+
        '</div>'+
      '</div>'+
      '<div id="od-home-dm-typing" class="od-home-dm-typing"></div>'+
      '<form id="od-home-dm-form" class="od-home-dm-composer">'+
        '<button type="button" id="od-home-dm-add" title="Add attachment">＋</button>'+
        '<textarea id="od-home-dm-input" rows="1" maxlength="4000" placeholder="Message @'+escapeHtml(username)+'"></textarea>'+
        '<button type="button" id="od-home-dm-emoji" title="Emoji">☺</button>'+
        '<button type="submit" class="od-home-dm-send" title="Send">➤</button>'+
      '</form>';

    renderHomeDirectMessageFeed(true);

    // Open the chat immediately; message history loads in the background.
    try{
      const history=await api("/api/dms/"+encodeURIComponent(dmId)+"/messages");
      dmState.messages=history.messages||[];
      renderHomeDirectMessageFeed(true);
      socket?.emit("dm:join",dmId);
      socket?.emit("dm:read",dmId);
      api("/api/dms/"+encodeURIComponent(dmId)+"/read",{method:"POST",body:"{}"}).catch(()=>{});
    }catch(historyError){
      console.warn("DM history load failed",historyError);
      orbitToast("Chat opened","Message history could not be loaded yet.");
    }

    const input=$("#od-home-dm-input");
    $("#od-home-dm-form").onsubmit=async e=>{
      e.preventDefault();
      const value=input?.value.trim();
      if(!value)return;
      try{
        await api("/api/dms/"+encodeURIComponent(dmId)+"/messages",{method:"POST",body:JSON.stringify({content:value})});
        input.value="";
        input.style.height="auto";
        socket?.emit("dm:typing",{dmId:dmId,isTyping:false});
        input.focus();
      }catch(err){orbitToast("Message failed",err.message,"error")}
    };
    input?.addEventListener("input",()=>{
      input.style.height="auto";
      input.style.height=Math.min(input.scrollHeight,150)+"px";
      if(!socket)return;
      socket.emit("dm:typing",{dmId:dmId,isTyping:true});
      clearTimeout(dmState.typingTimer);
      dmState.typingTimer=setTimeout(()=>socket?.emit("dm:typing",{dmId:dmId,isTyping:false}),900);
    });
    input?.addEventListener("keydown",e=>{
      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#od-home-dm-form")?.requestSubmit()}
    });
    $("#od-home-dm-emoji").onclick=()=>{
      const el=$("#od-home-dm-input");if(!el)return;
      const start=el.selectionStart??el.value.length;
      el.value=el.value.slice(0,start)+"🙂"+el.value.slice(el.selectionEnd??start);
      el.focus();
      el.selectionStart=el.selectionEnd=start+2;
    };
    $("#od-home-dm-add").onclick=()=>orbitToast("Attachments","Attachment upload is available in community channels.");
    $("#od-home-dm-search").onclick=()=>{
      const q=prompt("Search messages");
      if(q===null)return;
      const term=q.trim().toLowerCase();
      document.querySelectorAll("#od-home-dm-messages .od-home-dm-message").forEach(row=>{
        row.style.display=!term||row.innerText.toLowerCase().includes(term)?"grid":"none";
      });
    };
    $("#od-home-dm-pin").onclick=()=>orbitToast("Pinned messages","Pinned message view is ready for this conversation.");
    $("#od-home-dm-add-user").onclick=async()=>{
      try{
        await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});
        orbitToast("Friend request sent","Request sent to @"+username+".","success");
      }catch(e){orbitToast("Friend request",e.message,"error")}
    };
    $("#od-home-dm-profile").onclick=()=>{
      if(side.classList.contains("od-profile-active")){
        side.classList.remove("od-profile-active");
        side.innerHTML='<div class="od-active-title"><strong>Active Now</strong></div><div id="od-active-list" class="od-active-list"></div>';
        renderActive();
      }else{
        renderProfilePanel();
      }
    };
    $("#od-home-dm-call").onclick=()=>orbitToast("Voice call","Use a community voice room to start a live call.");
    $("#od-home-dm-video").onclick=()=>orbitToast("Video call","Use a community voice room to start a live video call.");

    document.querySelectorAll("[data-od-social]").forEach(btn=>btn.classList.toggle("active",btn.dataset.odSocial==="dms"));
    document.querySelectorAll("[data-od-dm]").forEach(btn=>btn.classList.toggle("active",String(btn.dataset.odDm)===String(dmId)));
  }catch(e){orbitToast("Direct message",e.message,"error")}
}


function renderHomeDirectMessageFeed(scrollBottom){
  const feed=$("#od-home-dm-messages");
  if(!feed)return;
  const other=dmState.active?.otherUser||{};
  if(!dmState.messages.length){
    feed.innerHTML='<div class="od-home-dm-welcome"><div class="od-home-dm-big-avatar">'+escapeHtml(avatar(other.username||"G"))+'</div><strong>'+escapeHtml(other.display_name||other.username||"Guest")+'</strong><span>Start a conversation with @'+escapeHtml(other.username||"guest")+'.</span></div>';
    return;
  }
  feed.innerHTML=dmState.messages.map((m)=>{
    const own=String(m.user_id)===String(me?.id);
    const av=m.username===me?.username&&me?avatar(me.username):avatar(m.username||"G");
    return '<article class="od-home-dm-message '+(own?"own":"")+'">'+
      '<div class="od-home-dm-msg-avatar">'+escapeHtml(av)+'</div>'+
      '<div class="od-home-dm-msg-stack"><div class="od-home-dm-meta"><strong>'+escapeHtml(m.username||"Guest")+'</strong><time>'+escapeHtml(formatDMTime(m.created_at))+'</time></div>'+
      '<div class="od-home-dm-text">'+escapeHtml(m.content||"")+'</div></div>'+
      '</article>';
  }).join("");
  if(scrollBottom)requestAnimationFrame(()=>feed.scrollTop=feed.scrollHeight);
}


/* ===== ORBIT PRODUCT EXPANSION / SOCIAL OS MODULES ===== */
/* ===== ORBIT PRODUCT EXPANSION / SOCIAL OS MODULES ===== */
let orbitLiveSessionId = null;

function readLocalJson(key, fallback){
  try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}
}
function writeLocalJson(key,value){localStorage.setItem(key,JSON.stringify(value))}
function orbitDate(value){
  const d=new Date(value); return Number.isNaN(d.getTime())?String(value||""):d.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})
}
function renderCommunitiesPage(){
  $("#page-actions").innerHTML='<button id="communities-create">+ Create community</button><button id="communities-discover">Discover</button>';
  const rows=(servers||[]).map(s=>{
    const active=String(s.id)===String(currentServer?.id);
    return '<button class="os-list-row '+(active?'active':'')+'" data-open-community="'+escapeHtml(s.id)+'"><div class="os-icon">◈</div><div><strong>'+escapeHtml(s.name)+'</strong><span>'+((s.memberCount||0))+' members · '+(active?'Active workspace':'Community')+'</span></div><b>'+((s.owner_id&&String(s.owner_id)===String(me?.id))?'OWNER':'MEMBER')+'</b></button>';
  }).join('');
  $("#page-body").innerHTML=
    '<div class="os-hero"><div><span class="eyebrow">COMMUNITY NETWORK</span><h2>Your communities.</h2><p>Every community is a world with its own Spaces, roles, conversations and live rooms.</p></div><div class="os-stat"><strong>'+servers.length+'</strong><span>connected</span></div></div>'+
    '<div class="os-toolbar"><div><strong>Connected communities</strong><span>Open a workspace or discover a new one.</span></div><button id="communities-new-inline">Create community</button></div>'+
    '<div class="os-list">'+(rows||'<div class="os-empty"><strong>No communities yet</strong><span>Create one to start your first Space.</span></div>')+'</div>'+
    '<div class="os-feature-grid"><div class="os-feature"><span>PUBLIC</span><strong>Discoverable communities</strong><small>Community discovery UI is ready; discovery ranking can be connected to a real recommendation service.</small></div><div class="os-feature"><span>SPACES</span><strong>Chat · Forum · Voice · Media</strong><small>Use the current channel engine as the first Space layer while richer Space types are added.</small></div><div class="os-feature"><span>CONTROL</span><strong>Permissions & audit</strong><small>Use Control Center for roles, moderation, bans, security and audit actions.</small></div></div>';
  $("#communities-create").onclick=()=>$("#new-server").click();
  $("#communities-new-inline").onclick=()=>$("#new-server").click();
  $("#communities-discover").onclick=()=>setView("discover");
  document.querySelectorAll("[data-open-community]").forEach(b=>b.onclick=async()=>{const ss=servers.find(x=>String(x.id)===String(b.dataset.openCommunity));if(ss)await selectServer(ss);goChat()});
}

function renderCallsPage(){
  const voice=(channels||[]).filter(c=>c.type==="voice");
  $("#page-actions").innerHTML='<button id="calls-start">Start video call</button><button id="calls-voice">Start voice</button>';
  const items=voice.map(c=>'<div class="os-call-row"><div class="os-call-pulse"></div><div><strong>'+escapeHtml(c.name)+'</strong><span>Voice Space · '+(String(c.id)===String(currentChannel?.id)?'selected':'ready to join')+'</span></div><button data-join-call="'+escapeHtml(c.id)+'">Join</button></div>').join('');
  $("#page-body").innerHTML=
    '<div class="os-hero"><div><span class="eyebrow">COMMUNICATION</span><h2>Calls, without friction.</h2><p>Jump into voice and video from any Space. The existing WebRTC layer remains the live transport.</p></div><div class="os-live-badge">LIVE MEDIA</div></div>'+
    '<div class="os-feature-grid"><div class="os-feature"><span>VOICE</span><strong>Push-to-talk ready</strong><small>Noise suppression, device selection, quality controls and connection telemetry are already available.</small></div><div class="os-feature"><span>VIDEO</span><strong>1080p / 1440p presets</strong><small>Video quality and layout controls connect directly to the current call engine.</small></div><div class="os-feature"><span>SCREEN</span><strong>Screen sharing</strong><small>Share screen from the call room with the existing browser capture flow.</small></div></div>'+
    '<div class="os-section-title"><strong>Available voice Spaces</strong><span>'+voice.length+' rooms</span></div>'+
    '<div class="os-call-list">'+(items||'<div class="os-empty"><strong>No voice Spaces yet</strong><span>Create a Voice Space from the workspace sidebar.</span></div>')+'</div>';
  $("#calls-start").onclick=()=>{if(currentChannel?.type!=="voice")return orbitToast("Video call","Select a Voice Space first.","error");startCall("video")};
  $("#calls-voice").onclick=()=>{if(currentChannel?.type!=="voice")return orbitToast("Voice call","Select a Voice Space first.","error");startCall("voice")};
  document.querySelectorAll("[data-join-call]").forEach(b=>b.onclick=async()=>{const c=voice.find(x=>String(x.id)===String(b.dataset.joinCall));if(!c)return;await selectChannel(c);startCall("voice")});
}

async function renderLivePage(){
  if(!currentServer){
    $("#page-actions").innerHTML="";
    $("#page-body").innerHTML='<div class="os-empty"><strong>Select a community first</strong><span>Live sessions belong to community Voice Spaces.</span></div>';
    return;
  }
  $("#page-actions").innerHTML='<button id="live-refresh">Refresh</button>';
  $("#page-body").innerHTML='<div class="os-empty"><strong>Loading live rooms…</strong><span>Finding active sessions in this community.</span></div>';
  try{
    const data=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/live");
    const sessions=data.sessions||[];
    const liveCards=sessions.map(s=>'<div class="os-stream-card"><div class="os-stream-art"><span>LIVE</span></div><div><strong>'+escapeHtml(s.title)+'</strong><span>'+escapeHtml(s.category)+' · '+Number(s.viewers||0)+' viewers · host @'+escapeHtml(s.host?.username||"unknown")+'</span><button data-live-join="'+escapeHtml(s.channelId)+'">Join live</button>'+(String(s.hostUserId)===String(me?.id)?'<button data-live-end="'+escapeHtml(s.id)+'">End live</button>':"")+'</div></div>').join("");
    $("#page-body").innerHTML=
      '<div class="os-hero os-live-hero"><div><span class="eyebrow">LIVE NETWORK</span><h2>Watch what is happening now.</h2><p>Shared live sessions are server-backed. The capture layer uses the existing WebRTC studio; external broadcast delivery can be connected later.</p></div><div class="os-stat"><strong>'+sessions.length+'</strong><span>live now</span></div></div>'+
      '<div class="os-event-compose"><input id="live-title" placeholder="Live session title"><input id="live-category" placeholder="Category"><button id="live-start">Start live</button></div>'+
      '<div class="os-stream-grid">'+(liveCards||'<div class="os-empty"><strong>No one is live</strong><span>Choose a Voice Space, start the studio and become the first live room.</span></div>')+'</div>'+
      '<div class="os-note"><strong>Transport boundary</strong><span>Orbit now has a shared live-session backend and realtime room presence. Public internet broadcasting still requires an ingest/transcoding/CDN provider; the app does not fake that dependency.</span></div>';
    $("#live-start").onclick=async()=>{
      if(currentChannel?.type!=="voice")return orbitToast("Go live","Select a Voice Space first.","error");
      try{
        const created=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/live",{method:"POST",body:JSON.stringify({channelId:currentChannel.id,title:$("#live-title").value.trim()||currentChannel.name+" Live",category:$("#live-category").value.trim()||"Community"})});
        orbitLiveSessionId=created.session.id;
        goChat();
        await startCall("video");
        if(!callState.active){await api("/api/live/"+encodeURIComponent(orbitLiveSessionId)+"/end",{method:"POST",body:"{}"});orbitLiveSessionId=null;return;}
        orbitToast("You're live","The community live room is active.","success");
      }catch(err){orbitToast("Go live failed",err.message,"error")}
    };
    $("#live-refresh").onclick=()=>renderLivePage();
    document.querySelectorAll("[data-live-join]").forEach(b=>b.onclick=async()=>{const c=(channels||[]).find(x=>String(x.id)===String(b.dataset.liveJoin));if(!c)return;await selectChannel(c);goChat();startCall("video")});
    document.querySelectorAll("[data-live-end]").forEach(b=>b.onclick=async()=>{try{await api("/api/live/"+encodeURIComponent(b.dataset.liveEnd)+"/end",{method:"POST",body:"{}"});if(String(orbitLiveSessionId)===String(b.dataset.liveEnd)){orbitLiveSessionId=null;leaveCall()}renderLivePage()}catch(err){orbitToast("End live failed",err.message,"error")}});    
  }catch(err){$("#page-body").innerHTML='<div class="os-empty"><strong>Could not load live sessions</strong><span>'+escapeHtml(err.message)+'</span></div>'}
}async function renderEventsPage(){
  if(!currentServer){
    $("#page-actions").innerHTML="";
    $("#page-body").innerHTML='<div class="os-empty"><strong>Select a community first</strong><span>Open Communities and choose a workspace to manage its events.</span></div>';
    return;
  }
  $("#page-actions").innerHTML='<button id="events-create">+ Create event</button><button id="events-refresh">Refresh</button>';
  $("#page-body").innerHTML='<div class="os-hero"><div><span class="eyebrow">EVENTS</span><h2>Spaces become experiences.</h2><p>Schedule classes, tournaments, watch parties, meetings and community moments. Events are shared with every member of this community.</p></div><div class="os-stat"><strong>—</strong><span>loading</span></div></div><div class="os-list"><div class="os-empty"><strong>Loading events…</strong><span>Syncing the community event stream.</span></div></div>';
  try{
    const data=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/events?upcoming=1");
    const events=data.events||[];
    const cards=events.map(e=>{
      const date=new Date(e.when);
      const canDelete=String(e.creatorId)===String(me?.id);
      return '<div class="os-event-card"><div class="os-event-date"><strong>'+escapeHtml(date.toLocaleDateString([], {day:"2-digit"}))+'</strong><span>'+escapeHtml(date.toLocaleDateString([], {month:"short"}))+'</span></div><div><strong>'+escapeHtml(e.title)+'</strong><span>'+escapeHtml(e.type)+' · '+escapeHtml(e.description||"Community event")+'</span><small>'+escapeHtml(orbitDate(e.when))+' · '+Number(e.rsvpCount||0)+' going</small></div><div><button data-event-rsvp="'+escapeHtml(e.id)+'">'+(e.going?"Going":"RSVP")+'</button>'+(canDelete?'<button data-event-delete="'+escapeHtml(e.id)+'">Delete</button>':"")+'</div></div>';
    }).join("");
    $("#page-body").innerHTML=
      '<div class="os-hero"><div><span class="eyebrow">EVENTS</span><h2>Spaces become experiences.</h2><p>Schedule classes, tournaments, watch parties, meetings and community moments. Events are shared with every member of this community.</p></div><div class="os-stat"><strong>'+events.length+'</strong><span>upcoming</span></div></div>'+
      '<div class="os-event-compose"><input id="os-event-title" placeholder="Event title"><input id="os-event-when" type="datetime-local"><select id="os-event-type"><option>Community</option><option>Gaming</option><option>Class</option><option>Meeting</option><option>Watch party</option><option>Voice</option><option>Video</option></select><button id="os-event-add">Create event</button></div>'+
      '<div class="os-list">'+(cards||'<div class="os-empty"><strong>No upcoming events</strong><span>Create the first event for this community.</span></div>')+'</div>'+
      '<div class="os-note"><strong>Shared event data</strong><span>Events, RSVPs and permissions are stored server-side and broadcast to connected community members in realtime.</span></div>';
    $("#events-create").onclick=()=>$("#os-event-title")?.focus();
    $("#events-refresh").onclick=()=>renderEventsPage();
    $("#os-event-add").onclick=async()=>{
      const title=$("#os-event-title").value.trim(),when=$("#os-event-when").value,type=$("#os-event-type").value;
      if(!title||!when)return orbitToast("Create event","Add a title and date/time.","error");
      try{await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/events",{method:"POST",body:JSON.stringify({title,when,type,description:"Created from Orbit Events"})});orbitToast("Event created","The community can now see and RSVP to it.","success");renderEventsPage()}catch(err){orbitToast("Create event failed",err.message,"error")}
    };
    document.querySelectorAll("[data-event-rsvp]").forEach(b=>b.onclick=async()=>{
      try{await api("/api/events/"+encodeURIComponent(b.dataset.eventRsvp)+"/rsvp",{method:"POST",body:JSON.stringify({going:b.textContent!=="Going"})});renderEventsPage()}catch(err){orbitToast("RSVP failed",err.message,"error")}
    });
    document.querySelectorAll("[data-event-delete]").forEach(b=>b.onclick=async()=>{
      try{await api("/api/events/"+encodeURIComponent(b.dataset.eventDelete),{method:"DELETE"});orbitToast("Event removed","The event was deleted.","success");renderEventsPage()}catch(err){orbitToast("Delete failed",err.message,"error")}
    });
  }catch(err){$("#page-body").innerHTML='<div class="os-empty"><strong>Could not load events</strong><span>'+escapeHtml(err.message)+'</span></div>'}
}async function renderProjectsPage(){
  if(!currentServer){
    $("#page-actions").innerHTML="";
    $("#page-body").innerHTML='<div class="os-empty"><strong>Select a community first</strong><span>Projects belong to communities and sync between their members.</span></div>';
    return;
  }
  $("#page-actions").innerHTML='<button id="project-add">+ Create project</button><button id="project-refresh">Refresh</button>';
  $("#page-body").innerHTML='<div class="os-hero"><div><span class="eyebrow">PROJECTS</span><h2>Turn communities into teams.</h2><p>Shared projects, tasks, assignments and progress live inside the community workspace.</p></div><div class="os-stat"><strong>—</strong><span>loading</span></div></div><div class="os-empty"><strong>Loading projects…</strong><span>Syncing the community project workspace.</span></div>';
  try{
    const data=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/projects");
    const projects=data.projects||[];
    const selectedId=orbitUI.projectId&&projects.some(p=>String(p.id)===String(orbitUI.projectId))?orbitUI.projectId:(projects[0]?.id||"");
    orbitUI.projectId=selectedId||"";
    const project=projects.find(p=>String(p.id)===String(selectedId))||null;
    const tasks=project?.tasks||[];
    const col=(key,label)=>'<section class="os-kanban-col"><header><strong>'+label+'</strong><span>'+tasks.filter(t=>t.status===key).length+'</span></header>'+tasks.filter(t=>t.status===key).map(t=>'<button class="os-task" data-task="'+escapeHtml(t.id)+'" data-project="'+escapeHtml(project.id)+'"><span>'+escapeHtml(t.label||"Task")+'</span><strong>'+escapeHtml(t.title)+'</strong><small>Click to move →</small></button>').join("")+'</section>';
    const options=projects.map(p=>'<option value="'+escapeHtml(p.id)+'" '+(String(p.id)===String(selectedId)?"selected":"")+'>'+escapeHtml(p.name)+'</option>').join("");
    $("#page-body").innerHTML=
      '<div class="os-hero"><div><span class="eyebrow">PROJECTS</span><h2>Turn communities into teams.</h2><p>Shared projects, tasks, assignments and progress live inside the community workspace.</p></div><div class="os-stat"><strong>'+projects.length+'</strong><span>projects</span></div></div>'+
      '<div class="os-project-compose"><select id="os-project-select" '+(projects.length?"":"disabled")+'>'+options+'</select><input id="os-task-title" placeholder="'+(project?"New task":"Create a project first")+'" '+(project?"":"disabled")+'><select id="os-task-status" '+(project?"":"disabled")+'><option value="backlog">Backlog</option><option value="in-progress">In progress</option><option value="done">Done</option></select><button id="os-task-add" '+(project?"":"disabled")+'>Add task</button></div>'+
      '<div class="os-toolbar"><div><strong>'+escapeHtml(project?.name||"No project selected")+'</strong><span>'+escapeHtml(project?.description||"Create a project to start collaborative work.")+'</span></div><span class="chip">'+tasks.length+' tasks</span></div>'+
      (project?'<div class="os-kanban">'+col("backlog","Backlog")+col("in-progress","In progress")+col("done","Done")+'</div>':'<div class="os-empty"><strong>No project yet</strong><span>Create a project to unlock the shared Kanban.</span></div>');
    $("#project-add").onclick=()=>openModal("Create project",'<input id="new-project-name" placeholder="Project name"><textarea id="new-project-description" placeholder="What are you building?"></textarea><button class="primary" id="new-project-save">Create project</button>');
    $("#project-refresh").onclick=()=>renderProjectsPage();
    $("#os-project-select")?.addEventListener("change",e=>{orbitUI.projectId=e.target.value;renderProjectsPage()});
    $("#os-task-add")?.addEventListener("click",async()=>{
      const title=$("#os-task-title").value.trim();if(!title||!project)return;
      try{await api("/api/projects/"+encodeURIComponent(project.id)+"/tasks",{method:"POST",body:JSON.stringify({title,status:$("#os-task-status").value,label:"Workspace"})});orbitToast("Task added","The task is now shared with the community.","success");renderProjectsPage()}catch(err){orbitToast("Task failed",err.message,"error")}
    });
    document.querySelectorAll("[data-task]").forEach(b=>b.onclick=async()=>{
      const t=tasks.find(x=>String(x.id)===String(b.dataset.task));if(!t)return;
      const next={backlog:"in-progress","in-progress":"done",done:"backlog"}[t.status];
      try{await api("/api/projects/"+encodeURIComponent(b.dataset.project)+"/tasks/"+encodeURIComponent(t.id),{method:"PATCH",body:JSON.stringify({status:next})});renderProjectsPage()}catch(err){orbitToast("Task update failed",err.message,"error")}
    });
    $("#new-project-save")?.addEventListener("click",async()=>{
      const name=$("#new-project-name").value.trim();const description=$("#new-project-description").value.trim();if(!name)return orbitToast("Project","Enter a project name.","error");
      try{const result=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/projects",{method:"POST",body:JSON.stringify({name,description})});orbitUI.projectId=result.project.id;closeModal();orbitToast("Project created","Shared project is ready.","success");renderProjectsPage()}catch(err){orbitToast("Project failed",err.message,"error")}
    });
  }catch(err){$("#page-body").innerHTML='<div class="os-empty"><strong>Could not load projects</strong><span>'+escapeHtml(err.message)+'</span></div>'}
}async function renderFilesPage(){
  let recent=readLocalJson("orbit_recent_files_v1",[]);
  try{const serverFiles=await api("/api/files?limit=40");recent=serverFiles.files||recent;writeLocalJson("orbit_recent_files_v1",recent)}catch{}
  $("#page-actions").innerHTML='<button id="files-upload">Upload file</button><button id="files-chat">Open composer</button>';
  const rows=recent.map(f=>'<div class="os-file-row"><div class="os-file-icon">'+(String(f.type||"").startsWith("image/")?"IMG":(String(f.type||"").includes("pdf")?"PDF":"FILE"))+'</div><div><strong>'+escapeHtml(f.name||"file")+'</strong><span>'+escapeHtml(f.type||"file")+' · '+Math.max(0,Math.round(Number(f.size||0)/1024))+' KB</span></div><a href="/api/uploads/'+encodeURIComponent(f.id)+'" target="_blank" rel="noopener">Open</a></div>').join("");
  $("#page-body").innerHTML=
    '<div class="os-hero"><div><span class="eyebrow">FILES</span><h2>Your shared workspace files.</h2><p>Upload from here or attach directly inside a conversation. Files are served by Orbit and inherit the current guest-mode upload limits.</p></div><div class="os-stat"><strong>'+recent.length+'</strong><span>recent</span></div></div>'+
    '<div class="os-file-drop" id="os-file-drop"><span>DROP</span><strong>Drop files here</strong><small>Images, video, audio, PDF and common documents.</small><button id="os-file-browse">Browse</button></div>'+
    '<div class="os-section-title"><strong>Recent files</strong><span>Local index · server file endpoint</span></div>'+
    '<div class="os-list">'+(rows||'<div class="os-empty"><strong>No files indexed yet</strong><span>Upload a file to create your first workspace item.</span></div>')+'</div>';
  const upload=()=>{const input=document.createElement("input");input.type="file";input.accept="image/*,video/*,audio/*,.pdf,.zip,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.json,.js,.ts,.md";input.onchange=()=>{const file=input.files?.[0];if(!file)return;if(file.size>1_500_000)return orbitToast("File too large","Guest mode limit is 1.5 MB for this workspace.","error");const fr=new FileReader();fr.onload=async()=>{try{const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type||"application/octet-stream",size:file.size,data:String(fr.result),purpose:"workspace-file"})});const saved=readLocalJson("orbit_recent_files_v1",[]).filter(x=>x.id!==up.file.id);saved.unshift(up.file);writeLocalJson("orbit_recent_files_v1",saved.slice(0,40));orbitToast("File uploaded",file.name,"success");renderFilesPage()}catch(err){orbitToast("Upload failed",err.message,"error")}};fr.readAsDataURL(file)};input.click()};
  $("#files-upload").onclick=upload;$("#files-browse").onclick=upload;$("#files-chat").onclick=()=>{goChat();$("#attach").click()};
}

async function renderAIPage(){
  $("#page-actions").innerHTML='<button id="ai-new">New conversation</button><button id="ai-refresh">Refresh</button>';
  $("#page-body").innerHTML='<div class="os-empty"><strong>Loading ORBIT…</strong><span>Syncing your assistant history.</span></div>';
  try{
    const data=await api("/api/ai/conversations");
    const conversations=data.conversations||[];
    const conversationId=orbitUI.aiConversationId&&conversations.some(c=>String(c.id)===String(orbitUI.aiConversationId))?orbitUI.aiConversationId:"";
    orbitUI.aiConversationId=conversationId;
    const active=conversations.find(c=>String(c.id)===String(conversationId));
    const history=active?.messages||[];
    $("#page-body").innerHTML=
      '<div class="os-hero os-ai-hero"><div><span class="eyebrow">ORBIT INTELLIGENCE</span><h2>AI, inside the workspace.</h2><p>Your AI conversations are stored server-side. Full model answers activate automatically when an AI provider is configured.</p></div><div class="os-ai-orb">✧</div></div>'+
      '<div class="os-toolbar"><div><strong>'+escapeHtml(active?.title||"New conversation")+'</strong><span>'+conversations.length+' saved conversations</span></div><button id="ai-new-inline">New conversation</button></div>'+
      '<div class="os-ai-shell"><div id="os-ai-log">'+(history.length?history.map(m=>'<div class="os-ai-msg '+m.role+'"><span>'+escapeHtml(m.role==="assistant"?"ORBIT":"YOU")+'</span><p>'+escapeHtml(m.content||"")+'</p></div>').join(""):'<div class="os-empty"><strong>Start a conversation</strong><span>Ask ORBIT to navigate, search or help organize your workspace.</span></div>')+'</div><form id="os-ai-form" class="os-ai-form"><input id="os-ai-input" placeholder="Ask ORBIT… e.g. “open settings” or “show files”"><button>Send</button></form></div>'+
      '<div class="os-note"><strong>AI control</strong><span>ORBIT never bypasses community permissions. External model access is optional and configured server-side with ORBIT_AI_API_URL, ORBIT_AI_API_KEY and ORBIT_AI_MODEL.</span></div>';
    const newConversation=()=>{orbitUI.aiConversationId="";renderAIPage()};
    $("#ai-new").onclick=newConversation;$("#ai-new-inline").onclick=newConversation;$("#ai-refresh").onclick=()=>renderAIPage();
    $("#os-ai-form").onsubmit=async e=>{
      e.preventDefault();
      const input=$("#os-ai-input").value.trim();if(!input)return;
      const btn=$("#os-ai-form button");btn.disabled=true;
      try{
        const result=await api("/api/ai/chat",{method:"POST",body:JSON.stringify({conversationId:orbitUI.aiConversationId||undefined,message:input,serverId:currentServer?.id||undefined})});
        orbitUI.aiConversationId=result.conversation.id;
        renderAIPage();
        const q=input.toLowerCase();
        if(result.reply==="Opening Settings.")setView("settings");
        else if(result.reply==="Opening Files.")setView("files");
        else if(result.reply==="Opening Calls.")setView("calls");
        else if(result.reply==="Opening Events.")setView("events");
        else if(result.reply==="Opening Projects.")setView("projects");
        else if(result.reply==="Opening Communities.")setView("communities");
        else if(result.reply==="Opening Live.")setView("live");
        else if(q.startsWith("search "))openSearchModal(input.slice(7));
      }catch(err){orbitToast("ORBIT failed",err.message,"error")}finally{btn.disabled=false}
    };
  }catch(err){$("#page-body").innerHTML='<div class="os-empty"><strong>Could not load ORBIT</strong><span>'+escapeHtml(err.message)+'</span></div>'}
}function renderDiscoverPage(){
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
  const isSystem=String(m.content||"").startsWith("https://");
  const time=escapeHtml(formatDMTime(m.created_at));
  return '<article class="dm-message '+(own?"own":"")+'" data-dm-message-id="'+escapeHtml(m.id)+'">'+
    '<div class="dm-message-avatar">'+escapeHtml(avatar(m.username||"G"))+'</div>'+
    '<div class="dm-message-stack">'+
      '<div class="dm-message-meta-top"><strong>'+escapeHtml(m.username||"Guest")+'</strong><time>'+time+'</time></div>'+
      '<div class="dm-message-bubble">'+(isSystem?'<a class="dm-link-message" href="'+escapeHtml(m.content)+'" target="_blank" rel="noopener">'+escapeHtml(m.content)+'</a>':escapeHtml(m.content))+'</div>'+
      '<div class="dm-message-meta">'+(own&&m.seen_at?'Seen · ':"")+(m.edited_at?'edited · ':'')+'Direct message</div>'+
    '</div>'+
    '<div class="dm-message-hover"><button title="Reply">↩</button><button title="More">•••</button></div>'+
  '</article>';
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
  const u=dmCurrentOther();
  const title=$("#dm-active-name"),meta=$("#dm-active-meta"),av=$("#dm-active-avatar"),dot=$("#dm-active-status");
  const panel=$("#dm-member-panel");
  if(!title||!meta||!av)return;
  if(!u){
    title.textContent="Select a conversation";
    meta.textContent="Choose a friend from the left to start chatting.";
    av.textContent="O";
    dot?.classList.remove("online");
    if(panel)panel.innerHTML='<div class="dm-profile-empty"><div class="dm-profile-empty-icon">◌</div><strong>No profile selected</strong><span>Select a direct message to see their profile.</span></div>';
    return;
  }
  const online=dmUserStatus(u)==="Online";
  const name=u.display_name||u.username||"Guest";
  const username=u.username||"guest";
  const avatarUrl=avatarImageUrl(u);
  title.textContent=name;
  meta.textContent=(online?"Online":"Offline")+" · @"+username;
  av.innerHTML=avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="">':escapeHtml(avatar(username));
  av.classList.toggle("has-image",Boolean(avatarUrl));
  dot?.classList.toggle("online",online);
  if(panel){
    panel.innerHTML=
      '<div class="dm-profile-banner"></div>'+
      '<div class="dm-profile-body">'+
        '<div class="dm-profile-avatar-wrap"><div class="dm-profile-avatar">'+(avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="">':escapeHtml(avatar(username)))+'</div><i class="dm-profile-status '+(online?"online":"offline")+'"></i></div>'+
        '<strong class="dm-profile-name">'+escapeHtml(name)+'</strong>'+
        '<span class="dm-profile-tag">@'+escapeHtml(username)+'</span>'+
        '<div class="dm-profile-rule"></div>'+
        '<div class="dm-profile-section-title">USER INFO</div>'+
        '<div class="dm-profile-info-row"><span>Username</span><strong>'+escapeHtml(username)+'</strong></div>'+
        '<div class="dm-profile-info-row"><span>Status</span><strong>'+(online?"Online":"Offline")+'</strong></div>'+
        '<button class="dm-profile-action" id="dm-profile-open">View Full Profile</button>'+
      '</div>';
    $("#dm-profile-open")?.addEventListener("click",()=>openPulseProfile(u.id));
  }
}
function renderDMPageShell(){
  $("#page-body").innerHTML='<div class="dm-discord-shell">'+
    '<aside class="dm-list-pane">'+
      '<div class="dm-discord-search"><span>⌕</span><input id="dm-list-search" placeholder="Find or start a conversation" autocomplete="off"></div>'+
      '<nav class="dm-discord-nav">'+
        '<button data-dm-nav="friends"><span>♟</span>Friends</button>'+
        '<button class="active" data-dm-nav="messages"><span>◌</span>Direct Messages</button>'+
        '<button data-dm-nav="calls"><span>◉</span>Calls</button>'+
      '</nav>'+
      '<div class="dm-discord-list-head"><span>DIRECT MESSAGES</span><button id="dm-new-inline" title="New direct message">+</button></div>'+
      '<div id="dm-list" class="dm-list"></div>'+
      '<div class="dm-sidebar-user"><div class="avatar">'+avatar(me?.username||"G")+'</div><div><strong>'+escapeHtml(me?.display_name||me?.username||"Guest")+'</strong><span>Online · @'+escapeHtml(me?.username||"guest")+'</span></div><button id="dm-sidebar-settings" title="Settings">⚙</button></div>'+
    '</aside>'+
    '<section class="dm-chat-pane">'+
      '<header class="dm-chat-header">'+
        '<div class="dm-active-profile"><div id="dm-active-avatar" class="dm-active-avatar"><span>O</span></div><span id="dm-active-status" class="dm-active-dot"></span><div><strong id="dm-active-name">Select a conversation</strong><span id="dm-active-meta">Choose a friend from the left to start chatting.</span></div></div>'+
        '<div class="dm-chat-actions">'+
          '<button id="dm-call-inline" title="Start voice call">☎</button>'+
          '<button id="dm-video-inline" title="Start video call">▣</button>'+
          '<button id="dm-pin-inline" title="Pinned messages">⌖</button>'+
          '<button id="dm-profile-inline" title="Toggle profile">◉</button>'+
          '<label class="dm-chat-search"><span>⌕</span><input id="dm-message-search" placeholder="Search"></label>'+
        '</div>'+
      '</header>'+
      '<div id="dm-messages" class="dm-messages"><div class="dm-empty-chat"><div class="dm-empty-icon">◌</div><strong>Your private space</strong><span>Select a conversation and start talking.</span></div></div>'+
      '<div id="dm-typing" class="dm-typing"></div>'+
      '<form id="dm-form" class="dm-composer"><div class="dm-compose-tools"><button type="button" id="dm-attach" title="Add attachment">＋</button><button type="button" id="dm-gif" title="GIF">GIF</button><button type="button" id="dm-sticker" title="Sticker">☺</button><button type="button" id="dm-emoji" title="Emoji">☺</button></div><textarea id="dm-input" rows="1" maxlength="4000" placeholder="Message…"></textarea><button class="dm-send" type="submit" aria-label="Send message">➤</button></form>'+
    '</section>'+
    '<aside id="dm-member-panel" class="dm-member-panel"><div class="dm-profile-empty"><div class="dm-profile-empty-icon">◌</div><strong>Select a conversation</strong><span>The person you are chatting with will appear here.</span></div></aside>'+
  '</div>';
}
function bindDMPage(){
  $("#dm-new-inline")?.addEventListener("click",()=>openModal("New direct message",'<input id="dm-target" placeholder="Exact guest username"><button class="primary" id="dm-create">Start conversation</button>'));
  $("#dm-list-search")?.addEventListener("input",e=>{dmState.query=e.target.value;renderDMList()});
  $("#dm-profile-inline")?.addEventListener("click",()=>{
    const panel=$("#dm-member-panel");
    if(panel)panel.classList.toggle("open");
  });
  $("#dm-sidebar-settings")?.addEventListener("click",()=>setView("settings"));
  document.querySelectorAll("[data-dm-nav]").forEach(btn=>btn.onclick=()=>{
    const target=btn.dataset.dmNav;
    if(target==="friends")setView("home");
    if(target==="calls")setView("calls");
  });
  $("#dm-call-inline")?.addEventListener("click",()=>{
    const u=dmCurrentOther();
    if(u)orbitToast("Voice call","Start a voice call from a community voice room or use the call controls there.");
  });
  $("#dm-video-inline")?.addEventListener("click",()=>{
    const u=dmCurrentOther();
    if(u)orbitToast("Video call","Start a video call from a community voice room or use the call controls there.");
  });
  $("#dm-pin-inline")?.addEventListener("click",()=>orbitToast("Pinned messages","Pinned message view is ready for this conversation."));
  $("#dm-message-search")?.addEventListener("input",e=>{
    const q=e.target.value.trim().toLowerCase();
    document.querySelectorAll("#dm-messages .dm-message").forEach(row=>row.style.display=!q||row.innerText.toLowerCase().includes(q)?"flex":"none");
  });
  $("#dm-attach")?.addEventListener("click",()=>orbitToast("Attachments","Attachment upload is available from community channels."));
  $("#dm-gif")?.addEventListener("click",()=>orbitToast("GIF","GIF picker is reserved for the DM composer."));
  $("#dm-sticker")?.addEventListener("click",()=>{$("#dm-emoji")?.click()});
  $("#dm-emoji")?.addEventListener("click",()=>{const input=$("#dm-input");if(!input)return;const start=input.selectionStart??input.value.length;input.value=input.value.slice(0,start)+"🙂"+input.value.slice(input.selectionEnd??start);input.focus();input.selectionStart=input.selectionEnd=start+2;saveDMDraft()});
  $("#dm-input")?.addEventListener("input",()=>{
    const input=$("#dm-input");saveDMDraft();input.style.height="auto";input.style.height=Math.min(input.scrollHeight,160)+"px";
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
      input.focus();
    }catch(err){orbitToast("Message failed",err.message,"error")}
  });
}
async function renderDMPage(selectId=null){
  try{
    // Legacy Messages route is now permanently redirected into Home inline chat.
    orbitUI.view="home";
    document.body.classList.add("orbit-discord-home");
    $("#global-page")?.classList.add("discord-home-active");
    $("#global-page")?.classList.remove("hidden");
    $("#chat-view")?.classList.add("hidden");
    $("#page-actions").innerHTML="";
    renderHomePage();

    const d=await api("/api/dms");
    dmState.list=d.dms||[];
    const preferred=selectId||dmState.activeId||dmState.list[0]?.id;
    if(preferred){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      await openHomeDirectMessage(preferred);
    }
  }catch(e){
    orbitToast("Direct messages",e.message,"error");
  }
}

async function openDM(idValue){
  return renderDMPage(idValue);
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
  const sections=[["appearance","Appearance"],["profile","Profile"],["privacy","Privacy"],["voice","Voice & Video"],["sound","Sounds"],["notifications","Notifications"],["accessibility","Accessibility"],["performance","Performance"],["files","Files & Sharing"],["security","Security"],["advanced","Advanced"]];
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
      '<div class="avatar-profile-editor">'+
      '<div class="avatar-upload-row"><div class="orbit-avatar-preview" id="avatar-upload-preview"><span>'+escapeHtml(avatar(me?.username||"G"))+'</span></div><div><strong>Profile avatar</strong><span>Upload GIF, PNG, JPG or WebP up to 2 MB.</span></div><button type="button" id="avatar-upload-btn">Upload</button><button type="button" id="avatar-remove-btn">Remove</button></div>'+
      '<div class="avatar-profile-preview"><div class="orbit-avatar-preview"><span>'+escapeHtml(avatar(me?.username||"G"))+'</span></div><div><strong>Animated avatar</strong><span>Your avatar now has a live effect across Orbit.</span></div></div>'+
      '<div class="avatar-style-grid">'+
      '<button type="button" class="avatar-style-card" data-avatar-style="aurora"><span class="style-preview style-aurora"></span><strong>Aurora</strong><small>Flowing color</small></button>'+
      '<button type="button" class="avatar-style-card" data-avatar-style="neon"><span class="style-preview style-neon"></span><strong>Neon Pulse</strong><small>Cyber glow</small></button>'+
      '<button type="button" class="avatar-style-card" data-avatar-style="energy"><span class="style-preview style-energy"></span><strong>Energy Ring</strong><small>Power wave</small></button>'+
      '<button type="button" class="avatar-style-card" data-avatar-style="off"><span class="style-preview style-off"></span><strong>Static</strong><small>No animation</small></button>'+
      '</div>'+
      '<div class="avatar-frame-section">'+
      '<div class="avatar-frame-head"><div><strong>Avatar frames</strong><span>Choose a live frame for your profile avatar.</span></div></div>'+
      '<div class="avatar-frame-grid">'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="none"><span class="frame-preview frame-none">A</span><strong>None</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="halo"><span class="frame-preview frame-halo">A</span><strong>Halo</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="crown"><span class="frame-preview frame-crown">A</span><strong>Crown</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="orbit"><span class="frame-preview frame-orbit">A</span><strong>Orbit</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="spark"><span class="frame-preview frame-spark">A</span><strong>Spark</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="fire"><span class="frame-preview frame-fire">A</span><strong>Inferno</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="ice"><span class="frame-preview frame-ice">A</span><strong>Ice</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="cyber"><span class="frame-preview frame-cyber">A</span><strong>Cyber</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="royal"><span class="frame-preview frame-royal">A</span><strong>Royal</strong></button>'+
      '<button type="button" class="avatar-frame-card" data-avatar-frame="dragon"><span class="frame-preview frame-dragon">A</span><strong>Dragon</strong></button>'+
      '<button type="button" class="avatar-frame-card avatar-frame-upload-card" id="avatar-frame-upload-btn"><span class="frame-preview frame-upload">＋</span><strong>Upload</strong></button>'+
      '</div></div></div>'+
      '<input id="profile-name" value="'+escapeHtml(orbitUI.profile.displayName||me?.display_name||me?.username||"Guest")+'" placeholder="Display name">'+
      '<textarea id="profile-bio" placeholder="Bio">'+escapeHtml(orbitUI.profile.bio||"")+'</textarea>'+
      '<div class="activity-editor"><div><strong>Activity status</strong><span>Show people what you are doing.</span></div><div class="activity-presets"><button type="button" data-activity-type="Gaming">🎮 Gaming</button><button type="button" data-activity-type="Coding">💻 Coding</button><button type="button" data-activity-type="Listening">🎧 Listening</button><button type="button" data-activity-type="Watching">📺 Watching</button><button type="button" data-activity-type="Streaming">🔴 Streaming</button></div><input id="profile-activity" maxlength="80" value="'+escapeHtml(me?.activity||"Online")+'" placeholder="Custom activity…"></div>'+
      '<select id="profile-status"><option>Online</option><option>Idle</option><option>Do Not Disturb</option><option>Invisible</option></select>'+
      '<button class="primary" id="save-profile">Save profile</button>';
    $("#profile-status").value=orbitUI.profile.status||"Online";
    document.querySelectorAll("[data-activity-type]").forEach(b=>b.onclick=()=>$("#profile-activity").value=b.dataset.activityType);
    const currentAvatarUrl=avatarImageUrl(me);
    const preview=$("#avatar-upload-preview");
    if(currentAvatarUrl) preview.innerHTML='<img src="'+escapeHtml(currentAvatarUrl)+'" alt="">';
    $("#avatar-upload-btn").onclick=()=>{
      const input=document.createElement("input");
      input.type="file"; input.accept="image/png,image/jpeg,image/webp,image/gif,image/avif";
      input.onchange=async()=>{
        const file=input.files?.[0]; if(!file)return;
        if(file.size>2_000_000){orbitToast("Avatar","Image must be 2 MB or smaller.","error");return;}
        const fr=new FileReader();
        fr.onload=async()=>{
          try{
            const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type,size:file.size,data:String(fr.result),purpose:"avatar"})});
            const avatarUrl="/api/avatar/"+encodeURIComponent(up.file.id);
            const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({avatarUrl})});
            me=updated.user; saveGuest(); renderOwnAvatar();
            orbitUI.profile.avatarUrl=avatarUrl;
            localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));
            preview.innerHTML='<img src="'+escapeHtml(avatarUrl)+'" alt="">';
            orbitToast("Avatar updated","Your uploaded avatar is now active.","success");
          }catch(err){orbitToast("Avatar upload failed",err.message,"error")}
        };
        fr.readAsDataURL(file);
      };
      input.click();
    };
    $("#avatar-remove-btn").onclick=async()=>{
      try{
        const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({avatarUrl:""})});
        me=updated.user; saveGuest(); renderOwnAvatar();
        delete orbitUI.profile.avatarUrl;
        localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));
        preview.innerHTML='<span>'+escapeHtml(avatar(me?.username||"G"))+'</span>';
        orbitToast("Avatar removed","Your default animated avatar is back.","success");
      }catch(err){orbitToast("Avatar remove failed",err.message,"error")}
    };

    const avatarMotion=orbitUI.profile.avatarMotion||"aurora";
    document.querySelectorAll("[data-avatar-style]").forEach(b=>{
      b.classList.toggle("active",b.dataset.avatarStyle===avatarMotion);
      b.onclick=()=>{
        orbitUI.profile.avatarMotion=b.dataset.avatarStyle;
        applyAvatarMotion();
        document.querySelectorAll("[data-avatar-style]").forEach(x=>x.classList.toggle("active",x===b));
      };
    });
    const currentAvatarFrame=avatarFrameName(me);
    const currentCustomFrame=avatarCustomFrameUrl(me);
    document.querySelectorAll("[data-avatar-frame]").forEach(b=>{
      b.classList.toggle("active",!currentCustomFrame && b.dataset.avatarFrame===currentAvatarFrame);
      b.onclick=async()=>{
        try{
          const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({
            avatarDecoration:b.dataset.avatarFrame,
            avatarDecorationUrl:""
          })});
          me=updated.user; saveGuest(); renderOwnAvatar();
          document.querySelectorAll("[data-avatar-frame]").forEach(x=>x.classList.toggle("active",x===b));
          const previewFrame=$("#avatar-upload-preview");
          if(previewFrame){
            const purl=avatarImageUrl(me);
            previewFrame.innerHTML=purl?'<img src="'+escapeHtml(purl)+'" alt="">':'<span>'+escapeHtml(avatar(me?.username||"G"))+'</span>';
            setAvatarFrame(previewFrame,avatarFrameName(me),avatarCustomFrameUrl(me));
          }
          orbitToast("Frame updated","Your new avatar frame is active.","success");
        }catch(err){orbitToast("Frame update failed",err.message,"error")}
      };
    });
    const uploadFrame=$("#avatar-frame-upload-btn");
    if(uploadFrame) uploadFrame.onclick=()=>{
      const input=document.createElement("input");
      input.type="file";
      input.accept="image/png,image/jpeg,image/webp,image/gif,image/avif";
      input.onchange=async()=>{
        const file=input.files?.[0];
        if(!file) return;
        if(file.size>1_000_000){
          orbitToast("Frame upload","Frame image must be 1 MB or smaller.","error");
          return;
        }
        if(!file.type.startsWith("image/")){
          orbitToast("Frame upload","Please choose an image file.","error");
          return;
        }
        const fr=new FileReader();
        fr.onload=async()=>{
          try{
            const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({
              name:file.name,
              type:file.type,
              size:file.size,
              data:String(fr.result),
              purpose:"avatar-decoration"
            })});
            const avatarDecorationUrl="/api/avatar/"+encodeURIComponent(up.file.id);
            const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({
              avatarDecoration:"none",
              avatarDecorationUrl
            })});
            me=updated.user; saveGuest(); renderOwnAvatar();
            document.querySelectorAll("[data-avatar-frame]").forEach(x=>x.classList.remove("active"));
            uploadFrame.classList.add("active");
            const previewFrame=$("#avatar-upload-preview");
            if(previewFrame){
              const purl=avatarImageUrl(me);
              previewFrame.innerHTML=purl?'<img src="'+escapeHtml(purl)+'" alt="">':'<span>'+escapeHtml(avatar(me?.username||"G"))+'</span>';
              setAvatarFrame(previewFrame,avatarFrameName(me),avatarCustomFrameUrl(me));
            }
            orbitToast("Custom frame uploaded","Your uploaded frame is now active.","success");
          }catch(err){orbitToast("Frame upload failed",err.message,"error")}
        };
        fr.readAsDataURL(file);
      };
      input.click();
    };
    $("#check-username").onclick=async()=>{try{const name=$("#profile-username").value.trim();if(!name)return;const r=await api("/api/search?q="+encodeURIComponent(name));const exact=(r.users||[]).find(u=>u.username.toLowerCase()===name.replace(/^@/,"").toLowerCase()&&String(u.id)!==String(me?.id));$("#username-status").textContent=exact?"Username is taken.":"Username looks available.";$("#username-status").classList.toggle("is-good",!exact);$("#username-status").classList.toggle("is-bad",!!exact)}catch{}};
    $("#save-profile").onclick=async()=>{try{
      const username=$("#profile-username").value.trim().replace(/^@+/,"").toLowerCase();
      const displayName=$("#profile-name").value.trim()||username||"Guest";
      const bio=$("#profile-bio").value.trim();
      const status=$("#profile-status").value;
      const activity=$("#profile-activity").value.trim()||"Online";
      const activityType=(activity==="Online"?"custom":"custom");
      const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({username,displayName,bio,activity,activityType})});
      me=updated.user; guestName=me.username; saveGuest(); renderOwnAvatar();
      orbitUI.profile.displayName=displayName;orbitUI.profile.bio=bio;orbitUI.profile.status=status;
      localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));
      $("#me-name").textContent=displayName;$("#me-status").textContent=status.toLowerCase()+" · @"+me.username;
      orbitToast("Profile updated","Your profile, activity and identity are saved.","success");
    }catch(err){
      if(err.message==="Username is already taken"&&err.suggested) $("#username-status").textContent="Taken. Try @"+err.suggested;
      else orbitToast("Profile update failed",err.message,"error");
    }}
  }else if(section==="voice"){
    const screenShareEnabled=localStorage.getItem("orbit_screen_share")!=="off";
    const preferred=callState.settings.quality||"720p";
    const screenAudio=localStorage.getItem("orbit_screen_audio")!=="off";
    card.innerHTML='<h3>Voice & Video</h3><p>Professional controls for calls, cameras and screen sharing.</p>'+
      setting("Noise suppression","Reduce keyboard and room noise.",true,"voice-ns")+
      setting("Echo cancellation","Reduce feedback.",true,"voice-ec")+
      setting("Auto gain","Normalize microphone volume.",true,"voice-gain")+
      setting("Screen sharing","Allow screen sharing in calls and rooms.",screenShareEnabled,"voice-screen-share")+
      setting("System audio","Also share browser/tab audio when supported.",screenAudio,"voice-screen-audio")+
      '<div class="setting-row"><div><strong>Video & screen quality</strong><span>Choose a capture profile for cameras and shared screens.</span></div><select id="preferred-quality"><option '+(preferred==="480p"?"selected":"")+' value="480p">480p</option><option '+(preferred==="720p"?"selected":"")+' value="720p">720p</option><option '+(preferred==="1080p"?"selected":"")+' value="1080p">1080p</option><option '+(preferred==="1080p60"?"selected":"")+' value="1080p60">1080p60</option><option '+(preferred==="1440p"?"selected":"")+' value="1440p">1440p</option></select></div>'+
      '<div class="setting-row"><div><strong>Frame rate</strong><span>Higher FPS makes screen motion smoother.</span></div><select id="preferred-fps"><option value="24">24 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></div>';
    $("#preferred-quality").onchange=e=>{callState.settings.quality=e.target.value;localStorage.setItem("orbit_video_quality",e.target.value);};
    const fpsSelect=$("#preferred-fps"); if(fpsSelect) fpsSelect.value=String(callState.settings.fps||30);
    fpsSelect?.addEventListener("change",e=>{callState.settings.fps=Number(e.target.value);});
  }else if(section==="sound"){
    const enabled=orbitSound.enabled;
    const vol=Math.round(orbitSound.master*100);
    card.innerHTML='<h3>Sounds</h3><p>Give Orbit its own audio identity. These sounds run locally in your browser.</p>'+
      setting("Interface sounds","Clicks, sends, uploads and call feedback.",enabled,"sound-enabled")+
      '<div class="setting-row"><div><strong>Master volume</strong><span>Control Orbit UI sound level.</span></div><input id="sound-volume" type="range" min="0" max="100" value="'+vol+'"><b id="sound-volume-value">'+vol+'%</b></div>'+
      '<div class="setting-row"><div><strong>Sound pack</strong><span>Choose the tone character you prefer.</span></div><select id="sound-pack"><option value="crystal">Crystal</option><option value="soft">Soft</option><option value="arcade">Arcade</option></select></div>'+
      '<div class="setting-row sound-test-row"><div><strong>Preview</strong><span>Test the current sound profile.</span></div><button class="primary" id="sound-test">Play test</button></div>';
    $("#sound-volume").oninput=e=>{setOrbitSoundSetting("volume",Number(e.target.value)/100);$("#sound-volume-value").textContent=e.target.value+"%";playUiTone("click");};
    $("#sound-pack").value=orbitSound.pack;
    $("#sound-pack").onchange=e=>{setOrbitSoundSetting("pack",e.target.value);playUiTone("success");};
    $("#sound-test").onclick=()=>{playUiTone("call");setTimeout(()=>playUiTone("success"),120);};
  }else if(section==="files"){
    card.innerHTML='<h3>Files & Sharing</h3><p>Control how Orbit handles attachments and shared media.</p>'+
      '<div class="setting-row"><div><strong>Drag & drop uploads</strong><span>Drop files directly into a text channel.</span></div><span class="setting-status-badge">READY</span></div>'+
      '<div class="setting-row"><div><strong>Maximum file size</strong><span>Per file in the current guest workspace.</span></div><strong>4.5 MB</strong></div>'+
      '<div class="setting-row"><div><strong>Supported media</strong><span>Images, video, audio, PDF and common office/archive files.</span></div><span class="setting-status-badge">MULTI</span></div>'+
      '<div class="setting-row"><div><strong>Screen share</strong><span>Use the Share screen action inside a call.</span></div><span class="setting-status-badge">LIVE</span></div>';
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
  document.querySelectorAll("[data-setting-toggle]").forEach(b=>b.onclick=()=>{
    b.classList.toggle("on");
    const key=b.dataset.settingToggle;
    if(key==="appearance-motion"){document.body.classList.toggle("reduced-motion",b.classList.contains("on"));localStorage.setItem("orbit_motion",b.classList.contains("on")?"reduced":"full")}
    if(key==="appearance-density"){document.body.classList.toggle("compact",b.classList.contains("on"));localStorage.setItem("orbit_density",b.classList.contains("on")?"compact":"comfortable")}
    if(key==="voice-screen-share"){localStorage.setItem("orbit_screen_share",b.classList.contains("on")?"on":"off");syncScreenShareControls();}
    if(key==="voice-screen-audio"){localStorage.setItem("orbit_screen_audio",b.classList.contains("on")?"on":"off");}
    if(key==="sound-enabled"){setOrbitSoundSetting("enabled",b.classList.contains("on"));if(orbitSound.enabled)playUiTone("success");}
  });
}
function setting(title,desc,on,key){return '<div class="setting-row"><div><strong>'+title+'</strong><span>'+desc+'</span></div><button class="switch '+(on?"on":"")+'" data-setting-toggle="'+key+'"></button></div>'}
function syncScreenShareControls(){
  const enabled=localStorage.getItem("orbit_screen_share")!=="off";
  ["#quick-screen-share-btn","#share-btn","#dock-screen"].forEach(sel=>{
    const el=$(sel);
    if(!el)return;
    el.classList.toggle("hidden",!enabled);
    el.disabled=!enabled;
    el.setAttribute("aria-hidden",enabled?"false":"true");
  });
}

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
    ["⌂","Home","home"],["☎","Calls","calls"],["●","Live","live"],["◷","Events","events"],["◫","Projects","projects"],["□","Files","files"],["✧","ORBIT AI","ai"],["✦","Discover","discover"],["◎","Friends","friends"],["⌑","Saved","saved"],["⌖","Explore","explore"],["⚙","Settings","settings"],["+","Create server","create-server"],["#","Create channel","create-channel"],["☎","Start voice call","voice"],["▣","Start video call","video"],["↗","Share screen","share"],["⌕","Search","search"]
  ].filter(x=>(x[1]+" "+x[2]).toLowerCase().includes(String(q||"").toLowerCase()));
  $("#command-results").innerHTML=(commands.length?commands:[["⌕","No matches",""]]).map((x,i)=>'<button class="command-item" data-command-index="'+i+'"><span class="command-icon">'+x[0]+'</span><div><strong>'+x[1]+'</strong><span>'+x[2]+'</span></div><span>↵</span></button>').join("");
  document.querySelectorAll("[data-command-index]").forEach((b,i)=>b.onclick=()=>runCommand(commands[i]));
}
function runCommand(item){
  if(!item)return;
  closeCommandPalette();
  const a=item[2];
  if(["home","discover","dms","friends","calls","live","events","projects","files","ai","notifications","saved","explore","settings"].includes(a))return setView(a);
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
  async function openServerSettings(){
    if(!currentServer)return;
    const role=String(currentServer.role||"");
    if(!["owner","admin"].includes(role)) return orbitToast("Server settings","Only server managers can change these settings.","error");
    let settings={locked:false,slowmode:0,verification:"open"};
    try{
      const d=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/admin/dashboard");
      settings=d.server?.settings||settings;
    }catch(err){return orbitToast("Server settings",err.message,"error")}
    const verification=String(settings.verification||"open");
    openModal("Server settings",
      '<div class="server-settings-shell">'+
        '<div class="server-settings-hero"><div class="server-settings-icon">⚙</div><div><span class="community-kicker">SERVER SETTINGS</span><h3>'+escapeHtml(currentServer.name)+'</h3><p>Manage the rules that shape this community. Changes apply to this server only.</p></div></div>'+
        '<div class="server-setting-list">'+
          '<div class="server-setting-row"><div><strong>Lock community</strong><span>Prevent members from sending new messages while you handle moderation.</span></div><button type="button" class="server-toggle '+(settings.locked?"on":"")+'" id="server-setting-locked" aria-pressed="'+(settings.locked?"true":"false")+'"><i></i></button></div>'+
          '<div class="server-setting-row"><div><strong>Message slowmode</strong><span>Set a delay between messages to reduce spam.</span></div><select id="server-setting-slowmode"><option value="0">Off</option><option value="5">5 seconds</option><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">120 seconds</option></select></div>'+
          '<div class="server-setting-row"><div><strong>Verification level</strong><span>Choose how much verification new members need before participating.</span></div><select id="server-setting-verification"><option value="open">Open</option><option value="verified">Verified</option><option value="high">High</option></select></div>'+
        '</div>'+
        '<div class="server-settings-footer"><span id="server-settings-status">Unsaved changes</span><div><button class="community-cancel" id="server-settings-cancel">Cancel</button><button class="primary community-create-btn" id="server-settings-save">Save changes</button></div></div>'+
      '</div>'
    );
    $("#server-setting-slowmode").value=String(settings.slowmode||0);
    $("#server-setting-verification").value=verification;
    let locked=Boolean(settings.locked);
    $("#server-setting-locked").onclick=()=>{
      locked=!locked;
      const b=$("#server-setting-locked");b.classList.toggle("on",locked);b.setAttribute("aria-pressed",locked?"true":"false");
    };
    $("#server-settings-cancel").onclick=closeModal;
    $("#server-settings-save").onclick=async()=>{
      const btn=$("#server-settings-save");btn.disabled=true;btn.textContent="Saving…";
      try{
        const patch={locked,slowmode:Number($("#server-setting-slowmode").value),verification:$("#server-setting-verification").value};
        const d=await api("/api/servers/"+encodeURIComponent(currentServer.id)+"/admin/settings",{method:"PATCH",body:JSON.stringify(patch)});
        if(currentServer.settings)currentServer.settings=d.settings;
        closeModal();orbitToast("Server settings saved","Your community settings are updated.","success");
      }catch(err){btn.disabled=false;btn.textContent="Save changes";orbitToast("Settings failed",err.message,"error")}
    };
  }
  $("#workspace-menu")?.addEventListener("click", () => {
    if (!currentServer) return;
    const role=String(currentServer.role||"");
    const manager=["owner","admin"].includes(role);
    openModal("Community controls",
      '<div class="control-grid">' +
      '<div class="control-row"><strong>' + escapeHtml(currentServer.name) + '</strong><span>'+ (role==="owner"?"Owner":"Administrator") +'</span></div>' +
      '<div class="control-row"><strong>Members</strong><span>Open the Members panel from chat.</span></div>' +
      '<div class="control-row"><strong>Invite</strong><span>Create a 7-day invite link.</span></div>' +
      (manager?'<button class="primary" id="workspace-open-server-settings">Server settings</button>':"")+
      '</div>');
    if(manager)$("#workspace-open-server-settings").onclick=()=>{closeModal();openServerSettings()};
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
    closeServerSidebar();
  });
  $("#mobile-sidebar-btn")?.addEventListener("click",()=>{
    const sidebar=$("#sidebar");
    if(!sidebar)return;
    sidebar.classList.toggle("open");
    document.body.classList.toggle("mobile-sidebar-open",sidebar.classList.contains("open"));
  });
  $("#settings-nav")?.addEventListener("click",()=>{setView("settings");closeServerSidebar()});
  $("#profile-card-btn")?.addEventListener("click",()=>{setView("settings");closeServerSidebar();renderSettingsPage("profile")});
  $("#sidebar-search")?.addEventListener("click",()=>openSearchModal($("#quick-search")?.value||""));
$("#quick-search")?.addEventListener("focus",()=>$("#sidebar-search")?.classList.add("focused"));
$("#quick-search")?.addEventListener("blur",()=>$("#sidebar-search")?.classList.remove("focused"));
  $("#quick-search")?.addEventListener("keydown",e=>{if(e.key==="Enter")runGlobalSearch(e.target.value)});
  function openJoinCommunityModal(){
  openModal("Join a community",
    '<div class="community-modal-shell">'+
      '<div class="community-modal-hero join-hero"><div class="community-modal-icon join-icon">↗</div><div><span class="community-kicker">JOIN A SPACE</span><h3>Join an existing community</h3><p>Paste an Orbit invite code or a full invite link. We will add the community to your workspace.</p></div></div>'+
      '<div class="community-form-card"><label><span>Invite code or link</span><input id="invite-code" maxlength="300" placeholder="Paste invite code or https://…/?invite=…"></label><div class="community-join-status" id="community-join-status"><span class="status-dot"></span><span>Waiting for an invite</span></div></div>'+
      '<div class="community-modal-actions"><button class="community-cancel" id="join-server-cancel">Cancel</button><button class="primary community-create-btn" id="join-by-invite" disabled>Join community</button></div>'+
    '</div>'
  );
  const input=$("#invite-code"),btn=$("#join-by-invite"),status=$("#community-join-status");
  const sync=()=>{
    const raw=input.value.trim();
    const valid=raw.length>=3;
    btn.disabled=!valid;
    status.innerHTML=valid?'<span class="status-dot ready"></span><span>Invite detected — ready to join</span>':'<span class="status-dot"></span><span>Paste an invite code or link</span>';
  };
  input?.addEventListener("input",sync);
  input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!btn.disabled)btn.click()});
  $("#join-server-cancel")?.addEventListener("click",closeModal);
  setTimeout(()=>input?.focus(),30);
  btn?.addEventListener("click",async()=>{
    const raw=input.value.trim();let code=raw;
    try{if(raw.includes("invite="))code=new URL(raw).searchParams.get("invite")||raw}catch{}
    btn.disabled=true;btn.textContent="Joining…";
    try{
      await api("/api/invites/"+encodeURIComponent(code)+"/accept",{method:"POST",body:"{}"});
      closeModal();await loadServers();orbitToast("Joined community","The community has been added to your workspace.","success");
    }catch(err){
      btn.disabled=false;btn.textContent="Join community";
      orbitToast("Invite failed",err.message,"error");
    }
  });
}
$("#join-server")?.addEventListener("click",openJoinCommunityModal);
  $("#command-input")?.addEventListener("input",e=>renderCommandResults(e.target.value));
  $("#command-palette")?.addEventListener("click",e=>{if(e.target.id==="command-palette")closeCommandPalette()});
  $("#modal-close")?.addEventListener("click",closeModal);
  $("#modal")?.addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
  $("#close-thread")?.addEventListener("click",()=>$("#thread-panel").classList.add("hidden"));
  $("#member-filter")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("#member-list .member").forEach(m=>m.classList.toggle("hidden",!m.textContent.toLowerCase().includes(q)))});
  document.addEventListener("click",async e=>{
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


function openCreateCommunityModal(){
  openModal("Create a community",
    '<div class="community-modal-shell">'+
      '<div class="community-modal-hero"><div class="community-modal-icon">◈</div><div><span class="community-kicker">START YOUR SPACE</span><h3>Create your community</h3><p>Give your community a name. You can add Spaces, members and roles after it is created.</p></div></div>'+
      '<div class="community-form-card"><label><span>Community name</span><input id="server-name-input" maxlength="60" placeholder="e.g. Orbit Gaming, Study Hub, Friends"></label><div class="community-name-hint"><span>Tip</span><span>Keep it short and recognizable.</span></div><div class="community-preview"><span class="community-preview-icon" id="community-preview-icon">O</span><div><strong id="community-preview-name">Your community</strong><span>Ready for channels, voice rooms and members</span></div></div></div>'+
      '<div class="community-modal-actions"><button class="community-cancel" id="create-server-cancel">Cancel</button><button class="primary community-create-btn" id="create-server-now" disabled>Create community</button></div>'+
    '</div>'
  );
  const input=$("#server-name-input"),btn=$("#create-server-now"),preview=$("#community-preview-name"),icon=$("#community-preview-icon");
  const sync=()=>{const v=input.value.trim();btn.disabled=v.length<2;preview.textContent=v||"Your community";icon.textContent=(v||"O").slice(0,1).toUpperCase()};
  input?.addEventListener("input",sync);
  $("#create-server-cancel")?.addEventListener("click",closeModal);
  input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!btn.disabled)btn.click()});
  setTimeout(()=>input?.focus(),30);
  btn?.addEventListener("click",async()=>{
    const name=input.value.trim();
    if(name.length<2)return;
    btn.disabled=true;btn.textContent="Creating…";
    try{
      const d=await api("/api/servers",{method:"POST",body:JSON.stringify({name})});
      closeModal();await loadServers();const created=servers.find(x=>String(x.id)===String(d.server.id));
      if(created)await selectServer(created);
      orbitToast("Community created",d.server.name+" is ready.","success");
    }catch(err){
      btn.disabled=false;btn.textContent="Create community";
      orbitToast("Creation failed",err.message,"error");
    }
  });
}
$("#new-server").onclick=openCreateCommunityModal;
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
    const homeTyping=$("#od-home-dm-typing");if(homeTyping)homeTyping.textContent=x.isTyping?(x.username||"Your friend")+" is typing…":"";
  });
  socket.on("dm:message",m=>{
    const existing=dmState.list.find(d=>String(d.id)===String(m.dm_id));
    if(existing){existing.lastMessage=m;if(String(m.user_id)!==String(me?.id)&&String(dmState.activeId)!==String(m.dm_id))existing.unreadCount=Number(existing.unreadCount||0)+1;}
    if(String(dmState.activeId)===String(m.dm_id)){
      if(!dmState.messages.some(x=>String(x.id)===String(m.id))){
        dmState.messages.push(m);
        renderDMMessageFeed(true);
        renderHomeDirectMessageFeed(true);
      }
      if(String(m.user_id)!==String(me?.id)){
        socket?.emit("dm:read",m.dm_id);
        api("/api/dms/"+encodeURIComponent(m.dm_id)+"/read",{method:"POST",body:"{}"}).catch(()=>{});
      }
    }else if(String(m.user_id)!==String(me?.id)){
      orbitToast("New message",(m.username||"Your friend")+": "+String(m.content||"").slice(0,90),"success");
    }
    if(orbitUI.view==="dms")renderDMList();
    if(orbitUI.view==="home")document.querySelectorAll("[data-od-dm]").forEach(btn=>btn.classList.toggle("active",String(btn.dataset.odDm)===String(m.dm_id)));
  });
  socket.on("dm:read",event=>{
    if(!event||String(event.dmId)!==String(dmState.activeId))return;
    dmState.messages.forEach(m=>{if(String(m.user_id)===String(me?.id)&&String(event.readerId)!==String(me?.id))m.seen_at=event.readAt});
    renderDMMessageFeed(false);
    renderHomeDirectMessageFeed(false);
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
async function uploadFileToCurrentChannel(file){
  if(!file||!socket||!currentChannel||currentChannel.type==="voice") return;
  const max=4_500_000;
  if(file.size>max){orbitToast("File too large","Orbit allows files up to 4.5 MB in this build.","error");playUiTone("error");return;}
  const overlay=$("#upload-overlay"),name=$("#upload-file-name"),bar=$("#upload-progress-bar"),percent=$("#upload-progress-value");
  overlay?.classList.remove("hidden");
  if(name)name.textContent=file.name;
  if(bar)bar.style.width="4%";
  if(percent)percent.textContent="Reading…";
  try{
    const fr=new FileReader();
    const data=await new Promise((resolve,reject)=>{
      fr.onprogress=e=>{if(e.lengthComputable){const p=Math.round((e.loaded/e.total)*70);if(bar)bar.style.width=p+"%";if(percent)percent.textContent=p+"%";}};
      fr.onload=()=>resolve(String(fr.result)); fr.onerror=()=>reject(new Error("Could not read this file."));
      fr.readAsDataURL(file);
    });
    if(percent)percent.textContent="Uploading…";
    if(bar)bar.style.width="76%";
    const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type||"application/octet-stream",size:file.size,data,purpose:"workspace-file"})});
    if(bar)bar.style.width="100%";
    if(percent)percent.textContent="Sent";
    socket.emit("message:send",{channelId:currentChannel.id,content:"📎 "+file.name,attachment:up.file});
    playUiTone("upload");
    orbitToast("File sent",file.name,"success");
  }catch(e){
    playUiTone("error");
    orbitToast("Upload failed",e.message,"error");
  }finally{
    setTimeout(()=>overlay?.classList.add("hidden"),550);
  }
}
const fileInput=document.createElement("input");
fileInput.type="file";
fileInput.id="orbit-file-picker";
fileInput.multiple=true;
fileInput.accept="image/*,video/*,audio/*,.pdf,.zip,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx";
fileInput.hidden=true;
document.body.appendChild(fileInput);
fileInput.onchange=async()=>{for(const file of Array.from(fileInput.files||[])) await uploadFileToCurrentChannel(file);fileInput.value="";};
$("#attach")?.addEventListener("click",()=>fileInput.click());

function showDropOverlay(show){
  $("#drop-overlay")?.classList.toggle("hidden",!show);
}
let dragDepth=0;
["dragenter","dragover"].forEach(type=>$("#chat-view")?.addEventListener(type,e=>{if(!currentChannel||currentChannel.type==="voice")return;e.preventDefault();e.stopPropagation();dragDepth++;showDropOverlay(true)}));
$("#chat-view")?.addEventListener("dragleave",e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)showDropOverlay(false)});
$("#chat-view")?.addEventListener("drop",async e=>{
  e.preventDefault();e.stopPropagation();dragDepth=0;showDropOverlay(false);
  if(!currentChannel||currentChannel.type==="voice")return;
  for(const file of Array.from(e.dataTransfer?.files||[])) await uploadFileToCurrentChannel(file);
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
  
});

// Boot premium nav after DOM is parsed, then launch guest session.
applySavedOrbitBackground();
bindPremiumNavigation();
wireEnhancedControls();
updateVoiceDock();

applyAccentTheme(localStorage.getItem("orbit_theme")||"purple");
if(localStorage.getItem("orbit_video_quality")) callState.settings.quality=localStorage.getItem("orbit_video_quality");
applySavedOrbitBackground();
syncScreenShareControls();
closeServerSidebar();

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


/* Hard hide the standalone Messages navigation button.
   Direct Messages remain available as people in the Home sidebar. */
(function hideStandaloneMessagesNav(){
  function hide(){
    document.querySelectorAll('[data-od-social="dms"], [data-dm-nav="messages"], [data-view="dms"]').forEach(el=>el.remove());
  }
  hide();
  new MutationObserver(hide).observe(document.body,{subtree:true,childList:true});
})();


/* Root DM compatibility bridge: every legacy conversation row opens in Home. */
(function bridgeLegacyConversationClicks(){
  window.openDMFromAnywhere=async function(id){
    if(!id)return;
    try{
      const onHome=orbitUI.view==="home" && $("#od-home-main");
      orbitUI.view="home";
      document.body.classList.add("orbit-discord-home");
      $("#global-page")?.classList.add("discord-home-active");
      $("#global-page")?.classList.remove("hidden");
      $("#chat-view")?.classList.add("hidden");

      if(!onHome) renderHomePage();

      if(!dmState.list.length){
        const d=await api("/api/dms");
        dmState.list=d.dms||[];
      }
      const exists=dmState.list.some(x=>String(x.id)===String(id));
      if(!exists)return orbitToast("Direct message","Conversation not found.","error");

      await openHomeDirectMessage(id);
    }catch(err){
      console.error("openDMFromAnywhere failed",err);
      orbitToast("Direct message",err.message||"Could not open chat.","error");
    }
  };

  document.addEventListener("click",e=>{
    const row=e.target.closest(".dm-conversation,[data-dm-open]");
    if(!row)return;
    const id=row.dataset.dmOpen;
    if(!id)return;
    e.preventDefault();
    e.stopPropagation();
    window.openDMFromAnywhere(id);
  },true);
})();
 
/* Never allow the legacy standalone Messages screen/nav to remain active. */
(function enforceHomeDmMode(){
  function scrub(){
    document.querySelectorAll('[data-view="dms"],[data-od-social="dms"],[data-dm-nav="messages"]').forEach(el=>el.remove());
    if(window.orbitUI && orbitUI.view==="dms") setView("home");
  }
  scrub();
  new MutationObserver(scrub).observe(document.body,{subtree:true,childList:true});
})();
