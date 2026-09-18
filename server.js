const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) console.warn("[orbit] DATABASE_URL is not configured yet.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && !/localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function db(query, params = []) {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return pool.query(query, params);
}

async function initDb() {
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS servers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS members (
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (server_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id BIGSERIAL PRIMARY KEY,
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INT NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#7c3aed'
    );
    CREATE TABLE IF NOT EXISTS member_roles (
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (server_id, user_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS channels (
      id BIGSERIAL PRIMARY KEY,
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ,
      uses INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_channel_time_idx ON messages(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id);
  `);
}

function sign(user) {
  return jwt.sign({ id: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Invalid or expired session" }); }
}
async function membership(serverId, userId) {
  const r = await db("SELECT role FROM members WHERE server_id=$1 AND user_id=$2", [serverId, userId]);
  return r.rows[0] || null;
}
function canManage(m) { return m && (m.role === "owner" || m.role === "admin" || m.role === "moderator"); }

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", asyncHandler(async (req, res) => {
  const r = await db("SELECT 1 AS ok");
  res.status(200).json({ ok: true, service: "orbit-chat", db: r.rows[0].ok === 1, time: new Date().toISOString() });
}));

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const username = String(req.body.username || "").trim().replace(/\s+/g, "");
  const password = String(req.body.password || "");
  if (!email || !username || password.length < 8) return res.status(400).json({ error: "Email, username and 8+ character password are required" });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Username must be 3-24 letters, numbers or underscores" });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await db("INSERT INTO users(email,username,password_hash) VALUES($1,$2,$3) RETURNING id,email,username,status,created_at", [email, username, hash]);
    res.status(201).json({ user: r.rows[0], token: sign(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email or username already exists" });
    throw e;
  }
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const login = String(req.body.login || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const r = await db("SELECT * FROM users WHERE LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1) LIMIT 1", [login]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid credentials" });
  await db("UPDATE users SET status='online' WHERE id=$1", [user.id]);
  res.json({ user: { id:user.id,email:user.email,username:user.username,status:"online" }, token: sign(user) });
}));

app.get("/api/me", auth, asyncHandler(async (req, res) => {
  const r = await db("SELECT id,email,username,avatar_url,status,created_at FROM users WHERE id=$1", [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "User not found" });
  res.json({ user: r.rows[0] });
}));

app.get("/api/servers", auth, asyncHandler(async (req,res)=>{
  const r = await db(`
    SELECT s.id,s.name,s.owner_id,
           (SELECT id FROM channels c WHERE c.server_id=s.id ORDER BY position,id LIMIT 1) default_channel_id
    FROM servers s JOIN members m ON m.server_id=s.id
    WHERE m.user_id=$1 ORDER BY s.created_at
  `, [req.user.id]);
  res.json({ servers:r.rows });
}));

app.post("/api/servers", auth, asyncHandler(async (req,res)=>{
  const name = String(req.body.name || "").trim().slice(0,50);
  if (!name) return res.status(400).json({error:"Server name is required"});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = (await client.query("INSERT INTO servers(name,owner_id) VALUES($1,$2) RETURNING *", [name,req.user.id])).rows[0];
    await client.query("INSERT INTO members(server_id,user_id,role) VALUES($1,$2,'owner')", [s.id,req.user.id]);
    await client.query("INSERT INTO roles(server_id,name,permissions,position) VALUES($1,'Owner',$2,100),($1,'Admin',$3,80),($1,'Moderator',$4,60),($1,'Member',$5,10)", [
      s.id,
      JSON.stringify({manage_server:true,manage_channels:true,manage_members:true,send_messages:true,manage_messages:true}),
      JSON.stringify({manage_server:false,manage_channels:true,manage_members:true,send_messages:true,manage_messages:true}),
      JSON.stringify({manage_server:false,manage_channels:false,manage_members:true,send_messages:true,manage_messages:true}),
      JSON.stringify({manage_server:false,manage_channels:false,manage_members:false,send_messages:true,manage_messages:false})
    ]);
    const c = (await client.query("INSERT INTO channels(server_id,name,type,position) VALUES($1,'general','text',0) RETURNING *",[s.id])).rows[0];
    await client.query("COMMIT");
    res.status(201).json({server:s,channel:c});
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));

app.get("/api/servers/:id/channels", auth, asyncHandler(async (req,res)=>{
  const m=await membership(req.params.id,req.user.id); if(!m) return res.status(403).json({error:"Not a member"});
  const r=await db("SELECT id,name,type,position FROM channels WHERE server_id=$1 ORDER BY position,id",[req.params.id]);
  res.json({channels:r.rows, role:m.role});
}));

app.post("/api/servers/:id/channels", auth, asyncHandler(async (req,res)=>{
  const m=await membership(req.params.id,req.user.id); if(!canManage(m)) return res.status(403).json({error:"Permission denied"});
  const name=String(req.body.name||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").slice(0,50);
  const type=["text","announcement"].includes(req.body.type) ? req.body.type : "text";
  if(!name) return res.status(400).json({error:"Channel name is required"});
  const r=await db("INSERT INTO channels(server_id,name,type,position) VALUES($1,$2,$3,(SELECT COALESCE(MAX(position),-1)+1 FROM channels WHERE server_id=$1)) RETURNING *",[req.params.id,name,type]);
  res.status(201).json({channel:r.rows[0]});
}));

app.get("/api/channels/:id/messages", auth, asyncHandler(async (req,res)=>{
  const c=await db("SELECT id,server_id FROM channels WHERE id=$1",[req.params.id]); if(!c.rows[0]) return res.status(404).json({error:"Channel not found"});
  if(!(await membership(c.rows[0].server_id,req.user.id))) return res.status(403).json({error:"Not a member"});
  const r=await db(`
    SELECT m.id,m.channel_id,m.content,m.reply_to_id,m.created_at,m.edited_at,u.id user_id,u.username,u.avatar_url
    FROM messages m JOIN users u ON u.id=m.user_id
    WHERE m.channel_id=$1 ORDER BY m.created_at DESC LIMIT 100
  `,[req.params.id]);
  res.json({messages:r.rows.reverse()});
}));

app.post("/api/servers/:id/invites", auth, asyncHandler(async (req,res)=>{
  const m=await membership(req.params.id,req.user.id); if(!canManage(m)) return res.status(403).json({error:"Permission denied"});
  const code = Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
  const r=await db("INSERT INTO invites(code,server_id,created_by,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days') RETURNING code,expires_at",[code,req.params.id,req.user.id]);
  res.status(201).json({invite:r.rows[0]});
}));

app.post("/api/invites/:code/accept", auth, asyncHandler(async (req,res)=>{
  const i=await db("SELECT * FROM invites WHERE code=$1 AND (expires_at IS NULL OR expires_at>NOW())",[req.params.code]);
  if(!i.rows[0]) return res.status(404).json({error:"Invite expired or invalid"});
  await db("INSERT INTO members(server_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[i.rows[0].server_id,req.user.id]);
  await db("UPDATE invites SET uses=uses+1 WHERE code=$1",[req.params.code]);
  res.json({server_id:i.rows[0].server_id});
}));

app.get("/api/servers/:id/members", auth, asyncHandler(async (req,res)=>{
  if(!(await membership(req.params.id,req.user.id))) return res.status(403).json({error:"Not a member"});
  const r=await db(`
    SELECT u.id,u.username,u.avatar_url,u.status,m.role,m.created_at
    FROM members m JOIN users u ON u.id=m.user_id
    WHERE m.server_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,u.username
  `,[req.params.id]);
  res.json({members:r.rows});
}));

app.patch("/api/servers/:id/members/:userId/role", auth, asyncHandler(async(req,res)=>{
  const actor=await membership(req.params.id,req.user.id); if(!actor || !["owner","admin"].includes(actor.role)) return res.status(403).json({error:"Permission denied"});
  const role=["member","moderator","admin"].includes(req.body.role) ? req.body.role : null;
  if(!role) return res.status(400).json({error:"Unsupported role"});
  await db("UPDATE members SET role=$1 WHERE server_id=$2 AND user_id=$3 AND role <> 'owner'",[role,req.params.id,req.params.userId]);
  res.json({ok:true});
}));

app.use((err,req,res,next)=>{ console.error(err); res.status(500).json({error:"Internal server error"}); });

io.use((socket,next)=>{
  try {
    const token=socket.handshake.auth?.token;
    socket.user=jwt.verify(token,JWT_SECRET);
    next();
  } catch { next(new Error("Unauthorized")); }
});

const online = new Map();
io.on("connection",(socket)=>{
  online.set(String(socket.user.id), socket.id);
  socket.broadcast.emit("presence:update",{userId:String(socket.user.id),status:"online"});

  socket.on("channel:join", async (channelId)=>{
    try {
      const c=await db("SELECT id,server_id FROM channels WHERE id=$1",[channelId]); if(!c.rows[0]) return;
      if(!(await membership(c.rows[0].server_id,socket.user.id))) return;
      [...socket.rooms].filter(r=>/^channel:\d+$/.test(r)).forEach(r=>socket.leave(r));
      socket.join("channel:"+channelId);
    } catch {}
  });

  socket.on("typing", async ({channelId,isTyping})=>{
    if(channelId) socket.to("channel:"+channelId).emit("typing",{userId:String(socket.user.id),username:socket.user.username,isTyping:!!isTyping});
  });

  socket.on("message:send", async ({channelId,content,replyToId})=>{
    try {
      const text=String(content||"").trim().slice(0,4000); if(!text) return;
      const c=await db("SELECT id,server_id FROM channels WHERE id=$1",[channelId]); if(!c.rows[0]) return;
      if(!(await membership(c.rows[0].server_id,socket.user.id))) return;
      const r=await db(`
        INSERT INTO messages(channel_id,user_id,content,reply_to_id)
        VALUES($1,$2,$3,$4)
        RETURNING id,channel_id,content,reply_to_id,created_at
      `,[channelId,socket.user.id,text,replyToId||null]);
      const msg={...r.rows[0],user_id:Number(socket.user.id),username:socket.user.username};
      io.to("channel:"+channelId).emit("message:new",msg);
    } catch {}
  });

  socket.on("disconnect",()=>{
    online.delete(String(socket.user.id));
    socket.broadcast.emit("presence:update",{userId:String(socket.user.id),status:"offline"});
  });
});

(async()=>{
  try {
    await initDb();
    console.log("[orbit] database ready");
  } catch(e) {
    console.error("[orbit] database init failed:",e.message);
  }
  server.listen(PORT,"0.0.0.0",()=>console.log("[orbit] listening on",PORT));
})();