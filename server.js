const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { pipeline, env: hfEnv } = require("@huggingface/transformers");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["polling"],
  allowUpgrades: false
});

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "orbit-guest-dev-secret";
const ADMIN_CONTROL_KEY = String(process.env.ADMIN_CONTROL_KEY || "").trim();
const ORBIT_OWNER_CONTROL_KEY = String(process.env.ORBIT_OWNER_CONTROL_KEY || "").trim();
const adminKeyAttempts = new Map();
const ownerKeyAttempts = new Map();
const AVATAR_DECORATIONS = new Set(["none","halo","crown","orbit","spark","fire","ice","cyber","royal","dragon"]);

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
  dmReads: new Map(),
  notifications: new Map(),
  threads: new Map(),
  polls: new Map(),
  uploads: new Map(),
  events: new Map(),
  projects: new Map(),
  aiConversations: new Map(),
  liveSessions: new Map(),
  audit: []
};

const CALL_EVENT_PREFIX = "call:";
const callRoomFor = channelId => CALL_EVENT_PREFIX + String(channelId);
const dmCallRoomFor = callId => "dmcall:" + String(callId);
const dmCalls = new Map();
const serverMessageRate = new Map();

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const PERSIST_URL = String(process.env.ORBIT_PERSIST_URL || "").trim().replace(/\/$/, "");
const PERSIST_SECRET = String(process.env.ORBIT_PERSIST_SECRET || "").trim();

let dbPool = null;
let dbReady = false;
let persistTimer = null;
let persistInFlight = false;
let persistPending = false;
let persistMode = "memory";

function now() { return new Date().toISOString(); }

function serializeMemory() {
  return {
    users: [...memory.users.entries()],
    servers: [...memory.servers.entries()].map(([key, value]) => [key, { ...value, members: [...(value.members instanceof Map ? value.members.entries() : [])] }]),
    channels: [...memory.channels.entries()],
    messages: [...memory.messages.entries()],
    invites: [...memory.invites.entries()],
    friendRequests: [...memory.friendRequests.entries()],
    friendships: [...memory.friendships],
    dms: [...memory.dms.entries()],
    dmMessages: [...memory.dmMessages.entries()],
    dmReads: [...memory.dmReads.entries()],
    notifications: [...memory.notifications.entries()],
    threads: [...memory.threads.entries()],
    polls: [...memory.polls.entries()],
    uploads: [...memory.uploads.entries()],
    events: [...memory.events.entries()],
    projects: [...memory.projects.entries()],
    aiConversations: [...memory.aiConversations.entries()],
    liveSessions: [...memory.liveSessions.entries()],
    audit: memory.audit
  };
}

function hydrateMemory(data) {
  if (!data || typeof data !== "object") return;
  const restoreMap = name => { memory[name] = new Map(Array.isArray(data[name]) ? data[name] : []); };
  restoreMap("users");
  memory.servers = new Map((data.servers || []).map(([key, value]) => [key, { ...value, members: new Map(value?.members || []) }]));
  restoreMap("channels"); restoreMap("messages"); restoreMap("invites"); restoreMap("friendRequests");
  memory.friendships = new Set(data.friendships || []);
  restoreMap("dms"); restoreMap("dmMessages"); restoreMap("dmReads"); restoreMap("notifications");
  restoreMap("threads"); restoreMap("polls"); restoreMap("uploads");
  restoreMap("events"); restoreMap("projects"); restoreMap("aiConversations"); restoreMap("liveSessions");
  memory.audit = Array.isArray(data.audit) ? data.audit : [];
}

