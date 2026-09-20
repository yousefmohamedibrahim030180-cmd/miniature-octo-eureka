const express=require("express");
const http=require("http");
const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");
const {Server}=require("socket.io");

const app=express();
const httpServer=http.createServer(app);
const io=new Server(httpServer,{transports:["polling"],cors:{origin:true,credentials:true}});
const PORT=Number(process.env.PORT||8080);
const DATABASE_URL=String(process.env.DATABASE_URL||"").trim();
const JWT_SECRET=String(process.env.JWT_SECRET||"orbit-v2-dev-secret");
const cookieName="orbit_v2_session";
const memory={sessions:new Map(),callRooms:new Map(),rate:new Map(),callStarted:new Map()};
let db=null;

function id(prefix){return prefix+"_"+crypto.randomUUID()}
function now(){return new Date()}
function iso(v){return new Date(v).toISOString()}
function sha(v){return crypto.createHash("sha256").update(String(v)).digest("hex")}
function cleanUsername(v){return String(v||"").trim().toLowerCase().replace(/^@+/,"").replace(/[^a-z0-9._-]/g,"").slice(0,20)}
function cleanName(v,fallback="ORBIT User"){return String(v||"").trim().replace(/\s+/g," ").slice(0,32)||fallback}
function cookieValue(req,name){
  const raw=String(req.headers.cookie||"");
  for(const item of raw.split(";")){
    const [k,...rest]=item.trim().split("=");
    if(k===name)return decodeURIComponent(rest.join("=")||"");
  }
  return "";
}
function setCookie(res,token){
  const secure=String(res.req?.headers?.["x-forwarded-proto"]||"").split(",")[0].trim()==="https"||process.env.NODE_ENV==="production";
  const parts=[cookieName+"="+encodeURIComponent(token),"Max-Age=2592000","Path=/","HttpOnly","SameSite=Lax"];
  if(secure)parts.push("Secure");
  res.setHeader("Set-Cookie",parts.join("; "));
}
function clearCookie(res){res.setHeader("Set-Cookie",cookieName+"=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")}
function token(){return crypto.randomBytes(48).toString("base64url")}
function publicUser(u){
  if(!u)return null;
  return {
    id:u.id,username:u.username,displayName:u.display_name,bio:u.bio||"",avatarUrl:u.avatar_url||"",
    level:Number(u.level||1),xp:Number(u.xp||0),coins:Number(u.coins||0),
    equipped:{frame:u.avatar_frame||"orbit",effect:u.avatar_effect||"none",nameplate:u.nameplate||"none",chatTheme:u.chat_theme||"orbit-dark"},
    stats:{messages:Number(u.messages_count||0),callMinutes:Number(u.call_minutes||0),friends:Number(u.friends_count||0),communitiesCreated:Number(u.communities_created||0),communitiesJoined:Number(u.communities_joined||0)},
    createdAt:u.created_at
  };
}

async function q(text,params=[]){return db.query(text,params)}
async function tx(fn){
  const client=await db.connect();
  try{await client.query("BEGIN");const result=await fn(client);await client.query("COMMIT");return result}
  catch(e){await client.query("ROLLBACK");throw e}
  finally{client.release()}
}

