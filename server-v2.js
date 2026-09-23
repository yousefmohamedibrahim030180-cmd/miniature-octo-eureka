const express=require("express");
const http=require("http");
const path=require("path");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Server}=require("socket.io");

const app=express();
// ORBIT deploy marker: keep Railway source deploys aligned with main.
const server=http.createServer(app);
const io=new Server(server,{transports:["polling"],cors:{origin:true,credentials:true},allowUpgrades:false,maxHttpBufferSize:8*1024*1024,pingTimeout:60000,pingInterval:25000});
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
 inventory:new Map(),missionClaims:new Set(),missionProgress:new Map(),wishlist:new Map(),frameStock:new Map(),customFrames:[],daily:new Set(),friends:new Set(),audit:[]
};
let persistTimer=null,persistBusy=false,persistPending=false,persistMode="memory";

function id(prefix){return prefix+"_"+crypto.randomUUID()}
function now(){return new Date().toISOString()}
function cleanUsername(v){return String(v||"").trim().toLowerCase().replace(/^@+/,"").replace(/[^a-z0-9._-]/g,"").slice(0,20)}
function cleanName(v,fallback){return String(v||"").trim().replace(/\s+/g," ").slice(0,32)||fallback||"ORBIT User"}
function hash(v){return crypto.createHash("sha256").update(String(v)).digest("hex")}
function token(){return crypto.randomBytes(48).toString("base64url")}
function escString(v){return String(v??"").slice(0,4000)}
function avatarField(v){
 const value=String(v||"").trim();
 if(/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value))return value.length<=900000?value:"";
 if(/^https:\/\//i.test(value))return value.slice(0,2000);
 return "";
}

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
  wishlist:[...memory.wishlist].map(([k,v])=>[k,[...v]]),
  frameStock:[...memory.frameStock],
  customFrames:memory.customFrames,
  missionClaims:[...memory.missionClaims],
  missionProgress:[...memory.missionProgress],
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
 memory.wishlist=new Map((data.wishlist||[]).map(x=>[x[0],new Set(x[1]||[])]));
 memory.frameStock=new Map(data.frameStock||[]);
 memory.customFrames=Array.isArray(data.customFrames)?data.customFrames:[];
 memory.missionClaims=new Set(data.missionClaims||[]);
 memory.missionProgress=new Map(data.missionProgress||[]);
 memory.daily=new Set(data.daily||[]);
 memory.friends=new Set(data.friends||[]);
 memory.audit=Array.isArray(data.audit)?data.audit.slice(0,500):[];
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
   for(const custom of memory.customFrames||[]){if(!SHOP.some(x=>x.id===custom.id))SHOP.push(custom)}
   for(const frame of GENERATED_FRAMES){if(frame.limited&&!memory.frameStock.has(frame.id))memory.frameStock.set(frame.id,Number(frame.remainingStock||0))}
   for(const frame of memory.customFrames||[]){if(frame.limited&&!memory.frameStock.has(frame.id))memory.frameStock.set(frame.id,Number(frame.remainingStock||0))}
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
function ownerTokenFor(){return jwt.sign({owner:true,userId:"owner"},JWT_SECRET,{expiresIn:"8h"})}
function hasOwnerToken(req){const raw=String(req.headers["x-owner-token"]||"").trim();if(!raw)return false;try{const p=jwt.verify(raw,JWT_SECRET);return Boolean(p?.owner)&&String(p.userId)==="owner"}catch{return false}}
function ownerAuth(req,res,next){if(!hasOwnerToken(req))return res.status(401).json({error:"Owner session expired or missing"});req.ownerActor={id:"owner",username:"owner"};req.user={id:"owner",username:"owner",displayName:"Platform Owner",status:"online",suspended:false};next()}
function requireOwner(req,res){if(!hasOwnerToken(req)){res.status(401).json({error:"Owner session expired or missing"});return false}if(!req.ownerActor)req.ownerActor={id:"owner",username:"owner"};return true}
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
 u.preferences=u.preferences||{};
 u.preferences.theme=u.preferences.theme||"void";
 u.preferences.background=u.preferences.background||"nebula";
 u.preferences.surface=u.preferences.surface||"glass";
 u.preferences.radius=u.preferences.radius||"medium";
 u.preferences.glow=u.preferences.glow||"medium";
 u.preferences.density=u.preferences.density||"comfortable";
 u.preferences.motion=u.preferences.motion!==false;
 u.preferences.accent=u.preferences.accent||"violet";
 u.preferences.fontScale=u.preferences.fontScale||"100";
 u.preferences.language=u.preferences.language||"en";
 u.preferences.timeFormat=u.preferences.timeFormat||"24h";
 u.preferences.sidebar=u.preferences.sidebar||"expanded";
 u.preferences.messageDensity=u.preferences.messageDensity||"comfortable";
 u.preferences.enterToSend=u.preferences.enterToSend!==false;
 u.preferences.showAvatars=u.preferences.showAvatars!==false;
 u.preferences.showTimestamps=u.preferences.showTimestamps!==false;
 u.preferences.autoplayMedia=u.preferences.autoplayMedia!==false;
 u.preferences.linkPreviews=u.preferences.linkPreviews!==false;
 u.preferences.emojiReactions=u.preferences.emojiReactions!==false;
 u.preferences.typingIndicators=u.preferences.typingIndicators!==false;
 u.preferences.spellcheck=u.preferences.spellcheck!==false;
 u.preferences.sounds=u.preferences.sounds!==false;
 u.preferences.notifications=u.preferences.notifications||{messages:true,mentions:true,calls:true,social:true,desktop:false,badges:true,sound:true};
 u.preferences.privacy=u.preferences.privacy||{presence:true,readReceipts:true,friendRequests:true,profileSearch:true,messageRequests:true};
 u.preferences.accessibility=u.preferences.accessibility||{reducedMotion:false,highContrast:false,largeText:false};
 u.preferences.calls=u.preferences.calls||{echoCancellation:true,autoGain:true,noiseSuppression:true,hdVideo:true};
 u.preferences.data=u.preferences.data||{compressUploads:true,saveDrafts:true,confirmExternalLinks:true};
 u.xp=Number(u.xp||0);u.level=Math.max(1,Number(u.level||1));u.coins=Number(u.coins||250);
 u.messages=Number(u.messages||0);u.callMinutes=Number(u.callMinutes||0);u.friends=Number(u.friends||0);
 u.communitiesCreated=Number(u.communitiesCreated||0);u.communitiesJoined=Number(u.communitiesJoined||0);
 return u;
}
for(const u of memory.users.values())ensureUserDefaults(u);

