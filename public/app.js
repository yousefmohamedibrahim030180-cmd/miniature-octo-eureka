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

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function avatar(name) {
  return (name || "G").slice(0, 1).toUpperCase();
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
function closeModal() {
  $("#modal").classList.add("hidden");
}
function showError(message) {
  console.error(message);
  openModal("Something went wrong", `<p style="color:#ff8585">${escapeHtml(message)}</p>`);
}

async function enterAsGuest() {
  const data = await api("/api/guest", {
    method: "POST",
    body: JSON.stringify({
      guestId: guestId || undefined,
      username: guestName || undefined
    })
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
  socket = io({
    auth: { token },
    transports: ["websocket", "polling"]
  });
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
  socket.on("connect_error", () => {});
}

async function loadServers() {
  const data = await api("/api/servers");
  servers = data.servers;
  renderServers();
  if (!currentServer || !servers.some(s => String(s.id) === String(currentServer.id))) {
    currentServer = servers[0] || null;
  }
  if (currentServer) await selectServer(currentServer);
}

function renderServers() {
  $("#server-list").innerHTML = servers.map(s =>
    `<button class="server-item ${String(currentServer?.id) === String(s.id) ? "active" : ""}" data-id="${s.id}" title="${escapeHtml(s.name)}">${escapeHtml(s.name.slice(0,2).toUpperCase())}</button>`
  ).join("");
  document.querySelectorAll(".server-item").forEach(btn => {
    btn.onclick = () => selectServer(servers.find(s => String(s.id) === btn.dataset.id));
  });
}

async function selectServer(serverItem) {
  currentServer = serverItem;
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
    `<button class="channel ${String(currentChannel?.id) === String(c.id) ? "active" : ""}" data-id="${c.id}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span></button>`
  ).join("");
  document.querySelectorAll(".channel").forEach(btn => {
    btn.onclick = () => selectChannel(channels.find(c => String(c.id) === btn.dataset.id));
  });
}

async function selectChannel(channel) {
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
  el.innerHTML = `
    <div class="avatar">${escapeHtml(avatar(m.username))}</div>
    <div>
      <div class="msg-head"><strong>${escapeHtml(m.username)}</strong><time>${fmt(m.created_at)}</time></div>
      <div class="msg-body">${escapeHtml(m.content)}</div>
    </div>`;
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
  `<input id="guest-name-input" value="${escapeHtml(me?.username || "")}" maxlength="24"><button class="primary" id="save-guest-name">Save name</button>`
);

$("#modal-close").onclick = closeModal;
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

document.addEventListener("click", async e => {
  try {
    if (e.target.id === "create-server") {
      const data = await api("/api/servers", {
        method: "POST",
        body: JSON.stringify({ name: $("#server-name").value })
      });
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
      const data = await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ username: value })
      });
      me = data.user;
      guestName = me.username;
      saveGuest();
      $("#me-name").textContent = me.username;
      $("#me-avatar").textContent = avatar(me.username);
      closeModal();
      return;
    }

    if (e.target.id === "invite-btn" && currentServer) {
      const data = await api("/api/servers/" + currentServer.id + "/invites", {
        method: "POST",
        body: "{}"
      });
      openModal(
        "Invite link",
        `<input value="${location.origin}/?invite=${encodeURIComponent(data.invite.code)}" readonly><p style="color:#8b93a3;font-size:12px">Share this link with guests. Valid for 7 days.</p>`
      );
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
      openModal(
        "Control center",
        `<div class="control-grid">
          <div class="control-row"><strong>Server</strong><span>${escapeHtml(currentServer.name)}</span></div>
          <div class="control-row"><strong>Access</strong><span>No account required — guest sessions only</span></div>
          <div class="control-row"><strong>Roles</strong><span>Owner · Admin · Moderator · Member</span></div>
          <div class="control-row"><strong>Realtime</strong><span>Socket.IO · typing · presence · live messages</span></div>
          <div class="control-row"><strong>Storage</strong><span>Live memory mode until PostgreSQL is connected</span></div>
        </div>`
      );
      return;
    }
  } catch (err) {
    showError(err.message);
  }
});

async function loadMembers() {
  if (!currentServer) return;
  const data = await api("/api/servers/" + currentServer.id + "/members");
  $("#member-list").innerHTML = data.members.map(m =>
    `<div class="member" data-user="${m.id}">
      <div class="avatar">${escapeHtml(avatar(m.username))}</div>
      <div class="member-info"><strong>${escapeHtml(m.username)}</strong><span class="presence">${m.status} · ${m.role}</span></div>
    </div>`
  ).join("");
}

(async () => {
  try {
    await enterAsGuest();
    const invite = new URLSearchParams(location.search).get("invite");
    if (invite) {
      await api("/api/invites/" + encodeURIComponent(invite) + "/accept", {
        method: "POST",
        body: "{}"
      }).catch(() => {});
      await loadServers();
    }
  } catch (err) {
    showError(err.message);
  }
})();