async function migrate(){
  db=new Pool({connectionString:DATABASE_URL||"postgres://localhost/orbit",max:10,idleTimeoutMillis:30000,connectionTimeoutMillis:8000,ssl:process.env.DATABASE_SSL==="disable"?false:{rejectUnauthorized:false}});
  const statements=[
`CREATE TABLE IF NOT EXISTS v2_users(
id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',
avatar_url TEXT NOT NULL DEFAULT '',avatar_frame TEXT NOT NULL DEFAULT 'orbit',avatar_effect TEXT NOT NULL DEFAULT 'none',
nameplate TEXT NOT NULL DEFAULT 'none',chat_theme TEXT NOT NULL DEFAULT 'orbit-dark',xp INTEGER NOT NULL DEFAULT 0,level INTEGER NOT NULL DEFAULT 1,
coins INTEGER NOT NULL DEFAULT 250,messages_count INTEGER NOT NULL DEFAULT 0,call_minutes INTEGER NOT NULL DEFAULT 0,friends_count INTEGER NOT NULL DEFAULT 0,
communities_created INTEGER NOT NULL DEFAULT 0,communities_joined INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
`CREATE TABLE IF NOT EXISTS v2_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS v2_communities(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',icon_url TEXT NOT NULL DEFAULT '',join_code TEXT UNIQUE NOT NULL,owner_id TEXT NOT NULL REFERENCES v2_users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS v2_members(community_id TEXT NOT NULL REFERENCES v2_communities(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,role TEXT NOT NULL DEFAULT 'member',joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(community_id,user_id))`,
`CREATE TABLE IF NOT EXISTS v2_channels(id TEXT PRIMARY KEY,community_id TEXT NOT NULL REFERENCES v2_communities(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'text',conversation_id TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS v2_conversations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS v2_conversation_members(conversation_id TEXT NOT NULL REFERENCES v2_conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,PRIMARY KEY(conversation_id,user_id))`,
`CREATE TABLE IF NOT EXISTS v2_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES v2_conversations(id) ON DELETE CASCADE,sender_id TEXT NOT NULL REFERENCES v2_users(id),content TEXT NOT NULL,reply_to TEXT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE INDEX IF NOT EXISTS v2_messages_conv_idx ON v2_messages(conversation_id,created_at)`,
`CREATE TABLE IF NOT EXISTS v2_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'system',read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS v2_inventory(user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,item_id TEXT NOT NULL,owned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,item_id))`,
`CREATE TABLE IF NOT EXISTS v2_mission_claims(user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,mission_id TEXT NOT NULL,cycle TEXT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,mission_id,cycle))`,
`CREATE TABLE IF NOT EXISTS v2_user_daily(user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,day TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,day))`,
`CREATE TABLE IF NOT EXISTS v2_friendships(user_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,friend_id TEXT NOT NULL REFERENCES v2_users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,friend_id))`
  ];
  for(const s of statements)await q(s);
}

const SHOP=[
{id:"frame-orbit",type:"frame",name:"Orbit Core",price:0,rarity:"Core",css:"orbit"},
{id:"frame-nebula",type:"frame",name:"Nebula",price:450,rarity:"Epic",css:"nebula"},
{id:"frame-cyber",type:"frame",name:"Cyber Pulse",price:600,rarity:"Epic",css:"cyber"},
{id:"frame-royal",type:"frame",name:"Royal Halo",price:850,rarity:"Legendary",css:"royal"},
{id:"frame-ice",type:"frame",name:"Ice Crystal",price:700,rarity:"Legendary",css:"ice"},
{id:"effect-none",type:"effect",name:"None",price:0,rarity:"Core",css:"none"},
{id:"effect-spark",type:"effect",name:"Spark Field",price:300,rarity:"Rare",css:"spark"},
{id:"effect-orbit",type:"effect",name:"Orbiting Lights",price:700,rarity:"Epic",css:"orbit"},
{id:"plate-orbit",type:"nameplate",name:"ORBIT",price:0,rarity:"Core",css:"orbit"},
{id:"plate-nexus",type:"nameplate",name:"NEXUS",price:900,rarity:"Legendary",css:"nexus"},
{id:"theme-void",type:"chat_theme",name:"Void",price:0,rarity:"Core",css:"void"},
{id:"theme-aurora",type:"chat_theme",name:"Aurora",price:550,rarity:"Epic",css:"aurora"},
{id:"theme-ice",type:"chat_theme",name:"Ice Glass",price:650,rarity:"Epic",css:"ice"}
];
const MISSIONS=[
{id:"first-message",title:"First Signal",description:"Send your first message.",metric:"messages",target:1,rewardXp:50,rewardCoins:40,cadence:"lifetime"},
{id:"ten-messages",title:"Conversation Starter",description:"Send 10 messages.",metric:"messages",target:10,rewardXp:150,rewardCoins:100,cadence:"daily"},
{id:"join-community",title:"Join the Orbit",description:"Join a community.",metric:"communitiesJoined",target:1,rewardXp:100,rewardCoins:80,cadence:"lifetime"},
{id:"create-community",title:"Build a World",description:"Create a community.",metric:"communitiesCreated",target:1,rewardXp:300,rewardCoins:180,cadence:"lifetime"},
{id:"voice-explorer",title:"Voice Explorer",description:"Reach 15 minutes in calls.",metric:"callMinutes",target:15,rewardXp:200,rewardCoins:120,cadence:"daily"},
{id:"profile-crafted",title:"Profile Crafted",description:"Add a bio and customize your profile.",metric:"profile",target:1,rewardXp:120,rewardCoins:90,cadence:"lifetime"}
];

function item(id){return SHOP.find(x=>x.id===id)||null}
function levelFromXp(xp){return Math.max(1,Math.floor(Number(xp||0)/500)+1)}
function profileReady(u){return Boolean(String(u.bio||"").trim())&&Boolean(String(u.display_name||"").trim())}
function cycleFor(m){if(m.cadence==="lifetime")return "lifetime";return new Date().toISOString().slice(0,10)}
async function metricValue(u,metric){if(metric==="profile")return profileReady(u)?1:0;return Number(u[metric+"_count"]??0)}
async function ensureCore(userId){
  for(const x of SHOP.filter(i=>i.price===0))await q("INSERT INTO v2_inventory(user_id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[userId,x.id]);
}
async function getUserById(uid){const r=await q("SELECT * FROM v2_users WHERE id=$1",[uid]);return r.rows[0]||null}
async function auth(req,res,next){
  try{
    const raw=cookieValue(req,cookieName);
    if(!raw)return res.status(401).json({error:"Not authenticated"});
    const r=await q("SELECT s.id,u.* FROM v2_sessions s JOIN v2_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[sha(raw)]);
    if(!r.rows[0])return res.status(401).json({error:"Session expired"});
    req.user=r.rows[0];req.sessionId=r.rows[0].id;next();
  }catch(e){console.error(e);res.status(500).json({error:"Authentication service unavailable"})}
}
async function notify(userId,title,body,kind="system"){
 const n={id:id("notif"),userId,title,body,kind};
 await q("INSERT INTO v2_notifications(id,user_id,title,body,kind) VALUES($1,$2,$3,$4,$5)",[n.id,userId,title,body,kind]);
 for(const [sid,s] of io.sockets.sockets){if(String(s.userId)===String(userId))s.emit("notification:new",{notification:n})}
}
async function award(userId,xp=0,coins=0){
 const u=await getUserById(userId);if(!u)return;
 const nextXp=Number(u.xp||0)+Number(xp||0);const lvl=levelFromXp(nextXp);
 await q("UPDATE v2_users SET xp=$1,level=$2,coins=coins+$3,updated_at=NOW() WHERE id=$4",[nextXp,lvl,Number(coins||0),userId]);
}
async function dailyCheckIn(userId){
 const day=new Date().toISOString().slice(0,10);
 const r=await q("INSERT INTO v2_user_daily(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",[userId,day]);
 if(r.rowCount)await award(userId,30,50);
 return Boolean(r.rowCount);
}
async function ensureHome(userId){
 const r=await q("SELECT c.id FROM v2_communities c JOIN v2_members m ON m.community_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at LIMIT 1",[userId]);
 if(r.rows[0])return r.rows[0].id;
 const existing=await q("SELECT id FROM v2_communities WHERE join_code='ORBIT-HOME' LIMIT 1");
 let cid=existing.rows[0]?.id;
 if(!cid){
   cid=id("com");
   await q("INSERT INTO v2_communities(id,name,description,join_code,owner_id) VALUES($1,$2,$3,$4,$5)",[cid,"ORBIT Lobby","Official starting space for ORBIT.","ORBIT-HOME",userId]);
 }
 await q("INSERT INTO v2_members(community_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[cid,userId]);
 const conv=id("conv");await q("INSERT INTO v2_conversations(id,kind) VALUES($1,'channel')",[conv]);
 const ch=id("ch");await q("INSERT INTO v2_channels(id,community_id,name,type,conversation_id) VALUES($1,$2,'general','text',$3)",[ch,cid,conv]);
 await award(userId,0,0);return cid;
}

app.use(express.json({limit:"4mb"}));
app.use(express.static(path.join(__dirname,"public"),{setHeaders(res){res.setHeader("Cache-Control","no-store")}}));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"public","orbit-v2.html")));

app.get("/health",async(req,res)=>{
 try{const r=await q("SELECT COUNT(*)::int AS users FROM v2_users");res.json({ok:true,version:"2.0.0-aaa",database:true,users:r.rows[0].users,time:iso(now())})}
 catch(e){res.status(503).json({ok:false,version:"2.0.0-aaa",database:false,error:e.message})}
});

app.post("/api/auth/register",async(req,res)=>{
 try{
  const username=cleanUsername(req.body?.username);const password=String(req.body?.password||"");const displayName=cleanName(req.body?.displayName,username||"ORBIT User");
  if(!/^[a-z0-9][a-z0-9._-]{3,19}$/.test(username))return res.status(400).json({error:"Username must be 4-20 characters."});
  if(password.length<8||password.length>72)return res.status(400).json({error:"Password must be 8-72 characters."});
  const exists=await q("SELECT 1 FROM v2_users WHERE username=$1",[username]);if(exists.rowCount)return res.status(409).json({error:"Username already exists."});
  const userId=id("user");const hash=await bcrypt.hash(password,12);
  await q("INSERT INTO v2_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)",[userId,username,displayName,hash]);
  await ensureCore(userId);await ensureHome(userId);await dailyCheckIn(userId);
  const t=token();await q("INSERT INTO v2_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 days')",[id("sess"),userId,sha(t)]);setCookie(res,t);
  const u=await getUserById(userId);res.status(201).json({user:publicUser(u)});
 }catch(e){console.error(e);res.status(500).json({error:"Registration failed"})}
});

app.post("/api/auth/login",async(req,res)=>{
 try{
  const username=cleanUsername(req.body?.username);const password=String(req.body?.password||"");
  const r=await q("SELECT * FROM v2_users WHERE username=$1",[username]);const u=r.rows[0];
  if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Incorrect username or password."});
  await ensureCore(u.id);await ensureHome(u.id);await dailyCheckIn(u.id);
  const t=token();await q("INSERT INTO v2_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 days')",[id("sess"),u.id,sha(t)]);setCookie(res,t);
  res.json({user:publicUser(await getUserById(u.id))});
 }catch(e){console.error(e);res.status(500).json({error:"Sign in failed"})}
});
app.post("/api/auth/logout",auth,async(req,res)=>{await q("DELETE FROM v2_sessions WHERE id=$1",[req.sessionId]);clearCookie(res);res.json({ok:true})});
app.get("/api/me",auth,async(req,res)=>{res.json({user:publicUser(await getUserById(req.user.id)),dailyCheckIn:await dailyCheckIn(req.user.id)})});

app.patch("/api/me/profile",auth,async(req,res)=>{
 const display=cleanName(req.body?.displayName||req.user.display_name,req.user.username);const bio=String(req.body?.bio||"").trim().slice(0,280);const avatar=String(req.body?.avatarUrl||"").trim().slice(0,500);
 await q("UPDATE v2_users SET display_name=$1,bio=$2,avatar_url=$3,updated_at=NOW() WHERE id=$4",[display,bio,avatar,req.user.id]);
 res.json({user:publicUser(await getUserById(req.user.id))});
});
app.get("/api/search",auth,async(req,res)=>{
 const term=String(req.query.q||"").trim().toLowerCase();if(!term)return res.json({users:[],communities:[]});
 const u=await q("SELECT * FROM v2_users WHERE username LIKE $1 OR LOWER(display_name) LIKE $1 LIMIT 20",["%"+term+"%"]);
 const c=await q("SELECT * FROM v2_communities WHERE LOWER(name) LIKE $1 LIMIT 20",["%"+term+"%"]);
 res.json({users:u.rows.map(publicUser),communities:c.rows});
});

app.get("/api/studio",auth,async(req,res)=>{
 const u=await getUserById(req.user.id);const inv=await q("SELECT item_id FROM v2_inventory WHERE user_id=$1",[u.id]);
 const owned=new Set(inv.rows.map(x=>x.item_id));res.json({user:publicUser(u),shop:SHOP.map(x=>({...x,owned:owned.has(x.id)}))});
});
app.post("/api/studio/buy",auth,async(req,res)=>{
 const x=item(String(req.body?.itemId||""));if(!x)return res.status(404).json({error:"Item not found"});if(x.price<=0)return res.status(400).json({error:"This item is already free."});
 const result=await tx(async(c)=>{
   const u=(await c.query("SELECT coins FROM v2_users WHERE id=$1 FOR UPDATE",[req.user.id])).rows[0];
   const have=await c.query("SELECT 1 FROM v2_inventory WHERE user_id=$1 AND item_id=$2",[req.user.id,x.id]);
   if(have.rowCount)return {error:"You already own this item."};
   if(Number(u.coins)<x.price)return {error:"Not enough ORBIT Coins."};
   await c.query("UPDATE v2_users SET coins=coins-$1 WHERE id=$2",[x.price,req.user.id]);
   await c.query("INSERT INTO v2_inventory(user_id,item_id) VALUES($1,$2)",[req.user.id,x.id]);return {ok:true};
 });
 if(result.error)return res.status(400).json(result);res.json({ok:true});
});
app.post("/api/studio/equip",auth,async(req,res)=>{
 const type=String(req.body?.type||"");const itemId=String(req.body?.itemId||"");const x=item(itemId);
 if(!x||x.type!==type)return res.status(400).json({error:"Invalid item."});
 const owned=await q("SELECT 1 FROM v2_inventory WHERE user_id=$1 AND item_id=$2",[req.user.id,itemId]);if(!owned.rowCount)return res.status(403).json({error:"Item is not owned."});
 const col={frame:"avatar_frame",effect:"avatar_effect",nameplate:"nameplate",chat_theme:"chat_theme"}[type];if(!col)return res.status(400).json({error:"Unsupported customization."});
 await q("UPDATE v2_users SET "+col+"=$1,updated_at=NOW() WHERE id=$2",[x.css,req.user.id]);res.json({user:publicUser(await getUserById(req.user.id))});
});
app.post("/api/studio/checkin",auth,async(req,res)=>res.json({claimed:await dailyCheckIn(req.user.id),user:publicUser(await getUserById(req.user.id))}));

app.get("/api/missions",auth,async(req,res)=>{
 const u=await getUserById(req.user.id);const today=new Date().toISOString().slice(0,10);
 const claims=await q("SELECT mission_id,cycle FROM v2_mission_claims WHERE user_id=$1 AND (cycle=$2 OR cycle='lifetime')",[u.id,today]);
 const set=new Set(claims.rows.map(x=>x.mission_id+":"+x.cycle));
 const missions=MISSIONS.map(m=>({...m,progress:m.metric==="profile"?await metricValue(u,"profile"):await metricValue(u,m.metric),claimed:set.has(m.id+":"+cycleFor(m))}));
 res.json({missions});
});
app.post("/api/missions/:id/claim",auth,async(req,res)=>{
 const m=MISSIONS.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"Mission not found"});
 const u=await getUserById(req.user.id);const progress=await metricValue(u,m.metric);if(progress<m.target)return res.status(400).json({error:"Mission is not complete yet."});
 const cycle=cycleFor(m);const r=await q("INSERT INTO v2_mission_claims(user_id,mission_id,cycle) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",[u.id,m.id,cycle]);
 if(!r.rowCount)return res.status(409).json({error:"Mission already claimed."});
 await award(u.id,m.rewardXp,m.rewardCoins);res.json({ok:true,user:publicUser(await getUserById(u.id)),reward:{xp:m.rewardXp,coins:m.rewardCoins}});
});

