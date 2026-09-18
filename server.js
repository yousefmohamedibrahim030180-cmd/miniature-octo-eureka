const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"]
});

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "orbit-guest-dev-secret";

const memory = {
  users: new Map(),
  servers: new Map(),
  channels: new Map(),
  messages: new Map(),
  invites: new Map()
};

const CALL_EVENT_PREFIX = "call:";
const callRoomFor = channelId => CALL_EVENT_PREFIX + String(channelId);

function now() { return new Date().toISOString(); }
function id(prefix) { return prefix + "_" + crypto.randomUUID(); }
function cleanName(value, fallback = "Guest") {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return name || fallback;
}
function tokenFor(user) {
  return jwt.sign(
    { id: user.id, username: user.username, guest: true },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}
function readToken(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}
function auth(req, res, next) {
  try {
    const payload = jwt.verify(readToken(req), JWT_SECRET);
    const user = memory.users.get(payload.id);
    if (!user) return res.status(401).json({ error: "Guest session expired" });
    user.status = "online";
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Guest session expired" });
  }
}
function ensureDefaultServer(user) {
  if (!memory.servers.size) {
    const serverId = id("server");
    const channelId = id("channel");
    const lobby = {
      id: serverId,
      name: "Orbit Lobby",
      ownerId: user.id,
      createdAt: now(),
      members: new Map([[user.id, "owner"]]),
      channels: [channelId]
    };
    memory.servers.set(serverId, lobby);
    memory.channels.set(channelId, {
      id: channelId,
      serverId,
      name: "general",
      type: "text",
      position: 0
    });
    memory.messages.set(channelId, []);
  } else {
    for (const s of memory.servers.values()) {
      if (!s.members.has(user.id) && s.name === "Orbit Lobby") {
        s.members.set(user.id, "member");
      }
    }
  }
}
function member(serverId, userId) {
  const s = memory.servers.get(String(serverId));
  if (!s) return null;
  const role = s.members.get(String(userId));
  return role ? { role, server: s } : null;
}
function canManage(role) {
  return ["owner", "admin", "moderator"].includes(role);
}
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    avatar_url: null,
    status: user.status || "online",
    guest: true
  };
}
function createGuest(username, existingId) {
  const userId = existingId && memory.users.has(existingId) ? existingId : id("guest");
  const user = memory.users.get(userId) || {
    id: userId,
    username: cleanName(username, "Guest-" + Math.random().toString(36).slice(2, 6).toUpperCase()),
    status: "online",
    createdAt: now()
  };
  user.username = cleanName(username, user.username);
  user.status = "online";
  memory.users.set(user.id, user);
  ensureDefaultServer(user);
  return user;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "orbit-chat",
    mode: "guest-memory",
    db: false,
    users: memory.users.size,
    servers: memory.servers.size,
    calls: [...io.sockets.adapter.rooms.keys()].filter(k => k.startsWith(CALL_EVENT_PREFIX)).length,
    time: now()
  });
});

app.post("/api/guest", (req, res) => {
  const user = createGuest(req.body?.username, req.body?.guestId);
  res.json({ user: publicUser(user), token: tokenFor(user) });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/me", auth, (req, res) => {
  req.user.username = cleanName(req.body?.username, req.user.username);
  res.json({ user: publicUser(req.user) });
});

app.get("/api/servers", auth, (req, res) => {
  const servers = [];
  for (const s of memory.servers.values()) {
    const role = s.members.get(req.user.id);
    if (role) {
      servers.push({
        id: s.id,
        name: s.name,
        owner_id: s.ownerId,
        role,
        default_channel_id: s.channels[0] || null
      });
    }
  }
  res.json({ servers });
});