const RARITY_PRICE={Common:100,Uncommon:220,Rare:450,Epic:800,Legendary:1600,Mythic:3200,Ancient:5200,Divine:7600,Celestial:9500,LIMITED:4500};
const FRAME_CATEGORIES={
 Cosmic:["Galaxy Ring","Black Hole","Nebula","Supernova","Solar Eclipse","Starfield","Cosmic Energy","Astral Portal","Moon Orbit","Space Rift"],
 Legendary:["Inferno Crown","Dragon Flame","Phoenix","Hellfire","Molten Core","Burning Soul","Eternal Flame","Crimson Dragon","Firestorm","Apocalypse"],
 Ice:["Frozen Crown","Ice Crystal","Arctic Aura","Frost Dragon","Frozen Galaxy","Blizzard","Diamond Ice","Glacier","Snowfall","Eternal Winter"],
 Energy:["Lightning","Plasma","Electric Pulse","Thunder Core","Energy Reactor","Voltage","Neon Shock","Arc Energy","Power Surge","Overcharge"],
 Royal:["Golden Crown","Imperial Gold","Royal Emerald","Royal Sapphire","Black Gold","Diamond King","Platinum","Emperor","Sovereign","Royal Eclipse"],
 Fantasy:["Dragon","Dark Dragon","Ancient Rune","Magic Portal","Mystic Crystal","Demon Gate","Elven Aura","Arcane Circle","Wizard","Mythic Beast"],
 Cyber:["Cyber Core","Cyberpunk","Hologram","Digital Matrix","Quantum","AI Core","Cyber Grid","Neon Circuit","System Override","Digital Portal"],
 Elemental:["Water","Fire","Earth","Wind","Lightning","Shadow","Light","Void","Nature","Plasma"],
 Dark:["Skull","Shadow","Dark Matter","Void","Grim","Black Flame","Phantom","Dark Portal","Soul Reaper","Nightfall"],
 Nature:["Forest","Sakura","Ancient Tree","Emerald Leaf","Nature Spirit","Floral","Ocean","Aurora","Wild Garden","Mystic Forest"],
 Gaming:["Victory","Ranked","Champion","Boss","Level Up","Critical Hit","Game Master","XP","GG","Ultimate"],
 Competitive:["Challenger","Elite","Master","Grandmaster","Champion","Tournament","MVP","Victory","Top 1","Hall of Fame"],
 Events:["Halloween","Christmas","New Year","Valentine","Ramadan","Eid","Summer","Winter","Anniversary","ORBIT Birthday"],
 Tech:["Quantum Mesh","Neural Link","Core Reactor","Signal Bloom","Photon Grid","Data Halo","Nano Pulse","Circuit Crown","Protocol Zero","Hyperlink"],
 Retro:["Pixel Orbit","Arcade Nova","Synthwave","CRT Pulse","8Bit Crown","Vector Ring","Retro Grid","Cassette Core","Vapor Drive","Neon Memory"],
 Monochrome:["Obsidian","Silverline","Whiteout","Graphite","Chrome","Pearl Black","Polar Ink","Steel Halo","Mono Rift","Carbon"],
 Mythic:["Astral Dragon","Divine Rune","Celestial Beast","Eternal Gate","Ancient Sun","Godforge","Star Titan","Mythic Crown","Primordial","Worldbreaker"],
 Seasonal:["Autumn Moon","Spring Bloom","Summer Solstice","Winter Solstice","Meteor Season","Solar Season","Moon Festival","Aurora Season","Rainfall","Harvest Night"],
 Founder:["Genesis","First Flight","Ascension","APEX","Founders Ring","Origin Core","Legacy","Pioneer","First Orbit","Prime Signal"],
 Abyss:["Void Walker","Void King","Event Horizon","Singularity","Abyss","Shadow Rift","Void Emperor","Absolute Zero","Black Star","Deep Space"]
};
const COLLECTION_NAMES=["THE VOID","CELESTIAL","DRAGONFIRE","FROSTBORN","ELECTRIC AGE","ROYAL DYNASTY","ARCANE RIFT","CYBER NEXUS","ELEMENTAL REIGN","WILD ORBIT","ARENA ELITE","EVENT HORIZON","GENESIS ARCHIVE","SYNTH MEMORY","OBSIDIAN CODE","MYTHIC AGE","SEASONAL SKIES","FOUNDER'S VAULT","ABYSSAL RIFT","ORBIT APEX"];
const SLUG=v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const RARITIES=["Common","Uncommon","Rare","Epic","Legendary","Mythic","Ancient","Divine","Celestial","LIMITED"];
const GENERATED_FRAMES=[];
const categoryNames=Object.entries(FRAME_CATEGORIES);
for(let i=0;i<200;i++){
 const [category,names]=categoryNames[i%categoryNames.length],name=names[i%names.length],variant=Math.floor(i/categoryNames.length)+1;
 const rarity=RARITIES[(i*7+Math.floor(i/13))%RARITIES.length];
 const animated=(i%3)!==0;
 const limited=rarity==="LIMITED"||i%47===0;
 const collectionIndex=Math.floor(i/10)%COLLECTION_NAMES.length;
 const slug=SLUG(name)+"-"+variant;
 const css=SLUG(category)+"-"+slug+"-"+SLUG(rarity)+(animated?"-animated":"");
 GENERATED_FRAMES.push({
  id:"frame-"+String(i+1).padStart(3,"0"),type:"frame",name:variant>1?name+" "+variant:name,
  slug,description:"A collectible ORBIT identity frame from the "+COLLECTION_NAMES[collectionIndex]+" collection.",
  category,rarity,price:limited?Math.max(2500,RARITY_PRICE[rarity]||4500):(RARITY_PRICE[rarity]||450),
  currency:"coins",css,animated,animationType:animated?["orbit","pulse","spark","portal","scan"][i%5]:"none",
  collectionId:"collection-"+String(collectionIndex+1).padStart(2,"0"),collection:COLLECTION_NAMES[collectionIndex],
  limited,stock:limited?500+((i*17)%4500):null,remainingStock:limited?500+((i*17)%4500):null,
  releaseDate:new Date(Date.UTC(2026,0,1+(i%365))).toISOString(),expirationDate:limited?new Date(Date.UTC(2027,0,1+(i%180))).toISOString():null,
  featured:i<24||i%17===0,popularity:1000-i*3+(i%29)*17,
  levelCap:(i%5===0)?5:1
 });
}
GENERATED_FRAMES[0]={...GENERATED_FRAMES[0],id:"frame-orbit",name:"Orbit Core",slug:"orbit-core",category:"Cosmic",rarity:"Common",price:0,css:"orbit",animated:false,animationType:"none",collectionId:"collection-01",collection:"THE VOID",limited:false};
const EXTRA_FRAME_IDS=[
 ["frame-nebula","Nebula","Cosmic","Epic","nebula"],["frame-cyber","Cyber Pulse","Cyber","Epic","cyber"],["frame-royal","Royal Halo","Royal","Legendary","royal"],
 ["frame-ice","Ice Crystal","Ice","Legendary","ice"],["frame-plasma","Plasma Surge","Energy","Epic","plasma"],["frame-hologram","Hologram Circuit","Cyber","Epic","hologram"],
 ["frame-quantum","Quantum Ring","Cyber","Legendary","quantum"],["frame-quasar","Quasar Crown","Cosmic","Legendary","quasar"],["frame-singularity","Singularity","Dark","Mythic","singularity"]
];
for(const [id,name,category,rarity,css] of EXTRA_FRAME_IDS){
 const idx=GENERATED_FRAMES.findIndex(x=>x.id===id);
 const frame={id,type:"frame",name,slug:SLUG(name),description:"Legacy ORBIT frame preserved in the legendary catalog.",category,rarity,price:rarity==="Mythic"?2200:rarity==="Legendary"?850:450,currency:"coins",css,animated:!["nebula","cyber","royal","ice"].includes(css),animationType:"orbit",collectionId:"collection-01",collection:"THE VOID",limited:false,stock:null,remainingStock:null,releaseDate:"2026-01-01T00:00:00.000Z",expirationDate:null,featured:true,popularity:5000,levelCap:3};
 if(idx>=0)GENERATED_FRAMES[idx]={...GENERATED_FRAMES[idx],...frame};
}
const COLLECTIONS=COLLECTION_NAMES.map((name,i)=>({id:"collection-"+String(i+1).padStart(2,"0"),name,description:"A curated ORBIT identity collection built around a distinct visual universe.",banner:"",totalFrames:10,reward:i%3===0?"Collector Badge":i%3===1?"Unique Title":"Cosmetic Token",rewardType:"badge"}));
let SHOP=[
 ...GENERATED_FRAMES,
 {id:"effect-none",type:"effect",name:"None",price:0,rarity:"Core",css:"none"},
 {id:"effect-spark",type:"effect",name:"Spark Field",price:300,rarity:"Rare",css:"spark"},
 {id:"effect-orbit",type:"effect",name:"Orbiting Lights",price:700,rarity:"Epic",css:"orbit"},
 {id:"plate-orbit",type:"nameplate",name:"ORBIT",price:0,rarity:"Core",css:"orbit"},
 {id:"plate-nexus",type:"nameplate",name:"NEXUS",price:900,rarity:"Legendary",css:"nexus"},
 {id:"theme-void",type:"chat_theme",name:"Void",price:0,rarity:"Core",css:"void"},
 {id:"theme-aurora",type:"chat_theme",name:"Aurora",price:550,rarity:"Epic",css:"aurora"},
 {id:"theme-ice",type:"chat_theme",name:"Ice Glass",price:650,rarity:"Epic",css:"ice"}
];
for(const f of GENERATED_FRAMES)memory.frameStock.set(f.id,f.remainingStock);
const baseShopIds=new Set(SHOP.map(x=>x.id));
function frameRows(){return SHOP.filter(x=>x.type==="frame"&&x.enabled!==false)}
const MISSIONS=[
 {id:"daily-signal",title:"Daily Signal",description:"Send 5 messages today.",metric:"messages",target:5,xp:60,coins:45,cadence:"daily"},
 {id:"daily-conversation",title:"Keep It Moving",description:"Send 10 messages today.",metric:"messages",target:10,xp:120,coins:90,cadence:"daily"},
 {id:"daily-call",title:"Live Orbit",description:"Spend 5 minutes in a call today.",metric:"callMinutes",target:5,xp:90,coins:70,cadence:"daily"},
 {id:"weekly-social",title:"Social Orbit",description:"Send 50 messages this week.",metric:"messages",target:50,xp:320,coins:240,cadence:"weekly"},
 {id:"weekly-voice",title:"Voice Run",description:"Spend 30 minutes in calls this week.",metric:"callMinutes",target:30,xp:450,coins:320,cadence:"weekly"},
 {id:"join-community",title:"Enter a World",description:"Join your first community.",metric:"communitiesJoined",target:1,xp:100,coins:80,cadence:"lifetime"},
 {id:"create-community",title:"Build a World",description:"Create your first community.",metric:"communitiesCreated",target:1,xp:300,coins:180,cadence:"lifetime"},
 {id:"profile-crafted",title:"Identity Complete",description:"Add a bio and customize your ORBIT identity.",metric:"profile",target:1,xp:120,coins:90,cadence:"lifetime"}
];
function missionCycle(m){
 if(m.cadence==="lifetime")return "lifetime";
 const d=new Date();
 if(m.cadence==="weekly"){
  const day=(d.getUTCDay()+6)%7,monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));
  return monday.toISOString().slice(0,10);
 }
 return d.toISOString().slice(0,10);
}
function missionProgressKey(user,metric,cycle){return String(user.id)+":"+metric+":"+cycle}
function trackMissionProgress(user,metric,amount=1){
 const value=Number(amount||0);if(!value)return;
 for(const m of MISSIONS){
  if(m.metric!==metric||m.cadence==="lifetime")continue;
  const key=missionProgressKey(user,metric,missionCycle(m));
  memory.missionProgress.set(key,Number(memory.missionProgress.get(key)||0)+value);
 }
}
function missionValue(user,m){
 if(m.metric==="profile")return user.bio?1:0;
 if(m.cadence==="lifetime")return Number(user[m.metric]||0);
 return Number(memory.missionProgress.get(missionProgressKey(user,m.metric,missionCycle(m)))||0);
}
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
function conversationState(c){c.lastMessage=c.lastMessage&&typeof c.lastMessage==="object"?c.lastMessage:null;c.updatedAt=c.updatedAt||c.createdAt||now();c.unread=c.unread&&typeof c.unread==="object"?c.unread:{};return c;}
function messagePreview(m){if(!m)return null;const raw=String(m.content||"").trim();const preview=m.deleted_at?"Message deleted":raw||((m.metadata?.attachment?.kind==="image")?"Photo":(m.metadata?.attachment?.kind==="voice"?"Voice message":"Attachment"));return {id:m.id,senderId:m.senderId,content:preview.slice(0,180),created_at:m.created_at,deleted_at:m.deleted_at||null};}
function appendConversationMessage(conversationId,m,bumpUnread=true){const c=conversationState(memory.conversations.get(conversationId)||{id:conversationId});memory.conversations.set(conversationId,c);c.lastMessage=messagePreview(m);c.updatedAt=m.created_at;if(!bumpUnread)return;const members=memory.convMembers.get(conversationId)||new Set();for(const uid of members)if(String(uid)!==String(m.senderId))c.unread[String(uid)]=Number(c.unread[String(uid)]||0)+1;}
function markConversationRead(conversationId,userId){const c=memory.conversations.get(conversationId);if(!c)return false;conversationState(c);if(Number(c.unread[String(userId)]||0)===0)return false;c.unread[String(userId)]=0;return true;}
function messageRows(conversationId){return (memory.messages.get(conversationId)||[]).map(m=>({...m,sender:userPublic(memory.users.get(m.senderId))}));}
function directSummary(c,userId){conversationState(c);const members=memory.convMembers.get(c.id)||new Set(),other=[...members].find(x=>String(x)!==String(userId)),u=memory.users.get(other);return u?{id:c.id,kind:"dm",otherUser:userPublic(u),lastMessage:c.lastMessage,updatedAt:c.updatedAt,unread:Number(c.unread?.[String(userId)]||0)}:null;}
function createMessage(conversationId,user,text,replyToId=null,metadata={}){return {id:id("msg"),conversation_id:conversationId,senderId:user.id,content:escString(text).trim(),replyToId:replyToId||null,metadata:metadata&&typeof metadata==="object"?metadata:{},created_at:now(),username:user.username,display_name:user.displayName,avatar_url:user.avatarUrl,avatar_frame:user.frame,avatar_effect:user.effect};}
function pushMessage(conversationId,m){const list=memory.messages.get(conversationId)||[];list.push(m);memory.messages.set(conversationId,list.slice(-1000));appendConversationMessage(conversationId,m);return m;}
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
app.get("/",(req,res)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");res.sendFile(path.join(__dirname,"public","orbit-v2.html"));});
app.get("/download",(req,res)=>res.sendFile(path.join(__dirname,"public","download","index.html")));
app.get("/health",(req,res)=>res.json({ok:true,service:"orbit-v2",version:"2.0.0-aaa",persistence: persistMode,users:memory.users.size,communities:memory.communities.size,conversations:memory.conversations.size,time:now()}));
app.get("/owner",(req,res)=>res.sendFile(path.join(__dirname,"public","owner-v2.html")));
app.get("/owner-v2",(req,res)=>res.sendFile(path.join(__dirname,"public","owner-v2.html")));
app.get("/download/orbit.exe",(req,res)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");res.redirect(302,"https://github.com/yousefmohamedibrahim030180-cmd/miniature-octo-eureka/releases/download/orbit-latest/ORBIT-2.0.0-aaa-x64.exe");});


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
app.patch("/api/me/preferences",auth,(req,res)=>{ensureUserDefaults(req.user);const b=req.body||{},p=req.user.preferences;
 if(["void","aurora","ice","midnight"].includes(String(b.theme)))p.theme=String(b.theme);
 if(["nebula","aurora","cyber","grid","plain"].includes(String(b.background)))p.background=String(b.background);
 if(["glass","solid","frost"].includes(String(b.surface)))p.surface=String(b.surface);
 if(["sharp","medium","soft"].includes(String(b.radius)))p.radius=String(b.radius);
 if(["low","medium","high"].includes(String(b.glow)))p.glow=String(b.glow);
 if(["comfortable","compact"].includes(String(b.density)))p.density=String(b.density);
 if(typeof b.motion==="boolean")p.motion=b.motion;
 if(["violet","cyan","gold","rose"].includes(String(b.accent)))p.accent=String(b.accent);
 if(["90","100","110","125"].includes(String(b.fontScale)))p.fontScale=String(b.fontScale);
 if(["en","ar"].includes(String(b.language)))p.language=String(b.language);
 if(["12h","24h"].includes(String(b.timeFormat)))p.timeFormat=String(b.timeFormat);
 if(["expanded","compact","minimal"].includes(String(b.sidebar)))p.sidebar=String(b.sidebar);
 if(["comfortable","compact","spacious"].includes(String(b.messageDensity)))p.messageDensity=String(b.messageDensity);
 for(const k of ["enterToSend","showAvatars","showTimestamps","autoplayMedia","linkPreviews","emojiReactions","typingIndicators","spellcheck","sounds"])if(typeof b[k]==="boolean")p[k]=b[k];
 for(const k of ["messages","mentions","calls","social","desktop","badges","sound"])if(typeof b.notifications?.[k]==="boolean")p.notifications[k]=b.notifications[k];
 for(const k of ["presence","readReceipts","friendRequests","profileSearch","messageRequests"])if(typeof b.privacy?.[k]==="boolean")p.privacy[k]=b.privacy[k];
 for(const k of ["reducedMotion","highContrast","largeText"])if(typeof b.accessibility?.[k]==="boolean")p.accessibility[k]=b.accessibility[k];
 for(const k of ["echoCancellation","autoGain","noiseSuppression","hdVideo","joinSound"])if(typeof b.calls?.[k]==="boolean")p.calls[k]=b.calls[k];
 for(const k of ["compressUploads","saveDrafts","confirmExternalLinks"])if(typeof b.data?.[k]==="boolean")p.data[k]=b.data[k];
 persist();res.json({user:userPublic(req.user)});
});

app.get("/api/me/sessions",auth,(req,res)=>{
 const current=hash(cookie(req,COOKIE)),rows=[];
 for(const [sessionHash,session] of memory.sessions.entries()){
  if(session.userId!==req.user.id)continue;
  rows.push({
   id:sessionHash.slice(0,12),
   createdAt:session.createdAt||null,
   expiresAt:session.expiresAt||null,
   current:sessionHash===current,
   ageHours:session.createdAt?Math.max(0,Math.round((Date.now()-session.createdAt)/3600000)):null
  });
 }
 rows.sort((a,b)=>Number(b.current)-Number(a.current)||(b.createdAt||0)-(a.createdAt||0));
 res.json({sessions:rows});
});

app.post("/api/me/sessions/revoke-others",auth,(req,res)=>{
 const current=hash(cookie(req,COOKIE));let revoked=0;
 for(const [sessionHash,session] of memory.sessions.entries()){
  if(session.userId===req.user.id&&sessionHash!==current){memory.sessions.delete(sessionHash);revoked++}
 }
 persist();
 res.json({ok:true,revoked});
});

app.post("/api/me/password",auth,async(req,res)=>{
 const current=String(req.body?.currentPassword||""),next=String(req.body?.newPassword||"");
 if(next.length<8||next.length>72)return res.status(400).json({error:"New password must be 8-72 characters."});
 if(!current||!(await bcrypt.compare(current,req.user.passwordHash)))return res.status(401).json({error:"Current password is incorrect."});
 if(current===next)return res.status(400).json({error:"Choose a different password."});
 req.user.passwordHash=await bcrypt.hash(next,12);
 const currentHash=hash(cookie(req,COOKIE));let revoked=0;
 for(const [sessionHash,session] of memory.sessions.entries()){
  if(session.userId===req.user.id&&sessionHash!==currentHash){memory.sessions.delete(sessionHash);revoked++}
 }
 audit(req.user.id,"password_changed",req.user.id,{revokedSessions:revoked});
 persist();
 res.json({ok:true,revoked});
});

app.get("/api/me/export",auth,(req,res)=>{
 const convIds=new Set();
 for(const [convId,members] of memory.convMembers.entries())if(members.has(req.user.id))convIds.add(convId);
 const messages=[];
 for(const convId of convIds){
  const list=memory.messages.get(convId)||[];
  for(const m of list)messages.push(m);
 }
 const notifications=[...(memory.notifications.get(req.user.id)||[])];
 const memberships=[...memory.members.entries()].filter(([,members])=>members.has(req.user.id)).map(([communityId,members])=>{
  const c=memory.communities.get(communityId);
  return c?{id:c.id,name:c.name,role:members.get(req.user.id)||"member"}:null;
 }).filter(Boolean);
 const payload={
  exportedAt:now(),
  account:userPublic(req.user),
  communities:memberships,
  messages:messages.slice(-5000),
  notifications,
  sessionCount:[...memory.sessions.values()].filter(x=>x.userId===req.user.id).length,
  note:"Secrets such as passwords, session tokens and internal hashes are never exported."
 };
 audit(req.user.id,"data_export",req.user.id,{messageCount:payload.messages.length});
 persist();
 res.setHeader("Content-Type","application/json; charset=utf-8");
 res.setHeader("Content-Disposition","attachment; filename=\"orbit-data.json\"");
 res.send(JSON.stringify(payload,null,2));
});

app.get("/api/search",auth,(req,res)=>{
 const q=String(req.query.q||"").trim().toLowerCase();if(!q)return res.json({users:[],communities:[]});
 const users=[...memory.users.values()].filter(u=>u.username.includes(q)||u.displayName.toLowerCase().includes(q)).slice(0,20).map(userPublic);
 const communities=[...memory.communities.values()].filter(c=>c.name.toLowerCase().includes(q)).slice(0,20);
 res.json({users,communities});
});

app.get("/api/studio",auth,(req,res)=>{
 ensureInventory(req.user);
 const owned=memory.inventory.get(req.user.id),wishlist=memory.wishlist.get(req.user.id)||new Set();
 res.json({user:userPublic(req.user),shop:SHOP.map(x=>({...x,owned:owned.has(x.id),wishlist:wishlist.has(x.id),remainingStock:x.type==="frame"&&x.limited?Number(memory.frameStock.get(x.id)||0):x.remainingStock})),collections:COLLECTIONS.map(c=>({...c,collected:frameRows().filter(f=>f.collectionId===c.id&&owned.has(f.id)).length}))});
});
app.get("/api/studio/frames",auth,(req,res)=>{
 ensureInventory(req.user);
 const q=String(req.query?.q||"").trim().toLowerCase(),category=String(req.query?.category||"").trim(),rarity=String(req.query?.rarity||"").trim();
 const section=String(req.query?.section||"").trim(),animated=req.query?.animated==="true",limited=req.query?.limited==="true",ownedOnly=req.query?.owned==="true";
 let rows=frameRows().filter(x=>(!q||[x.name,x.category,x.rarity,x.collection,x.description].join(" ").toLowerCase().includes(q))&&(!category||x.category===category)&&(!rarity||x.rarity===rarity)&&(!animated||x.animated)&&(!limited||x.limited)&&(!ownedOnly||memory.inventory.get(req.user.id).has(x.id)));
 if(section==="featured")rows=rows.filter(x=>x.featured);
 if(section==="limited")rows=rows.filter(x=>x.limited);
 if(section==="animated")rows=rows.filter(x=>x.animated);
 if(section==="owned")rows=rows.filter(x=>memory.inventory.get(req.user.id).has(x.id));
 if(section==="wishlist")rows=rows.filter(x=>(memory.wishlist.get(req.user.id)||new Set()).has(x.id));
 const sort=String(req.query?.sort||"popular");
 rows.sort((a,b)=>sort==="price-low"?a.price-b.price:sort==="price-high"?b.price-a.price:sort==="newest"?String(b.releaseDate).localeCompare(String(a.releaseDate)):sort==="alpha"?a.name.localeCompare(b.name):Number(b.popularity||0)-Number(a.popularity||0));
 const page=Math.max(1,Number(req.query?.page||1)),pageSize=Math.min(60,Math.max(12,Number(req.query?.pageSize||36))),start=(page-1)*pageSize;
 res.json({frames:rows.slice(start,start+pageSize).map(x=>({...x,owned:memory.inventory.get(req.user.id).has(x.id),wishlist:(memory.wishlist.get(req.user.id)||new Set()).has(x.id),remainingStock:x.limited?Number(memory.frameStock.get(x.id)||0):x.remainingStock})),page,pageSize,total:rows.length,categories:[...new Set(frameRows().map(x=>x.category))],rarities:[...new Set(frameRows().map(x=>x.rarity))]});
});
app.get("/api/studio/collections",auth,(req,res)=>{
 ensureInventory(req.user);const inv=memory.inventory.get(req.user.id);
 res.json({collections:COLLECTIONS.map(c=>({...c,collected:frameRows().filter(f=>f.collectionId===c.id&&inv.has(f.id)).length}))});
});
app.post("/api/studio/wishlist",auth,(req,res)=>{
 const item=getItem(req.body?.itemId);if(!item)return res.status(404).json({error:"Cosmetic not found."});
 const set=memory.wishlist.get(req.user.id)||new Set();const state=set.has(item.id);if(state)set.delete(item.id);else set.add(item.id);memory.wishlist.set(req.user.id,set);persist();res.json({ok:true,wishlisted:!state});
});
app.post("/api/studio/checkin",auth,(req,res)=>{const claimed=daily(req.user);res.json({claimed,user:userPublic(req.user)})});
app.post("/api/studio/buy",auth,(req,res)=>{
 const x=getItem(req.body?.itemId);if(!x||x.enabled===false)return res.status(404).json({error:"Item not found."});ensureInventory(req.user);const inv=memory.inventory.get(req.user.id);
 if(inv.has(x.id))return res.status(409).json({error:"You already own this item."});
 if(x.type==="frame"&&x.limited){const remaining=Number(memory.frameStock.get(x.id)||0);if(remaining<=0)return res.status(409).json({error:"This limited edition is sold out."})}
 if(req.user.coins<x.price)return res.status(400).json({error:"Not enough ORBIT Coins."});
 req.user.coins-=x.price;inv.add(x.id);if(x.type==="frame"&&x.limited)memory.frameStock.set(x.id,Math.max(0,Number(memory.frameStock.get(x.id)||0)-1));persist();res.json({ok:true,user:userPublic(req.user),item:{id:x.id,name:x.name}});
});
app.post("/api/studio/equip",auth,(req,res)=>{
 const type=String(req.body?.type||""),x=getItem(req.body?.itemId);if(!x||x.type!==type)return res.status(400).json({error:"Invalid item."});ensureInventory(req.user);
 if(!memory.inventory.get(req.user.id).has(x.id))return res.status(403).json({error:"Item is not owned."});
 if(type==="frame")req.user.frame=x.css;if(type==="effect")req.user.effect=x.css;if(type==="nameplate")req.user.nameplate=x.css;if(type==="chat_theme")req.user.chatTheme=x.css;
 persist();res.json({user:userPublic(req.user)})
});


app.get("/api/owner/cosmetics/frames",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;
 const page=Math.max(1,Number(req.query?.page||1)),pageSize=Math.min(100,Math.max(20,Number(req.query?.pageSize||50))),rows=frameRows(),start=(page-1)*pageSize;
 res.json({frames:rows.slice(start,start+pageSize),page,pageSize,total:rows.length,collections:COLLECTIONS});
});
app.post("/api/owner/cosmetics/frames",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;
 const body=req.body||{},name=cleanName(body.name,"New Frame"),slug=SLUG(body.slug||name);
 const frame={id:"frame-custom-"+crypto.randomUUID(),type:"frame",name,slug,description:String(body.description||"").slice(0,400),category:String(body.category||"Cosmic").slice(0,40),rarity:RARITIES.includes(String(body.rarity))?String(body.rarity):"Rare",price:Math.max(0,Number(body.price||450)),currency:"coins",css:SLUG(body.css||("custom-"+slug))+"-"+SLUG(body.rarity||"rare"),animated:Boolean(body.animated),animationType:String(body.animationType||"orbit"),collectionId:String(body.collectionId||"collection-01"),collection:COLLECTIONS.find(c=>c.id===String(body.collectionId||"collection-01"))?.name||"THE VOID",limited:Boolean(body.limited),stock:body.limited?Math.max(1,Number(body.stock||500)):null,remainingStock:body.limited?Math.max(1,Number(body.stock||500)):null,releaseDate:body.releaseDate||now(),expirationDate:body.expirationDate||null,featured:Boolean(body.featured),popularity:100,levelCap:Math.max(1,Number(body.levelCap||1)),assetUrl:String(body.assetUrl||""),previewUrl:String(body.previewUrl||"")};
 SHOP.push(frame);memory.customFrames.push(frame);memory.frameStock.set(frame.id,frame.remainingStock);persist();audit("owner","COSMETIC_FRAME_CREATE",frame.id,{name:frame.name,rarity:frame.rarity});res.status(201).json({frame});
});
app.patch("/api/owner/cosmetics/frames/:id",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;
 const frame=getItem(req.params.id);if(!frame||frame.type!=="frame")return res.status(404).json({error:"Frame not found."});
 const b=req.body||{};for(const k of ["name","description","category","animationType","assetUrl","previewUrl","collectionId","collection","releaseDate","expirationDate"]){if(b[k]!==undefined)frame[k]=String(b[k]).slice(0,500)}
 if(b.rarity&&RARITIES.includes(String(b.rarity)))frame.rarity=String(b.rarity);if(b.price!==undefined)frame.price=Math.max(0,Number(b.price||0));if(b.animated!==undefined)frame.animated=Boolean(b.animated);if(b.limited!==undefined)frame.limited=Boolean(b.limited);if(b.featured!==undefined)frame.featured=Boolean(b.featured);if(b.enabled!==undefined)frame.enabled=Boolean(b.enabled);if(b.stock!==undefined&&frame.limited){frame.stock=Math.max(0,Number(b.stock));memory.frameStock.set(frame.id,frame.stock);frame.remainingStock=frame.stock}persist();audit("owner","COSMETIC_FRAME_UPDATE",frame.id,{name:frame.name});res.json({frame});
});
app.post("/api/owner/cosmetics/frames/:id/stock",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;const frame=getItem(req.params.id);if(!frame||frame.type!=="frame")return res.status(404).json({error:"Frame not found."});
 const stock=Math.max(0,Number(req.body?.stock||0));frame.limited=true;frame.stock=stock;frame.remainingStock=stock;memory.frameStock.set(frame.id,stock);persist();res.json({frame});
});