app.get("/api/communities",auth,async(req,res)=>{
 const r=await q("SELECT c.*,m.role FROM v2_communities c JOIN v2_members m ON m.community_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at",[req.user.id]);
 res.json({communities:r.rows});
});
app.post("/api/communities",auth,async(req,res)=>{
 const name=cleanName(req.body?.name,"New Community");const description=String(req.body?.description||"").slice(0,300);const cid=id("com"),code="ORB-"+crypto.randomBytes(4).toString("hex").toUpperCase();
 await tx(async(c)=>{
   await c.query("INSERT INTO v2_communities(id,name,description,join_code,owner_id) VALUES($1,$2,$3,$4,$5)",[cid,name,description,code,req.user.id]);
   await c.query("INSERT INTO v2_members(community_id,user_id,role) VALUES($1,$2,'owner')",[cid,req.user.id]);
   const conv=id("conv");await c.query("INSERT INTO v2_conversations(id,kind) VALUES($1,'channel')",[conv]);
   await c.query("INSERT INTO v2_channels(id,community_id,name,type,conversation_id) VALUES($1,$2,'general','text',$3)",[id("ch"),cid,conv]);
 });
 await q("UPDATE v2_users SET communities_created=communities_created+1,communities_joined=communities_joined+1 WHERE id=$1",[req.user.id]);await award(req.user.id,100,0);
 const r=await q("SELECT * FROM v2_communities WHERE id=$1",[cid]);res.status(201).json({community:r.rows[0],joinCode:code});
});
app.post("/api/communities/join",auth,async(req,res)=>{
 const code=String(req.body?.code||"").trim().toUpperCase();const r=await q("SELECT * FROM v2_communities WHERE join_code=$1",[code]);if(!r.rows[0])return res.status(404).json({error:"Community code not found."});
 const c=r.rows[0];const m=await q("INSERT INTO v2_members(community_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING RETURNING user_id",[c.id,req.user.id]);
 if(m.rowCount){await q("UPDATE v2_users SET communities_joined=communities_joined+1 WHERE id=$1",[req.user.id]);await award(req.user.id,75,0)}
 res.json({community:c});
});
app.get("/api/communities/:id/channels",auth,async(req,res)=>{
 const m=await q("SELECT 1 FROM v2_members WHERE community_id=$1 AND user_id=$2",[req.params.id,req.user.id]);if(!m.rowCount)return res.status(403).json({error:"Not a member"});
 const r=await q("SELECT * FROM v2_channels WHERE community_id=$1 ORDER BY created_at",[req.params.id]);res.json({channels:r.rows});
});