app.post("/api/servers", auth, (req, res) => {
  const name = cleanName(req.body?.name, "").slice(0, 50);
  if (!name) return res.status(400).json({ error: "Server name is required" });

  const serverId = id("server");
  const channelId = id("channel");
  const s = {
    id: serverId,
    name,
    ownerId: req.user.id,
    createdAt: now(),
    members: new Map([[req.user.id, "owner"]]),
    channels: [channelId]
  };
  memory.servers.set(serverId, s);
  memory.channels.set(channelId, {
    id: channelId,
    serverId,
    name: "general",
    type: "text",
    position: 0
  });
  memory.messages.set(channelId, []);

  res.status(201).json({
    server: {
      id: s.id,
      name: s.name,
      owner_id: s.ownerId,
      role: "owner",
      default_channel_id: channelId
    },
    channel: memory.channels.get(channelId)
  });
});

app.get("/api/servers/:id/channels", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access) return res.status(403).json({ error: "Not a member" });
  const channels = access.server.channels
    .map(channelId => memory.channels.get(channelId))
    .filter(Boolean)
    .sort((a, b) => a.position - b.position);
  res.json({ channels, role: access.role });
});

app.post("/api/servers/:id/channels", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access || !canManage(access.role)) {
    return res.status(403).json({ error: "Permission denied" });
  }
  const name = String(req.body?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 50);
  const type = ["text", "announcement"].includes(req.body?.type)
    ? req.body.type
    : "text";
  if (!name) return res.status(400).json({ error: "Channel name is required" });

  const channelId = id("channel");
  const channel = {
    id: channelId,
    serverId: access.server.id,
    name,
    type,
    position: access.server.channels.length
  };
  access.server.channels.push(channelId);
  memory.channels.set(channelId, channel);
  memory.messages.set(channelId, []);
  res.status(201).json({ channel });
});

app.get("/api/channels/:id/messages", auth, (req, res) => {
  const channel = memory.channels.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Channel not found" });
  if (!member(channel.serverId, req.user.id)) {
    return res.status(403).json({ error: "Not a member" });
  }
  res.json({ messages: (memory.messages.get(channel.id) || []).slice(-100) });
});

app.post("/api/servers/:id/invites", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access || !canManage(access.role)) {
    return res.status(403).json({ error: "Permission denied" });
  }
  const code = crypto.randomBytes(6).toString("base64url");
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  memory.invites.set(code, {
    code,
    serverId: access.server.id,
    expiresAt: expires,
    uses: 0
  });
  res.status(201).json({
    invite: { code, expires_at: new Date(expires).toISOString() }
  });
});

app.post("/api/invites/:code/accept", auth, (req, res) => {
  const invite = memory.invites.get(req.params.code);
  if (!invite || invite.expiresAt < Date.now()) {
    return res.status(404).json({ error: "Invite expired or invalid" });
  }
  const server = memory.servers.get(invite.serverId);
  if (!server) return res.status(404).json({ error: "Server not found" });
  if (!server.members.has(req.user.id)) server.members.set(req.user.id, "member");
  invite.uses += 1;
  res.json({ server_id: server.id });
});

app.get("/api/servers/:id/members", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access) return res.status(403).json({ error: "Not a member" });

  const members = [];
  for (const [userId, role] of access.server.members.entries()) {
    const user = memory.users.get(userId);
    if (user) members.push({ ...publicUser(user), role, created_at: user.createdAt });
  }
  members.sort((a, b) => {
    const rank = { owner: 0, admin: 1, moderator: 2, member: 3 };
    return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.username.localeCompare(b.username);
  });
  res.json({ members });
});

app.patch("/api/servers/:id/members/:userId/role", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access || !["owner", "admin"].includes(access.role)) {
    return res.status(403).json({ error: "Permission denied" });
  }
  const target = member(req.params.id, req.params.userId);
  if (!target || target.role === "owner") {
    return res.status(400).json({ error: "Member cannot be changed" });
  }
  const role = ["member", "moderator", "admin"].includes(req.body?.role)
    ? req.body.role
    : null;
  if (!role) return res.status(400).json({ error: "Unsupported role" });
  target.server.members.set(req.params.userId, role);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const user = memory.users.get(payload.id);
    if (!user) return next(new Error("Guest session expired"));
    socket.user = user;
    user.status = "online";
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