async function sidecarRequest(method, body) {
  if (!PERSIST_URL || !PERSIST_SECRET) return { configured: false, found: false };
  const response = await fetch(PERSIST_URL + "/state", {
    method,
    headers: {
      "x-orbit-secret": PERSIST_SECRET,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 404 && method === "GET") return { configured: true, found: false };
  if (!response.ok) throw new Error("Persistence sidecar returned HTTP " + response.status);
  return { configured: true, found: true, payload: await response.json() };
}

async function initPersistence() {
  if (DATABASE_URL) {
    try {
      dbPool = new Pool({
        connectionString: DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false }
      });
      await dbPool.query("CREATE TABLE IF NOT EXISTS orbit_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const result = await dbPool.query("SELECT data FROM orbit_state WHERE id = 1");
      if (result.rows[0]?.data) {
        hydrateMemory(result.rows[0].data);
        for (const user of memory.users.values()) {
          user.status = "offline";
          user.activity = "Offline";
          user.activityChannelId = null;
          user.activityChannelName = null;
          user.activityServerId = null;
        }
        console.log("[orbit] PostgreSQL state restored.");
      } else {
        dbReady = true;
        persistMode = "postgres-memory-cache";
        await persistState();
        console.log("[orbit] PostgreSQL persistence initialized.");
      }
      dbReady = true;
      persistMode = "postgres-memory-cache";
      return;
    } catch (error) {
      console.error("[orbit] PostgreSQL unavailable; trying private sidecar:", error.message);
      dbReady = false;
      if (dbPool) { try { await dbPool.end(); } catch {} }
      dbPool = null;
    }
  }

  if (PERSIST_URL && PERSIST_SECRET) {
    try {
      const result = await sidecarRequest("GET");
      if (result.found && result.payload?.data) {
        hydrateMemory(result.payload.data);
        for (const user of memory.users.values()) {
          user.status = "offline";
          user.activity = "Offline";
          user.activityChannelId = null;
          user.activityChannelName = null;
          user.activityServerId = null;
        }
        console.log("[orbit] Private persistence sidecar state restored.");
      } else {
        console.log("[orbit] Private persistence sidecar is empty; initializing.");
      }
      dbReady = true;
      persistMode = "sidecar-memory-cache";
      await persistState();
      console.log("[orbit] Private persistence sidecar ready.");
      return;
    } catch (error) {
      console.error("[orbit] Persistence sidecar unavailable; continuing in memory mode:", error.message);
    }
  }

  dbReady = false;
  persistMode = "memory";
  console.log("[orbit] No persistent store configured; using memory mode.");
}

async function persistState() {
  if (!dbReady) return;
  if (persistInFlight) {
    persistPending = true;
    return;
  }

  persistInFlight = true;
  try {
    const data = serializeMemory();
    if (dbPool) {
      await dbPool.query(
        "INSERT INTO orbit_state (id, data, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
        [JSON.stringify(data)]
      );
    } else if (PERSIST_URL && PERSIST_SECRET) {
      await sidecarRequest("PUT", { data });
    }
  } catch (error) {
    console.error("[orbit] Persistence write failed:", error.message);
  } finally {
    persistInFlight = false;
    if (persistPending) {
      persistPending = false;
      setImmediate(() => persistState().catch(error => console.error("[orbit] persistence retry failed:", error.message)));
    }
  }
}

function schedulePersist() {
  if (!dbReady) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistState().catch(error => console.error("[orbit] persistence error:", error.message)), 250);
}
function id(prefix) { return prefix + "_" + crypto.randomUUID(); }
function cleanName(value, fallback = "Guest") {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return name || fallback;
}
function cleanUsername(value, fallback = "") {
  let name = String(value || "").trim().toLowerCase().replace(/^@+/, "").replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/[-_.]{2,}/g, "-").slice(0, 20);
  if (name.length < 4) name = fallback;
  return name;
}
function uniqueUsername(requested, ignoreUserId = null) {
  const base = cleanUsername(requested, "orbit");
  const used = new Set([...memory.users.values()]
    .filter(u => !ignoreUserId || String(u.id) !== String(ignoreUserId))
    .map(u => String(u.username || "").toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 10000; i++) {
    const candidate = (base.slice(0, Math.max(1, 20 - String(i).length - 1)) + "-" + i).replace(/-+$/,"");
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return base + "-" + Math.random().toString(36).slice(2, 6);
}
function tokenFor(user) {
  return jwt.sign(
    { id: user.id, username: user.username, account: true },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}
function readToken(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}
function authenticate(req, res, next, allowLegacy = false) {
  try {
    const payload = jwt.verify(readToken(req), JWT_SECRET);
    const user = memory.users.get(payload.id);
    if (!user) return res.status(401).json({ error: "Session expired. Please sign in again." });
    if (user.suspended) return res.status(403).json({ error: "This ORBIT account is suspended." });
    if (!allowLegacy && !payload.account) return res.status(401).json({ error: "An ORBIT account is required. Please create an account or sign in." });
    user.status = "online";
    req.user = user;
    req.authPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}
function auth(req, res, next) { return authenticate(req, res, next, false); }
function authLegacy(req, res, next) { return authenticate(req, res, next, true); }
function serverSettings(server) {
  if (!server.settings || typeof server.settings !== "object") server.settings = {};
  if (typeof server.settings.locked !== "boolean") server.settings.locked = false;
  if (!Number.isFinite(Number(server.settings.slowmode))) server.settings.slowmode = 0;
  server.settings.slowmode = Math.max(0, Math.min(120, Number(server.settings.slowmode)));
  if (!["open","verified","high"].includes(server.settings.verification)) server.settings.verification = "open";
  if (!server.settings.theme || typeof server.settings.theme !== "object") server.settings.theme = {};
  const theme=server.settings.theme;
  if (!/^#[0-9a-f]{6}$/i.test(String(theme.accent||""))) theme.accent="#7c5cff";
  if (!/^#[0-9a-f]{6}$/i.test(String(theme.secondary||""))) theme.secondary="#14b8a6";
  if (theme.icon_url && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(String(theme.icon_url))) theme.icon_url=null;
  if (theme.banner_url && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(String(theme.banner_url))) theme.banner_url=null;
  theme.description=String(theme.description||"").slice(0,500);
  theme.welcomeMessage=String(theme.welcomeMessage||"").slice(0,700);
  if (!server.settings.nexusWorld || typeof server.settings.nexusWorld !== "object") server.settings.nexusWorld = null;
  if (!server.settings.nexusWorld || typeof server.settings.nexusWorld !== "object") server.settings.nexusWorld = null;
  if (!Array.isArray(server.bannedUserIds)) server.bannedUserIds = [];
  return server.settings;
}
function ensureUserStats(user) {
  if (!user.stats || typeof user.stats !== "object") user.stats={};
  user.stats.messages=Number(user.stats.messages||0);
  user.stats.voiceJoins=Number(user.stats.voiceJoins||0);
  user.stats.serversCreated=Number(user.stats.serversCreated||0);
  user.stats.friends=Number(user.stats.friends||0);
  return user.stats;
}
function userBadges(user) {
  const stats=ensureUserStats(user);
  const badges=[];
  if (stats.serversCreated>0) badges.push({id:"creator",label:"Creator",icon:"✦"});
  if (stats.messages>=10) badges.push({id:"chatter",label:"Chatter",icon:"◈"});
  if (stats.voiceJoins>=1) badges.push({id:"voice",label:"Voice Explorer",icon:"◉"});
  if (stats.friends>=1) badges.push({id:"social",label:"Social",icon:"◎"});
  if (user.avatarUrl || user.avatarDecorationUrl || userBio(user)) badges.push({id:"profile",label:"Profile Crafted",icon:"◇"});
  return badges.slice(0,6);
}
function userBio(user){ return String(user.bio||"").trim(); }
function isServerBanned(server, userId) {
  serverSettings(server);
  return server.bannedUserIds.includes(String(userId));
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
      channels: [channelId, voiceId],
      settings: { locked: false, slowmode: 0, verification: "open" },
      bannedUserIds: []
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
      serverSettings(s);
      if (!s.members.has(user.id) && s.name === "Orbit Lobby" && !isServerBanned(s, user.id)) {
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
function adminTokenFor(user, serverId, role) {
  return jwt.sign(
    { admin: true, userId: String(user.id), serverId: String(serverId), role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}
function hasAdminToken(req, serverId) {
  const raw = String(req.headers["x-admin-token"] || "").trim();
  if (!raw) return false;
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    return Boolean(payload?.admin) &&
      String(payload.userId) === String(req.user?.id) &&
      String(payload.serverId) === String(serverId);
  } catch {
    return false;
  }
}
function requireAdminToken(req, res, serverId) {
  if (!hasAdminToken(req, serverId)) {
    res.status(401).json({ error: "Admin key session expired or missing" });
    return false;
  }
  return true;
}
function ownerTokenFor(user) {
  return jwt.sign(
    { owner: true, userId: String(user.id) },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}
function hasOwnerToken(req) {
  const raw = String(req.headers["x-owner-token"] || "").trim();
  if (!raw) return false;
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    return Boolean(payload?.owner) &&
      String(payload.userId) === String(req.user?.id);
  } catch {
    return false;
  }
}
function requireOwner(req, res) {
  if (!hasOwnerToken(req)) {
    res.status(401).json({ error: "Owner session expired or missing" });
    return false;
  }
  return true;
}
function ownerAttemptKey(req) {
  return String(req.ip || req.headers["x-forwarded-for"] || "unknown") + ":" + String(req.user?.id || "unknown");
}
function adminAttemptKey(req) {
  return String(req.ip || req.headers["x-forwarded-for"] || "unknown") + ":" + String(req.user?.id || "unknown");
}
function publicUser(user) {
  ensureUserStats(user);
  return {
    id: user.id,
    username: user.username,
    handle: "@" + user.username,
    display_name: user.displayName || user.username,
    avatar_url: user.avatarUrl || null,
    avatar_decoration: user.avatarDecoration || "none",
    avatar_decoration_url: user.avatarDecorationUrl || null,
    status: user.status || "online",
    activity: user.activity || "Online",
    activity_type: user.activityType || "custom",
    badges: userBadges(user),
    guest: false,
    account: Boolean(user.passwordHash)
  };
}
function createGuest(username, existingId) {
  const userId = existingId && memory.users.has(existingId) ? existingId : id("guest");
  const existing = memory.users.get(userId);
  const requested = cleanUsername(username, existing?.username || ("orbit-" + Math.random().toString(36).slice(2, 7)));
  const user = existing || {
    id: userId,
    username: uniqueUsername(requested),
    displayName: cleanName(username, requested),
    status: "online",
    activity: "Online",
    activityType: "custom",
    bio: "",
    createdAt: now(),
    avatarUrl: null,
    avatarDecoration: "none",
    avatarDecorationUrl: null,
    stats: {messages:0,voiceJoins:0,serversCreated:0,friends:0}
  };
  if (!existing) {
    user.username = uniqueUsername(requested, user.id);
  } else if (!user.username) {
    user.username = uniqueUsername(requested, user.id);
  }
  user.displayName = user.displayName || cleanName(username, user.username);
  user.status = "online";
  memory.users.set(user.id, user);
  ensureDefaultServer(user);
  return user;
}

app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

app.use((req, res, next) => {
  res.on("finish", () => schedulePersist());
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "orbit-chat",
    mode: persistMode,
    db: dbReady,
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

const accountLoginAttempts = new Map();

function authAttemptKey(req, username="") {
  return String(req.ip || req.headers["x-forwarded-for"] || "unknown") + ":" + String(username || "").toLowerCase();
}

function validAccountUsername(value) {
  const username = cleanUsername(value, "");
  return /^[a-z0-9][a-z0-9._-]{3,19}$/.test(username) ? username : "";
}

function validAccountPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 72;
}

app.post("/api/auth/register", async (req, res) => {
  const username = validAccountUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const displayName = cleanName(req.body?.displayName || username, username);

  if (!username) return res.status(400).json({ error: "Username must be 4–20 characters and use letters, numbers, dots, underscores or hyphens." });
  if (!validAccountPassword(password)) return res.status(400).json({ error: "Password must be 8–72 characters." });
  if ([...memory.users.values()].some(user => String(user.username || "").toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already in use." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = {
    id: id("user"),
    username,
    displayName,
    passwordHash,
    accountCreatedAt: now(),
    status: "online",
    activity: "Online",
    activityType: "custom",
    bio: "",
    createdAt: now(),
    avatarUrl: null,
    avatarDecoration: "none",
    avatarDecorationUrl: null,
    stats: { messages:0, voiceJoins:0, serversCreated:0, friends:0 }
  };
  memory.users.set(user.id, user);
  ensureDefaultServer(user);
  schedulePersist();

  res.status(201).json({ user: publicUser(user), token: tokenFor(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const username = validAccountUsername(req.body?.username);
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  const key = authAttemptKey(req, username);
  const nowMs = Date.now();
  const history = accountLoginAttempts.get(key) || { count: 0, resetAt: nowMs + 10 * 60 * 1000 };
  if (nowMs > history.resetAt) {
    history.count = 0;
    history.resetAt = nowMs + 10 * 60 * 1000;
  }
  if (history.count >= 12) return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });

  const user = [...memory.users.values()].find(item => String(item.username || "").toLowerCase() === username.toLowerCase() && item.passwordHash);
  const ok = Boolean(user) && await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    history.count += 1;
    accountLoginAttempts.set(key, history);
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  accountLoginAttempts.delete(key);
  user.status = "online";
  user.activity = "Online";
  schedulePersist();
  res.json({ user: publicUser(user), token: tokenFor(user) });
});

app.post("/api/auth/convert-legacy", authLegacy, async (req, res) => {
  if (req.user.passwordHash) return res.status(400).json({ error: "This account is already configured." });
  const username = validAccountUsername(req.body?.username || req.user.username);
  const password = String(req.body?.password || "");
  if (!username || !validAccountPassword(password)) return res.status(400).json({ error: "Choose a valid username and an 8–72 character password." });
  const conflict = [...memory.users.values()].find(u => String(u.id) !== String(req.user.id) && String(u.username || "").toLowerCase() === username.toLowerCase());
  if (conflict) return res.status(409).json({ error: "That username is already in use." });
  req.user.username = username;
  req.user.passwordHash = await bcrypt.hash(password, 12);
  req.user.accountCreatedAt = req.user.accountCreatedAt || now();
  req.user.guest = false;
  schedulePersist();
  res.json({ user: publicUser(req.user), token: tokenFor(req.user) });
});

app.get("/api/me", authLegacy, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/pulse", auth, (req, res) => {
  res.json(livePulseSnapshot());
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
    .filter(u => u.username.toLowerCase().includes(q) || String(u.displayName || "").toLowerCase().includes(q))
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
function emitToUser(userId, event, payload) {
  for (const connected of io.sockets.sockets.values()) {
    if (String(connected.user?.id) === String(userId)) connected.emit(event, payload);
  }
}
function emitToServer(serverId, event, payload) {
  for (const connected of io.sockets.sockets.values()) {
    if (member(serverId, connected.user?.id)) connected.emit(event, payload);
  }
}
function canAccessServer(serverId, userId) {
  return Boolean(member(serverId, userId));
}
function findEvent(eventId) {
  return memory.events.get(String(eventId)) || null;
}
function findProject(projectId) {
  return memory.projects.get(String(projectId)) || null;
}
function sanitizeEvent(event, viewerId) {
  return {
    id: event.id,
    serverId: event.serverId,
    title: event.title,
    description: event.description,
    type: event.type,
    when: event.when,
    creatorId: event.creatorId,
    creator: publicUser(memory.users.get(event.creatorId) || {}),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    rsvpCount: Array.isArray(event.rsvps) ? event.rsvps.length : 0,
    going: Array.isArray(event.rsvps) && event.rsvps.includes(String(viewerId))
  };
}
function sanitizeProject(project, viewerId) {
  return {
    id: project.id,
    serverId: project.serverId,
    name: project.name,
    description: project.description,
    creatorId: project.creatorId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    taskCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
    openTaskCount: Array.isArray(project.tasks) ? project.tasks.filter(t => t.status !== "done").length : 0,
    tasks: (project.tasks || []).map(task => ({
      ...task,
      assignee: task.assigneeId ? publicUser(memory.users.get(task.assigneeId) || {}) : null
    }))
  };
}
function sanitizeLive(session) {
  const room = callRoomFor(session.channelId);
  const participants = [...(io.sockets.adapter.rooms.get(room) || [])]
    .map(socketId => io.sockets.sockets.get(socketId))
    .filter(Boolean)
    .map(callParticipant);
  return {
    ...session,
    host: publicUser(memory.users.get(session.hostUserId) || {}),
    viewers: participants.length,
    participants
  };
}
function localOrbitReply(message) {
  const q = String(message || "").trim().toLowerCase();
  if (!q) return "Tell me what you want to do in Orbit.";
  if (q.includes("open settings")) return "Opening Settings.";
  if (q.includes("show files")) return "Opening Files.";
  if (q.includes("open calls") || q === "calls") return "Opening Calls.";
  if (q.includes("open events") || q === "events") return "Opening Events.";
  if (q.includes("open projects") || q === "projects") return "Opening Projects.";
  if (q.includes("open communities") || q.includes("communities")) return "Opening Communities.";
  if (q.includes("open live") || q === "live") return "Opening Live.";
  if (q.startsWith("search ")) return "Opening global search for: " + String(message).trim().slice(7);
  return "I can navigate and organize Orbit locally. Add an AI provider on the server to enable full generative answers, summaries, translations and document analysis.";
}
let nexusLocalPipeline = null;
let nexusLocalPipelinePromise = null;

async function requestLocalOrbitModel(messages) {
  if (!nexusLocalPipelinePromise) {
    nexusLocalPipelinePromise = (async () => {
      hfEnv.cacheDir = String(process.env.ORBIT_AI_CACHE_DIR || path.join(__dirname, ".cache", "nexus-ai"));
      return await pipeline(
        "text-generation",
        String(process.env.ORBIT_AI_LOCAL_MODEL || "HuggingFaceTB/SmolLM2-135M-Instruct"),
        { dtype: String(process.env.ORBIT_AI_LOCAL_DTYPE || "q4") }
      );
    })().catch(error => {
      nexusLocalPipelinePromise = null;
      throw error;
    });
  }
  nexusLocalPipeline = await nexusLocalPipelinePromise;
  const output = await nexusLocalPipeline(messages.slice(-10), {
    max_new_tokens: Math.max(32, Math.min(220, Number(process.env.ORBIT_AI_LOCAL_MAX_TOKENS || 180))),
    temperature: 0.7,
    do_sample: true
  });
  const generated = output?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const assistant = [...generated].reverse().find(item => item?.role === "assistant");
    return typeof assistant?.content === "string" && assistant.content.trim() ? assistant.content.trim() : null;
  }
  return typeof generated === "string" && generated.trim() ? generated.trim() : null;
}

async function requestOrbitModel(messages) {
  const url=String(process.env.ORBIT_AI_API_URL || "").trim();
  const key=String(process.env.ORBIT_AI_API_KEY || "").trim();
  const model=String(process.env.ORBIT_AI_MODEL || "orbit").trim();
  if(url && key){
    try{
      const response=await fetch(url,{
        method:"POST",
        headers:{"content-type":"application/json","authorization":"Bearer "+key},
        body:JSON.stringify({model,messages})
      });
      if(!response.ok) throw new Error("AI provider returned HTTP "+response.status);
      const data=await response.json();
      const content=data?.choices?.[0]?.message?.content;
      if(typeof content==="string"&&content.trim()) return {content:content.trim(),provider:"external"};
    }catch(error){
      console.error("[orbit] configured AI provider failed, using local NEXUS model:", error.message);
    }
  }
  try {
    const local = await requestLocalOrbitModel(messages);\n    return local ? {content:local,provider:"local"} : null;
  } catch (error) {
    console.error("[orbit] local NEXUS model unavailable:", error.message);
    return null;
  }
}
app.get("/api/servers/:id/nexus/world", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access) return res.status(403).json({ error: "Not a member" });
  const settings = serverSettings(access.server);
  res.json({ world: settings.nexusWorld || null });
});
app.put("/api/servers/:id/nexus/world", auth, (req, res) => {
  const access = member(req.params.id, req.user.id);
  if (!access || !canManage(access.role)) return res.status(403).json({ error: "Owner/admin/moderator permission required" });
  const raw = req.body?.world && typeof req.body.world === "object" ? req.body.world : null;
  if (!raw) return res.status(400).json({ error: "World blueprint is required" });
  const world = {
    id: String(raw.id || id("world")).slice(0, 80),
    name: String(raw.name || "NEXUS WORLD").trim().slice(0, 120),
    type: String(raw.type || "custom").trim().slice(0, 40),
    prompt: String(raw.prompt || "").trim().slice(0, 400),
    atmosphere: String(raw.atmosphere || "aether").trim().slice(0, 30),
    surface: String(raw.surface || "night").trim().slice(0, 30),
    intensity: Math.max(20, Math.min(100, Number(raw.intensity || 70))),
    glass: Math.max(20, Math.min(92, Number(raw.glass || 62))),
    zones: Array.isArray(raw.zones) ? raw.zones.map(x => String(x || "").trim().slice(0, 70)).filter(Boolean).slice(0, 12) : [],
    updatedAt: now(),
    updatedBy: req.user.id
  };
  serverSettings(access.server).nexusWorld = world;
  schedulePersist();
  emitToServer(access.server.id, "nexus:world-updated", { world });
  res.json({ world });
});
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
  const targetName = cleanUsername(req.body?.username || "", "").toLowerCase();
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
  emitToUser(target.id, "friend:request", { request: { ...request, fromUser: publicUser(req.user) } });
  audit(req.user.id, "FRIEND_REQUEST_CREATE", target.id);
  res.status(201).json({ request });
});

app.post("/api/friends/request/:id/accept", auth, (req, res) => {
  const request = memory.friendRequests.get(req.params.id);
  if (!request || request.to !== String(req.user.id) || request.status !== "pending") return res.status(404).json({ error: "Request not found" });
  request.status = "accepted";
  memory.friendships.add(pairKey(request.from, request.to));
  const from = memory.users.get(request.from);
  ensureUserStats(req.user).friends+=1;
  if(from) ensureUserStats(from).friends+=1;
  notify(request.from, { type: "friend_request", title: "Friend request accepted", body: req.user.username + " accepted your request", actorId: req.user.id });
  emitToUser(request.from, "friend:accepted", { friend: publicUser(req.user), requestId: request.id });
  emitToUser(request.to, "friend:accepted", { friend: from ? publicUser(from) : null, requestId: request.id });
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
      const unreadCount = list.filter(m => String(m.user_id) !== String(req.user.id) && !m.seen_at).length;
      return { ...dm, otherUser: other ? publicUser(other) : null, lastMessage: list[list.length - 1] || null, unreadCount };
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
  const rawAttachment = req.body?.attachment && typeof req.body.attachment === "object" ? req.body.attachment : null;
  let attachment = null;
  if (rawAttachment?.id) {
    const stored = memory.uploads.get(String(rawAttachment.id));
    if (!stored || String(stored.user_id) !== String(req.user.id)) return res.status(400).json({ error: "Attachment not found" });
    attachment = { id: stored.id, name: String(stored.name || "Attachment").slice(0, 180), type: String(stored.type || "application/octet-stream").slice(0, 120), size: Number(stored.size || 0) };
  }
  if (!content && !attachment) return res.status(400).json({ error: "Message is empty" });
  const message = {
    id: id("dmmsg"), dm_id: dm.id, content, attachment, reactions: {},
    user_id: req.user.id, username: req.user.username, created_at: now(), seen_at: null
  };
  const list = memory.dmMessages.get(dm.id) || [];
  list.push(message);
  memory.dmMessages.set(dm.id, list.slice(-500));
  const notificationText = attachment ? "📎 " + attachment.name : content;
  for (const memberId of dm.members.filter(idValue => idValue !== String(req.user.id))) {
    notify(memberId, { type: "message", title: "New direct message", body: req.user.username + ": " + notificationText.slice(0, 120), actorId: req.user.id, dmId: dm.id });
  }
  schedulePersist();
  io.to(socketRoom("dm", dm.id)).emit("dm:message", message);
  res.status(201).json({ message });
});

app.post("/api/dms/:id/messages/:messageId/reaction", auth, (req, res) => {
  const dm = memory.dms.get(req.params.id);
  if (!dm || !dm.members.includes(String(req.user.id))) return res.status(403).json({ error: "Not a participant" });
  const list = memory.dmMessages.get(dm.id) || [];
  const message = list.find(item => String(item.id) === String(req.params.messageId));
  if (!message) return res.status(404).json({ error: "Message not found" });
  const emoji = String(req.body?.emoji || "👍").slice(0, 8);
  message.reactions = message.reactions || {};
  message.reactions[emoji] = message.reactions[emoji] || [];
  const users = message.reactions[emoji];
  const idx = users.map(String).indexOf(String(req.user.id));
  if (idx === -1) users.push(String(req.user.id)); else users.splice(idx, 1);
  schedulePersist();
  io.to(socketRoom("dm", dm.id)).emit("dm:reaction", { dmId: dm.id, messageId: message.id, reactions: message.reactions });
  res.json({ reactions: message.reactions });
});

app.post("/api/dms/:id/read", auth, (req, res) => {
  const dm = memory.dms.get(req.params.id);
  if (!dm || !dm.members.includes(String(req.user.id))) return res.status(403).json({ error: "Not a participant" });
  const readAt = now();
  const list = memory.dmMessages.get(dm.id) || [];
  let changed = false;
  for (const message of list) {
    if (String(message.user_id) !== String(req.user.id) && !message.seen_at) {
      message.seen_at = readAt;
      changed = true;
    }
  }
  memory.dmReads.set(dm.id + ":" + req.user.id, readAt);
  if (changed) io.to(socketRoom("dm", dm.id)).emit("dm:read", { dmId: dm.id, readerId: req.user.id, readAt });
  res.json({ ok: true, readAt });
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
  audit(req.user.id, "MESSAGE_EDIT", found.message.id, { serverId: channel.serverId });
  res.json({ message: found.message });
});
app.delete("/api/messages/:id", auth, (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: "Message not found" });
  const channel = memory.channels.get(found.channelId);
  if (!channel) return res.status(404).json({ error: "Channel not found" });
  const access = member(channel.serverId, req.user.id);
  const ownMessage = String(found.message.user_id) === String(req.user.id);
  if (!ownMessage) {
    if (!canManage(access?.role) || !hasAdminToken(req, channel.serverId)) {
      return res.status(403).json({ error: "Admin key required to moderate another user's message" });
    }
  } else if (!canEditMessage(found, req.user)) {
    return res.status(403).json({ error: "Permission denied" });
  }
  const [deleted] = found.list.splice(found.index, 1);
  io.to("channel:" + found.channelId).emit("message:delete", { messageId: deleted.id });
  audit(req.user.id, "MESSAGE_DELETE", deleted.id, { serverId: channel.serverId });
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

app.post("/api/servers/:id/admin/auth", auth, (req, res) => {
  const serverId = String(req.params.id);
  const access = member(serverId, req.user.id);
  if (!access || !canManage(access.role)) return res.status(403).json({ error: "Permission denied" });
  if (!ADMIN_CONTROL_KEY) return res.status(503).json({ error: "Admin control key is not configured" });

  const attemptKey = adminAttemptKey(req);
  const nowMs = Date.now();
  const history = adminKeyAttempts.get(attemptKey) || { count: 0, resetAt: nowMs + 10 * 60 * 1000 };
  if (nowMs > history.resetAt) {
    history.count = 0;
    history.resetAt = nowMs + 10 * 60 * 1000;
  }
  if (history.count >= 8) return res.status(429).json({ error: "Too many key attempts. Try again later." });

  const provided = String(req.body?.key || "").trim();
  if (provided !== ADMIN_CONTROL_KEY) {
    history.count += 1;
    adminKeyAttempts.set(attemptKey, history);
    audit(req.user.id, "ADMIN_KEY_FAILED", serverId, { serverId });
    return res.status(401).json({ error: "Invalid admin key" });
  }

  adminKeyAttempts.delete(attemptKey);
  const adminToken = adminTokenFor(req.user, serverId, access.role);
  audit(req.user.id, "ADMIN_KEY_AUTH", serverId, { serverId, role: access.role });
  res.json({
    ok: true,
    token: adminToken,
    expiresIn: 8 * 60 * 60,
    role: access.role,
    server: { id: access.server.id, name: access.server.name }
  });
});

app.get("/api/servers/:id/audit", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  const rows=memory.audit.filter(item=>String(item?.details?.serverId||"")===String(access.server.id)).slice(0,150);
  res.json({audit:rows});
});

app.get("/api/servers/:id/admin/dashboard", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  const server=access.server;
  const settings=serverSettings(server);
  const members=[...server.members.entries()].map(([userId,role])=>{
    const user=memory.users.get(userId);
    return user?{...publicUser(user),role,joinedAt:user.createdAt,banned:isServerBanned(server,user.id)}:null;
  }).filter(Boolean).sort((a,b)=>({owner:0,admin:1,moderator:2,member:3}[a.role]??9)-({owner:0,admin:1,moderator:2,member:3}[b.role]??9)||a.username.localeCompare(b.username));
  const channels=server.channels.map(channelId=>memory.channels.get(channelId)).filter(Boolean).map(channel=>({
    ...channel,
    messageCount:(memory.messages.get(channel.id)||[]).length,
    activeParticipants:[...(io.sockets.adapter.rooms.get(callRoomFor(channel.id))||[])].map(socketId=>io.sockets.sockets.get(socketId)).filter(Boolean).map(callParticipant)
  }));
  const messages=[];
  for(const channel of channels) for(const message of (memory.messages.get(channel.id)||[])) messages.push({...message,channel_name:channel.name,channel_type:channel.type});
  messages.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const calls=livePulseSnapshot().calls.filter(call=>String(call.serverId)===String(server.id));
  const auditRows=memory.audit.filter(item=>String(item?.details?.serverId||"")===String(server.id)).slice(0,150);
  res.json({
    ok:true,
    server:{id:server.id,name:server.name,ownerId:server.ownerId,createdAt:server.createdAt,role:access.role,memberCount:server.members.size,channelCount:server.channels.length,settings},
    permissions:{
      manageMembers:["owner","admin"].includes(access.role),
      manageRoles:["owner","admin"].includes(access.role),
      manageSecurity:["owner","admin"].includes(access.role),
      deleteMessages:canManage(access.role),
      deleteChannels:["owner","admin"].includes(access.role)
    },
    stats:{
      members:server.members.size,
      online:members.filter(m=>m.status==="online").length,
      channels:channels.length,
      textChannels:channels.filter(c=>c.type!=="voice").length,
      voiceChannels:channels.filter(c=>c.type==="voice").length,
      messages:messages.length,
      activeCalls:calls.length,
      activeCallParticipants:calls.reduce((sum,c)=>sum+c.participants.length,0),
      banned:server.bannedUserIds.length,
      auditEvents:auditRows.length
    },
    members,
    channels,
    messages:messages.slice(0,250),
    calls,
    audit:auditRows,
    bans:server.bannedUserIds.map(idValue=>memory.users.get(idValue)).filter(Boolean).map(publicUser)
  });
});

app.patch("/api/servers/:id/admin/settings", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const settings=serverSettings(access.server);
  if(req.body?.locked!==undefined) settings.locked=Boolean(req.body.locked);
  if(req.body?.slowmode!==undefined){
    const value=Number(req.body.slowmode);
    if(!Number.isFinite(value)||value<0||value>120) return res.status(400).json({error:"Slowmode must be between 0 and 120 seconds"});
    settings.slowmode=Math.round(value);
  }
  if(req.body?.verification!==undefined){
    const v=String(req.body.verification);
    if(!["open","verified","high"].includes(v)) return res.status(400).json({error:"Unsupported verification level"});
    settings.verification=v;
  }
  audit(req.user.id,"SERVER_SETTINGS_UPDATE",access.server.id,{serverId:access.server.id,settings:{...settings}});
  res.json({ok:true,settings});
});

app.patch("/api/servers/:id/admin/members/:userId/role", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const target=member(req.params.id,req.params.userId);
  if(!target || target.role==="owner") return res.status(400).json({error:"Member cannot be changed"});
  if(access.role==="admin" && target.role==="admin") return res.status(403).json({error:"Only the owner can change another admin"});
  const nextRole=["member","moderator","admin"].includes(String(req.body?.role))?String(req.body.role):null;
  if(!nextRole) return res.status(400).json({error:"Unsupported role"});
  if(access.role==="admin" && nextRole==="admin") return res.status(403).json({error:"Only the owner can grant admin"});
  target.server.members.set(req.params.userId,nextRole);
  audit(req.user.id,"SERVER_ROLE_UPDATE",req.params.userId,{serverId:target.server.id,role:nextRole});
  emitToUser(req.params.userId,"server:role-updated",{serverId:target.server.id,role:nextRole});
  res.json({ok:true,role:nextRole});
});

app.post("/api/servers/:id/admin/members/:userId/kick", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const target=member(req.params.id,req.params.userId);
  if(!target || target.role==="owner") return res.status(400).json({error:"Member cannot be kicked"});
  if(access.role==="admin" && target.role==="admin") return res.status(403).json({error:"Only the owner can kick another admin"});
  target.server.members.delete(req.params.userId);
  audit(req.user.id,"SERVER_MEMBER_KICK",req.params.userId,{serverId:target.server.id});
  emitToUser(req.params.userId,"server:removed",{serverId:target.server.id,action:"kick"});
  res.json({ok:true});
});

app.post("/api/servers/:id/admin/members/:userId/ban", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const target=member(req.params.id,req.params.userId);
  if(!target || target.role==="owner") return res.status(400).json({error:"Member cannot be banned"});
  if(access.role==="admin" && target.role==="admin") return res.status(403).json({error:"Only the owner can ban another admin"});
  serverSettings(target.server);
  if(!target.server.bannedUserIds.includes(String(req.params.userId))) target.server.bannedUserIds.push(String(req.params.userId));
  target.server.members.delete(req.params.userId);
  audit(req.user.id,"SERVER_MEMBER_BAN",req.params.userId,{serverId:target.server.id});
  emitToUser(req.params.userId,"server:removed",{serverId:target.server.id,action:"ban"});
  res.json({ok:true});
});

app.post("/api/servers/:id/admin/members/:userId/unban", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const server=access.server;serverSettings(server);
  server.bannedUserIds=server.bannedUserIds.filter(idValue=>String(idValue)!==String(req.params.userId));
  audit(req.user.id,"SERVER_MEMBER_UNBAN",req.params.userId,{serverId:server.id});
  res.json({ok:true});
});

app.delete("/api/servers/:id/admin/channels/:channelId", auth, (req, res) => {
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const server=access.server;
  if(!server.channels.includes(req.params.channelId)) return res.status(404).json({error:"Channel not found"});
  if(server.channels.length<=1) return res.status(400).json({error:"A server must keep at least one channel"});
  server.channels=server.channels.filter(idValue=>String(idValue)!==String(req.params.channelId));
  const channel=memory.channels.get(req.params.channelId);
  memory.channels.delete(req.params.channelId);
  memory.messages.delete(req.params.channelId);
  if(channel) for(const key of [...memory.polls.keys()]){const poll=memory.polls.get(key);if(poll?.channelId===channel.id)memory.polls.delete(key);}
  io.to("channel:"+req.params.channelId).emit("channel:deleted",{channelId:req.params.channelId});
  audit(req.user.id,"CHANNEL_DELETE",req.params.channelId,{serverId:server.id});
  res.json({ok:true});
});

app.get("/api/files", auth, (req,res)=>{
  const limit=Math.max(1,Math.min(100,Number(req.query.limit||40)));
  const files=[...memory.uploads.values()]
    .filter(file=>String(file.user_id)===String(req.user.id))
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0,limit)
    .map(file=>({id:file.id,name:file.name,type:file.type,size:file.size,created_at:file.created_at,download_url:"/api/uploads/"+encodeURIComponent(file.id)}));
  res.json({files});
});