app.get("/api/dms",auth,async(req,res)=>{
 const r=await q(`SELECT c.id,c.created_at,u.id other_id,u.username,u.display_name,u.avatar_url,u.avatar_frame,u.avatar_effect,u.nameplate,u.chat_theme,u.level,u.xp
 FROM v2_conversations c
 JOIN v2_conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1
 JOIN v2_conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id<>$1
 JOIN v2_users u ON u.id=cm2.user_id
 WHERE c.kind='dm' ORDER BY c.created_at DESC`,[req.user.id]);
 res.json({dms:r.rows.map(x=>({id:x.id,otherUser:{id:x.other_id,username:x.username,displayName:x.display_name,avatarUrl:x.avatar_url,level:x.level,xp:x.xp,equipped:{frame:x.avatar_frame,effect:x.avatar_effect,nameplate:x.nameplate,chatTheme:x.chat_theme}}}))});
});
app.post("/api/dms",auth,async(req,res)=>{
 const username=cleanUsername(req.body?.username);const u=(await q("SELECT * FROM v2_users WHERE username=$1",[username])).rows[0];if(!u||u.id===req.user.id)return res.status(404).json({error:"User not found."});
 const found=await q(`SELECT c.id FROM v2_conversations c
 JOIN v2_conversation_members a ON a.conversation_id=c.id AND a.user_id=$1
 JOIN v2_conversation_members b ON b.conversation_id=c.id AND b.user_id=$2
 WHERE c.kind='dm' LIMIT 1`,[req.user.id,u.id]);
 if(found.rows[0])return res.json({dmId:found.rows[0].id});
 const cid=id("dm");await tx(async(c)=>{await c.query("INSERT INTO v2_conversations(id,kind) VALUES($1,'dm')",[cid]);await c.query("INSERT INTO v2_conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3)",[cid,req.user.id,u.id])});
 res.status(201).json({dmId:cid});
});
async function canReadConversation(conversationId,userId){const r=await q("SELECT 1 FROM v2_conversation_members WHERE conversation_id=$1 AND user_id=$2",[conversationId,userId]);return Boolean(r.rowCount)}
app.get("/api/conversations/:id/messages",auth,async(req,res)=>{
 if(!(await canReadConversation(req.params.id,req.user.id)))return res.status(403).json({error:"Conversation access denied"});
 const r=await q(`SELECT m.*,u.username,u.display_name,u.avatar_url,u.avatar_frame,u.avatar_effect FROM v2_messages m JOIN v2_users u ON u.id=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 300`,[req.params.id]);
 res.json({messages:r.rows});
});
app.post("/api/conversations/:id/messages",auth,async(req,res)=>{
 if(!(await canReadConversation(req.params.id,req.user.id)))return res.status(403).json({error:"Conversation access denied"});
 const text=String(req.body?.content||"").trim().slice(0,4000);if(!text)return res.status(400).json({error:"Message is empty"});
 const mid=id("msg");await q("INSERT INTO v2_messages(id,conversation_id,sender_id,content,reply_to,metadata) VALUES($1,$2,$3,$4,$5,$6)",[mid,req.params.id,req.user.id,text,req.body?.replyToId||null,JSON.stringify(req.body?.metadata||{})]);
 await q("UPDATE v2_users SET messages_count=messages_count+1,xp=xp+10,level=FLOOR((xp+10)/500)+1 WHERE id=$1",[req.user.id]);
 const r=await q(`SELECT m.*,u.username,u.display_name,u.avatar_url,u.avatar_frame,u.avatar_effect FROM v2_messages m JOIN v2_users u ON u.id=m.sender_id WHERE m.id=$1`,[mid]);res.status(201).json({message:r.rows[0]});
});

