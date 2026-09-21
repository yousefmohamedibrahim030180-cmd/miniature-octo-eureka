const express=require("express");
const http=require("http");
const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{transports:["polling"],cors:{origin:true,credentials:true},allowUpgrades:false});
const PORT=Number(process.env.PORT||8080);
const PERSIST_URL=String(process.env.ORBIT_PERSIST_URL||"").trim().replace(/\/$/,"");
const PERSIST_SECRET=String(process.env.ORBIT_PERSIST_SECRET||"").trim();
const ORBIT_OWNER_CONTROL_KEY=String(process.env.ORBIT_OWNER_CONTROL_KEY||"").trim();
const ownerKeyAttempts=new Map();
const COOKIE="orbit_v2_session";
const JWT_SECRET=String(process.env.JWT_SECRET||"orbit-guest-dev-secret");
const memory={
 users:new Map(),sessions:new Map(),communities:new Map(),members:new Map(),channels:new Map(),
 conversations:new Map(),convMembers:new Map(),messages:new Map(),notifications:new Map(),
 inventory:new Map(),missionClaims:new Set(),daily:new Set(),friends:new Set()
};
let persistTimer=null,persistBusy=false,persistPending=false,persistMode="memory";

function id(prefix){return prefix+"_"+crypto.randomUUID()}
function now(){return new Date().toISOString()}
function cleanUsername(v){return String(v||"").trim().toLowerCase().replace(/^@+/,"").replace(/[^a-z0-9._-]/g,"").slice(0,20)}
function cleanName(v,fallback){return String(v||"").trim().replace(/\s+/g," ").slice(0,32)||fallback||"ORBIT User"}
function hash(v){return crypto.createHash("sha256").update(String(v)).digest("hex")}
function token(){return crypto.randomBytes(48).toString("base64url")}
function escString(v){return String(v??"").slice(0,4000)}
function avatarField(v){return String(v||"").slice(0,500)}