app.get("/api/missions",auth,(req,res)=>{
 const list=MISSIONS.map(m=>{
  const cycle=missionCycle(m),value=missionValue(req.user,m);
  return {...m,progress:Math.min(m.target,value),cycle,claimed:memory.missionClaims.has(req.user.id+":"+m.id+":"+cycle)}
 });
 res.json({missions:list})
});
app.post("/api/missions/:id/claim",auth,(req,res)=>{
 const m=MISSIONS.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"Mission not found."});
 const cycle=missionCycle(m),value=missionValue(req.user,m);
 if(value<m.target)return res.status(400).json({error:"Mission is not complete yet."});
 const key=req.user.id+":"+m.id+":"+cycle;
 if(memory.missionClaims.has(key))return res.status(409).json({error:"Mission already claimed."});
 memory.missionClaims.add(key);award(req.user,m.xp,m.coins);persist();
 res.json({ok:true,user:userPublic(req.user),reward:{xp:m.xp,coins:m.coins},mission:{id:m.id,cycle,progress:value}})
});

app.get("/api/communities",auth,(req,res)=>{
 const rows=[...memory.communities.values()].filter(c=>communityMember(c.id,req.user.id)).map(c=>{const members=memory.members.get(c.id)||new Map();return {...c,role:members.get(req.user.id)||"member",memberCount:members.size}});
 res.json({communities:rows})
});
app.post("/api/communities",auth,(req,res)=>{
 const c={id:id("com"),name:cleanName(req.body?.name,"New Community"),description:String(req.body?.description||"").slice(0,300),iconUrl:avatarField(req.body?.iconUrl),accent:["violet","cyan","gold","rose"].includes(String(req.body?.accent))?String(req.body.accent):"violet",verificationLevel:"standard",joinCode:"ORB-"+crypto.randomBytes(4).toString("hex").toUpperCase(),ownerId:req.user.id,createdAt:now()};
 memory.communities.set(c.id,c);memory.members.set(c.id,new Map([[req.user.id,"owner"]]));const conv={id:id("conv"),kind:"channel",createdAt:now()};memory.conversations.set(conv.id,conv);memory.convMembers.set(conv.id,new Set());
 memory.channels.set(id("ch"),{id:id("ch"),communityId:c.id,name:"general",type:"text",topic:"Welcome to your new ORBIT server.",conversationId:conv.id,createdAt:now()});
 req.user.communitiesCreated++;req.user.communitiesJoined++;trackMissionProgress(req.user,"communitiesCreated",1);trackMissionProgress(req.user,"communitiesJoined",1);award(req.user,100,0);persist();res.status(201).json({community:c,joinCode:c.joinCode})
});
app.post("/api/communities/join",auth,(req,res)=>{
 const code=String(req.body?.code||"").trim().toUpperCase(),c=[...memory.communities.values()].find(x=>x.joinCode===code);if(!c)return res.status(404).json({error:"Community code not found."});
 const m=memory.members.get(c.id)||new Map();const was=m.has(req.user.id);if(!was){m.set(req.user.id,"member");req.user.communitiesJoined++;trackMissionProgress(req.user,"communitiesJoined",1);award(req.user,75,0);memory.members.set(c.id,m);persist()}res.json({community:c})
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

app.post("/api/owner/auth",(req,res)=>{
 if(!ORBIT_OWNER_CONTROL_KEY)return res.status(503).json({error:"Owner control key is not configured"});
 const key=ownerAttemptKey(req),nowMs=Date.now(),h=ownerKeyAttempts.get(key)||{count:0,resetAt:nowMs+10*60*1000};
 if(nowMs>h.resetAt){h.count=0;h.resetAt=nowMs+10*60*1000}
 if(h.count>=8)return res.status(429).json({error:"Too many owner key attempts. Try again later."});
 const provided=String(req.body?.key||"").trim();
 if(provided!==ORBIT_OWNER_CONTROL_KEY){h.count+=1;ownerKeyAttempts.set(key,h);return res.status(401).json({error:"Invalid owner key"})}
 ownerKeyAttempts.delete(key);audit("owner","OWNER_KEY_AUTH","owner",{});res.json({ok:true,token:ownerTokenFor(),expiresIn:8*60*60});
});
function ownerUserSnapshot(u){
 ensureUserDefaults(u);let serverCount=0,totalMessages=0,dmMessages=0;
 for(const [cid,m] of memory.members){if(m.has(u.id))serverCount++}
 for(const list of memory.messages.values())for(const m of list)if(String(m.senderId)===String(u.id))totalMessages++;
 return {...userPublic(u),serverCount,totalMessages,dmMessages,onlineSockets:[...io.sockets.sockets.values()].filter(s=>String(s.userId)===String(u.id)).length};
}
app.get("/api/owner/dashboard",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;
 let messages=0,dmConversations=0,dmMessages=0,uploads=0,activeCalls=0,callParticipants=0;
 for(const list of memory.messages.values())messages+=list.length;
 for(const [cid,c] of memory.conversations)if(c.kind==="dm"){dmConversations++;dmMessages+=(memory.messages.get(cid)||[]).length}
 const calls=[];for(const [room,ids] of io.sockets.adapter.rooms){if(!String(room).startsWith("v2call:")||!ids.size)continue;const conversationId=String(room).slice(7);const ch=[...memory.channels.values()].find(x=>x.conversationId===conversationId);const participants=[...ids].map(sid=>{const so=io.sockets.sockets.get(sid);return so?{socketId:sid,user:userPublic(so.user)}:null}).filter(Boolean);calls.push({room,conversationId,channelName:ch?.name||"call",serverId:ch?.communityId||null,participants});}
 activeCalls=calls.length;callParticipants=calls.reduce((n,c)=>n+c.participants.length,0);
 res.json({ok:true,me:{id:req.user.id,username:req.user.username},stats:{users:memory.users.size,online:[...memory.users.values()].filter(u=>u.status==="online"&&!u.suspended).length,suspended:[...memory.users.values()].filter(u=>u.suspended).length,servers:memory.communities.size,channels:memory.channels.size,messages,dmConversations,dmMessages,uploads,activeCalls,callParticipants,auditEvents:memory.audit.length,uptime:Math.floor(process.uptime()),persistence:persistMode},users:[...memory.users.values()].map(ownerUserSnapshot).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,1000),servers:[...memory.communities.values()].map(c=>{const m=memory.members.get(c.id)||new Map();return {...c,memberCount:m.size,owner: userPublic(memory.users.get(c.ownerId))}}),calls,audit:memory.audit.slice(0,300)});
});
app.get("/api/owner/users/:id",ownerAuth,(req,res)=>{
 if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});ensureInventory(u);
 const servers=[...memory.communities.values()].filter(c=>(memory.members.get(c.id)||new Map()).has(u.id)).map(c=>{const m=memory.members.get(c.id)||new Map();return{id:c.id,name:c.name,role:m.get(u.id),ownerId:c.ownerId}});
 const messages=[];for(const ch of memory.channels.values()){const list=memory.messages.get(ch.conversationId)||[];for(const m of list)if(String(m.senderId)===String(u.id))messages.push({...m,kind:"channel",serverId:ch.communityId,channelId:ch.id,channelName:ch.name})}
 const dms=[];for(const [cid,c] of memory.conversations)if(c.kind==="dm"&&(memory.convMembers.get(cid)||new Set()).has(u.id)){const members=[...(memory.convMembers.get(cid)||new Set())].map(idv=>{const x=memory.users.get(idv);return x?{id:x.id,username:x.username,display_name:x.displayName||x.username}:{id:idv}});dms.push({id:cid,members,messages:memory.messages.get(cid)||[]})}
 messages.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 res.json({ok:true,user:{...ownerUserSnapshot(u),accountCreatedAt:u.createdAt||null},inventory:[...memory.inventory.get(u.id)||[]].map(getItem).filter(Boolean),allItems:SHOP,servers,messages:messages.slice(0,1000),dms,uploads:[],sessions:[...memory.sessions.values()].filter(x=>x.userId===u.id).map(x=>({createdAt:new Date(x.createdAt).toISOString(),expiresAt:new Date(x.expiresAt).toISOString()}))});
});
app.post("/api/owner/users/:id/grant-coins",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const amount=Math.trunc(Number(req.body?.amount));if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000000)return res.status(400).json({error:"Invalid coin amount"});ensureUserDefaults(u);u.coins=Math.max(0,u.coins+amount);audit(req.user.id,amount>0?"OWNER_COINS_GRANT":"OWNER_COINS_REMOVE",u.id,{amount,reason:String(req.body?.reason||"Owner adjustment").slice(0,240),balance:u.coins});persist();res.json({ok:true,user:userPublic(u),amount});});
app.post("/api/owner/users/:id/grant-item",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const item=getItem(req.body?.itemId);if(!item)return res.status(404).json({error:"Item not found"});ensureInventory(u);const inv=memory.inventory.get(u.id);const existed=inv.has(item.id);inv.add(item.id);audit(req.user.id,existed?"OWNER_ITEM_REGRANT":"OWNER_ITEM_GRANT",u.id,{itemId:item.id,name:item.name,type:item.type,equip:Boolean(req.body?.equip)});if(req.body?.equip){if(item.type==="frame")u.frame=item.css;else if(item.type==="effect")u.effect=item.css;else if(item.type==="nameplate")u.nameplate=item.css;else if(item.type==="chat_theme")u.chatTheme=item.css}persist();res.json({ok:true,user:userPublic(u),item,existed});});
app.post("/api/owner/users/:id/revoke-item",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const item=getItem(req.body?.itemId);if(!item)return res.status(404).json({error:"Item not found"});ensureInventory(u);if(item.price===0)return res.status(400).json({error:"Core items cannot be revoked"});const inv=memory.inventory.get(u.id);inv.delete(item.id);audit(req.user.id,"OWNER_ITEM_REVOKE",u.id,{itemId:item.id});persist();res.json({ok:true,user:userPublic(u),item});});
app.post("/api/owner/users/:id/suspend",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const targetId=String(req.params.id);if(targetId===String(req.user.id))return res.status(400).json({error:"You cannot suspend your current owner account."});const u=memory.users.get(targetId);if(!u)return res.status(404).json({error:"User not found"});const mins=Number(req.body?.durationMinutes||0);u.suspended=true;u.suspendedAt=now();u.suspendedUntil=mins>0?new Date(Date.now()+Math.min(mins,525600)*60000).toISOString():null;u.suspendedReason=String(req.body?.reason||"Banned by platform owner").trim().slice(0,300);u.status="offline";for(const so of io.sockets.sockets.values())if(String(so.userId)===targetId)so.disconnect(true);audit(req.user.id,"OWNER_USER_BAN",targetId,{reason:u.suspendedReason,durationMinutes:mins||null});persist();res.json({ok:true,user:userPublic(u),suspended:true});});
app.post("/api/owner/users/:id/grant-xp",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});const amount=Math.trunc(Number(req.body?.amount));if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>100000000)return res.status(400).json({error:"Invalid XP amount"});ensureUserDefaults(u);u.xp=Math.max(0,u.xp+amount);u.level=levelFor(u.xp);audit(req.user.id,amount>0?"OWNER_XP_GRANT":"OWNER_XP_REMOVE",u.id,{amount,level:u.level,xp:u.xp});persist();res.json({ok:true,user:userPublic(u),amount});});
app.post("/api/owner/users/:id/unsuspend",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const u=memory.users.get(String(req.params.id));if(!u)return res.status(404).json({error:"User not found"});u.suspended=false;u.suspendedAt=null;u.suspendedUntil=null;u.suspendedReason=null;audit(req.user.id,"OWNER_USER_UNBAN",u.id,{});persist();res.json({ok:true,user:userPublic(u),suspended:false});});
app.post("/api/owner/messages/delete",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const messageId=String(req.body?.messageId||"");if(!messageId)return res.status(400).json({error:"Message id is required"});for(const [cid,list] of memory.messages){const at=list.findIndex(m=>String(m.id)===messageId);if(at!==-1){const [deleted]=list.splice(at,1);memory.messages.set(cid,list);audit(req.user.id,"OWNER_MESSAGE_DELETE",messageId,{conversationId:cid,senderId:deleted.senderId});persist();io.to("conversation:"+cid).emit("message:delete",{messageId});return res.json({ok:true})}}res.status(404).json({error:"Message not found"});});
app.get("/api/owner/shop",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;res.json({items:SHOP})});

