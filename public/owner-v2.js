const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let ownerToken = sessionStorage.getItem("orbit_owner_v2_token") || "";
let data = null;
let view = "overview";
let drawerUserId = null;

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function toast(message, bad) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.className = "toast-show" + (bad ? " toast-bad" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.className = ""; }, 2600);
}

async function api(url, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  if (ownerToken) headers["X-Owner-Token"] = ownerToken;
  if (opts.body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, Object.assign({}, opts, {
    credentials: "same-origin",
    headers
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || ("Request failed (" + response.status + ")"));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showGate(message) {
  $("#gate").classList.remove("hidden");
  $("#app").classList.add("hidden");
  $("#gateError").textContent = message || "";
}

function showApp() {
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

async function authenticate(key) {
  const result = await api("/api/owner/auth", {
    method: "POST",
    body: JSON.stringify({ key: String(key || "").trim() })
  });
  if (!result.token) throw new Error("Owner login returned no session token.");
  ownerToken = result.token;
  sessionStorage.setItem("orbit_owner_v2_token", ownerToken);
  await loadDashboard();
}

async function loadDashboard() {
  try {
    const dashboard = await api("/api/owner/dashboard");
    const shop = await api("/api/owner/shop");
    data = dashboard;
    data._items = shop.items || [];
    showApp();
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("#statusText").textContent = "LIVE · " + time;
    render();
  } catch (error) {
    if (error.status === 401) {
      ownerToken = "";
      sessionStorage.removeItem("orbit_owner_v2_token");
      showGate("Owner session expired. Enter the owner key again.");
    } else {
      showApp();
      toast(error.message || "Could not load owner dashboard.", true);
    }
  }
}

function metric(value, label, note) {
  return '<div class="metric"><b>' + esc(Number(value).toLocaleString()) +
    '</b><span>' + esc(label) + '</span><small>' + esc(note || "") + "</small></div>";
}

function header(kicker, title, copy, action) {
  return '<div class="page-head"><div><span class="eyebrow">' + esc(kicker) +
    "</span><h1>" + esc(title) + "</h1><p>" + esc(copy) +
    '</p></div><div class="actions">' + (action || "") + "</div></div>";
}

function render() {
  $$(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  $$(".view").forEach((section) => {
    section.classList.toggle("active", section.id === "view-" + view);
  });
  if (!data) return;
  if (view === "overview") renderOverview();
  if (view === "users") renderUsers();
  if (view === "economy") renderEconomy();
  if (view === "servers") renderServers();
  if (view === "content") renderContent();
  if (view === "live") renderLive();
  if (view === "audit") renderAudit();
}

function renderOverview() {
  const s = data.stats;
  const coins = (data.users || []).reduce((sum, user) => sum + Number(user.coins || 0), 0);
  $("#view-overview").innerHTML =
    header("PLATFORM PULSE", "Everything under your control",
      "Live visibility across users, communities, economy, content and realtime activity.",
      '<button class="btn primary" id="overviewRefresh">↻ Refresh</button>') +
    '<div class="metrics">' +
      metric(s.users, "Users", s.online + " online") +
      metric(s.suspended, "Banned", "Platform accounts") +
      metric(s.servers, "Servers", s.channels + " channels") +
      metric(s.messages, "Messages", s.dmMessages + " direct") +
      metric(coins, "Total coins", "Visible balances") +
      metric(s.activeCalls, "Live calls", s.callParticipants + " participants") +
    '</div>' +
    '<div class="grid">' +
      '<div class="card hero-card"><h3>OWNER STATUS</h3>' +
        '<div class="stat-row"><span>Persistence</span><b>' + esc(s.persistence) + "</b></div>" +
        '<div class="stat-row"><span>Uptime</span><b>' + Math.floor(s.uptime / 3600) + "h " + Math.floor((s.uptime % 3600) / 60) + "m</b></div>" +
        '<div class="stat-row"><span>Audit events</span><b>' + Number(s.auditEvents || 0).toLocaleString() + "</b></div>" +
        '<div class="stat-row"><span>Owner session</span><b>@' + esc(data.me.username || "owner") + "</b></div>" +
      '</div>' +
      '<div class="card"><h3>LIVE RIGHT NOW</h3>' +
        ((data.calls || []).length
          ? data.calls.map((call) => '<div class="stat-row"><span>#' + esc(call.channelName || "call") +
              '</span><b class="live">' + call.participants.length + " live</b></div>").join("")
          : '<div class="empty">No active calls.</div>') +
      "</div>" +
    '</div>' +
    '<div class="grid grid3"><div class="card"><h3>FAST ACTIONS</h3><div class="actions">' +
      '<button class="btn" data-go="users">Manage users</button>' +
      '<button class="btn" data-go="economy">Open economy</button>' +
      '<button class="btn" data-go="servers">Manage servers</button>' +
    '</div></div><div class="card"><h3>SECURITY</h3><p class="muted">' +
      'Owner sessions expire automatically. Destructive owner actions are audit logged.' +
    "</p></div></div>";
  $("#overviewRefresh").onclick = loadDashboard;
}

function renderUsers() {
  $("#view-users").innerHTML =
    header("ACCOUNT CONTROL", "Users",
      "Search every account, inspect history, grant rewards, manage cosmetics and ban access.",
      '<button class="btn primary" id="usersRefresh">↻ Refresh</button>') +
    '<div class="toolbar"><input id="userSearch" class="search-input" placeholder="Search username, id or display name">' +
    '<select id="userFilter" class="select"><option value="all">All users</option><option value="online">Online</option><option value="banned">Banned</option></select></div>' +
    '<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Status</th><th>Coins</th><th>Level</th><th>Servers</th><th>Messages</th><th></th></tr></thead><tbody id="usersBody"></tbody></table></div>';

  const paint = () => {
    const query = String($("#userSearch").value || "").toLowerCase();
    const filter = $("#userFilter").value;
    const rows = (data.users || []).filter((user) => {
      const match = !query ||
        String(user.username || "").toLowerCase().includes(query) ||
        String(user.id || "").toLowerCase().includes(query) ||
        String(user.displayName || "").toLowerCase().includes(query);
      const status = filter === "all" ||
        (filter === "online" && user.status === "online") ||
        (filter === "banned" && user.suspended);
      return match && status;
    });

    $("#usersBody").innerHTML = rows.length ? rows.map((user) =>
      '<tr><td><div class="user-cell"><div class="user-avatar">' +
      esc(String(user.username || "O").charAt(0).toUpperCase()) +
      '</div><div class="user-copy"><b>' + esc(user.displayName || user.username) +
      '</b><small>@' + esc(user.username) + " · " + esc(user.id) +
      "</small></div></div></td><td><span class=\"badge " +
      (user.suspended ? "bad" : "good") + '">' +
      (user.suspended ? "BANNED" : esc(user.status || "offline")) +
      "</span></td><td>" + Number(user.coins || 0).toLocaleString() +
      "</td><td>L" + Number(user.level || 1) +
      "</td><td>" + Number(user.serverCount || 0) +
      "</td><td>" + Number(user.totalMessages || 0) +
      '</td><td><button class="btn" data-open-user="' + esc(user.id) + '">Open</button></td></tr>'
    ).join("") : '<tr><td colspan="7"><div class="empty">No users match.</div></td></tr>';
  };

  $("#userSearch").oninput = paint;
  $("#userFilter").onchange = paint;
  $("#usersRefresh").onclick = loadDashboard;
  paint();
}

function renderEconomy() {
  const users = (data.users || []).slice().sort((a, b) => Number(b.coins || 0) - Number(a.coins || 0));
  const items = data._items || [];
  $("#view-economy").innerHTML =
    header("ECONOMY CONTROL", "Coins & cosmetics",
      "Give currency and cosmetics directly from a central platform inventory.",
      '<button class="btn primary" id="ecoRefresh">↻ Refresh</button>') +
    '<div class="grid"><div class="card"><h3>TOP BALANCES</h3>' +
      (users.slice(0, 20).map((user) =>
        '<div class="table-row"><span>@' + esc(user.username) +
        "</span><b>✦ " + Number(user.coins || 0).toLocaleString() + "</b></div>"
      ).join("") || '<div class="empty">No users.</div>') +
    '</div><div class="card"><h3>ECONOMY NOTES</h3><p class="muted">' +
      "Owner grants are immediate. Negative coin adjustments cannot go below zero. Cosmetics bypass shop pricing." +
    '</p><div class="actions"><button class="btn" data-go="users">Choose a user</button></div></div></div>' +
    '<div class="card" style="margin-top:12px"><h3>AVAILABLE COSMETICS</h3><div class="card-grid">' +
      (items.map((item) =>
        '<div class="item-card"><span class="item-tag">' + esc(item.rarity) +
        "</span><b>" + esc(item.name) + "</b><small>" + esc(item.type) +
        " · " + esc(item.css) + " · price " + Number(item.price || 0).toLocaleString() +
        '</small><button class="btn" data-go="users">Grant from user drawer</button></div>'
      ).join("") || '<div class="empty">No cosmetics.</div>') +
    "</div></div>";
  $("#ecoRefresh").onclick = loadDashboard;
}

function renderServers() {
  const servers = data.servers || [];
  $("#view-servers").innerHTML =
    header("WORLD CONTROL", "Servers",
      "Every ORBIT community, owner and member count.",
      '<button class="btn primary" id="srvRefresh">↻ Refresh</button>') +
    '<div class="card-grid">' +
      servers.map((server) =>
        '<div class="item-card server-card"><div class="server-top"><div><b>' +
        esc(server.name) + "</b><small>" + esc(server.id) +
        '</small></div><span class="badge">' + Number(server.memberCount || 0) +
        " members</span></div><div class=\"server-meta\"><span class=\"badge\">" +
        esc(server.verificationLevel || "standard") + "</span><span class=\"badge\">Owner: @" +
        esc(server.owner && server.owner.username ? server.owner.username : "unknown") +
        "</span></div><p class=\"muted\">" + esc(server.description || "No description.") +
        "</p></div>"
      ).join("") +
    '</div><div class="empty" style="' + (servers.length ? "display:none" : "") + '">No servers found.</div>';
  $("#srvRefresh").onclick = loadDashboard;
}

async function renderContent() {
  let result;
  try {
    result = await api("/api/owner/content?limit=250");
  } catch (error) {
    toast(error.message, true);
    return;
  }
  const messages = result.messages || [];
  $("#view-content").innerHTML =
    header("CONTENT CONTROL", "Platform content",
      "Recent messages from channels and direct conversations. Remove content directly.",
      '<button class="btn primary" id="contentRefresh">↻ Refresh</button>') +
    '<div class="toolbar"><input id="contentSearch" class="search-input" placeholder="Search message text, username or channel"></div>' +
    '<div class="list" id="contentList"></div>';

  const paint = () => {
    const query = String($("#contentSearch").value || "").toLowerCase();
    const filtered = messages.filter((message) =>
      !query ||
      String(message.content || "").toLowerCase().includes(query) ||
      String(message.username || "").toLowerCase().includes(query) ||
      String(message.channelName || "").toLowerCase().includes(query)
    );
    $("#contentList").innerHTML = filtered.length ? filtered.map((message) =>
      '<div class="message-block"><header><b>' + esc(message.username || "Guest") +
      "</b><span>" + fmt(message.created_at) + "</span><span>#"
      + esc(message.channelName || message.kind || "content") +
      '</span><button class="btn danger" style="margin-left:auto" data-delete-content="' +
      esc(message.id) + '">Delete</button></header><p>' +
      esc(message.content || "") + '</p><small class="muted">' +
      esc(message.id) + " · " + esc(message.kind) + "</small></div>"
    ).join("") : '<div class="empty">No matching content.</div>';
  };

  $("#contentSearch").oninput = paint;
  $("#contentRefresh").onclick = renderContent;
  paint();
}

function renderLive() {
  const calls = data.calls || [];
  $("#view-live").innerHTML =
    header("REALTIME NETWORK", "Live calls",
      "Current voice/video rooms and their participants.",
      '<button class="btn primary" id="liveRefresh">↻ Refresh</button>') +
    '<div class="list">' +
      (calls.length ? calls.map((call) =>
        '<div class="call-card"><div class="call-head"><div><b>#' +
        esc(call.channelName || "call") +
        '</b><small class="muted" style="display:block;margin-top:4px">' +
        esc(call.serverId || "DM / realtime") + " · " +
        esc(call.conversationId || "") +
        '</small></div><span class="live">● ' + call.participants.length +
        " LIVE</span></div><div class=\"table-row\">" +
        call.participants.map((person) =>
          "<span>@" + esc(person.user && person.user.username ? person.user.username : "unknown") + "</span>"
        ).join(" · ") + "</div></div>"
      ).join("") : '<div class="empty">No active calls.</div>') +
    "</div>";
  $("#liveRefresh").onclick = loadDashboard;
}

function renderAudit() {
  const audit = data.audit || [];
  $("#view-audit").innerHTML =
    header("SECURITY TRAIL", "Owner audit",
      "Every platform-owner action is recorded with a timestamp and target.",
      '<button class="btn primary" id="auditRefresh">↻ Refresh</button>') +
    '<div class="list">' +
      (audit.length ? audit.map((item) =>
        '<div class="audit-row"><div><strong>' + esc(item.action) +
        "</strong><span>" + fmt(item.created_at) +
        " · target " + esc(item.target || "system") +
        '</span></div><code>' + esc(JSON.stringify(item.details || {})) +
        "</code></div>"
      ).join("") : '<div class="empty">No audit events.</div>') +
    "</div>";
  $("#auditRefresh").onclick = loadDashboard;
}

async function openUser(userId) {
  try {
    const result = await api("/api/owner/users/" + encodeURIComponent(userId));
    drawerUserId = result.user.id;
    $("#drawerTitle").textContent = "@" + result.user.username;
    $("#drawerMeta").textContent = result.user.id + " · " + (result.user.suspended ? "BANNED" : "ACTIVE");
    $("#drawerBody").innerHTML = userDrawer(result);
    $("#drawer").classList.remove("hidden");
  } catch (error) {
    toast(error.message, true);
  }
}

function userDrawer(result) {
  const user = result.user;
  const inventory = result.inventory || [];
  const items = result.allItems || [];
  const owned = new Set(inventory.map((item) => item.id));

  return '<div class="profile-banner"><div class="profile-avatar">' +
    esc(String(user.username || "O").charAt(0).toUpperCase()) +
    '</div><div><b>' + esc(user.displayName || user.username) +
    '</b><span>@' + esc(user.username) + " · " + esc(user.status || "offline") +
    '</span><span>✦ ' + Number(user.coins || 0).toLocaleString() +
    " · L" + Number(user.level || 1) + " · XP " + Number(user.xp || 0) +
    '</span></div></div>' +

    '<div class="drawer-section"><h3>OWNER ACTIONS</h3><div class="owner-actions">' +

    '<div class="command"><strong>Coins</strong><small>Add or remove ORBIT Coins.</small><div class="inline">' +
    '<input id="coinAmount" class="money-input" type="number" placeholder="+500">' +
    '<button class="btn primary" data-coins="' + esc(user.id) + '">Apply</button></div></div>' +

    '<div class="command"><strong>XP</strong><small>Directly adjust experience points.</small><div class="inline">' +
    '<input id="xpAmount" class="money-input" type="number" placeholder="+100">' +
    '<button class="btn" data-xp="' + esc(user.id) + '">Apply</button></div></div>' +

    '<div class="command"><strong>Give cosmetic</strong><small>Grant any frame, effect, nameplate or theme for free.</small><div class="inline">' +
    '<select id="grantItem" class="select small">' +
    items.map((item) => '<option value="' + esc(item.id) + '">' + esc(item.name) + " · " +
      esc(item.type) + (owned.has(item.id) ? " · owned" : "") + "</option>").join("") +
    '</select><button class="btn gold" data-grant="' + esc(user.id) + '">Give</button></div>' +
    '<label style="display:block;margin-top:7px;color:var(--muted);font-size:8px"><input id="equipNow" type="checkbox"> Equip immediately</label></div>' +

    '<div class="command"><strong>Revoke cosmetic</strong><small>Remove a non-core owned item.</small><div class="inline">' +
    '<select id="revokeItem" class="select small">' +
    inventory.filter((item) => Number(item.price) !== 0).map((item) =>
      '<option value="' + esc(item.id) + '">' + esc(item.name) + "</option>"
    ).join("") +
    '</select><button class="btn danger" data-revoke="' + esc(user.id) + '">Revoke</button></div></div>' +

    '<div class="command"><strong>Ban / Unban</strong><small>Permanent or timed platform ban. Active sockets are disconnected.</small><div class="inline">' +
    '<select id="banDuration" class="select small"><option value="0">Permanent</option><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option></select>' +
    (user.suspended
      ? '<button class="btn green" data-unban="' + esc(user.id) + '">Unban</button>'
      : '<button class="btn danger" data-ban="' + esc(user.id) + '">Ban</button>') +
    '</div></div>' +

    '<div class="command"><strong>Force sign-out</strong><small>Invalidate all active sessions.</small>' +
    '<button class="btn" data-logout-user="' + esc(user.id) + '">Sign out everywhere</button></div>' +

    '</div></div>' +

    '<div class="drawer-section"><h3>INVENTORY · ' + inventory.length + '</h3><div class="list">' +
    (inventory.length ? inventory.map((item) =>
      '<div class="list-row"><span>' + esc(item.name) + " · " + esc(item.type) +
      "</span><b>" + esc(item.rarity) + "</b></div>"
    ).join("") : '<div class="empty">No cosmetics owned.</div>') +
    "</div></div>" +

    '<div class="drawer-section"><h3>SERVERS · ' + result.servers.length + '</h3><div class="list">' +
    (result.servers.length ? result.servers.map((server) =>
      '<div class="list-row"><span>' + esc(server.name) +
      "</span><b>" + esc(server.role) + "</b></div>"
    ).join("") : '<div class="empty">No servers.</div>') +
    "</div></div>" +

    '<div class="drawer-section"><h3>MESSAGES · ' + result.messages.length + '</h3><div class="list">' +
    (result.messages.length ? result.messages.slice(0, 80).map((message) =>
      '<div class="message-block"><header><b>' + esc(message.username || user.username) +
      "</b><span>" + fmt(message.created_at) +
      '</span><button class="btn danger" style="margin-left:auto" data-delete-user-message="' +
      esc(message.id) + '">Delete</button></header><p>' + esc(message.content || "") +
      "</p></div>"
    ).join("") : '<div class="empty">No messages.</div>') +
    "</div></div>" +

    '<div class="drawer-section"><h3>DIRECT CONVERSATIONS · ' + result.dms.length + '</h3><div class="list">' +
    (result.dms.length ? result.dms.map((dm) =>
      '<div class="list-row"><span>' +
      dm.members.map((member) => "@" + esc(member.username)).join(" · ") +
      "</span><b>" + dm.messages.length + " messages</b></div>"
    ).join("") : '<div class="empty">No DMs.</div>') +
    "</div></div>" +

    '<div class="drawer-section"><h3>SESSIONS</h3><div class="list">' +
    ((result.sessions || []).length ? result.sessions.map((session) =>
      '<div class="list-row"><span>Created ' + fmt(session.createdAt) +
      "</span><b>Expires " + fmt(session.expiresAt) + "</b></div>"
    ).join("") : '<div class="empty">No active sessions.</div>') +
    "</div></div>";
}

async function ownerAction(url, body, success, reopenUserId) {
  try {
    await api(url, {
      method: "POST",
      body: JSON.stringify(body || {})
    });
    toast(success);
    await loadDashboard();
    if (reopenUserId) await openUser(reopenUserId);
  } catch (error) {
    toast(error.message, true);
  }
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    view = nav.dataset.view;
    render();
    return;
  }

  const go = event.target.closest("[data-go]");
  if (go) {
    view = go.dataset.go;
    render();
    return;
  }

  const open = event.target.closest("[data-open-user]");
  if (open) {
    await openUser(open.dataset.openUser);
    return;
  }

  if (event.target.closest("[data-close-drawer]")) {
    $("#drawer").classList.add("hidden");
    return;
  }

  const coin = event.target.closest("[data-coins]");
  if (coin) {
    const amount = Number($("#coinAmount").value || 0);
    if (!Number.isFinite(amount) || amount === 0) {
      toast("Enter a non-zero amount.", true);
      return;
    }
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(coin.dataset.coins) + "/grant-coins",
      { amount: amount, reason: "Owner command" },
      "Coin balance updated",
      coin.dataset.coins
    );
    return;
  }

  const xp = event.target.closest("[data-xp]");
  if (xp) {
    const amount = Number($("#xpAmount").value || 0);
    if (!Number.isFinite(amount) || amount === 0) {
      toast("Enter a non-zero XP amount.", true);
      return;
    }
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(xp.dataset.xp) + "/grant-xp",
      { amount: amount },
      "XP updated",
      xp.dataset.xp
    );
    return;
  }

  const grant = event.target.closest("[data-grant]");
  if (grant) {
    const itemId = $("#grantItem").value;
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(grant.dataset.grant) + "/grant-item",
      { itemId: itemId, equip: Boolean($("#equipNow").checked) },
      "Cosmetic granted",
      grant.dataset.grant
    );
    return;
  }

  const revoke = event.target.closest("[data-revoke]");
  if (revoke) {
    const select = $("#revokeItem");
    if (!select || !select.value) {
      toast("No revocable item selected.", true);
      return;
    }
    if (!window.confirm("Revoke this cosmetic?")) return;
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(revoke.dataset.revoke) + "/revoke-item",
      { itemId: select.value },
      "Cosmetic revoked",
      revoke.dataset.revoke
    );
    return;
  }

  const ban = event.target.closest("[data-ban]");
  if (ban) {
    if (String(ban.dataset.ban) === String(data.me.id)) {
      toast("You cannot ban the owner account.", true);
      return;
    }
    const duration = Number($("#banDuration").value || 0);
    const reason = window.prompt("Ban reason:", "Platform owner action");
    if (reason === null) return;
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(ban.dataset.ban) + "/suspend",
      { durationMinutes: duration, reason: reason },
      "Account banned",
      ban.dataset.ban
    );
    return;
  }

  const unban = event.target.closest("[data-unban]");
  if (unban) {
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(unban.dataset.unban) + "/unsuspend",
      {},
      "Account unbanned",
      unban.dataset.unban
    );
    return;
  }

  const logout = event.target.closest("[data-logout-user]");
  if (logout) {
    if (!window.confirm("Sign this user out of every active session?")) return;
    await ownerAction(
      "/api/owner/users/" + encodeURIComponent(logout.dataset.logoutUser) + "/logout",
      {},
      "Sessions revoked",
      logout.dataset.logoutUser
    );
    return;
  }

  const deleteUserMessage = event.target.closest("[data-delete-user-message]");
  if (deleteUserMessage) {
    if (!window.confirm("Delete this message permanently?")) return;
    await ownerAction(
      "/api/owner/messages/delete",
      { messageId: deleteUserMessage.dataset.deleteUserMessage },
      "Message deleted",
      drawerUserId
    );
    return;
  }

  const deleteContent = event.target.closest("[data-delete-content]");
  if (deleteContent) {
    if (!window.confirm("Delete this message permanently?")) return;
    await ownerAction(
      "/api/owner/messages/delete",
      { messageId: deleteContent.dataset.deleteContent },
      "Message deleted"
    );
    return;
  }

  if (event.target.id === "refreshBtn") {
    await loadDashboard();
    return;
  }

  if (event.target.id === "lockBtn") {
    sessionStorage.removeItem("orbit_owner_v2_token");
    ownerToken = "";
    showGate("Owner console locked.");
    return;
  }

  if (event.target.id === "backBtn") {
    window.location.href = "/";
  }
});

$$(".nav-btn").forEach((button) => {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    render();
  });
});

$("#gateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#ownerKey");
  const button = $("#gateForm button[type=submit]");
  const error = $("#gateError");
  const key = String(input.value || "").trim();
  error.textContent = "";

  if (!key) {
    error.textContent = "Enter the owner key.";
    return;
  }

  button.disabled = true;
  button.textContent = "Unlocking…";
  try {
    await authenticate(key);
    input.value = "";
  } catch (err) {
    error.textContent = err.message || "Could not unlock owner mode.";
  } finally {
    button.disabled = false;
    button.textContent = "Unlock command center ↗";
  }
});

async function boot() {
  if (!ownerToken) {
    showGate("Enter the owner key to unlock command center.");
    return;
  }
  await loadDashboard();
}

boot();