/* ORBIT LIVE WORLD — smooth persistent scene */
(()=>{"use strict";
if(window.__ORBIT_LIVE_WORLD__)return;
window.__ORBIT_LIVE_WORLD__=true;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let timer=0,loading=false,lastKey="";

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const isHome=()=>{const a=$("#nav button.active");return !!a&&a.dataset.view==="home"&&!!$("#surface .page")};
const go=route=>{const b=$('[data-view="'+route+'"]');if(b)b.click()};
const json=async url=>{try{const r=await fetch(url,{credentials:"same-origin",cache:"no-store"});if(!r.ok)return null;return await r.json()}catch{return null}};

function remove(){const el=$("#orbitLiveWorld");if(el)el.remove();clearInterval(timer);timer=0;lastKey=""}
function nodeData(users,servers,unread){
 const out=[];
 const pos=[[24,28],[73,24],[19,64],[80,62],[35,78],[66,74]];
 users.slice(0,6).forEach((u,i)=>out.push({type:"user",id:"u:"+u.id,name:u.displayName||u.username||"Orbit user",sub:"@"+(u.username||"user"),img:u.avatarUrl||"",x:pos[i][0],y:pos[i][1]}));
 const sp=[[50,7],[90,42],[52,91],[10,40]];
 servers.slice(0,4).forEach((s,i)=>out.push({type:"server",id:"s:"+s.id,name:s.name||"Server",sub:(s.memberCount||0)+" members",img:s.iconUrl||"",x:sp[i][0],y:sp[i][1]}));
 if(unread>0)out.push({type:"signal",id:"signal",name:unread+" live signals",sub:"Unread activity",x:50,y:50,img:""});
 return out;
}
function nodeMarkup(n){
 const cls="orbit-world-node "+(n.type==="server"?"server ":"")+(n.type==="signal"?"signal ":"");
 const letter=n.type==="server"?"◎":n.type==="signal"?"✦":(n.name||"O").slice(0,1).toUpperCase();
 const inner=n.img?'<img src="'+esc(n.img)+'" alt="">':'<span>'+letter+'</span>';
 const route=n.type==="user"?"messages":n.type==="server"?"communities":"messages";
 return '<button class="'+cls+'" data-world-id="'+esc(n.id)+'" data-world-route="'+route+'" style="left:'+n.x+'%;top:'+n.y+'%">'+inner+'<i class="dot"></i><span class="orbit-world-tooltip">'+esc(n.name)+' · '+esc(n.sub)+'</span></button>';
}
function createScene(){
 if(!isHome())return null;
 const page=$("#surface .page");if(!page)return null;
 let box=$("#orbitLiveWorld");
 if(box)return box;
 box=document.createElement("section");
 box.id="orbitLiveWorld";box.className="orbit-live-world";
 box.innerHTML=
 '<div class="orbit-world-copy"><span class="kicker">ORBIT // LIVE WORLD</span><h3>The network is alive.</h3><p>People, spaces and signals currently moving through your orbit.</p></div>'+
 '<div class="orbit-world-status"><i></i>REALTIME NETWORK</div>'+
 '<button class="orbit-world-refresh" id="orbitWorldRefresh" title="Refresh">↻</button>'+
 '<div class="orbit-world-stage"><div class="orbit-world-orbit"></div><div class="orbit-world-orbit two"></div>'+
 '<div class="orbit-world-core"><div class="orbit-world-core-label"><div><strong>ORBIT</strong><span>LIVE CORE</span></div></div></div>'+
 '<div id="orbitWorldNodes"></div></div>'+
 '<div class="orbit-world-feed"><div class="orbit-world-feed-title">LIVE SIGNALS</div><div id="orbitWorldFeed"></div></div>'+
 '<div class="orbit-world-metrics"><div class="orbit-world-metric"><strong id="worldOnline">0</strong><span>ONLINE NOW</span></div>'+
 '<div class="orbit-world-metric"><strong id="worldServers">0</strong><span>ACTIVE SPACES</span></div>'+
 '<div class="orbit-world-metric"><strong id="worldSignals">0</strong><span>UNREAD SIGNALS</span></div>'+
 '<div class="orbit-world-metric"><strong id="worldCalls">0</strong><span>LIVE CALLS</span></div></div>';
 page.querySelector("#orbitCore")?.insertAdjacentElement("afterend",box) || page.prepend(box);
 box.querySelector("#orbitWorldRefresh")?.addEventListener("click",load,{passive:true});
 return box;
}
function updateScene(d){
 if(!isHome()){remove();return}
 const box=createScene();if(!box)return;
 const nodes=nodeData(d.users,d.servers,d.unread);
 const nextKey=JSON.stringify(nodes.map(n=>[n.id,n.name,n.sub,n.x,n.y,n.img,d.unread]));
 if(nextKey!==lastKey){
   const holder=box.querySelector("#orbitWorldNodes");
   const old=new Map($$(".orbit-world-node").map(n=>[n.dataset.worldId,n]));
   for(const n of nodes){
     const cur=old.get(n.id);
     if(cur){
       cur.classList.add("moving");
       cur.style.left=n.x+"%";cur.style.top=n.y+"%";
       const tt=cur.querySelector(".orbit-world-tooltip");if(tt)tt.textContent=n.name+" · "+n.sub;
       old.delete(n.id);
     }else{
       const wrap=document.createElement("div");wrap.innerHTML=nodeMarkup(n);
       const el=wrap.firstElementChild;
       holder.appendChild(el);
     }
   }
   old.forEach(el=>el.remove());
   $$("#orbitWorldNodes [data-world-route]").forEach(b=>b.onclick=()=>go(b.dataset.worldRoute));
   lastKey=nextKey;
 }
 const vals={worldOnline:d.users.length,worldServers:d.servers.length,worldSignals:d.unread,worldCalls:d.liveCalls};
 Object.entries(vals).forEach(([id,v])=>{const el=$("#"+id);if(el&&el.textContent!==String(v))el.textContent=String(v)});
 const feed=$("#orbitWorldFeed");
 if(feed){
   const rows=[];
   if(d.unread)rows.push('<div class="orbit-world-feed-row"><i></i><span>'+esc(d.unread)+" unread signal"+(d.unread===1?"":"s")+"</span></div>");
   if(d.liveCalls)rows.push('<div class="orbit-world-feed-row"><i></i><span>'+esc(d.liveCalls)+" realtime call"+(d.liveCalls===1?"":"s")+" detected</span></div>");
   rows.push('<div class="orbit-world-feed-row"><i></i><span>'+esc(d.users.length)+" people online now</span></div>");
   rows.push('<div class="orbit-world-feed-row"><i></i><span>'+esc(d.servers.length)+" spaces in your orbit</span></div>");
   feed.innerHTML=rows.join("");
 }
}
async function load(){
 if(!isHome()||loading)return;
 loading=true;
 const [p,c,n]=await Promise.all([json("/api/presence"),json("/api/communities"),json("/api/notifications")]);
 const users=(p?.users||[]).filter(u=>u&&u.status==="online");
 const servers=(c?.communities||[]).slice(0,8);
 const notes=n?.notifications||[];
 const unread=notes.filter(x=>!x.read).length;
 const liveCalls=users.filter(u=>["in_call","calling","busy"].includes(String(u.status||"").toLowerCase())).length;
 updateScene({users,servers,unread,liveCalls});
 loading=false;
}
function sync(){
 if(isHome()){
   createScene();
   load();
   if(!timer)timer=setInterval(load,10000);
 }else remove();
}
const mo=new MutationObserver(()=>{clearTimeout(mo._t);mo._t=setTimeout(sync,100)});
mo.observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener("click",e=>{if(e.target.closest("#nav [data-view]"))setTimeout(sync,160)},true);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sync);else sync();
})();