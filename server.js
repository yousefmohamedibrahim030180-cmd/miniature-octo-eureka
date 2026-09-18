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
  invites: new Map(),
  friendRequests: new Map(),
  friendships: new Set(),
  dms: new Map(),
  dmMessages: new Map(),
  notifications: new Map(),
  threads: new Map(),
  polls: new Map(),
  uploads: new Map(),
  audit: []
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
    const voiceId = id("channel");
    const lobby = {
      id: serverId,
      name: "Orbit Lobby",
      ownerId: user.id,
      createdAt: now(),
      members: new Map([[user.id, "owner"]]),
      channels: [channelId, voiceId]
    };
    memory.servers.set(serverId, lobby);
    memory.channels.set(channelId, {
      id: channelId,
      serverId,
      name: "general",
      type: "text",
      position: 0
    });
    memory.channels.set(voiceId, {
      id: voiceId,
      serverId,
      name: "Lounge",
      type: "voice",
      position: 1
    });
    memory.messages.set(channelId, []);
    memory.messages.set(voiceId, []);
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
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

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

app.get("/api/platform/summary", auth, (req, res) => {
  let totalMessages = 0;
  for (const list of memory.messages.values()) totalMessages += list.length;
  const serverRows = [...memory.servers.values()].map(s => ({
    id: s.id,
    name: s.name,
    memberCount: s.members.size,
    channelCount: s.channels.length
  }));
  res.json({
    users: memory.users.size,
    servers: memory.servers.size,
    messages: totalMessages,
    calls: [...io.sockets.adapter.rooms.keys()].filter(k => k.startsWith(CALL_EVENT_PREFIX)).length,
    serverRows,
    uptime: Math.floor(process.uptime())
  });
});

app.get("/api/search", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ users: [], servers: [], channels: [], messages: [] });

  const users = [...memory.users.values()]
    .filter(u => u.username.toLowerCase().includes(q))
    .slice(0, 20)
    .map(publicUser);

  const servers = [...memory.servers.values()]
    .filter(s => s.name.toLowerCase().includes(q))
    .slice(0, 20)
    .map(s => ({ id: s.id, name: s.name, owner_id: s.ownerId, memberCount: s.members.size }));

  const channels = [...memory.channels.values()]
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 30)
    .map(c => ({ id: c.id, serverId: c.serverId, name: c.name, type: c.type }));

  const messages = [];
  for (const list of memory.messages.values()) {
    for (const message of list) {
      if (message.content.toLowerCase().includes(q)) messages.push(message);
      if (messages.length >= 50) break;
    }
    if (messages.length >= 50) break;
  }
  res.json({ users, servers, channels, messages });
});

function pairKey(a, b) {
  return [String(a), String(b)].sort().join(":");
}
function findMessage(messageId) {
  for (const [channelId, list] of memory.messages.entries()) {
    const index = list.findIndex(m => String(m.id) === String(messageId));
    if (index !== -1) return { channelId, list, index, message: list[index] };
  }
  return null;
}
function notify(userId, item) {
  const list = memory.notifications.get(String(userId)) || [];
  list.unshift({
    id: id("notif"),
    read: false,
    created_at: now(),
    ...item
  });
  memory.notifications.set(String(userId), list.slice(0, 200));
}
function audit(userId, action, target, details = {}) {
  memory.audit.unshift({ id: id("audit"), user_id: userId, action, target, details, created_at: now() });
  memory.audit = memory.audit.slice(0, 500);
}
function socketRoom(kind, idValue) { return kind + ":" + String(idValue); }

app.get("/api/friends", auth, (req, res) => {
  const userId = String(req.user.id);
  const friends = [];
  for (const key of memory.friendships) {
    const [a, b] = key.split(":");
    if (a !== userId && b !== userId) continue;
    const other = memory.users.get(a === userId ? b : a);
    if (other) friends.push(publicUser(other));
  }
  const incoming = [...memory.friendRequests.values()]
    .filter(r => r.to === userId && r.status === "pending")
    .map(r => ({ ...r, fromUser: publicUser(memory.users.get(r.from)) }));
  const outgoing = [...memory.friendRequests.values()]
    .filter(r => r.from === userId && r.status === "pending")
    .map(r => ({ ...r, toUser: publicUser(memory.users.get(r.to)) }));
  res.json({ friends, incoming, outgoing });
});