function serialize(){
 return {
  users:[...memory.users],
  sessions:[...memory.sessions],
  communities:[...memory.communities].map(([id,c])=>[id,c]),
  members:[...memory.members],
  channels:[...memory.channels],
  conversations:[...memory.conversations],
  convMembers:[...memory.convMembers],
  messages:[...memory.messages],
  notifications:[...memory.notifications],
  inventory:[...memory.inventory].map(([k,v])=>[k,[...v]]),
  missionClaims:[...memory.missionClaims],
  daily:[...memory.daily],
  friends:[...memory.friends],
  audit:memory.audit.slice(0,500)
 };
}
function restore(data){
 if(!data||typeof data!=="object")return;
 const map=(name)=>memory[name]=new Map(Array.isArray(data[name])?data[name]:[]);
 map("users");map("sessions");map("communities");map("members");map("channels");map("conversations");map("convMembers");map("messages");map("notifications");
 memory.inventory=new Map((data.inventory||[]).map(x=>[x[0],new Set(x[1]||[])]));
 memory.missionClaims=new Set(data.missionClaims||[]);
 memory.daily=new Set(data.daily||[]);
 memory.friends=new Set(data.friends||[]);
}
async function sidecar(method,body){
 if(!PERSIST_URL||!PERSIST_SECRET)return {found:false};
 const r=await fetch(PERSIST_URL+"/state",{method,headers:{"x-orbit-secret":PERSIST_SECRET,...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
 if(r.status===404&&method==="GET")return {found:false};
 if(!r.ok)throw new Error("Persistence service HTTP "+r.status);
 return {found:true,payload:await r.json()};
}
async function persistNow(){
 if(!PERSIST_URL||!PERSIST_SECRET)return;
 if(persistBusy){persistPending=true;return}
 persistBusy=true;
 try{await sidecar("PUT",{data:serialize()});persistMode="sidecar"}
 catch(e){console.error("[orbit-v2] persistence write failed:",e.message)}
 finally{
  persistBusy=false;
  if(persistPending){persistPending=false;setImmediate(()=>persistNow().catch(()=>{}))}
 }
}
function persist(){if(!PERSIST_URL||!PERSIST_SECRET)return;clearTimeout(persistTimer);persistTimer=setTimeout(()=>persistNow().catch(()=>{}),220)}
async function bootPersistence(){
 if(!PERSIST_URL||!PERSIST_SECRET){persistMode="memory";return}
 try{
  const r=await sidecar("GET");
  if(r.found&&r.payload?.data){
   const legacy=r.payload.data;
   if(Array.isArray(legacy.users)&&legacy.users.length&&!legacy.v2){
    restoreLegacy(legacy);
   }else restore(legacy);
   console.log("[orbit-v2] sidecar state restored.");
  }
  persistMode="sidecar";await persistNow();
 }catch(e){persistMode="memory";console.error("[orbit-v2] sidecar unavailable:",e.message)}
}
function restoreLegacy(legacy){
 const rows=Array.isArray(legacy.users)?legacy.users:[];
 let imported=0;
 for(const pair of rows){
  const u=pair?.[1];
  if(!u?.passwordHash||!u.username)continue;
  const uid=String(u.id||id("user"));
  if([...memory.users.values()].some(x=>x.username===cleanUsername(u.username)))continue;
  memory.users.set(uid,{
   id:uid,username:cleanUsername(u.username),displayName:cleanName(u.displayName,u.username),passwordHash:u.passwordHash,
   bio:String(u.bio||"").slice(0,280),avatarUrl:avatarField(u.avatarUrl),
   frame:u.avatarDecoration||"orbit",effect:"none",nameplate:"orbit",chatTheme:"orbit-dark",
   xp:Number(u.xp||0),level:Number(u.level||1),coins:Number(u.coins||250),
   messages:Number(u.stats?.messages||0),callMinutes:Number(u.stats?.voiceJoins||0),friends:Number(u.stats?.friends||0),
   communitiesCreated:Number(u.stats?.serversCreated||0),communitiesJoined:0,status:"offline",createdAt:u.createdAt||now()
  });
  imported++;
 }
 if(imported)console.log("[orbit-v2] imported legacy accounts:",imported);
}

function userPublic(u){
 if(!u)return null;
 return {
  id:u.id,username:u.username,displayName:u.displayName,bio:u.bio||"",avatarUrl:u.avatarUrl||"",
  status:u.status||"offline",level:Number(u.level||1),xp:Number(u.xp||0),coins:Number(u.coins||250),
  equipped:{frame:u.frame||"orbit",effect:u.effect||"none",nameplate:u.nameplate||"orbit",chatTheme:u.chatTheme||"orbit-dark"},
  stats:{messages:Number(u.messages||0),callMinutes:Number(u.callMinutes||0),friends:Number(u.friends||0),communitiesCreated:Number(u.communitiesCreated||0),communitiesJoined:Number(u.communitiesJoined||0)},
  preferences:u.preferences||{},
  createdAt:u.createdAt||null,suspended:Boolean(u.suspended),suspendedUntil:u.suspendedUntil||null,suspendedReason:u.suspendedReason||null
 };
}
function sessionUser(req,res){
 const raw=cookie(req,COOKIE);if(!raw)return null;
 const s=memory.sessions.get(hash(raw));
 if(s&&s.expiresAt>Date.now())return memory.users.get(s.userId)||null;
 try{
  const payload=jwt.verify(raw,JWT_SECRET);const u=memory.users.get(String(payload.id));
  if(u&&payload.account){
   const upgraded=token();memory.sessions.set(hash(upgraded),{userId:u.id,createdAt:Date.now(),expiresAt:Date.now()+2592000000});
   if(res)setCookie(res,upgraded);
   persist();return u;
  }
 }catch{}
 return null;
}
function audit(userId,action,target,details={}){memory.audit.unshift({id:id("audit"),user_id:userId,action,target:target||null,details:details||{},created_at:now()});memory.audit=memory.audit.slice(0,500);persist()}
function ownerAttemptKey(req){return String(req.ip||req.headers["x-forwarded-for"]||"unknown")+":"+String(req.user?.id||"unknown")}
function ownerTokenFor(u){return jwt.sign({owner:true,userId:String(u.id)},JWT_SECRET,{expiresIn:"8h"})}
function hasOwnerToken(req){const raw=String(req.headers["x-owner-token"]||"").trim();if(!raw)return false;try{const p=jwt.verify(raw,JWT_SECRET);return Boolean(p?.owner)&&String(p.userId)===String(req.user?.id)}catch{return false}}
function requireOwner(req,res){if(!hasOwnerToken(req)){res.status(401).json({error:"Owner session expired or missing"});return false}return true}
function cookie(req,name){
 const raw=String(req.headers.cookie||"");
 for(const p of raw.split(";")){
  const a=p.trim().split("=");
  if(a[0]===name)return decodeURIComponent(a.slice(1).join("=")||"");
 }
 return "";
}
function setCookie(res,value){
 const secure=process.env.NODE_ENV==="production"||String(res.req?.headers?.["x-forwarded-proto"]||"").split(",")[0].trim()==="https";
 let out=COOKIE+"="+encodeURIComponent(value)+"; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax";
 if(secure)out+="; Secure";
 res.setHeader("Set-Cookie",out);
}
function clearCookie(res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")}
function auth(req,res,next){
 const u=sessionUser(req,res);if(!u)return res.status(401).json({error:"Session expired. Please sign in again."});
 if(u.suspendedUntil&&new Date(u.suspendedUntil).getTime()<=Date.now()){u.suspended=false;u.suspendedUntil=null;u.suspendedReason=null;persist()}
 if(u.suspended)return res.status(403).json({error:"Account suspended"+(u.suspendedReason?": "+u.suspendedReason:"")});
 u.status="online";req.user=u;persist();next();
}
function ensureUserDefaults(u){
 u.frame=u.frame||"orbit";u.effect=u.effect||"none";u.nameplate=u.nameplate||"orbit";u.chatTheme=u.chatTheme||"orbit-dark";
 u.preferences=u.preferences||{};u.preferences.theme=u.preferences.theme||"void";u.preferences.density=u.preferences.density||"comfortable";u.preferences.motion=u.preferences.motion!==false;u.preferences.accent=u.preferences.accent||"violet";
 u.preferences.notifications=u.preferences.notifications||{messages:true,mentions:true,calls:true,social:true};
 u.preferences.privacy=u.preferences.privacy||{presence:true,readReceipts:true,friendRequests:true};
 u.xp=Number(u.xp||0);u.level=Math.max(1,Number(u.level||1));u.coins=Number(u.coins||250);
 u.messages=Number(u.messages||0);u.callMinutes=Number(u.callMinutes||0);u.friends=Number(u.friends||0);
 u.communitiesCreated=Number(u.communitiesCreated||0);u.communitiesJoined=Number(u.communitiesJoined||0);
 return u;
}
for(const u of memory.users.values())ensureUserDefaults(u);

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
 {id:"first-message",title:"First Signal",description:"Send your first message.",metric:"messages",target:1,xp:50,coins:40,cadence:"lifetime"},
 {id:"ten-messages",title:"Conversation Starter",description:"Send 10 messages.",metric:"messages",target:10,xp:150,coins:100,cadence:"daily"},
 {id:"join-community",title:"Join the Orbit",description:"Join a community.",metric:"communitiesJoined",target:1,xp:100,coins:80,cadence:"lifetime"},
 {id:"create-community",title:"Build a World",description:"Create a community.",metric:"communitiesCreated",target:1,xp:300,coins:180,cadence:"lifetime"},
 {id:"voice-explorer",title:"Voice Explorer",description:"Reach 15 minutes in calls.",metric:"callMinutes",target:15,xp:200,coins:120,cadence:"daily"},
 {id:"profile-crafted",title:"Profile Crafted",description:"Add a bio and customize your profile.",metric:"profile",target:1,xp:120,coins:90,cadence:"lifetime"}
];
function getItem(itemId){return SHOP.find(x=>x.id===itemId)||null}
function levelFor(xp){return Math.max(1,Math.floor(Number(xp||0)/500)+1)}
function award(u,xp,coins){u.xp+=Number(xp||0);u.level=levelFor(u.xp);u.coins+=Number(coins||0);persist()}
function daily(u){
 const key=u.id+":"+new Date().toISOString().slice(0,10);
 if(memory.daily.has(key))return false;
 memory.daily.add(key);award(u,30,50);return true;
}
function ensureInventory(u){
 if(!memory.inventory.has(u.id))memory.inventory.set(u.id,new Set());
 const inv=memory.inventory.get(u.id);for(const x of SHOP.filter(i=>i.price===0))inv.add(x.id);
}
function addNotification(uid,title,body,kind){
 const list=memory.notifications.get(uid)||[];
 list.unshift({id:id("notif"),user_id:uid,title,body,kind:kind||"system",read:false,created_at:now()});
 memory.notifications.set(uid,list.slice(0,100));persist();
 for(const socket of io.sockets.sockets.values())if(socket.userId===uid)socket.emit("notification:new",{notification:list[0]});
}
function communityMember(communityId,userId){const m=memory.members.get(communityId)||new Map();return m.has(userId)}
function conversationAccess(conversationId,userId){
 if((memory.convMembers.get(conversationId)||new Set()).has(userId))return true;
 const channel=[...memory.channels.values()].find(x=>x.conversationId===conversationId);
 return Boolean(channel&&communityMember(channel.communityId,userId));
}
function conversationUsers(conversationId){return [...(memory.convMembers.get(conversationId)||new Set())]}
function messageRows(conversationId){
 return (memory.messages.get(conversationId)||[]).map(m=>({...m,sender:userPublic(memory.users.get(m.senderId))}));
}
function ensureHome(u){
 const existing=[...memory.members.entries()].find(([cid,m])=>m.has(u.id)&&memory.communities.get(cid)?.name==="ORBIT Lobby");
 if(existing)return existing[0];
 let community=[...memory.communities.values()].find(c=>c.joinCode==="ORBIT-HOME");
 if(!community){
  community={id:id("com"),name:"ORBIT Lobby",description:"Official ORBIT starting space.",joinCode:"ORBIT-HOME",ownerId:u.id,createdAt:now()};
  memory.communities.set(community.id,community);
  memory.members.set(community.id,new Map([[u.id,"member"]]));
  const conv={id:id("conv"),kind:"channel",createdAt:now()};memory.conversations.set(conv.id,conv);memory.convMembers.set(conv.id,new Set());
  memory.channels.set(id("ch"),{id:id("ch"),communityId:community.id,name:"general",type:"text",conversationId:conv.id,createdAt:now()});
 }else{
  const m=memory.members.get(community.id)||new Map();m.set(u.id,"member");memory.members.set(community.id,m);
 }
 ensureInventory(u);persist();return community.id;
}

app.use(express.json({limit:"6mb"}));
app.use(express.static(path.join(__dirname,"public"),{index:false,setHeaders(res){res.setHeader("Cache-Control","no-store")}}));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"public","orbit-v2.html")));
app.get("/health",(req,res)=>res.json({ok:true,service:"orbit-v2",version:"2.0.0-aaa",persistence: persistMode,users:memory.users.size,communities:memory.communities.size,conversations:memory.conversations.size,time:now()}));