app.get("/api/owner/content",ownerAuth,(req,res)=>{if(!requireOwner(req,res))return;const limit=Math.min(500,Math.max(1,Number(req.query?.limit||200)));const messages=[];for(const [cid,list] of memory.messages){const ch=[...memory.channels.values()].find(x=>x.conversationId===cid);for(const m of list)messages.push({...m,kind:ch?"channel":"dm",conversationId:cid,channelName:ch?.name||"direct",serverId:ch?.communityId||null,username:m.username||memory.users.get(m.senderId)?.username||"unknown"})}messages.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));res.json({ok:true,messages:messages.slice(0,limit)})});
app.get("/api/dms",auth,(req,res)=>{
 const result=[];
 for(const c of memory.conversations.values()){if(c.kind!=="dm")continue;const members=memory.convMembers.get(c.id)||new Set();if(!members.has(req.user.id))continue;const summary=directSummary(c,req.user.id);if(summary)result.push(summary);}
 result.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));res.json({dms:result});
});
app.post("/api/dms",auth,(req,res)=>{
 const username=cleanUsername(req.body?.username),u=[...memory.users.values()].find(x=>x.username===username);
 if(!u||u.id===req.user.id)return res.status(404).json({error:"User not found."});
 for(const c of memory.conversations.values())if(c.kind==="dm"){const m=memory.convMembers.get(c.id)||new Set();if(m.has(req.user.id)&&m.has(u.id)&&m.size===2){conversationState(c);return res.json({dmId:c.id});}}
 const c=conversationState({id:id("dm"),kind:"dm",createdAt:now(),updatedAt:now(),lastMessage:null,unread:{}});
 memory.conversations.set(c.id,c);memory.convMembers.set(c.id,new Set([req.user.id,u.id]));persist();res.status(201).json({dmId:c.id});
});
app.get("/api/conversations/:id/messages",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 const all=memory.messages.get(req.params.id)||[],limit=Math.min(200,Math.max(20,Number(req.query?.limit||100)));
 const rows=all.slice(-limit).map(m=>({...m,sender:userPublic(memory.users.get(m.senderId))}));
 const changed=markConversationRead(req.params.id,req.user.id);if(changed)persist();
 res.json({messages:rows,hasMore:all.length>limit,conversation:conversationState(memory.conversations.get(req.params.id)||{})});
});
app.post("/api/conversations/:id/read",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 markConversationRead(req.params.id,req.user.id);persist();res.json({ok:true});
});
app.post("/api/conversations/:id/messages",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 const text=escString(req.body?.content).trim();if(!text&&!req.body?.metadata?.attachment)return res.status(400).json({error:"Message is empty."});
 const m=pushMessage(req.params.id,createMessage(req.params.id,req.user,text,req.body?.replyToId,req.body?.metadata));
 req.user.messages++;trackMissionProgress(req.user,"messages",1);award(req.user,10,0);persist();io.to("conversation:"+req.params.id).emit("message:new",m);res.status(201).json({message:m});
});
app.patch("/api/conversations/:id/messages/:messageId",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 const list=memory.messages.get(req.params.id)||[],m=list.find(x=>String(x.id)===String(req.params.messageId));
 if(!m)return res.status(404).json({error:"Message not found."});if(String(m.senderId)!==String(req.user.id))return res.status(403).json({error:"You can only edit your own messages."});if(m.deleted_at)return res.status(409).json({error:"Deleted messages cannot be edited."});
 const text=escString(req.body?.content).trim();if(!text)return res.status(400).json({error:"Message is empty."});
 m.content=text;m.edited_at=now();memory.messages.set(req.params.id,list);appendConversationMessage(req.params.id,m,false);persist();io.to("conversation:"+req.params.id).emit("message:update",m);res.json({message:m});
});
app.delete("/api/conversations/:id/messages/:messageId",auth,(req,res)=>{
 if(!conversationAccess(req.params.id,req.user.id))return res.status(403).json({error:"Conversation access denied."});
 const list=memory.messages.get(req.params.id)||[],m=list.find(x=>String(x.id)===String(req.params.messageId));
 if(!m)return res.status(404).json({error:"Message not found."});if(String(m.senderId)!==String(req.user.id))return res.status(403).json({error:"You can only delete your own messages."});
 if(!m.deleted_at){m.deleted_at=now();m.content="";m.metadata={};m.edited_at=null;memory.messages.set(req.params.id,list);appendConversationMessage(req.params.id,m,false);persist();io.to("conversation:"+req.params.id).emit("message:delete",{messageId:m.id,conversationId:req.params.id});}
 res.json({ok:true,message:m});
});