app.post("/api/friends/request", auth, (req, res) => {
  const targetName = String(req.body?.username || "").trim().toLowerCase();
  const target = [...memory.users.values()].find(u => u.username.toLowerCase() === targetName);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.id === req.user.id) return res.status(400).json({ error: "You cannot add yourself" });
  if (memory.friendships.has(pairKey(req.user.id, target.id))) return res.status(409).json({ error: "Already friends" });
  const existing = [...memory.friendRequests.values()].find(r =>
    r.status === "pending" &&
    ((r.from === req.user.id && r.to === target.id) || (r.from === target.id && r.to === req.user.id))
  );
  if (existing) return res.status(409).json({ error: "Friend request already exists" });
  const request = { id: id("friendreq"), from: req.user.id, to: target.id, status: "pending", created_at: now() };
  memory.friendRequests.set(request.id, request);
  notify(target.id, { type: "friend_request", title: "Friend request", body: req.user.username + " sent you a friend request", actorId: req.user.id, requestId: request.id });
  audit(req.user.id, "FRIEND_REQUEST_CREATE", target.id);
  res.status(201).json({ request });
});

app.post("/api/friends/request/:id/accept", auth, (req, res) => {
  const request = memory.friendRequests.get(req.params.id);
  if (!request || request.to !== String(req.user.id) || request.status !== "pending") return res.status(404).json({ error: "Request not found" });
  request.status = "accepted";
  memory.friendships.add(pairKey(request.from, request.to));
  const from = memory.users.get(request.from);
  notify(request.from, { type: "friend_request", title: "Friend request accepted", body: req.user.username + " accepted your request", actorId: req.user.id });
  audit(req.user.id, "FRIEND_REQUEST_ACCEPT", request.from);
  res.json({ ok: true, friend: from ? publicUser(from) : null });
});

app.post("/api/friends/request/:id/reject", auth, (req, res) => {
  const request = memory.friendRequests.get(req.params.id);
  if (!request || request.to !== String(req.user.id) || request.status !== "pending") return res.status(404).json({ error: "Request not found" });
  request.status = "rejected";
  audit(req.user.id, "FRIEND_REQUEST_REJECT", request.from);
  res.json({ ok: true });
});

app.get("/api/dms", auth, (req, res) => {
  const rows = [...memory.dms.values()]
    .filter(dm => dm.members.includes(String(req.user.id)))
    .map(dm => {
      const otherId = dm.members.find(idValue => idValue !== String(req.user.id));
      const other = otherId ? memory.users.get(otherId) : null;
      const list = memory.dmMessages.get(dm.id) || [];
      return { ...dm, otherUser: other ? publicUser(other) : null, lastMessage: list[list.length - 1] || null };
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({ dms: rows });
});

app.post("/api/dms", auth, (req, res) => {
  const targetId = String(req.body?.userId || "");
  const targetName = String(req.body?.username || "").trim().toLowerCase();
  const target = targetId ? memory.users.get(targetId) : [...memory.users.values()].find(u => u.username.toLowerCase() === targetName);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.id === req.user.id) return res.status(400).json({ error: "You cannot message yourself" });

  const existing = [...memory.dms.values()].find(dm => dm.type === "dm" && dm.members.length === 2 && dm.members.includes(String(req.user.id)) && dm.members.includes(String(target.id)));
  if (existing) return res.json({ dm: existing });

  const dm = { id: id("dm"), type: "dm", name: null, members: [String(req.user.id), String(target.id)], created_at: now() };
  memory.dms.set(dm.id, dm);
  memory.dmMessages.set(dm.id, []);
  res.status(201).json({ dm });
});

app.get("/api/dms/:id/messages", auth, (req, res) => {
  const dm = memory.dms.get(req.params.id);
  if (!dm || !dm.members.includes(String(req.user.id))) return res.status(403).json({ error: "Not a participant" });
  res.json({ messages: memory.dmMessages.get(dm.id) || [] });
});

app.post("/api/dms/:id/messages", auth, (req, res) => {
  const dm = memory.dms.get(req.params.id);
  if (!dm || !dm.members.includes(String(req.user.id))) return res.status(403).json({ error: "Not a participant" });
  const content = String(req.body?.content || "").trim().slice(0, 4000);
  if (!content) return res.status(400).json({ error: "Message is empty" });
  const message = { id: id("dmmsg"), dm_id: dm.id, content, user_id: req.user.id, username: req.user.username, created_at: now() };
  const list = memory.dmMessages.get(dm.id) || [];
  list.push(message);
  memory.dmMessages.set(dm.id, list.slice(-500));
  for (const memberId of dm.members.filter(idValue => idValue !== String(req.user.id))) {
    notify(memberId, { type: "message", title: "New direct message", body: req.user.username + ": " + content.slice(0, 120), actorId: req.user.id, dmId: dm.id });
  }
  io.to(socketRoom("dm", dm.id)).emit("dm:message", message);
  res.status(201).json({ message });
});

app.get("/api/notifications", auth, (req, res) => {
  res.json({ notifications: memory.notifications.get(String(req.user.id)) || [] });
});
app.post("/api/notifications/read", auth, (req, res) => {
  const list = memory.notifications.get(String(req.user.id)) || [];
  list.forEach(n => n.read = true);
  res.json({ ok: true });
});

app.get("/api/messages/:id/thread", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  const channel = memory.channels.get(found.channelId);
  if (!channel || !member(channel.serverId, req.user.id)) return res.status(403).json({ error: "Not a member" });
  const thread = memory.threads.get(String(req.params.id)) || { id: id("thread"), message_id: found.message.id, replies: [] };
  memory.threads.set(String(req.params.id), thread);
  res.json({ thread });
});
app.post("/api/messages/:id/thread", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  const channel = memory.channels.get(found.channelId);
  if (!channel || !member(channel.serverId, req.user.id)) return res.status(403).json({ error: "Not a member" });
  const content = String(req.body?.content || "").trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: "Reply is empty" });
  let thread = memory.threads.get(String(req.params.id));
  if (!thread) { thread = { id: id("thread"), message_id: found.message.id, replies: [] }; memory.threads.set(String(req.params.id), thread); }
  const reply = { id: id("reply"), user_id: req.user.id, username: req.user.username, content, created_at: now() };
  thread.replies.push(reply);
  notify(found.message.user_id, { type: "reply", title: "New thread reply", body: req.user.username + " replied to your message", actorId: req.user.id, messageId: found.message.id });
  res.status(201).json({ reply, thread });
});