app.get("/api/notifications",auth,async(req,res)=>{const r=await q("SELECT * FROM v2_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.user.id]);res.json({notifications:r.rows})});
app.post("/api/notifications/read",auth,async(req,res)=>{await q("UPDATE v2_notifications SET read_at=NOW() WHERE user_id=$1",[req.user.id]);res.json({ok:true})});

io.use(async(socket,next)=>{
 try{
  const raw=cookieValue({headers:{cookie:socket.handshake.headers.cookie}},cookieName);
  const r=await q("SELECT u.* FROM v2_sessions s JOIN v2_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[sha(raw)]);
  if(!r.rows[0])return next(new Error("Unauthorized"));
  socket.userId=r.rows[0].id;socket.user= r.rows[0];next();
 }catch(e){next(new Error("Unauthorized"))}
});
io.on("connection",socket=>{
 socket.join("user:"+socket.userId);socket.emit("session:ready",{user:publicUser(socket.user)});
 q("UPDATE v2_users SET updated_at=NOW() WHERE id=$1",[socket.userId]).catch(()=>{});
 socket.broadcast.emit("presence:update",{userId:socket.userId,status:"online"});
 socket.on("conversation:join",cid=>canReadConversation(cid,socket.userId).then(ok=>ok&&socket.join("conversation:"+cid)));
 socket.on("typing",async({conversationId,isTyping}={})=>{if(await canReadConversation(conversationId,socket.userId))socket.to("conversation:"+conversationId).emit("typing",{conversationId,userId:socket.userId,isTyping:Boolean(isTyping)})});
 socket.on("message:send",async({conversationId,content,replyToId,metadata}={},ack)=>{
   try{
    const key=socket.userId;const t=Date.now();const arr=memory.rate.get(key)||[];const fresh=arr.filter(x=>t-x<10000);if(fresh.length>=30)return ack?.({ok:false,error:"Slow down a little."});fresh.push(t);memory.rate.set(key,fresh);
    if(!(await canReadConversation(conversationId,socket.userId)))return ack?.({ok:false,error:"Conversation access denied"});
    const text=String(content||"").trim().slice(0,4000);if(!text)return;
    const mid=id("msg");await q("INSERT INTO v2_messages(id,conversation_id,sender_id,content,reply_to,metadata) VALUES($1,$2,$3,$4,$5,$6)",[mid,conversationId,socket.userId,text,replyToId||null,JSON.stringify(metadata||{})]);
    await q("UPDATE v2_users SET messages_count=messages_count+1,xp=xp+10,level=FLOOR((xp+10)/500)+1 WHERE id=$1",[socket.userId]);
    const m=(await q("SELECT m.*,u.username,u.display_name,u.avatar_url,u.avatar_frame,u.avatar_effect FROM v2_messages m JOIN v2_users u ON u.id=m.sender_id WHERE m.id=$1",[mid])).rows[0];
    io.to("conversation:"+conversationId).emit("message:new",m);ack?.({ok:true,message:m});
   }catch(e){ack?.({ok:false,error:"Message failed"})}
 });
 socket.on("call:invite",async({conversationId,mode="video"}={})=>{
   if(!(await canReadConversation(conversationId,socket.userId)))return;
   const r=await q("SELECT user_id FROM v2_conversation_members WHERE conversation_id=$1 AND user_id<>$2",[conversationId,socket.userId]);
   for(const row of r.rows)io.to("user:"+row.user_id).emit("call:incoming",{conversationId,mode,caller:publicUser(socket.user)});
 });
 socket.on("call:join",async({roomId,mode="video"}={})=>{
   const room="v2call:"+String(roomId);socket.join(room);
   memory.callRooms.set(socket.id,room);memory.callStarted.set(socket.id,Date.now());
   const participants=[...(io.sockets.adapter.rooms.get(room)||[])].filter(x=>x!==socket.id).map(id=>{const s=io.sockets.sockets.get(id);return s?{socketId:id,user:publicUser(s.user)}:null}).filter(Boolean);
   socket.emit("call:participants",participants);socket.to(room).emit("call:participant-joined",{socketId:socket.id,user:publicUser(socket.user),mode});
 });
 socket.on("call:leave",async()=>{
   const room=memory.callRooms.get(socket.id);if(!room)return;socket.leave(room);socket.to(room).emit("call:participant-left",{socketId:socket.id,userId:socket.userId});
   const started=memory.callStarted.get(socket.id);if(started){const minutes=Math.max(1,Math.round((Date.now()-started)/60000));await q("UPDATE v2_users SET call_minutes=call_minutes+$1,xp=xp+$2,level=FLOOR((xp+$2)/500)+1 WHERE id=$3",[minutes,minutes*2,socket.userId])}
   memory.callRooms.delete(socket.id);memory.callStarted.delete(socket.id);
 });
 socket.on("call:media",payload=>{const room=memory.callRooms.get(socket.id);if(room)socket.to(room).emit("call:media", {socketId:socket.id,...payload})});
 socket.on("rtc:offer",({to,offer}={})=>{const s=io.sockets.sockets.get(to);if(s)s.emit("rtc:offer",{from:socket.id,offer})});
 socket.on("rtc:answer",({to,answer}={})=>{const s=io.sockets.sockets.get(to);if(s)s.emit("rtc:answer",{from:socket.id,answer})});
 socket.on("rtc:ice",({to,candidate}={})=>{const s=io.sockets.sockets.get(to);if(s)s.emit("rtc:ice",{from:socket.id,candidate})});
 socket.on("disconnect",async()=>{
   socket.broadcast.emit("presence:update",{userId:socket.userId,status:"offline"});
   const room=memory.callRooms.get(socket.id);if(room){socket.to(room).emit("call:participant-left",{socketId:socket.id,userId:socket.userId})}
 });
});

async function migrateLegacyAccounts(){
 try{
  const old=await q("SELECT data FROM orbit_state WHERE id=1");
  if(!old.rows[0]?.data)return;
  const count=await q("SELECT COUNT(*)::int AS n FROM v2_users");if(count.rows[0].n)return;
  const users=Array.isArray(old.rows[0].data.users)?old.rows[0].data.users:[];
  for(const [,u] of users){
    if(!u?.passwordHash||!u.username)continue;
    await q("INSERT INTO v2_users(id,username,display_name,password_hash,bio) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO NOTHING",[u.id,cleanUsername(u.username),cleanName(u.displayName,u.username),u.passwordHash,String(u.bio||"").slice(0,280)]);
  }
  const rows=await q("SELECT id FROM v2_users");for(const r of rows.rows){await ensureCore(r.id);await ensureHome(r.id)}
 }catch(e){console.error("[orbit-v2] legacy migration skipped:",e.message)}
}

async function start(){
 if(!DATABASE_URL)throw new Error("DATABASE_URL is required for ORBIT V2.");
 await migrate();await migrateLegacyAccounts();
 httpServer.listen(PORT,"0.0.0.0",()=>console.log("[orbit-v2] AAA platform listening on "+PORT));
}
start().catch(e=>{console.error("[orbit-v2] boot failed",e);process.exit(1)});