app.post("/api/auth/register",async(req,res)=>{
 try{
  const username=cleanUsername(req.body?.username),password=String(req.body?.password||""),displayName=cleanName(req.body?.displayName,username);
  if(!/^[a-z0-9][a-z0-9._-]{3,19}$/.test(username))return res.status(400).json({error:"Username must be 4-20 characters."});
  if(password.length<8||password.length>72)return res.status(400).json({error:"Password must be 8-72 characters."});
  if([...memory.users.values()].some(u=>u.username===username))return res.status(409).json({error:"Username already exists."});
  const u={id:id("user"),username,displayName,passwordHash:await bcrypt.hash(password,12),bio:"",avatarUrl:"",frame:"orbit",effect:"none",nameplate:"orbit",chatTheme:"orbit-dark",xp:0,level:1,coins:250,messages:0,callMinutes:0,friends:0,communitiesCreated:0,communitiesJoined:0,status:"online",createdAt:now()};
  memory.users.set(u.id,u);ensureInventory(u);ensureHome(u);daily(u);const t=token();memory.sessions.set(hash(t),{userId:u.id,createdAt:Date.now(),expiresAt:Date.now()+2592000000});setCookie(res,t);persist();res.status(201).json({user:userPublic(u)});
 }catch(e){console.error(e);res.status(500).json({error:"Registration failed."})}
});
app.post("/api/auth/login",async(req,res)=>{
 const username=cleanUsername(req.body?.username),password=String(req.body?.password||""),u=[...memory.users.values()].find(x=>x.username===username);
 if(!u||!(await bcrypt.compare(password,u.passwordHash)))return res.status(401).json({error:"Incorrect username or password."});
 u.status="online";ensureInventory(u);ensureHome(u);daily(u);const t=token();memory.sessions.set(hash(t),{userId:u.id,createdAt:Date.now(),expiresAt:Date.now()+2592000000});setCookie(res,t);persist();res.json({user:userPublic(u)});
});
app.post("/api/auth/logout",auth,(req,res)=>{const t=cookie(req,COOKIE);memory.sessions.delete(hash(t));clearCookie(res);persist();res.json({ok:true})});
app.get("/api/me",auth,(req,res)=>{ensureInventory(req.user);res.json({user:userPublic(req.user),dailyCheckIn:daily(req.user)})});
app.patch("/api/me/profile",auth,(req,res)=>{req.user.displayName=cleanName(req.body?.displayName,req.user.username);req.user.bio=String(req.body?.bio||"").trim().slice(0,280);req.user.avatarUrl=avatarField(req.body?.avatarUrl);persist();res.json({user:userPublic(req.user)})});
app.patch("/api/me/preferences",auth,(req,res)=>{ensureUserDefaults(req.user);const b=req.body||{};if(["void","aurora","ice","midnight"].includes(String(b.theme)))req.user.preferences.theme=String(b.theme);if(["comfortable","compact"].includes(String(b.density)))req.user.preferences.density=String(b.density);if(typeof b.motion==="boolean")req.user.preferences.motion=b.motion;if(["violet","cyan","gold","rose"].includes(String(b.accent)))req.user.preferences.accent=String(b.accent);for(const k of ["messages","mentions","calls","social"])if(typeof b.notifications?.[k]==="boolean")req.user.preferences.notifications[k]=b.notifications[k];for(const k of ["presence","readReceipts","friendRequests"])if(typeof b.privacy?.[k]==="boolean")req.user.preferences.privacy[k]=b.privacy[k];persist();res.json({user:userPublic(req.user)})});

