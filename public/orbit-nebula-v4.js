/* ORBIT NEBULA SHELL V4 — actual shell replacement using the existing live DOM */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const routes=[
    ["home","⌂","Home","Command center"],["dms","✉","Messages","Direct & group conversations"],["space","◈","Orbit Space","People, rooms & links"],["communities","◉","Communities","Connected worlds"],["calls","●","Live","Voice, video & rooms"],["discover","✦","Discover","Explore the network"],["events","◷","Events","Upcoming & RSVP"],["projects","◫","Projects","Shared work"],["files","□","Files","Assets & documents"],["ai","✧","AI","Intelligence layer"]
  ];
  let shell, stage, navEls=[];
  const go=v=>{try{if(typeof window.setView==="function")window.setView(v);else $("#app .rail-nav[data-view='"+v+"']")?.click()}catch(e){};sync()};
  const current=()=>String(window.orbitUI?.view||"home");
  const me=()=>window.me||{};
  function mount(){
    if($("#orbit-v4-shell")) return;
    document.body.classList.add("orbit-v4-active");
    const rail=$("#app .server-rail"), sidebar=$("#sidebar"), content=$(".content");
    if(!sidebar||!content) return;
    shell=document.createElement("div");shell.id="orbit-v4-shell";
    const nav=document.createElement("aside");nav.id="orbit-v4-nav";
    nav.innerHTML='<div class="v4-brand"><div class="v4-brand-mark">◈</div><div class="v4-brand-copy"><b>ORBIT</b><span>NEXT-GEN COMMUNITY OS</span></div></div><div id="orbit-v4-workspaces" class="v4-workspaces"></div><div class="v4-nav-scroll"><div class="v4-section-label">WORKSPACE</div><div id="orbit-v4-routes"></div></div><div class="v4-nav-footer"><button class="v4-footer-btn" id="v4-profile">Profile</button><button class="v4-footer-btn" id="v4-settings">Settings</button></div>';
    stage=document.createElement("section");stage.id="orbit-v4-stage";
    stage.innerHTML='<header id="orbit-v4-top"><label class="v4-search"><span>⌕</span><input id="v4-search-input" placeholder="Search ORBIT · people, messages, communities"><kbd>Ctrl K</kbd></label><div class="v4-top-actions"><button class="v4-top-btn live" id="v4-presence">● Online</button><button class="v4-top-btn" id="v4-notify">◇</button><button class="v4-top-btn" id="v4-call">☎</button><button class="v4-top-btn primary" id="v4-ai">✧ AI</button></div></header><div id="orbit-v4-body"><div id="orbit-v4-content-slot"></div><aside id="orbit-v4-inspector"><div class="v4-inspector-head"><b>LIVE CONTEXT</b><span>ORBIT OS</span></div><div id="v4-inspector-main"></div><div id="orbit-v4-mini-space"><div class="v4-orbit-ring"></div><div class="v4-orbit-core">◈</div></div></aside></div><nav id="orbit-v4-mobile"><button class="v4-mob active" data-route="home">⌂</button><button class="v4-mob" data-route="dms">✉</button><button class="v4-mob" data-route="space">◈</button><button class="v4-mob" data-route="communities">◉</button><button class="v4-mob" id="v4-mobile-profile">◎</button></nav>';
    shell.append(nav,stage);document.body.appendChild(shell);
    $("#orbit-v4-content-slot").appendChild(content);
    buildWorkspaces();
    buildRoutes();
    wire();
    renderInspector();
    sync();
  }
  function buildWorkspaces(){
    const host=$("#orbit-v4-workspaces"), list=$("#server-list"), add=$("#new-server"), join=$("#join-server");
    if(list){
      $$(".server-item,.server-btn,[data-server-id]",list).forEach((el,i)=>{
        const b=document.createElement("button");b.className="v4-workspace";b.title=el.getAttribute("title")||el.textContent.trim()||("Community "+(i+1));b.textContent=(el.textContent.trim()||"O").slice(0,1).toUpperCase();b.onclick=()=>el.click();host.appendChild(b);
      });
    }
    if(host.children.length===0){const b=document.createElement("button");b.className="v4-workspace";b.textContent="O";b.title="Orbit Lobby";host.appendChild(b)}
    [add,join].forEach((el,i)=>{if(el){const b=document.createElement("button");b.className="v4-workspace v4-workspace-add";b.textContent=i===0?"+":"↗";b.title=el.title||"Workspace";b.onclick=()=>el.click();host.appendChild(b)}});
  }
  function buildRoutes(){
    const host=$("#orbit-v4-routes");if(!host)return;
    routes.forEach(([id,icon,label,sub])=>{
      const b=document.createElement("button");b.className="v4-route";b.dataset.route=id;b.innerHTML='<i>'+icon+'</i><span><b>'+label+'</b><span>'+sub+'</span></span>';
      if(id==="dms"){const n=(window.dmState?.list||[]).reduce((a,x)=>a+Number(x.unread||0),0);if(n)b.insertAdjacentHTML("beforeend",'<small>'+Math.min(99,n)+'</small>')}
      b.onclick=()=>go(id);host.appendChild(b);navEls.push(b);
    });
  }
  function wire(){
    $("#v4-profile").onclick=()=>$("#profile-card-btn")?.click();
    $("#v4-settings").onclick=()=>$("#settings-btn")?.click()||$("#workspace-menu")?.click();
    $("#v4-notify").onclick=()=>$("#notifications")?.click()||showNative("notifications");
    $("#v4-call").onclick=()=>$("#voice-call-btn")?.click();
    $("#v4-ai").onclick=()=>showNative("ai");
    $("#v4-presence").onclick=()=>$("#profile-card-btn")?.click();
    $("#v4-mobile-profile").onclick=()=>$("#profile-card-btn")?.click();
    $$("#orbit-v4-mobile .v4-mob[data-route]").forEach(b=>b.onclick=()=>go(b.dataset.route));
    const inp=$("#v4-search-input"); if(inp){inp.onfocus=()=>$("#quick-search")?.focus();inp.onkeydown=e=>{if(e.key==="Escape")inp.blur();if(e.key==="Enter")$("#quick-search")?.dispatchEvent(new Event("change",{bubbles:true}))}}
    window.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("#v4-search-input")?.focus()}});
  }
  function showNative(type){
    if(type==="ai"){$("#nebula-layer-ai")?.classList.add("open");if(!$("#nebula-layer-ai")&&typeof window.openLayer==="function")window.openLayer("ai");}
    else if(type==="notifications"){$("#notifications")?.click()||$("#command-palette")?.classList.remove("hidden")}
  }
  function renderInspector(){
    const root=$("#v4-inspector-main");if(!root)return;
    const u=me(), users=Array.isArray(window.pulseState?.users)?window.pulseState.users:[], calls=Array.isArray(window.pulseState?.calls)?window.pulseState.calls:[], servers=Array.isArray(window.servers)?window.servers:[];
    const channel=window.currentChannel||window.activeChannel||"general";
    const server=window.currentServer?.name||window.currentServer?.id||"Orbit Lobby";
    root.innerHTML='<section class="v4-card"><div class="v4-kicker">CURRENT CONTEXT</div><h3># '+escapeHtml(channel)+'</h3><p>'+escapeHtml(server)+' · realtime channel surface</p><div class="v4-metrics"><div class="v4-metric"><b>'+users.length+'</b><span>Presence</span></div><div class="v4-metric"><b>'+calls.length+'</b><span>Live rooms</span></div><div class="v4-metric"><b>'+servers.length+'</b><span>Communities</span></div><div class="v4-metric"><b>'+((window.dmState?.list)||[]).length+'</b><span>DM threads</span></div></div><button class="v4-action" id="v4-members">Open members</button><button class="v4-action" id="v4-video">Start video</button><button class="v4-action" id="v4-screen">Share screen</button></section><section class="v4-card"><div class="v4-kicker">IDENTITY</div><h3>'+escapeHtml(u.display_name||u.username||"Guest")+'</h3><p>'+escapeHtml(u.username?"@"+u.username:"Connected guest session")+'</p></section><section class="v4-card"><div class="v4-kicker">NETWORK</div><p>Realtime signal is bound to the existing ORBIT runtime, sockets and server state.</p></section>';
    $("#v4-members").onclick=()=>$("#members-btn")?.click();$("#v4-video").onclick=()=>$("#video-call-btn")?.click();$("#v4-screen").onclick=()=>$("#quick-screen-share-btn")?.click();
  }
  const escapeHtml=v=>String(v??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]||m));
  function sync(){if(!shell)return;const a=current();navEls.forEach(b=>b.classList.toggle("active",b.dataset.route===a));$$("#orbit-v4-mobile .v4-mob").forEach(b=>b.classList.toggle("active",b.dataset.route===a));renderInspector()}
  function boot(){mount();setTimeout(sync,900);setInterval(sync,2500)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
