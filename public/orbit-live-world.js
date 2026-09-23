/* ORBIT LIVE WORLD — Home-only living network */
(()=>{"use strict";
  if(window.__ORBIT_LIVE_WORLD__)return;
  window.__ORBIT_LIVE_WORLD__=true;
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  let timer=0,refreshing=false;

  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

  function isHome(){
    const a=$("#nav button.active");
    return !!a&&a.dataset.view==="home"&&!!$("#surface .page");
  }
  function remove(){
    $("#orbitLiveWorld")?.remove();
    clearInterval(timer);timer=0;
  }
  function go(route){
    const b=$('[data-view="'+route+'"]');
    if(b)b.click();
  }
  async function fetchJson(url){
    try{
      const r=await fetch(url,{credentials:"same-origin"});
      if(!r.ok)return null;
      return await r.json();
    }catch{return null}
  }
  function chooseNodes(users,servers,signals){
    const nodes=[];
    users.slice(0,6).forEach((u,i)=>nodes.push({type:"user",name:u.displayName||u.username||"Orbit user",sub:"@"+(u.username||"user"),img:u.avatarUrl,pos:[[24,28],[73,24],[19,64],[80,62],[35,78],[66,74]][i],data:u}));
    servers.slice(0,4).forEach((s,i)=>nodes.push({type:"server",name:s.name||"Server",sub:(s.memberCount||0)+" members",pos:[[50,7],[90,42],[52,91],[10,40]][i],data:s}));
    if(signals>0)nodes.push({type:"signal",name:signals+" live signals",sub:"Unread activity",pos:[50,50],data:null});
    return nodes;
  }
  function nodeHtml(n){
    const cls="orbit-world-node "+(n.type==="server"?"server ":"")+(n.type==="signal"?"signal ":"");
    const core=n.type==="server"?"◎":n.type==="signal"?"✦":"";
    const inner=n.img?'<img src="'+esc(n.img)+'" alt="">':"<span>"+core+esc(n.img?"":(n.name||"O").slice(0,1).toUpperCase())+"</span>";
    const action=n.type==="user"?"messages":n.type==="server"?"communities":"messages";
    return '<button class="'+cls+'" style="left:'+n.pos[0]+'%;top:'+n.pos[1]+'%" data-world-route="'+action+'">'+inner+'<i class="dot"></i><span class="orbit-world-tooltip">'+esc(n.name)+' · '+esc(n.sub)+'</span></button>';
  }
  async function load(){
    if(!isHome()||refreshing)return;
    refreshing=true;
    const [p,c,n]=await Promise.all([
      fetchJson("/api/presence"),
      fetchJson("/api/communities"),
      fetchJson("/api/notifications")
    ]);
    const users=(p?.users||[]).filter(u=>u&&u.status==="online");
    const servers=(c?.communities||[]).slice(0,8);
    const notifications=n?.notifications||[];
    const unread=notifications.filter(x=>!x.read).length;
    const liveCalls=users.filter(u=>["in_call","calling","busy"].includes(String(u.status||"").toLowerCase())).length;
    render({users,servers,unread,liveCalls,signals:notifications.length});
    refreshing=false;
  }
  function render(d){
    if(!isHome()){remove();return}
    const page=$("#surface .page");if(!page)return;
    let box=$("#orbitLiveWorld");
    if(!box){
      box=document.createElement("section");
      box.id="orbitLiveWorld";
      box.className="orbit-live-world";
      page.querySelector("#orbitCore")?.insertAdjacentElement("afterend",box) || page.prepend(box);
    }
    const nodes=chooseNodes(d.users,d.servers,d.unread||0);
    box.innerHTML=
      '<div class="orbit-world-copy"><span class="kicker">ORBIT // LIVE WORLD</span><h3>The network is alive.</h3><p>People, spaces and signals currently moving through your orbit.</p></div>'+
      '<div class="orbit-world-status"><i></i>REALTIME NETWORK</div>'+
      '<button class="orbit-world-refresh" id="orbitWorldRefresh" title="Refresh">↻</button>'+
      '<div class="orbit-world-stage"><div class="orbit-world-orbit"></div><div class="orbit-world-orbit two"></div><div class="orbit-world-core"><div class="orbit-world-core-label"><div><strong>ORBIT</strong><span>LIVE CORE</span></div></div></div>'+
      nodes.map(nodeHtml).join("")+'</div>'+
      '<div class="orbit-world-feed"><div class="orbit-world-feed-title">LIVE SIGNALS</div>'+
      (d.unread?'<div class="orbit-world-feed-row"><i></i><span>'+esc(d.unread)+' unread signal'+(d.unread===1?"":"s")+'</span></div>':"")+
      (d.liveCalls?'<div class="orbit-world-feed-row"><i></i><span>'+esc(d.liveCalls)+' realtime call'+(d.liveCalls===1?"":"s")+' detected</span></div>':"")+
      '<div class="orbit-world-feed-row"><i></i><span>'+esc(d.users.length)+' people online now</span></div>'+
      '<div class="orbit-world-feed-row"><i></i><span>'+esc(d.servers.length)+' spaces in your orbit</span></div></div>'+
      '<div class="orbit-world-metrics">'+
      '<div class="orbit-world-metric"><strong>'+d.users.length+'</strong><span>ONLINE NOW</span></div>'+
      '<div class="orbit-world-metric"><strong>'+d.servers.length+'</strong><span>ACTIVE SPACES</span></div>'+
      '<div class="orbit-world-metric"><strong>'+d.unread+'</strong><span>UNREAD SIGNALS</span></div>'+
      '<div class="orbit-world-metric"><strong>'+d.liveCalls+'</strong><span>LIVE CALLS</span></div>'+
      '</div>';
    $$("#orbitLiveWorld [data-world-route]").forEach(b=>b.onclick=()=>go(b.dataset.worldRoute));
    $("#orbitWorldRefresh")?.addEventListener("click",()=>load(),{once:true});
  }
  function sync(){
    if(isHome()){load();if(!timer)timer=setInterval(load,10000)}
    else remove();
  }
  const mo=new MutationObserver(()=>{clearTimeout(mo._t);mo._t=setTimeout(sync,80)});
  mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener("click",e=>{
    if(e.target.closest("#nav [data-view]"))setTimeout(sync,140);
  },true);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sync);else sync();
})();