app.get("/api/search",auth,(req,res)=>{
 const q=String(req.query.q||"").trim().toLowerCase();if(!q)return res.json({users:[],communities:[]});
 const users=[...memory.users.values()].filter(u=>u.username.includes(q)||u.displayName.toLowerCase().includes(q)).slice(0,20).map(userPublic);
 const communities=[...memory.communities.values()].filter(c=>c.name.toLowerCase().includes(q)).slice(0,20);
 res.json({users,communities});
});

app.get("/api/studio",auth,(req,res)=>{ensureInventory(req.user);const owned=memory.inventory.get(req.user.id);res.json({user:userPublic(req.user),shop:SHOP.map(x=>({...x,owned:owned.has(x.id)}))})});
app.post("/api/studio/checkin",auth,(req,res)=>{const claimed=daily(req.user);res.json({claimed,user:userPublic(req.user)})});
app.post("/api/studio/buy",auth,(req,res)=>{
 const x=getItem(req.body?.itemId);if(!x)return res.status(404).json({error:"Item not found."});ensureInventory(req.user);const inv=memory.inventory.get(req.user.id);
 if(inv.has(x.id))return res.status(409).json({error:"You already own this item."});
 if(req.user.coins<x.price)return res.status(400).json({error:"Not enough ORBIT Coins."});
 req.user.coins-=x.price;inv.add(x.id);persist();res.json({ok:true,user:userPublic(req.user)})
});
app.post("/api/studio/equip",auth,(req,res)=>{
 const type=String(req.body?.type||""),x=getItem(req.body?.itemId);if(!x||x.type!==type)return res.status(400).json({error:"Invalid item."});ensureInventory(req.user);
 if(!memory.inventory.get(req.user.id).has(x.id))return res.status(403).json({error:"Item is not owned."});
 if(type==="frame")req.user.frame=x.css;if(type==="effect")req.user.effect=x.css;if(type==="nameplate")req.user.nameplate=x.css;if(type==="chat_theme")req.user.chatTheme=x.css;
 persist();res.json({user:userPublic(req.user)})
});

app.get("/api/missions",auth,(req,res)=>{
 const today=new Date().toISOString().slice(0,10);
 const list=MISSIONS.map(m=>{
  const value=m.metric==="profile"?(req.user.bio?1:0):Number(req.user[m.metric]||0);
  const cycle=m.cadence==="lifetime"?"lifetime":today;
  return {...m,progress:Math.min(m.target,value),claimed:memory.missionClaims.has(req.user.id+":"+m.id+":"+cycle)}
 });
 res.json({missions:list})
});
app.post("/api/missions/:id/claim",auth,(req,res)=>{
 const m=MISSIONS.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"Mission not found."});
 const value=m.metric==="profile"?(req.user.bio?1:0):Number(req.user[m.metric]||0);if(value<m.target)return res.status(400).json({error:"Mission is not complete yet."});
 const cycle=m.cadence==="lifetime"?"lifetime":new Date().toISOString().slice(0,10),key=req.user.id+":"+m.id+":"+cycle;
 if(memory.missionClaims.has(key))return res.status(409).json({error:"Mission already claimed."});
 memory.missionClaims.add(key);award(req.user,m.xp,m.coins);res.json({ok:true,user:userPublic(req.user),reward:{xp:m.xp,coins:m.coins}})
});