app.post("/api/messages/:id/reaction", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  const channel = memory.channels.get(found.channelId);
  if (!channel || !member(channel.serverId, req.user.id)) return res.status(403).json({ error: "Not a member" });
  const emoji = String(req.body?.emoji || "👍").slice(0, 8);
  found.message.reactions = found.message.reactions || {};
  found.message.reactions[emoji] = found.message.reactions[emoji] || [];
  const users = found.message.reactions[emoji];
  const idx = users.indexOf(String(req.user.id));
  if (idx === -1) users.push(String(req.user.id)); else users.splice(idx, 1);
  io.to("channel:" + channel.id).emit("message:reaction", { messageId: found.message.id, reactions: found.message.reactions });
  res.json({ reactions: found.message.reactions });
});

function canEditMessage(found, user) {
  const channel = memory.channels.get(found.channelId);
  const access = channel ? member(channel.serverId, user.id) : null;
  return found.message.user_id === user.id || canManage(access?.role);
}
app.patch("/api/messages/:id", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  if (!canEditMessage(found, req.user)) return res.status(403).json({ error: "Permission denied" });
  const content = String(req.body?.content || "").trim().slice(0, 4000);
  if (!content) return res.status(400).json({ error: "Message is empty" });
  found.message.content = content;
  found.message.edited_at = now();
  io.to("channel:" + found.channelId).emit("message:update", found.message);
  audit(req.user.id, "MESSAGE_EDIT", found.message.id);
  res.json({ message: found.message });
});
app.delete("/api/messages/:id", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  if (!canEditMessage(found, req.user)) return res.status(403).json({ error: "Permission denied" });
  const [deleted] = found.list.splice(found.index, 1);
  io.to("channel:" + found.channelId).emit("message:delete", { messageId: deleted.id });
  audit(req.user.id, "MESSAGE_DELETE", deleted.id);
  res.json({ ok: true });
});

app.get("/api/channels/:id/polls", auth, (req, res) => {
  const channel = memory.channels.get(req.params.id);
  if (!channel || !member(channel.serverId, req.user.id)) return res.status(403).json({ error: "Not a member" });
  res.json({ polls: [...memory.polls.values()].filter(p => p.channelId === channel.id).map(p => ({
    ...p,
    options: p.options.map(o => ({ id:o.id, text:o.text, votes:o.votes.size }))
  })) });
});
app.post("/api/channels/:id/polls", auth, (req, res) => {
  const channel = memory.channels.get(req.params.id);
  if (!channel || !member(channel.serverId, req.user.id)) return res.status(403).json({ error: "Not a member" });
  const question = String(req.body?.question || "").trim().slice(0, 200);
  const options = Array.isArray(req.body?.options) ? req.body.options.map(v => String(v).trim().slice(0, 120)).filter(Boolean).slice(0, 8) : [];
  if (!question || options.length < 2) return res.status(400).json({ error: "Question and at least two options are required" });
  const poll = { id: id("poll"), channelId: channel.id, question, multiple: Boolean(req.body?.multiple), createdBy:req.user.id, created_at:now(), options:options.map(text=>({id:id("opt"),text,votes:new Set()})) };
  memory.polls.set(poll.id,poll);
  notify(req.user.id, { type:"poll", title:"Poll published", body:question, channelId:channel.id });
  io.to("channel:" + channel.id).emit("poll:new", { ...poll, options: poll.options.map(o=>({id:o.id,text:o.text,votes:o.votes.size})) });
  res.status(201).json({ poll: { ...poll, options: poll.options.map(o=>({id:o.id,text:o.text,votes:o.votes.size})) } });
});
app.post("/api/polls/:id/vote", auth, (req, res) => {
  const poll=memory.polls.get(req.params.id);
  if(!poll) return res.status(404).json({error:"Poll not found"});
  const optionIds=Array.isArray(req.body?.optionIds)?req.body.optionIds.map(String):[String(req.body?.optionId||"")];
  if(!poll.multiple && optionIds.length>1) return res.status(400).json({error:"Only one option allowed"});
  poll.options.forEach(o=>o.votes.delete(String(req.user.id)));
  for(const idValue of optionIds){const option=poll.options.find(o=>String(o.id)===idValue);if(option)option.votes.add(String(req.user.id));}
  res.json({poll:{...poll,options:poll.options.map(o=>({id:o.id,text:o.text,votes:o.votes.size}))}});
});