/* ===== Orbit Social OS backend ===== */
app.get("/api/servers/:id/events", auth, (req,res)=>{
  if(!canAccessServer(req.params.id,req.user.id)) return res.status(403).json({error:"Not a member"});
  const nowMs=Date.now();
  const events=[...memory.events.values()]
    .filter(e=>String(e.serverId)===String(req.params.id))
    .filter(e=>!req.query.upcoming || new Date(e.when).getTime()>=nowMs-86400000)
    .sort((a,b)=>new Date(a.when)-new Date(b.when))
    .slice(0,100)
    .map(e=>sanitizeEvent(e,req.user.id));
  res.json({events});
});
app.post("/api/servers/:id/events", auth, (req,res)=>{
  const access=member(req.params.id,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  const title=String(req.body?.title||"").trim().slice(0,140);
  const when=String(req.body?.when||"").trim();
  if(!title||!when||Number.isNaN(new Date(when).getTime())) return res.status(400).json({error:"Valid title and date/time are required"});
  const event={
    id:id("event"),
    serverId:access.server.id,
    title,
    description:String(req.body?.description||"").trim().slice(0,800),
    type:["Community","Gaming","Class","Meeting","Watch party","Voice","Video"].includes(req.body?.type)?req.body.type:"Community",
    when:new Date(when).toISOString(),
    creatorId:req.user.id,
    createdAt:now(),
    updatedAt:now(),
    rsvps:[String(req.user.id)]
  };
  memory.events.set(event.id,event);
  audit(req.user.id,"EVENT_CREATE",event.id,{serverId:event.serverId,title:event.title});
  const result=sanitizeEvent(event,req.user.id);
  emitToServer(event.serverId,"event:created",{event:result});
  res.status(201).json({event:result});
});
app.patch("/api/events/:id", auth, (req,res)=>{
  const event=findEvent(req.params.id);
  if(!event) return res.status(404).json({error:"Event not found"});
  const access=member(event.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  if(String(event.creatorId)!==String(req.user.id) && !canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  if(req.body?.title!==undefined) event.title=String(req.body.title||"").trim().slice(0,140);
  if(req.body?.description!==undefined) event.description=String(req.body.description||"").trim().slice(0,800);
  if(req.body?.type!==undefined && ["Community","Gaming","Class","Meeting","Watch party","Voice","Video"].includes(req.body.type)) event.type=req.body.type;
  if(req.body?.when!==undefined){
    const d=new Date(String(req.body.when));
    if(Number.isNaN(d.getTime())) return res.status(400).json({error:"Invalid event date"});
    event.when=d.toISOString();
  }
  event.updatedAt=now();
  schedulePersist();
  const result=sanitizeEvent(event,req.user.id);
  emitToServer(event.serverId,"event:updated",{event:result});
  res.json({event:result});
});
app.delete("/api/events/:id", auth, (req,res)=>{
  const event=findEvent(req.params.id);
  if(!event) return res.status(404).json({error:"Event not found"});
  const access=member(event.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  if(String(event.creatorId)!==String(req.user.id) && !canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  memory.events.delete(event.id);
  emitToServer(event.serverId,"event:deleted",{eventId:event.id});
  res.json({ok:true});
});
app.post("/api/events/:id/rsvp", auth, (req,res)=>{
  const event=findEvent(req.params.id);
  if(!event) return res.status(404).json({error:"Event not found"});
  if(!canAccessServer(event.serverId,req.user.id)) return res.status(403).json({error:"Not a member"});
  const going=req.body?.going!==false;
  event.rsvps=Array.isArray(event.rsvps)?event.rsvps.map(String):[];
  const uid=String(req.user.id);
  event.rsvps=going?[...new Set([...event.rsvps,uid])]:event.rsvps.filter(x=>x!==uid);
  event.updatedAt=now();
  const result=sanitizeEvent(event,req.user.id);
  emitToServer(event.serverId,"event:rsvp",{event:result});
  res.json({event:result});
});

app.get("/api/servers/:id/projects", auth, (req,res)=>{
  if(!canAccessServer(req.params.id,req.user.id)) return res.status(403).json({error:"Not a member"});
  const projects=[...memory.projects.values()]
    .filter(p=>String(p.serverId)===String(req.params.id))
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(p=>sanitizeProject(p,req.user.id));
  res.json({projects});
});
app.post("/api/servers/:id/projects", auth, (req,res)=>{
  const access=member(req.params.id,req.user.id);
  if(!access || !canManage(access.role)) return res.status(403).json({error:"Owner/admin/moderator permission required"});
  const name=String(req.body?.name||"").trim().slice(0,120);
  if(!name) return res.status(400).json({error:"Project name is required"});
  const project={id:id("project"),serverId:access.server.id,name,description:String(req.body?.description||"").trim().slice(0,800),creatorId:req.user.id,createdAt:now(),updatedAt:now(),tasks:[]};
  memory.projects.set(project.id,project);
  audit(req.user.id,"PROJECT_CREATE",project.id,{serverId:project.serverId,name:project.name});
  const result=sanitizeProject(project,req.user.id);
  emitToServer(project.serverId,"project:created",{project:result});
  res.status(201).json({project:result});
});
app.patch("/api/projects/:id", auth, (req,res)=>{
  const project=findProject(req.params.id);
  if(!project) return res.status(404).json({error:"Project not found"});
  const access=member(project.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  if(String(project.creatorId)!==String(req.user.id)&&!canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  if(req.body?.name!==undefined) project.name=String(req.body.name||"").trim().slice(0,120);
  if(req.body?.description!==undefined) project.description=String(req.body.description||"").trim().slice(0,800);
  project.updatedAt=now();
  const result=sanitizeProject(project,req.user.id);
  emitToServer(project.serverId,"project:updated",{project:result});
  res.json({project:result});
});
app.delete("/api/projects/:id", auth, (req,res)=>{
  const project=findProject(req.params.id);
  if(!project) return res.status(404).json({error:"Project not found"});
  const access=member(project.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  if(String(project.creatorId)!==String(req.user.id)&&!canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  memory.projects.delete(project.id);
  emitToServer(project.serverId,"project:deleted",{projectId:project.id});
  res.json({ok:true});
});
app.post("/api/projects/:id/tasks", auth, (req,res)=>{
  const project=findProject(req.params.id);
  if(!project) return res.status(404).json({error:"Project not found"});
  if(!canAccessServer(project.serverId,req.user.id)) return res.status(403).json({error:"Not a member"});
  const title=String(req.body?.title||"").trim().slice(0,180);
  if(!title) return res.status(400).json({error:"Task title is required"});
  const task={id:id("task"),title,description:String(req.body?.description||"").trim().slice(0,1000),status:["backlog","in-progress","done"].includes(req.body?.status)?req.body.status:"backlog",label:String(req.body?.label||"Workspace").slice(0,40),assigneeId:req.body?.assigneeId?String(req.body.assigneeId):null,createdBy:req.user.id,createdAt:now(),updatedAt:now()};
  project.tasks.push(task);
  project.updatedAt=now();
  const result=sanitizeProject(project,req.user.id);
  emitToServer(project.serverId,"project:task-created",{project:result,task});
  res.status(201).json({project:result,task});
});
app.patch("/api/projects/:projectId/tasks/:taskId", auth, (req,res)=>{
  const project=findProject(req.params.projectId);
  if(!project) return res.status(404).json({error:"Project not found"});
  const access=member(project.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  const task=project.tasks.find(t=>String(t.id)===String(req.params.taskId));
  if(!task) return res.status(404).json({error:"Task not found"});
  if(req.body?.title!==undefined) task.title=String(req.body.title||"").trim().slice(0,180);
  if(req.body?.description!==undefined) task.description=String(req.body.description||"").trim().slice(0,1000);
  if(req.body?.status!==undefined && ["backlog","in-progress","done"].includes(req.body.status)) task.status=req.body.status;
  if(req.body?.label!==undefined) task.label=String(req.body.label||"Workspace").slice(0,40);
  if(req.body?.assigneeId!==undefined) task.assigneeId=req.body.assigneeId?String(req.body.assigneeId):null;
  task.updatedAt=now(); project.updatedAt=now();
  const result=sanitizeProject(project,req.user.id);
  emitToServer(project.serverId,"project:task-updated",{project:result,task});
  res.json({project:result,task});
});
app.delete("/api/projects/:projectId/tasks/:taskId", auth, (req,res)=>{
  const project=findProject(req.params.projectId);
  if(!project) return res.status(404).json({error:"Project not found"});
  const access=member(project.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  project.tasks=project.tasks.filter(t=>String(t.id)!==String(req.params.taskId));
  project.updatedAt=now();
  emitToServer(project.serverId,"project:task-deleted",{projectId:project.id,taskId:req.params.taskId});
  res.json({ok:true});
});

app.get("/api/ai/conversations", auth, (req,res)=>{
  const conversations=[...memory.aiConversations.values()]
    .filter(c=>String(c.userId)===String(req.user.id))
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0,30)
    .map(c=>({id:c.id,title:c.title,serverId:c.serverId||null,createdAt:c.createdAt,updatedAt:c.updatedAt,messages:c.messages||[]}));
  res.json({conversations});
});
app.post("/api/ai/chat", auth, async (req,res)=>{
  const message=String(req.body?.message||"").trim().slice(0,4000);
  if(!message) return res.status(400).json({error:"Message is required"});
  let conversation=req.body?.conversationId?memory.aiConversations.get(String(req.body.conversationId)):null;
  const serverId=req.body?.serverId?String(req.body.serverId):null;
  if(serverId && !canAccessServer(serverId,req.user.id)) return res.status(403).json({error:"Not a member"});
  if(conversation && String(conversation.userId)!==String(req.user.id)) return res.status(403).json({error:"Conversation access denied"});
  if(!conversation){
    conversation={id:id("ai"),userId:req.user.id,serverId,title:message.slice(0,80),createdAt:now(),updatedAt:now(),messages:[]};
    memory.aiConversations.set(conversation.id,conversation);
  }
  conversation.messages.push({role:"user",content:message,createdAt:now()});
  conversation.messages=conversation.messages.slice(-40);
  let reply=null;
  let usedProvider=false;
  try{
    const modelMessages=[
      {role:"system",content:"You are ORBIT, an optional assistant inside a community communication platform. Respect server/member permissions. Never claim access to private data that is not present in this conversation."},
      ...conversation.messages.slice(-20).map(m=>({role:m.role,content:m.content}))
    ];
    const modelResult=await requestOrbitModel(modelMessages);
    if(modelResult?.content){
      reply=modelResult.content;
      usedProvider=modelResult.provider||"local";
    }
  }catch(error){
    console.error("[orbit] AI provider failed:",error.message);
  }
  if(!reply) reply=localOrbitReply(message);
  conversation.messages.push({role:"assistant",content:reply,createdAt:now()});
  conversation.updatedAt=now();
  audit(req.user.id,"AI_CHAT",conversation.id,{serverId:conversation.serverId||null,provider:usedProvider});
  res.json({conversation:{id:conversation.id,title:conversation.title,serverId:conversation.serverId||null,messages:conversation.messages},reply,provider:usedProvider||"local"});
});

app.get("/api/servers/:id/live", auth, (req,res)=>{
  if(!canAccessServer(req.params.id,req.user.id)) return res.status(403).json({error:"Not a member"});
  const sessions=[...memory.liveSessions.values()]
    .filter(s=>String(s.serverId)===String(req.params.id)&&s.status==="live")
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(s=>sanitizeLive(s));
  res.json({sessions});
});
app.post("/api/servers/:id/live", auth, (req,res)=>{
  const access=member(req.params.id,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  const channel=memory.channels.get(String(req.body?.channelId||""));
  if(!channel || String(channel.serverId)!==String(access.server.id) || channel.type!=="voice") return res.status(400).json({error:"Choose a Voice Space for the live session"});
  const existing=[...memory.liveSessions.values()].find(s=>String(s.channelId)===String(channel.id)&&s.status==="live");
  if(existing) return res.status(409).json({error:"A live session is already active in this Space",session:sanitizeLive(existing)});
  const session={id:id("live"),serverId:access.server.id,channelId:channel.id,hostUserId:req.user.id,title:String(req.body?.title||channel.name+" Live").trim().slice(0,140),category:String(req.body?.category||"Community").trim().slice(0,60),status:"live",createdAt:now(),endedAt:null};
  memory.liveSessions.set(session.id,session);
  emitToServer(session.serverId,"live:started",{session:sanitizeLive(session)});
  res.status(201).json({session:sanitizeLive(session)});
});
app.post("/api/live/:id/end", auth, (req,res)=>{
  const session=memory.liveSessions.get(String(req.params.id));
  if(!session) return res.status(404).json({error:"Live session not found"});
  const access=member(session.serverId,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  if(String(session.hostUserId)!==String(req.user.id)&&!canManage(access.role)) return res.status(403).json({error:"Permission denied"});
  session.status="ended";session.endedAt=now();
  emitToServer(session.serverId,"live:ended",{sessionId:session.id});
  res.json({ok:true});
});

app.post("/api/uploads", auth, (req,res)=>{
  const data=String(req.body?.data||"");
  if(!data || data.length>6_000_000) return res.status(400).json({error:"File is missing or too large"});
  const type=String(req.body?.type||"application/octet-stream").slice(0,120);
  const size=Number(req.body?.size||0);
  const purpose=String(req.body?.purpose||"file");
  if (purpose==="avatar" && (size>2_000_000 || !type.startsWith("image/"))) return res.status(400).json({error:"Avatar must be an image up to 2 MB"});
  if (purpose==="avatar-decoration" && (size>1_000_000 || !type.startsWith("image/"))) return res.status(400).json({error:"Avatar decoration must be an image up to 1 MB"});
  if (purpose==="server-icon" && (size>2_000_000 || !type.startsWith("image/"))) return res.status(400).json({error:"Server icon must be an image up to 2 MB"});
  if (purpose==="server-banner" && (size>2_000_000 || !type.startsWith("image/"))) return res.status(400).json({error:"Server banner must be an image up to 2 MB"});
  const item={id:id("file"),name:String(req.body?.name||"file").slice(0,180),type,size,data,created_at:now(),user_id:req.user.id};
  memory.uploads.set(item.id,item);
  res.status(201).json({file:{id:item.id,name:item.name,type:item.type,size:item.size}});
});
app.get("/api/uploads/:id", auth, (req,res)=>{
  const file=memory.uploads.get(req.params.id);
  if(!file) return res.status(404).end();
  res.type(file.type).send(Buffer.from(String(file.data).replace(/^data:[^;]+;base64,/,""),"base64"));
});
app.get("/api/avatar/:id",(req,res)=>{
  const file=memory.uploads.get(String(req.params.id));
  if(!file || !String(file.type||"").startsWith("image/")) return res.status(404).end();
  res.set("Cache-Control","public, max-age=31536000, immutable");
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
  if (req.body?.username !== undefined) {
    const desired = cleanUsername(req.body.username, req.user.username);
    if (desired !== req.user.username) {
      const available = uniqueUsername(desired, req.user.id);
      if (available !== desired) {
        return res.status(409).json({ error: "Username is already taken", suggested: available });
      }
      req.user.username = desired;
    }
  }
  if (req.body?.displayName !== undefined) {
    req.user.displayName = cleanName(req.body.displayName, req.user.username);
  }
  if (req.body?.bio !== undefined) {
    req.user.bio = String(req.body.bio||"").trim().slice(0,500);
  }
  if (req.body?.activity !== undefined || req.body?.activityType !== undefined) {
    const activity=String(req.body?.activity||"").trim().slice(0,80);
    const type=String(req.body?.activityType||"custom").trim().toLowerCase().slice(0,24);
    req.user.activity = activity || "Online";
    req.user.activityType = type || "custom";
  }
  if (req.body?.avatarUrl !== undefined) {
    const avatarUrl = String(req.body.avatarUrl || "").trim();
    if (avatarUrl && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(avatarUrl)) {
      return res.status(400).json({ error: "Invalid avatar" });
    }
    req.user.avatarUrl = avatarUrl || null;
  }
  if (req.body?.avatarDecoration !== undefined) {
    const decoration = String(req.body.avatarDecoration || "none").trim().toLowerCase();
    if (!AVATAR_DECORATIONS.has(decoration)) return res.status(400).json({ error: "Invalid avatar decoration" });
    req.user.avatarDecoration = decoration;
  }
  if (req.body?.avatarDecorationUrl !== undefined) {
    const decorationUrl = String(req.body.avatarDecorationUrl || "").trim();
    if (decorationUrl && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(decorationUrl)) {
      return res.status(400).json({ error: "Invalid avatar decoration" });
    }
    req.user.avatarDecorationUrl = decorationUrl || null;
  }
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
    channels: [channelId, voiceId],
    settings: {locked:false,slowmode:0,verification:"open",theme:{accent:"#7c5cff",secondary:"#14b8a6",icon_url:null,banner_url:null,description:"",welcomeMessage:"Welcome to our Orbit community."}},
    bannedUserIds: []
  };
  ensureUserStats(req.user).serversCreated+=1;
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

app.get("/api/servers/:id/community", auth, (req,res)=>{
  const access=member(req.params.id,req.user.id);
  if(!access) return res.status(403).json({error:"Not a member"});
  const settings=serverSettings(access.server);
  res.json({server:{id:access.server.id,name:access.server.name,owner_id:access.server.ownerId},role:access.role,theme:settings.theme});
});
app.patch("/api/servers/:id/community", auth, (req,res)=>{
  const access=member(req.params.id,req.user.id);
  if(!access || !["owner","admin"].includes(access.role)) return res.status(403).json({error:"Permission denied"});
  const settings=serverSettings(access.server);
  const body=req.body||{};
  if(body.accent!==undefined){
    const accent=String(body.accent||"").trim();
    if(!/^#[0-9a-f]{6}$/i.test(accent)) return res.status(400).json({error:"Invalid accent color"});
    settings.theme.accent=accent;
  }
  if(body.secondary!==undefined){
    const secondary=String(body.secondary||"").trim();
    if(!/^#[0-9a-f]{6}$/i.test(secondary)) return res.status(400).json({error:"Invalid secondary color"});
    settings.theme.secondary=secondary;
  }
  if(body.iconUrl!==undefined){
    const v=String(body.iconUrl||"").trim();
    if(v && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(v)) return res.status(400).json({error:"Invalid server icon"});
    settings.theme.icon_url=v||null;
  }
  if(body.bannerUrl!==undefined){
    const v=String(body.bannerUrl||"").trim();
    if(v && !/^\/api\/avatar\/[A-Za-z0-9_-]+$/.test(v)) return res.status(400).json({error:"Invalid server banner"});
    settings.theme.banner_url=v||null;
  }
  if(body.description!==undefined) settings.theme.description=String(body.description||"").trim().slice(0,500);
  if(body.welcomeMessage!==undefined) settings.theme.welcomeMessage=String(body.welcomeMessage||"").trim().slice(0,700);
  res.json({ok:true,theme:settings.theme});
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
  audit(req.user.id, "CHANNEL_CREATE", channel.id, { serverId: access.server.id, name: channel.name, type: channel.type });
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
  audit(req.user.id, "INVITE_CREATE", access.server.id, { serverId: access.server.id, code });
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
  if (isServerBanned(server, req.user.id)) return res.status(403).json({ error: "You are banned from this server" });
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


// ============================================================
// ORBIT OWNER CONSOLE — platform-wide administration
// ============================================================
app.post("/api/owner/auth", auth, (req, res) => {
  if (!ORBIT_OWNER_CONTROL_KEY) return res.status(503).json({ error: "Owner control key is not configured" });
  const attemptKey = ownerAttemptKey(req);
  const nowMs = Date.now();
  const history = ownerKeyAttempts.get(attemptKey) || { count: 0, resetAt: nowMs + 10 * 60 * 1000 };
  if (nowMs > history.resetAt) {
    history.count = 0;
    history.resetAt = nowMs + 10 * 60 * 1000;
  }
  if (history.count >= 8) return res.status(429).json({ error: "Too many owner key attempts. Try again later." });
  const provided = String(req.body?.key || "").trim();
  if (provided !== ORBIT_OWNER_CONTROL_KEY) {
    history.count += 1;
    ownerKeyAttempts.set(attemptKey, history);
    audit(req.user.id, "OWNER_KEY_FAILED", req.user.id, {});
    return res.status(401).json({ error: "Invalid owner key" });
  }
  ownerKeyAttempts.delete(attemptKey);
  audit(req.user.id, "OWNER_KEY_AUTH", req.user.id, {});
  res.json({ ok: true, token: ownerTokenFor(req.user), expiresIn: 8 * 60 * 60 });
});

function ownerUsersSnapshot() {
  return [...memory.users.values()].map(user => {
    let channelMessages = 0;
    let dmMessages = 0;
    let serverCount = 0;
    for (const server of memory.servers.values()) if (server.members.has(String(user.id))) serverCount += 1;
    for (const list of memory.messages.values()) for (const message of list) if (String(message.user_id) === String(user.id)) channelMessages += 1;
    for (const list of memory.dmMessages.values()) for (const message of list) if (String(message.user_id) === String(user.id)) dmMessages += 1;
    return {
      ...publicUser(user),
      suspended: Boolean(user.suspended),
      suspendedAt: user.suspendedAt || null,
      suspendedReason: user.suspendedReason || null,
      serverCount,
      channelMessages,
      dmMessages,
      totalMessages: channelMessages + dmMessages
    };
  }).sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

app.get("/api/owner/dashboard", auth, (req, res) => {
  if (!requireOwner(req, res)) return;
  let messages = 0;
  for (const list of memory.messages.values()) messages += list.length;
  let dmMessages = 0;
  for (const list of memory.dmMessages.values()) dmMessages += list.length;
  const calls = livePulseSnapshot().calls;
  res.json({
    ok: true,
    me: { id: req.user.id, username: req.user.username },
    stats: {
      users: memory.users.size,
      online: [...memory.users.values()].filter(u => u.status === "online" && !u.suspended).length,
      suspended: [...memory.users.values()].filter(u => u.suspended).length,
      servers: memory.servers.size,
      channels: memory.channels.size,
      messages,
      dmConversations: memory.dms.size,
      dmMessages,
      uploads: memory.uploads.size,
      activeCalls: calls.length,
      callParticipants: calls.reduce((n, c) => n + c.participants.length, 0),
      auditEvents: memory.audit.length,
      uptime: Math.floor(process.uptime()),
      persistence: persistMode
    },
    users: ownerUsersSnapshot().slice(0, 500),
    calls,
    audit: memory.audit.slice(0, 200)
  });
});

app.get("/api/owner/users/:id", auth, (req, res) => {
  if (!requireOwner(req, res)) return;
  const user = memory.users.get(String(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  const servers = [...memory.servers.values()].filter(s => s.members.has(String(user.id))).map(s => ({
    id: s.id, name: s.name, role: s.members.get(String(user.id)), ownerId: s.ownerId
  }));
  const messages = [];
  for (const channel of memory.channels.values()) {
    const list = memory.messages.get(channel.id) || [];
    for (const message of list) if (String(message.user_id) === String(user.id)) {
      const server = memory.servers.get(String(channel.serverId));
      messages.push({ ...message, kind: "channel", serverId: channel.serverId, serverName: server?.name || "Community", channelId: channel.id, channelName: channel.name });
    }
  }
  messages.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  const dms = [...memory.dms.values()].filter(dm => dm.members.includes(String(user.id))).map(dm => {
    const members = dm.members.map(idValue => {
      const memberUser = memory.users.get(String(idValue));
      return memberUser ? { id: memberUser.id, username: memberUser.username, display_name: memberUser.displayName || memberUser.username } : { id: idValue };
    });
    return { ...dm, members, messages: memory.dmMessages.get(dm.id) || [] };
  });
  const uploads = [...memory.uploads.values()].filter(file => String(file.user_id) === String(user.id))
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(file => ({id:file.id,name:file.name,type:file.type,size:file.size,created_at:file.created_at}));
  res.json({
    ok: true,
    user: {
      ...publicUser(user),
      suspended: Boolean(user.suspended),
      suspendedAt: user.suspendedAt || null,
      suspendedReason: user.suspendedReason || null,
      accountCreatedAt: user.accountCreatedAt || user.createdAt || null
    },
    servers,
    messages,
    dms,
    uploads
  });
});

app.post("/api/owner/users/:id/suspend", auth, (req, res) => {
  if (!requireOwner(req, res)) return;
  const targetId = String(req.params.id);
  if (targetId === String(req.user.id)) return res.status(400).json({ error: "The owner cannot suspend the current owner session." });
  const user = memory.users.get(targetId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.suspended = true;
  user.suspendedAt = now();
  user.suspendedReason = String(req.body?.reason || "Suspended by platform owner").trim().slice(0, 300);
  user.status = "offline";
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket.user?.id) === targetId) socket.disconnect(true);
  }
  audit(req.user.id, "OWNER_USER_SUSPEND", targetId, { reason: user.suspendedReason });
  schedulePersist();
  res.json({ ok: true, user: publicUser(user), suspended: true });
});

app.post("/api/owner/users/:id/unsuspend", auth, (req, res) => {
  if (!requireOwner(req, res)) return;
  const user = memory.users.get(String(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  user.suspended = false;
  user.suspendedAt = null;
  user.suspendedReason = null;
  user.status = "offline";
  audit(req.user.id, "OWNER_USER_UNSUSPEND", user.id, {});
  schedulePersist();
  res.json({ ok: true, user: publicUser(user), suspended: false });
});

app.post("/api/owner/messages/delete", auth, (req, res) => {
  if (!requireOwner(req, res)) return;
  const kind = String(req.body?.kind || "channel");
  const messageId = String(req.body?.messageId || "");
  if (!messageId) return res.status(400).json({ error: "Message id is required" });
  if (kind === "channel") {
    const found = findMessage(messageId);
    if (!found) return res.status(404).json({ error: "Message not found" });
    found.list.splice(found.index, 1);
    io.to("channel:" + found.channelId).emit("message:delete", { messageId });
    const channel = memory.channels.get(found.channelId);
    audit(req.user.id, "OWNER_MESSAGE_DELETE", messageId, { kind, serverId: channel?.serverId || null, channelId: found.channelId });
    schedulePersist();
    return res.json({ ok: true });
  }
  for (const [dmId, list] of memory.dmMessages.entries()) {
    const index = list.findIndex(m => String(m.id) === messageId);
    if (index !== -1) {
      const [deleted] = list.splice(index, 1);
      io.to(socketRoom("dm", dmId)).emit("dm:message:delete", { dmId, messageId });
      audit(req.user.id, "OWNER_DM_MESSAGE_DELETE", messageId, { kind: "dm", dmId, userId: deleted.user_id });
      schedulePersist();
      return res.json({ ok: true });
    }
  }
  return res.status(404).json({ error: "Message not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const user = memory.users.get(payload.id);
    if (!user || !payload.account || !user.passwordHash) return next(new Error("Account authentication required"));
    if (user.suspended) return next(new Error("Account suspended"));
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
function livePulseSnapshot() {
  const activeCalls = [];
  for (const roomName of io.sockets.adapter.rooms.keys()) {
    if (!roomName.startsWith(CALL_EVENT_PREFIX)) continue;
    const channelId = roomName.slice(CALL_EVENT_PREFIX.length);
    const channel = memory.channels.get(channelId);
    if (!channel) continue;
    const ids = [...(io.sockets.adapter.rooms.get(roomName) || [])];
    const participants = ids.map(socketId => io.sockets.sockets.get(socketId)).filter(Boolean).map(callParticipant);
    activeCalls.push({
      roomId: roomName,
      channelId: channel.id,
      serverId: channel.serverId,
      channelName: channel.name,
      participants
    });
  }
  const liveUsers = [...memory.users.values()].map(u => ({
    ...publicUser(u),
    activity: u.activity || "Online",
    activityChannelId: u.activityChannelId || null,
    activityChannelName: u.activityChannelName || null,
    activityServerId: u.activityServerId || null
  }));
  return { users: liveUsers, calls: activeCalls, generatedAt: now() };
}
function emitPulse(type, data = {}) {
  io.emit("pulse:update", {
    id: id("pulse"),
    type,
    createdAt: now(),
    ...data
  });
}

io.on("connection", socket => {
  socket.onAny(() => setImmediate(schedulePersist));
  socket.user.activity = socket.user.activity || "Online";
  socket.user.status = "online";
  socket.emit("pulse:snapshot", livePulseSnapshot());
  socket.broadcast.emit("presence:update", {
    userId: socket.user.id,
    status: "online",
    activity: socket.user.activity || "Online"
  });
  emitPulse("presence", { user: publicUser(socket.user), activity: socket.user.activity || "Online" });

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

    const server = memory.servers.get(channel.serverId);
    const role = server?.members.get(socket.user.id);
    const settings = server ? serverSettings(server) : { locked:false, slowmode:0 };
    if (settings.locked && !canManage(role)) {
      socket.emit("error:toast", { message: "This server is currently locked by an administrator." });
      return;
    }
    const rateKey = channel.serverId + ":" + socket.user.id;
    const lastMessageAt = serverMessageRate.get(rateKey) || 0;
    if (settings.slowmode > 0 && !canManage(role)) {
      const wait = (settings.slowmode * 1000) - (Date.now() - lastMessageAt);
      if (wait > 0) {
        socket.emit("error:toast", { message: "Slowmode is enabled. Try again in " + Math.ceil(wait / 1000) + "s." });
        return;
      }
    }
    serverMessageRate.set(rateKey, Date.now());

    ensureUserStats(socket.user).messages+=1;
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
    emitPulse("message", {
      serverId: channel.serverId,
      channelId: channel.id,
      channelName: channel.name,
      user: publicUser(socket.user),
      preview: text.slice(0, 120)
    });
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
    ensureUserStats(socket.user).voiceJoins+=1;
    socket.user.activity = mode === "voice" ? "In voice" : "In video";
    socket.user.activityChannelId = channel.id;
    socket.user.activityChannelName = channel.name;
    socket.user.activityServerId = channel.serverId;
    socket.broadcast.emit("presence:update", {
      userId: socket.user.id,
      status: "online",
      activity: socket.user.activity,
      activityChannelId: channel.id,
      activityChannelName: channel.name,
      activityServerId: channel.serverId
    });
    emitPulse("call-start", {
      serverId: channel.serverId,
      channelId: channel.id,
      channelName: channel.name,
      mode,
      user: publicUser(socket.user)
    });

    socket.to("channel:" + channel.id).emit("call:incoming", {
      ...callParticipant(socket),
      serverId: channel.serverId,
      channelId: channel.id,
      mode,
      roomId: room,
      createdAt: now()
    });

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
    const channel = memory.channels.get(String(channelId));
    const activeLive=[...memory.liveSessions.values()].find(s=>s.status==="live"&&String(s.channelId)===String(channelId)&&String(s.hostUserId)===String(socket.user.id));
    if(activeLive){
      activeLive.status="ended";
      activeLive.endedAt=now();
      emitToServer(activeLive.serverId,"live:ended",{sessionId:activeLive.id});
    }
    socket.leave(room);
    socket.to(room).emit("call:participant-left", {
      socketId: socket.id,
      userId: socket.user.id
    });
    socket.user.activity = "Online";
    socket.user.activityChannelId = null;
    socket.user.activityChannelName = null;
    socket.user.activityServerId = null;
    socket.broadcast.emit("presence:update", {
      userId: socket.user.id,
      status: "online",
      activity: "Online"
    });
    emitPulse("call-end", {
      serverId: channel?.serverId || null,
      channelId: channel?.id || channelId,
      channelName: channel?.name || null,
      user: publicUser(socket.user)
    });
  });

  socket.on("dm:call", ({ dmId, mode = "video" } = {}, ack) => {
    const dm = memory.dms.get(String(dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) {
      ack?.({ ok: false, error: "Private conversation not found" });
      return;
    }
    const targetUserIds = dm.members.filter(idValue => String(idValue) !== String(socket.user.id)).map(String);
    const targets = [...io.sockets.sockets.values()].filter(peer =>
      targetUserIds.includes(String(peer.user?.id)) && String(peer.id) !== String(socket.id)
    );
    if (!targets.length) {
      ack?.({ ok: false, error: "This person is offline right now." });
      return;
    }
    if (socket.data.dmCallId && dmCalls.has(socket.data.dmCallId)) dmCalls.delete(socket.data.dmCallId);
    const callId = id("dmcall");
    const roomId = dmCallRoomFor(callId);
    const invite = {
      callId,
      dmId: dm.id,
      roomId,
      mode: mode === "voice" ? "voice" : "video",
      callerSocketId: socket.id,
      caller: callParticipant(socket),
      targetUserIds,
      createdAt: now()
    };
    dmCalls.set(callId, invite);
    socket.data.dmCallId = callId;
    socket.data.dmCallRoom = null;
    targets.forEach(peer => peer.emit("dm:call:incoming", {
      scope: "dm",
      callId,
      dmId: dm.id,
      roomId,
      mode: invite.mode,
      socketId: socket.id,
      userId: socket.user.id,
      username: socket.user.username,
      fromUser: callParticipant(socket),
      createdAt: invite.createdAt
    }));
    ack?.({ ok: true, callId, roomId });
  });

  socket.on("dm:call:accept", ({ callId } = {}) => {
    const invite = dmCalls.get(String(callId));
    if (!invite) return socket.emit("error:toast", { message: "That private call has already ended." });
    const dm = memory.dms.get(String(invite.dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) return;
    if (!invite.targetUserIds.includes(String(socket.user.id))) return;
    const caller = io.sockets.sockets.get(String(invite.callerSocketId));
    if (!caller) {
      dmCalls.delete(String(callId));
      return socket.emit("error:toast", { message: "The caller disconnected." });
    }
    caller.join(invite.roomId);
    socket.join(invite.roomId);
    caller.data.dmCallId = invite.callId;
    caller.data.dmCallRoom = invite.roomId;
    socket.data.dmCallId = invite.callId;
    socket.data.dmCallRoom = invite.roomId;
    dmCalls.delete(String(callId));
    caller.emit("dm:call:accepted", {
      scope: "dm",
      callId: invite.callId,
      dmId: invite.dmId,
      roomId: invite.roomId,
      mode: invite.mode,
      participant: callParticipant(socket)
    });
    socket.emit("dm:call:participants", [callParticipant(caller)]);
  });

  socket.on("dm:call:decline", ({ callId } = {}) => {
    const invite = dmCalls.get(String(callId));
    if (!invite) return;
    if (!invite.targetUserIds.includes(String(socket.user.id))) return;
    const caller = io.sockets.sockets.get(String(invite.callerSocketId));
    if (caller) {
      caller.emit("dm:call:declined", {
        callId: invite.callId,
        dmId: invite.dmId,
        userId: socket.user.id,
        username: socket.user.username
      });
    }
    dmCalls.delete(String(callId));
    const callerSocket = io.sockets.sockets.get(String(invite.callerSocketId));
    if (callerSocket?.data?.dmCallId === invite.callId) callerSocket.data.dmCallId = null;
  });

  socket.on("dm:call:cancel", ({ callId } = {}) => {
    const invite = dmCalls.get(String(callId));
    if (!invite || String(invite.callerSocketId) !== String(socket.id)) return;
    invite.targetUserIds.forEach(userId => {
      for (const peer of io.sockets.sockets.values()) {
        if (String(peer.user?.id) === String(userId)) peer.emit("dm:call:cancelled", { callId: invite.callId, dmId: invite.dmId });
      }
    });
    dmCalls.delete(String(callId));
    socket.data.dmCallId = null;
  });

  socket.on("dm:call:leave", ({ callId, dmId } = {}) => {
    const room = socket.data.dmCallRoom || (callId ? dmCallRoomFor(callId) : null);
    if (room && socket.rooms.has(room)) {
      socket.leave(room);
      socket.to(room).emit("dm:call:participant-left", {
        socketId: socket.id,
        userId: socket.user.id,
        dmId: dmId || null
      });
    }
    if (callId && dmCalls.has(String(callId))) dmCalls.delete(String(callId));
    socket.data.dmCallId = null;
    socket.data.dmCallRoom = null;
  });

  socket.on("dm:call:media-state", ({ callId, dmId, muted, cameraOff, screenShare } = {}) => {
    const room = socket.data.dmCallRoom || (callId ? dmCallRoomFor(callId) : null);
    if (!room || !socket.rooms.has(room)) return;
    socket.to(room).emit("dm:call:media-state", {
      socketId: socket.id,
      userId: socket.user.id,
      dmId: dmId || null,
      muted: Boolean(muted),
      cameraOff: Boolean(cameraOff),
      screenShare: Boolean(screenShare)
    });
  });

  socket.on("dmrtc:offer", ({ to, offer } = {}) => {
    const peer = io.sockets.sockets.get(String(to));
    const room = socket.data.dmCallRoom;
    if (!peer || !offer || !room || !socket.rooms.has(room) || !peer.rooms.has(room)) return;
    peer.emit("dmrtc:offer", { from: socket.id, fromUser: callParticipant(socket), offer });
  });

  socket.on("dmrtc:answer", ({ to, answer } = {}) => {
    const peer = io.sockets.sockets.get(String(to));
    const room = socket.data.dmCallRoom;
    if (!peer || !answer || !room || !socket.rooms.has(room) || !peer.rooms.has(room)) return;
    peer.emit("dmrtc:answer", { from: socket.id, answer });
  });

  socket.on("dmrtc:ice", ({ to, candidate } = {}) => {
    const peer = io.sockets.sockets.get(String(to));
    const room = socket.data.dmCallRoom;
    if (!peer || !candidate || !room || !socket.rooms.has(room) || !peer.rooms.has(room)) return;
    peer.emit("dmrtc:ice", { from: socket.id, candidate });
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
    const channel = memory.channels.get(String(channelId));
    if (screenShare) socket.user.activity = "Sharing screen";
    else if (channel && socket.user.activity !== "Online") socket.user.activity = socket.user.activity || "In call";
    socket.to(callRoomFor(channelId)).emit("call:media-state", {
      socketId: socket.id,
      muted: Boolean(muted),
      cameraOff: Boolean(cameraOff),
      screenShare: Boolean(screenShare)
    });
    socket.broadcast.emit("presence:update", {
      userId: socket.user.id,
      status: "online",
      activity: socket.user.activity || "Online",
      activityChannelId: channel?.id || channelId,
      activityChannelName: channel?.name || null,
      activityServerId: channel?.serverId || null
    });
    if (screenShare) emitPulse("screen-share", {
      serverId: channel?.serverId || null,
      channelId: channel?.id || channelId,
      channelName: channel?.name || null,
      user: publicUser(socket.user)
    });
  });

  socket.on("call:decline", ({ channelId, callerSocketId }) => {
    const channel = memory.channels.get(String(channelId));
    if (!channel || !member(channel.serverId, socket.user.id)) return;
    const caller = io.sockets.sockets.get(String(callerSocketId));
    if (caller) {
      caller.emit("call:declined", {
        userId: socket.user.id,
        username: socket.user.username
      });
    }
  });

  socket.on("nexus:event", ({ serverId, type, payload } = {}) => {
    const access = member(String(serverId || ""), socket.user.id);
    if (!access || !canManage(access.role)) return;
    const safeType = String(type || "custom").slice(0, 40);
    const raw = payload && typeof payload === "object" ? payload : {};
    const safePayload = JSON.parse(JSON.stringify(raw));
    const size = JSON.stringify(safePayload).length;
    if (size > 5000) return;
    const event = { type: safeType, payload: safePayload, user: publicUser(socket.user), serverId: access.server.id, createdAt: now() };
    emitToServer(access.server.id, "nexus:event", event);
  });

  socket.on("dm:join", dmId => {
    const dm = memory.dms.get(String(dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) return;
    socket.join(socketRoom("dm", dmId));
  });

  socket.on("dm:typing", ({ dmId, isTyping }) => {
    const dm = memory.dms.get(String(dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) return;
    socket.to(socketRoom("dm", dmId)).emit("dm:typing", {
      dmId: dm.id,
      userId: socket.user.id,
      username: socket.user.username,
      isTyping: Boolean(isTyping)
    });
  });

  socket.on("dm:read", dmId => {
    const dm = memory.dms.get(String(dmId));
    if (!dm || !dm.members.includes(String(socket.user.id))) return;
    const readAt = now();
    const list = memory.dmMessages.get(dm.id) || [];
    let changed = false;
    for (const message of list) {
      if (String(message.user_id) !== String(socket.user.id) && !message.seen_at) {
        message.seen_at = readAt;
        changed = true;
      }
    }
    if (changed) io.to(socketRoom("dm", dm.id)).emit("dm:read", { dmId: dm.id, readerId: socket.user.id, readAt });
  });

  socket.on("disconnect", () => {
    if (socket.data?.dmCallRoom) {
      const room = socket.data.dmCallRoom;
      socket.to(room).emit("dm:call:participant-left", {
        socketId: socket.id,
        userId: socket.user.id
      });
      socket.data.dmCallRoom = null;
      socket.data.dmCallId = null;
    }
    for (const [callId, invite] of dmCalls.entries()) {
      if (String(invite.callerSocketId) === String(socket.id)) {
        invite.targetUserIds.forEach(userId => {
          for (const peer of io.sockets.sockets.values()) {
            if (String(peer.user?.id) === String(userId)) peer.emit("dm:call:cancelled", { callId, dmId: invite.dmId });
          }
        });
        dmCalls.delete(callId);
      }
    }
    for(const session of memory.liveSessions.values()){
      if(session.status==="live" && String(session.hostUserId)===String(socket.user.id)){
        session.status="ended";
        session.endedAt=now();
        emitToServer(session.serverId,"live:ended",{sessionId:session.id});
      }
    }
    socket.user.status = "offline";
    socket.user.activity = "Offline";
    socket.user.activityChannelId = null;
    socket.user.activityChannelName = null;
    socket.user.activityServerId = null;
    socket.broadcast.emit("presence:update", {
      userId: socket.user.id,
      status: "offline",
      activity: "Offline"
    });
    emitPulse("presence", { user: publicUser(socket.user), activity: "Offline" });

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

async function boot() {
  await initPersistence();
  server.listen(PORT, "0.0.0.0", () => console.log("[orbit] guest mode listening on " + PORT + (dbReady ? " with PostgreSQL" : " in memory mode")));
}
boot().catch(error => { console.error("[orbit] boot failed", error); process.exit(1); });