app.get("/api/communities",auth,(req,res)=>{
 const rows=[...memory.communities.values()].filter(c=>communityMember(c.id,req.user.id)).map(c=>{const members=memory.members.get(c.id)||new Map();return {...c,role:members.get(req.user.id)||"member",memberCount:members.size}});
 res.json({communities:rows})
});
app.post("/api/communities",auth,(req,res)=>{
 const c={id:id("com"),name:cleanName(req.body?.name,"New Community"),description:String(req.body?.description||"").slice(0,300),iconUrl:avatarField(req.body?.iconUrl),accent:["violet","cyan","gold","rose"].includes(String(req.body?.accent))?String(req.body.accent):"violet",verificationLevel:"standard",joinCode:"ORB-"+crypto.randomBytes(4).toString("hex").toUpperCase(),ownerId:req.user.id,createdAt:now()};
 memory.communities.set(c.id,c);memory.members.set(c.id,new Map([[req.user.id,"owner"]]));const conv={id:id("conv"),kind:"channel",createdAt:now()};memory.conversations.set(conv.id,conv);memory.convMembers.set(conv.id,new Set());
 memory.channels.set(id("ch"),{id:id("ch"),communityId:c.id,name:"general",type:"text",topic:"Welcome to your new ORBIT server.",conversationId:conv.id,createdAt:now()});
 req.user.communitiesCreated++;req.user.communitiesJoined++;award(req.user,100,0);persist();res.status(201).json({community:c,joinCode:c.joinCode})
});
app.post("/api/communities/join",auth,(req,res)=>{
 const code=String(req.body?.code||"").trim().toUpperCase(),c=[...memory.communities.values()].find(x=>x.joinCode===code);if(!c)return res.status(404).json({error:"Community code not found."});
 const m=memory.members.get(c.id)||new Map();const was=m.has(req.user.id);if(!was){m.set(req.user.id,"member");req.user.communitiesJoined++;award(req.user,75,0);memory.members.set(c.id,m);persist()}res.json({community:c})
});
function communityRole(communityId,userId){return (memory.members.get(communityId)||new Map()).get(userId)||null}
function canManageCommunity(communityId,userId){const r=communityRole(communityId,userId);return r==="owner"||r==="admin"}
function communityPayload(c,userId){const members=memory.members.get(c.id)||new Map();return {...c,role:members.get(userId)||"member",memberCount:members.size}}
app.get("/api/communities/:id/channels",auth,(req,res)=>{
 if(!communityMember(req.params.id,req.user.id))return res.status(403).json({error:"Not a member."});
 res.json({channels:[...memory.channels.values()].filter(c=>c.communityId===req.params.id)})
});
app.get("/api/communities/:id/overview",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});if(!communityMember(c.id,req.user.id))return res.status(403).json({error:"Not a member."});
 const members=memory.members.get(c.id)||new Map();
 res.json({community:communityPayload(c,req.user.id),channels:[...memory.channels.values()].filter(x=>x.communityId===c.id),members:[...members].map(([uid,role])=>({user:userPublic(memory.users.get(uid)),role})).filter(x=>x.user),canManage:canManageCommunity(c.id,req.user.id)});
});
app.patch("/api/communities/:id",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});
 if(c.ownerId!==req.user.id)return res.status(403).json({error:"Only the owner can change server settings."});
 if(req.body?.name!==undefined)c.name=cleanName(req.body.name,c.name);if(req.body?.description!==undefined)c.description=String(req.body.description||"").slice(0,300);if(req.body?.iconUrl!==undefined)c.iconUrl=avatarField(req.body.iconUrl);if(req.body?.accent!==undefined&&["violet","cyan","gold","rose"].includes(String(req.body.accent)))c.accent=String(req.body.accent);if(req.body?.verificationLevel!==undefined&&["standard","verified","strict"].includes(String(req.body.verificationLevel)))c.verificationLevel=String(req.body.verificationLevel);persist();res.json({community:communityPayload(c,req.user.id)});
});
app.post("/api/communities/:id/invite/regenerate",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});if(c.ownerId!==req.user.id)return res.status(403).json({error:"Only the owner can regenerate the invite."});
 c.joinCode="ORB-"+crypto.randomBytes(4).toString("hex").toUpperCase();persist();res.json({joinCode:c.joinCode});
});
app.post("/api/communities/:id/channels",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});if(!canManageCommunity(c.id,req.user.id))return res.status(403).json({error:"You do not have permission."});
 const name=String(req.body?.name||"general").trim().replace(/s+/g,"-").slice(0,32);if(!name)return res.status(400).json({error:"Channel name is required."});
 const conv={id:id("conv"),kind:"channel",createdAt:now()};memory.conversations.set(conv.id,conv);memory.convMembers.set(conv.id,new Set());
 const ch={id:id("ch"),communityId:c.id,name,type:req.body?.type==="voice"?"voice":"text",topic:String(req.body?.topic||"").slice(0,160),conversationId:conv.id,createdAt:now()};memory.channels.set(ch.id,ch);persist();res.status(201).json({channel:ch});
});
app.patch("/api/communities/:id/channels/:channelId",auth,(req,res)=>{
 const ch=memory.channels.get(req.params.channelId);if(!ch||ch.communityId!==req.params.id)return res.status(404).json({error:"Channel not found."});if(!canManageCommunity(ch.communityId,req.user.id))return res.status(403).json({error:"You do not have permission."});
 if(req.body?.name!==undefined)ch.name=String(req.body.name||"channel").trim().replace(/s+/g,"-").slice(0,32);if(req.body?.topic!==undefined)ch.topic=String(req.body.topic||"").slice(0,160);persist();res.json({channel:ch});
});
app.delete("/api/communities/:id/channels/:channelId",auth,(req,res)=>{
 const ch=memory.channels.get(req.params.channelId);if(!ch||ch.communityId!==req.params.id)return res.status(404).json({error:"Channel not found."});if(!canManageCommunity(ch.communityId,req.user.id))return res.status(403).json({error:"You do not have permission."});
 const count=[...memory.channels.values()].filter(x=>x.communityId===ch.communityId).length;if(count<=1)return res.status(400).json({error:"A server must keep at least one channel."});memory.channels.delete(ch.id);memory.conversations.delete(ch.conversationId);memory.convMembers.delete(ch.conversationId);memory.messages.delete(ch.conversationId);persist();res.json({ok:true});
});
app.patch("/api/communities/:id/members/:userId",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});if(c.ownerId!==req.user.id)return res.status(403).json({error:"Only the owner can change roles."});
 const role=String(req.body?.role||"member");if(!["member","mod","admin"].includes(role))return res.status(400).json({error:"Invalid role."});if(req.params.userId===c.ownerId)return res.status(400).json({error:"The owner role cannot be changed."});
 const m=memory.members.get(c.id)||new Map();if(!m.has(req.params.userId))return res.status(404).json({error:"Member not found."});m.set(req.params.userId,role);memory.members.set(c.id,m);persist();res.json({ok:true,role});
});
app.delete("/api/communities/:id/members/:userId",auth,(req,res)=>{
 const c=memory.communities.get(req.params.id);if(!c)return res.status(404).json({error:"Community not found."});if(!canManageCommunity(c.id,req.user.id))return res.status(403).json({error:"You do not have permission."});if(req.params.userId===c.ownerId)return res.status(400).json({error:"The owner cannot be removed."});
 const m=memory.members.get(c.id)||new Map();if(!m.has(req.params.userId))return res.status(404).json({error:"Member not found."});m.delete(req.params.userId);memory.members.set(c.id,m);persist();res.json({ok:true});
});