app.get("/api/servers/:id/audit", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  res.json({audit:memory.audit.slice(0,100)});
});

app.post("/api/uploads", auth, (req,res)=>{
  const data=String(req.body?.data||"");
  if(!data || data.length>2_500_000) return res.status(400).json({error:"File is missing or too large"});
  const item={id:id("file"),name:String(req.body?.name||"file").slice(0,180),type:String(req.body?.type||"application/octet-stream").slice(0,120),size:Number(req.body?.size||0),data,created_at:now(),user_id:req.user.id};
  memory.uploads.set(item.id,item);
  res.status(201).json({file:{id:item.id,name:item.name,type:item.type,size:item.size}});
});
app.get("/api/uploads/:id", auth, (req,res)=>{
  const file=memory.uploads.get(req.params.id);
  if(!file) return res.status(404).end();
  res.type(file.type).send(Buffer.from(String(file.data).replace(/^data:[^;]+;base64,/,""),"base64"));
});

app.get("/api/realtime-config", auth, (req, res) => {
  const turnUrls = String(process.env.TURN_URLS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

  const iceServers = [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]
    }
  ];

  if (turnUrls.length) {
    const turn = { urls: turnUrls };
    if (process.env.TURN_USERNAME) turn.username = process.env.TURN_USERNAME;
    if (process.env.TURN_CREDENTIAL) turn.credential = process.env.TURN_CREDENTIAL;
    iceServers.push(turn);
  }

  res.json({
    iceServers,
    hasTurn: turnUrls.length > 0
  });
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
  const voiceId = id("channel");
  const s = {
    id: serverId,
    name,
    ownerId: req.user.id,
    createdAt: now(),
    members: new Map([[req.user.id, "owner"]]),
    channels: [channelId, voiceId]
  };
  memory.servers.set(serverId, s);
  memory.channels.set(channelId, {
    id: channelId,
    serverId,
    name: "general",
    type: "text",
    position: 0
  });
  memory.channels.set(voiceId, {
    id: voiceId,
    serverId,
    name: "Lounge",
    type: "voice",
    position: 1
  });
  memory.messages.set(channelId, []);
  memory.messages.set(voiceId, []);

  res.status(201).json({
    server: {
      id: s.id,
      name: s.name,
      owner_id: s.ownerId,
      role: "owner",
      default_channel_id: channelId
    },
    channel: memory.channels.get(channelId),
    voiceChannel: memory.channels.get(voiceId)
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
  const type = ["text", "announcement", "voice"].includes(req.body?.type)
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

  socket.on("message:send", ({ channelId, content, replyToId, attachment }) => {
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
      username: socket.user.username,
      attachment: attachment || null
    };
    const list = memory.messages.get(channel.id) || [];
    list.push(message);
    if (list.length > 500) list.splice(0, list.length - 500);
    memory.messages.set(channel.id, list);
    io.to("channel:" + channel.id).emit("message:new", message);
  });

  socket.on("call:join", payload => {
    const channelId = typeof payload === "object" ? payload.channelId : payload;
    const mode = typeof payload === "object" && payload.mode ? payload.mode : "video";
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

    socket.to(room).emit("call:participant-joined", {
      ...callParticipant(socket),
      channelId: channel.id,
      mode
    });
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

  socket.on("call:media-state", ({ channelId, muted, cameraOff, screenShare }) => {
    socket.to(callRoomFor(channelId)).emit("call:media-state", {
      socketId: socket.id,
      muted: Boolean(muted),
      cameraOff: Boolean(cameraOff),
      screenShare: Boolean(screenShare)
    });
  });

  socket.on("dm:join", dmId => {
    const dm = memory.dms.get(String(dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) return;
    socket.join(socketRoom("dm", dmId));
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