function callParticipant(socket) {
  return {
    socketId: socket.id,
    userId: socket.user.id,
    username: socket.user.username
  };
}

io.on("connection", socket => {
  socket.broadcast.emit("presence:update", {
    userId: socket.user.id,
    status: "online"
  });

  socket.on("channel:join", channelId => {
    const channel = memory.channels.get(String(channelId));
    if (!channel || !member(channel.serverId, socket.user.id)) return;
    for (const room of socket.rooms) {
      if (room.startsWith("channel:")) socket.leave(room);
    }
    socket.join("channel:" + channel.id);
  });

  socket.on("typing", ({ channelId, isTyping }) => {
    if (!channelId) return;
    socket.to("channel:" + channelId).emit("typing", {
      userId: socket.user.id,
      username: socket.user.username,
      isTyping: Boolean(isTyping)
    });
  });

  socket.on("message:send", ({ channelId, content, replyToId }) => {
    const channel = memory.channels.get(String(channelId));
    if (!channel || !member(channel.serverId, socket.user.id)) return;
    const text = String(content || "").trim().slice(0, 4000);
    if (!text) return;

    const message = {
      id: id("msg"),
      channel_id: channel.id,
      content: text,
      reply_to_id: replyToId || null,
      created_at: now(),
      user_id: socket.user.id,
      username: socket.user.username
    };
    const list = memory.messages.get(channel.id) || [];
    list.push(message);
    if (list.length > 500) list.splice(0, list.length - 500);
    memory.messages.set(channel.id, list);
    io.to("channel:" + channel.id).emit("message:new", message);
  });

  socket.on("call:join", channelId => {
    const channel = memory.channels.get(String(channelId));
    if (!channel || !member(channel.serverId, socket.user.id)) return;

    const room = callRoomFor(channel.id);
    for (const existingRoom of socket.rooms) {
      if (existingRoom.startsWith(CALL_EVENT_PREFIX)) socket.leave(existingRoom);
    }

    const existingIds = [...(io.sockets.adapter.rooms.get(room) || [])]
      .filter(idValue => idValue !== socket.id);

    socket.join(room);

    socket.emit("call:participants", existingIds.map(idValue => {
      const peer = io.sockets.sockets.get(idValue);
      return peer ? callParticipant(peer) : null;
    }).filter(Boolean));

    socket.to(room).emit("call:participant-joined", callParticipant(socket));
  });

  socket.on("call:leave", channelId => {
    const room = callRoomFor(channelId);
    if (!socket.rooms.has(room)) return;
    socket.leave(room);
    socket.to(room).emit("call:participant-left", {
      socketId: socket.id,
      userId: socket.user.id
    });
  });

  socket.on("rtc:offer", ({ to, offer }) => {
    const peer = io.sockets.sockets.get(to);
    if (!peer || !offer) return;
    peer.emit("rtc:offer", {
      from: socket.id,
      fromUser: callParticipant(socket),
      offer
    });
  });

  socket.on("rtc:answer", ({ to, answer }) => {
    const peer = io.sockets.sockets.get(to);
    if (!peer || !answer) return;
    peer.emit("rtc:answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("rtc:ice", ({ to, candidate }) => {
    const peer = io.sockets.sockets.get(to);
    if (!peer || !candidate) return;
    peer.emit("rtc:ice", {
      from: socket.id,
      candidate
    });
  });

  socket.on("call:mute", ({ channelId, muted }) => {
    socket.to(callRoomFor(channelId)).emit("call:media-state", {
      socketId: socket.id,
      muted: Boolean(muted)
    });
  });

  socket.on("disconnect", () => {
    socket.user.status = "offline";
    socket.broadcast.emit("presence:update", {
      userId: socket.user.id,
      status: "offline"
    });

    for (const room of socket.rooms) {
      if (room.startsWith(CALL_EVENT_PREFIX)) {
        socket.to(room).emit("call:participant-left", {
          socketId: socket.id,
          userId: socket.user.id
        });
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[orbit] guest mode listening on " + PORT);
});