app.post("/api/owner/auth",auth,(req,res)=>{
 if(!ORBIT_OWNER_CONTROL_KEY)return res.status(503).json({error:"Owner control key is not configured"});
 const key=ownerAttemptKey(req),nowMs=Date.now(),h=ownerKeyAttempts.get(key)||{count:0,resetAt:nowMs+10*60*1000};
 if(nowMs>h.resetAt){h.count=0;h.resetAt=nowMs+10*60*1000}
 if(h.count>=8)return res.status(429).json({error:"Too many owner key attempts. Try again later."});
 const provided=String(req.body?.key||"").trim();
 if(provided!==ORBIT_OWNER_CONTROL_KEY){h.count+=1;ownerKeyAttempts.set(key,h);audit(req.user.id,"OWNER_KEY_FAILED",req.user.id,{});return res.status(401).json({error:"Invalid owner key"})}
 ownerKeyAttempts.delete(key);audit(req.user.id,"OWNER_KEY_AUTH",req.user.id,{});res.json({ok:true,token:ownerTokenFor(req.user),expiresIn:8*60*60});
});
function ownerUserSnapshot(u){
 ensureUserDefaults(u);let serverCount=0,totalMessages=0,dmMessages=0;
 for(const [cid,m] of memory.members){if(m.has(u.id))serverCount++}
 for(const list of memory.messages.values())for(const m of list)if(String(m.senderId)===String(u.id))totalMessages++;
 return {...userPublic(u),serverCount,totalMessages,dmMessages,onlineSockets:[...io.sockets.sockets.values()].filter(s=>String(s.userId)===String(u.id)).length};
}
app.get("/api/owner/dashboard",auth,(req,res)=>{
 if(!requireOwner(req,res))return;
 let messages=0,dmConversations=0,dmMessages=0,uploads=0,activeCalls=0,callParticipants=0;
 for(const list of memory.messages.values())messages+=list.length;
 for(const [cid,c] of memory.conversations)if(c.kind==="dm"){dmConversations++;dmMessages+=(memory.messages.get(cid)||[]).length}
 const calls=[];for(const [room,ids] of io.sockets.adapter.rooms){if(!String(room).startsWith("v2call:")||!ids.size)continue;const conversationId=String(room).slice(7);const ch=[...memory.channels.values()].find(x=>x.conversationId===conversationId);const participants=[...ids].map(sid=>{const so=io.sockets.sockets.get(sid);return so?{socketId:sid,user:userPublic(so.user)}:null}).filter(Boolean);calls.push({room,conversationId,channelName:ch?.name||"call",serverId:ch?.communityId||null,participants});}
 activeCalls=calls.length;callParticipants=calls.reduce((n,c)=>n+c.participants.length,0);
 res.json({ok:true,me:{id:req.user.id,username:req.user.username},stats:{users:memory.users.size,online:[...memory.users.values()].filter(u=>u.status==="online"&&!u.suspended).length,suspended:[...memory.users.values()].filter(u=>u.suspended).length,servers:memory.communities.size,channels:memory.channels.size,messages,dmConversations,dmMessages,uploads,activeCalls,callParticipants,auditEvents:memory.audit.length,uptime:Math.floor(process.uptime()),persistence:persistMode},users:[...memory.users.values()].map(ownerUserSnapshot).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,1000),servers:[...memory.communities.values()].map(c=>{const m=memory.members.get(c.id)||new Map();return {...c,memberCount:m.size,owner: userPublic(memory.users.get(c.ownerId))}}),calls,audit:memory.audit.slice(0,300)});
});
app.get("/api/owner/users/:id",auth,(req,res)=>{
 if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});ensureInventory(u);
 const servers=[...memory.communities.values()].filter(c=>(memory.members.get(c.id)||new Map()).has(u.id)).map(c=>{const m=memory.members.get(c.id)||new Map();return{id:c.id,name:c.name,role:m.get(u.id),ownerId:c.ownerId}});
 const messages=[];for(const ch of memory.channels.values()){const list=memory.messages.get(ch.conversationId)||[];for(const m of list)if(String(m.senderId)===String(u.id))messages.push({...m,kind:"channel",serverId:ch.communityId,channelId:ch.id,channelName:ch.name})}
 const dms=[];for(const [cid,c] of memory.conversations)if(c.kind==="dm"&&(memory.convMembers.get(cid)||new Set()).has(u.id)){const members=[...(memory.convMembers.get(cid)||new Set())].map(idv=>{const x=memory.users.get(idv);return x?{id:x.id,username:x.username,display_name:x.displayName||x.username}:{id:idv}});dms.push({id:cid,members,messages:memory.messages.get(cid)||[]})}
 messages.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 res.json({ok:true,user:{...ownerUserSnapshot(u),accountCreatedAt:u.createdAt||null},inventory:[...memory.inventory.get(u.id)||[]].map(getItem).filter(Boolean),allItems:SHOP,servers,messages:messages.slice(0,1000),dms,uploads:[],sessions:[...memory.sessions.values()].filter(x=>x.userId===u.id).map(x=>({createdAt:new Date(x.createdAt).toISOString(),expiresAt:new Date(x.expiresAt).toISOString()}))});
});
app.post("/api/owner/users/:id/grant-coins",auth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const amount=Math.trunc(Number(req.body?.amount));if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000000)return res.status(400).json({error:"Invalid coin amount"});ensureUserDefaults(u);u.coins=Math.max(0,u.coins+amount);audit(req.user.id,amount>0?"OWNER_COINS_GRANT":"OWNER_COINS_REMOVE",u.id,{amount,reason:String(req.body?.reason||"Owner adjustment").slice(0,240),balance:u.coins});persist();res.json({ok:true,user:userPublic(u),amount});});
app.post("/api/owner/users/:id/grant-item",auth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const item=getItem(req.body?.itemId);if(!item)return res.status(404).json({error:"Item not found"});ensureInventory(u);const inv=memory.inventory.get(u.id);const existed=inv.has(item.id);inv.add(item.id);audit(req.user.id,existed?"OWNER_ITEM_REGRANT":"OWNER_ITEM_GRANT",u.id,{itemId:item.id,name:item.name,type:item.type,equip:Boolean(req.body?.equip)});if(req.body?.equip){if(item.type==="frame")u.frame=item.css;else if(item.type==="effect")u.effect=item.css;else if(item.type==="nameplate")u.nameplate=item.css;else if(item.type==="chat_theme")u.chatTheme=item.css}persist();res.json({ok:true,user:userPublic(u),item,existed});});
app.post("/api/owner/users/:id/revoke-item",auth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const item=getItem(req.body?.itemId);if(!item)return res.status(404).json({error:"Item not found"});ensureInventory(u);if(item.price===0)return res.status(400).json({error:"Core items cannot be revoked"});const inv=memory.inventory.get(u.id);inv.delete(item.id);audit(req.user.id,"OWNER_ITEM_REVOKE",u.id,{itemId:item.id});persist();res.json({ok:true,user:userPublic(u),item});});
app.post("/api/owner/users/:id/suspend",auth,(req,res)=>{if(!requireOwner(req,res))return;const targetId=String(req.params.id);if(targetId===String(req.user.id))return res.status(400).json({error:"You cannot suspend your current owner account."});const u=memory.users.get(targetId);if(!u)return res.status(404).json({error:"User not found"});const mins=Number(req.body?.durationMinutes||0);u.suspended=true;u.suspendedAt=now();u.suspendedUntil=mins>0?new Date(Date.now()+Math.min(mins,525600)*60000).toISOString():null;u.suspendedReason=String(req.body?.reason||"Banned by platform owner").trim().slice(0,300);u.status="offline";for(const so of io.sockets.sockets.values())if(String(so.userId)===targetId)so.disconnect(true);audit(req.user.id,"OWNER_USER_BAN",targetId,{reason:u.suspendedReason,durationMinutes:mins||null});persist();res.json({ok:true,user:userPublic(u),suspended:true});});
app.post("/api/owner/users/:id/unsuspend",auth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});u.suspended=false;u.suspendedAt=null;u.suspendedUntil=null;u.suspendedReason=null;audit(req.user.id,"OWNER_USER_UNBAN",u.id,{});persist();res.json({ok:true,user:userPublic(u),suspended:false});});
app.post("/api/owner/messages/delete",auth,(req,res)=>{if(!requireOwner(req,res))return;const messageId=String(req.body?.messageId||"");if(!messageId)return res.status(400).json({error:"Message id is required"});for(const [cid,list] of memory.messages){const at=list.findIndex(m=>String(m.id)===messageId);if(at!==-1){const [deleted]=list.splice(at,1);memory.messages.set(cid,list);audit(req.user.id,"OWNER_MESSAGE_DELETE",messageId,{conversationId:cid,senderId:deleted.senderId});persist();io.to("conversation:"+cid).emit("message:delete",{messageId});return res.json({ok:true})}}res.status(404).json({error:"Message not found"});});
app.get("/api/owner/shop",auth,(req,res)=>{if(!requireOwner(req,res))return;res.json({items:SHOP})});