app.get("/api/presence",auth,(req,res)=>{const users=[...memory.users.values()].filter(u=>u.status==="online"&&!u.suspended).slice(0,200).map(userPublic);res.json({users,time:now()})});
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
 socket.join("user:"+socket.userId);socket.emit("session:ready",{user:userPublic(socket.user)});io.emit("presence:update",{status:"online",user:userPublic(socket.user)});
 socket.on("conversation:join",cid=>{if(conversationAccess(cid,socket.userId))socket.join("conversation:"+cid)});
 socket.on("typing",({conversationId,isTyping}={})=>{if(conversationAccess(conversationId,socket.userId))socket.to("conversation:"+conversationId).emit("typing",{conversationId,userId:socket.userId,isTyping:Boolean(isTyping)})});
 socket.on("conversation:read",(conversationId,ack)=>{if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});markConversationRead(conversationId,socket.userId);persist();socket.to("conversation:"+conversationId).emit("message:read",{conversationId,userId:socket.userId,at:now()});ack?.({ok:true});});
 socket.on("message:send",({conversationId,content,replyToId,metadata}={},ack)=>{if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});const text=escString(content).trim();if(!text&&!metadata?.attachment)return ack?.({ok:false,error:"Message is empty."});const u=memory.users.get(socket.userId),m=pushMessage(conversationId,createMessage(conversationId,u,text,replyToId,metadata));u.messages++;award(u,10,0);persist();io.to("conversation:"+conversationId).emit("message:new",m);for(const uid of conversationUsers(conversationId))if(uid!==socket.userId){const recipient=memory.users.get(uid);ensureUserDefaults(recipient);if(recipient.preferences.notifications.messages!==false)addNotification(uid,"New message","@"+u.username+" sent you a message.","message")}ack?.({ok:true,message:m});});
 socket.on("message:react",({conversationId,messageId,emoji}={},ack)=>{if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});const allowed=["❤️","👍","😂","🔥","🎉","😮"];if(!allowed.includes(String(emoji)))return ack?.({ok:false,error:"Reaction not supported."});const list=memory.messages.get(conversationId)||[],m=list.find(x=>String(x.id)===String(messageId));if(!m)return ack?.({ok:false,error:"Message not found."});m.metadata=m.metadata&&typeof m.metadata==="object"?m.metadata:{};m.metadata.reactions=m.metadata.reactions&&typeof m.metadata.reactions==="object"?m.metadata.reactions:{};const users=Array.isArray(m.metadata.reactions[emoji])?m.metadata.reactions[emoji].map(String):[];const at=users.indexOf(String(socket.userId));if(at>=0)users.splice(at,1);else users.push(String(socket.userId));if(users.length)m.metadata.reactions[emoji]=users;else delete m.metadata.reactions[emoji];memory.messages.set(conversationId,list);appendConversationMessage(conversationId,m,false);persist();io.to("conversation:"+conversationId).emit("message:update",m);ack?.({ok:true,message:m});});
 socket.on("message:update",({conversationId,messageId,content}={},ack)=>{if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});const list=memory.messages.get(conversationId)||[],m=list.find(x=>String(x.id)===String(messageId));if(!m)return ack?.({ok:false,error:"Message not found."});if(String(m.senderId)!==String(socket.userId))return ack?.({ok:false,error:"You can only edit your own messages."});if(m.deleted_at)return ack?.({ok:false,error:"Deleted messages cannot be edited."});const text=escString(content).trim();if(!text)return ack?.({ok:false,error:"Message is empty."});m.content=text;m.edited_at=now();memory.messages.set(conversationId,list);appendConversationMessage(conversationId,m,false);persist();io.to("conversation:"+conversationId).emit("message:update",m);ack?.({ok:true,message:m});});
 socket.on("message:delete",({conversationId,messageId}={},ack)=>{if(!conversationAccess(conversationId,socket.userId))return ack?.({ok:false,error:"Conversation access denied."});const list=memory.messages.get(conversationId)||[],m=list.find(x=>String(x.id)===String(messageId));if(!m)return ack?.({ok:false,error:"Message not found."});if(String(m.senderId)!==String(socket.userId))return ack?.({ok:false,error:"You can only delete your own messages."});if(!m.deleted_at){m.deleted_at=now();m.content="";m.metadata={};m.edited_at=null;memory.messages.set(conversationId,list);appendConversationMessage(conversationId,m,false);persist();io.to("conversation:"+conversationId).emit("message:delete",{messageId:m.id,conversationId});}ack?.({ok:true});});

 socket.on("call:invite",({conversationId,mode="video"}={})=>{
  if(!conversationAccess(conversationId,socket.userId))return;
  for(const uid of conversationUsers(conversationId))if(uid!==socket.userId){const recipient=memory.users.get(uid);ensureUserDefaults(recipient);if(recipient.preferences.notifications.calls!==false){addNotification(uid,"Incoming call",userPublic(socket.user).displayName+" started a "+mode+" call.","call");io.to("user:"+uid).emit("call:incoming",{conversationId,mode,caller:userPublic(socket.user)})}}
 });
 socket.on("call:join",({roomId,mode="video"}={})=>{
  if(!conversationAccess(roomId,socket.userId))return;
  const room="v2call:"+roomId;socket.join(room);socket.callRoom=room;socket.callStarted=Date.now();
  const p=[...(io.sockets.adapter.rooms.get(room)||[])].filter(x=>x!==socket.id).map(sid=>{const s=io.sockets.sockets.get(sid);return s?{socketId:sid,user:userPublic(s.user)}:null}).filter(Boolean);
  socket.emit("call:participants",p);socket.to(room).emit("call:participant-joined",{socketId:socket.id,user:userPublic(socket.user),mode})
 });
 socket.on("call:screen",({roomId,active=false,to}={})=>{if(!roomId||socket.callRoom!=="v2call:"+roomId||!conversationAccess(roomId,socket.userId))return;const target=io.sockets.sockets.get(String(to));if(target)target.emit("call:screen",{from:socket.id,active:Boolean(active),user:userPublic(socket.user)})});
  socket.on("screen:offer",({to,offer}={})=>{if(!to||!offer||!socket.callRoom||!conversationAccess(String(socket.callRoom).slice(7),socket.userId))return;const target=io.sockets.sockets.get(String(to));if(target&&target.callRoom===socket.callRoom)target.emit("screen:offer",{from:socket.id,offer,fromUser:userPublic(socket.user)})});
  socket.on("screen:answer",({to,answer}={})=>{if(!to||!answer||!socket.callRoom||!conversationAccess(String(socket.callRoom).slice(7),socket.userId))return;const target=io.sockets.sockets.get(String(to));if(target&&target.callRoom===socket.callRoom)target.emit("screen:answer",{from:socket.id,answer})});
  socket.on("screen:ice",({to,candidate}={})=>{if(!to||!candidate||!socket.callRoom||!conversationAccess(String(socket.callRoom).slice(7),socket.userId))return;const target=io.sockets.sockets.get(String(to));if(target&&target.callRoom===socket.callRoom)target.emit("screen:ice",{from:socket.id,candidate})});
  socket.on("screen:stop",({to}={})=>{if(!to||!socket.callRoom||!conversationAccess(String(socket.callRoom).slice(7),socket.userId))return;const target=io.sockets.sockets.get(String(to));if(target&&target.callRoom===socket.callRoom)target.emit("screen:stop",{from:socket.id})});
  socket.on("call:leave",()=>{
  if(!socket.callRoom)return;socket.leave(socket.callRoom);socket.to(socket.callRoom).emit("call:participant-left",{socketId:socket.id,userId:socket.userId});
  if(socket.callStarted){const mins=Math.max(1,Math.round((Date.now()-socket.callStarted)/60000));socket.user.callMinutes+=mins;trackMissionProgress(socket.user,"callMinutes",mins);award(socket.user,10,0)}socket.callRoom=null;socket.callStarted=null;persist()
 });
 socket.on("rtc:offer",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:offer",{from:socket.id,offer:d.offer,fromUser:userPublic(socket.user)})});
 socket.on("rtc:answer",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:answer",{from:socket.id,answer:d.answer})});
 socket.on("rtc:ice",d=>{const s=io.sockets.sockets.get(d?.to);if(s)s.emit("rtc:ice",{from:socket.id,candidate:d.candidate})});
 socket.on("disconnect",()=>{socket.user.status="offline";if(socket.callRoom){socket.to(socket.callRoom).emit("call:participant-left",{socketId:socket.id,userId:socket.userId})}io.emit("presence:update",{status:"offline",user:userPublic(socket.user)});persist()})
});

async function start(){
 await bootPersistence();
 for(const u of memory.users.values()){ensureUserDefaults(u);ensureInventory(u)}
 server.listen(PORT,"0.0.0.0",()=>console.log("[orbit-v2] AAA platform listening on "+PORT+" persistence="+persistMode));
}
start().catch(e=>{console.error("[orbit-v2] boot failed",e);process.exit(1)});