app.get("/api/dms",auth,(req,res)=>{
 const result=[];
 for(const c of memory.conversations.values()){
  if(c.kind!=="dm")continue;
  const members=memory.convMembers.get(c.id)||new Set();if(!members.has(req.user.id))continue;
  const other=[...members].find(x=>x!==req.user.id),u=memory.users.get(other);if(u)result.push({id:c.id,otherUser:userPublic(u)})
 }
 res.json({dms:result})
});
app.post("/api/dms",auth,(req,res)=>{
 const username=cleanUsername(req.body?.username),u=[...memory.users.values()].find(x=>x.username===username);if(!u||u.id===req.user.id)return res.status(404).json({error:"User not found."});
 for(const c of memory.conversations.values())if(c.kind==="dm"){const m=memory.convMembers.get(c.id)||new Set();if(m.has(req.user.id)&&m.has(u.id)&&m.size===2)return res.json({dmId:c.id})}
 const c={id:id("dm"),kind:"dm",createdAt:now()};memory.conversations.set(c.id,c);memory.convMembers.set(c.id,new Set([req.user.id,u.id]));persist();res.status(201).json({dmId:c.id})
});
app.get("/api/conversations/:id/messages",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 res.json({messages:messageRows(req.params.id)})
});
app.post("/api/conversations/:id/messages",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 const text=escString(req.body?.content).trim();if(!text)return res.status(400).json({error:"Message is empty."});
 const m={id:id("msg"),conversation_id:req.params.id,senderId:req.user.id,content:text,replyToId:req.body?.replyToId||null,metadata:req.body?.metadata||{},created_at:now(),username:req.user.username,display_name:req.user.displayName,avatar_url:req.user.avatarUrl,avatar_frame:req.user.frame,avatar_effect:req.user.effect};
 const list=memory.messages.get(req.params.id)||[];list.push(m);memory.messages.set(req.params.id,list.slice(-500));req.user.messages++;award(req.user,10,0);persist();io.to("conversation:"+req.params.id).emit("message:new",m);res.status(201).json({message:m})
});

app.get("/api/notifications",auth,(req,res)=>res.json({notifications:memory.notifications.get(req.user.id)||[]}));
app.post("/api/notifications/read",auth,(req,res)=>{for(const n of memory.notifications.get(req.user.id)||[])n.read=true;persist();res.json({ok:true})});
app.get("/api/friends",auth,(req,res)=>{const friends=[...memory.friends].filter(k=>k.startsWith(req.user.id+":")).map(k=>userPublic(memory.users.get(k.split(":")[1]))).filter(Boolean);res.json({friends})});
app.post("/api/friends/request",auth,(req,res)=>{
 const username=cleanUsername(req.body?.username),u=[...memory.users.values()].find(x=>x.username===username);if(!u||u.id===req.user.id)return res.status(404).json({error:"User not found."});
 const key=req.user.id+":"+u.id;if(memory.friends.has(key))return res.status(409).json({error:"Already friends."});memory.friends.add(key);memory.friends.add(u.id+":"+req.user.id);req.user.friends++;u.friends++;addNotification(u.id,"New friend","You are now connected with @"+req.user.username,"friend");persist();res.status(201).json({ok:true})
});

io.use((socket,next)=>{
 const raw=String(socket.handshake.headers?.cookie||"");let t="";
 for(const p of raw.split(";")){const a=p.trim().split("=");if(a[0]===COOKIE)t=decodeURIComponent(a.slice(1).join("=")||"")}
 let s=memory.sessions.get(hash(t)),u=s&&s.expiresAt>Date.now()?memory.users.get(s.userId):null;
 if(!u){
  try{const payload=jwt.verify(t,JWT_SECRET);if(payload.account)u=memory.users.get(String(payload.id))||null}catch{}
  if(u){
  if(u.suspendedUntil&&new Date(u.suspendedUntil).getTime()<=Date.now()){u.suspended=false;u.suspendedUntil=null;u.suspendedReason=null;persist()}
  if(u.suspended)return next(new Error("Account suspended"));
  const upgraded=token();memory.sessions.set(hash(upgraded),{userId:u.id,createdAt:Date.now(),expiresAt:Date.now()+2592000000});persist() }
 }
 if(!u)return next(new Error("Unauthorized"));socket.userId=u.id;socket.user=u;u.status="online";ensureInventory(u);next();persist()
});
io.on("connection",socket=>{
 socket.join("user:"+socket.userId);socket.emit("session:ready",{user:userPublic(socket.user)});
 socket.on("conversation:join",cid=>{if(conversationAccess(cid,socket.userId))socket.join("conversation:"+cid)});
 socket.on("typing",({conversationId,isTyping}={})=>{if(conversationAccess(conversationId,socket.userId))socket.to("conversation:"+conversationId).emit("typing",{conversationId,userId:socket.userId,isTyping:Boolean(isTyping)})});
 socket.on("message:send",({conversationId,content,replyToId,metadata}={},ack)=>{
  if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});
  const text=escString(content).trim();if(!text)return ack?.({ok:false,error:"Message is empty."});
  const u=memory.users.get(socket.userId),m={id:id("msg"),conversation_id:conversationId,senderId:u.id,content:text,replyToId:replyToId||null,metadata:metadata||{},created_at:now(),username:u.username,display_name:u.displayName,avatar_url:u.avatarUrl,avatar_frame:u.frame,avatar_effect:u.effect};
  const list=memory.messages.get(conversationId)||[];list.push(m);memory.messages.set(conversationId,list.slice(-500));u.messages++;award(u,10,0);persist();io.to("conversation:"+conversationId).emit("message:new",m);ack?.({ok:true,message:m})
 });
 socket.on("call:invite",({conversationId,mode="video"}={})=>{
  if(!conversationAccess(conversationId,socket.userId))return;
  for(const uid of conversationUsers(conversationId))if(uid!==socket.userId)io.to("user:"+uid).emit("call:incoming",{conversationId,mode,caller:userPublic(socket.user)})
 });
 socket.on("call:join",({roomId,mode="video"}={})=>{
  if(!conversationAccess(roomId,socket.userId))return;
  const room="v2call:"+roomId;socket.join(room);socket.callRoom=room;socket.callStarted=Date.now();
  const p=[...(io.sockets.adapter.rooms.get(room)||[])].filter(x=>x!==socket.id).map(sid=>{const s=io.sockets.sockets.get(sid);return s?{socketId:sid,user:userPublic(s.user)}:null}).filter(Boolean);
  socket.emit("call:participants",p);socket.to(room).emit("call:participant-joined",{socketId:socket.id,user:userPublic(socket.user),mode})
 });
 socket.on("call:leave",()=>{
  if(!socket.callRoom)return;socket.leave(socket.callRoom);socket.to(socket.callRoom).emit("call:participant-left",{socketId:socket.id,userId:socket.userId});
  if(socket.callStarted){socket.user.callMinutes+=Math.max(1,Math.round((Date.now()-socket.callStarted)/60000));award(socket.user,10,0)}socket.callRoom=null;socket.callStarted=null;persist()
 });
 socket.on("rtc:offer",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:offer",{from:socket.id,offer:d.offer,fromUser:userPublic(socket.user)})});
 socket.on("rtc:answer",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:answer",{from:socket.id,answer:d.answer})});
 socket.on("rtc:ice",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:ice",{from:socket.id,candidate:d.candidate})});
 socket.on("disconnect",()=>{socket.user.status="offline";if(socket.callRoom){socket.to(socket.callRoom).emit("call:participant-left",{socketId:socket.id,userId:socket.userId})}persist()})
});

async function start(){
 await bootPersistence();
 for(const u of memory.users.values()){ensureUserDefaults(u);ensureInventory(u)}
 server.listen(PORT,"0.0.0.0",()=>console.log("[orbit-v2] AAA platform listening on "+PORT+" persistence="+persistMode));
}
start().catch(e=>{console.error("[orbit-v2] boot failed",e);process.exit(1)});
