
/* ORBIT AETHER — live bridge for the HTML-native shell */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const navIds=["home","dms","space","communities","calls","discover","events","projects","files","ai"];
  const pulseUsers=()=>Array.isArray(window.pulseState?.users)?window.pulseState.users:[];
  const pulseCalls=()=>Array.isArray(window.pulseState?.calls)?window.pulseState.calls:[];
  function route(id){const b=document.querySelector('.rail-nav[data-view="'+id+'"]');if(b)b.click();sync()}
  function openSettings(){document.querySelector("#settings-btn")?.click()||document.querySelector("#aether-settings-btn")?.click()}
  function openSearch(){document.querySelector("#quick-search")?.focus()}
  function sync(){
    const active=String(window.orbitUI?.view||document.querySelector(".rail-nav.active")?.dataset.view||"home");
    $$(".aether-nav").forEach(b=>b.classList.toggle("active",b.dataset.view===active));
    $("#aether-context-name").textContent=active==="home"?"Command Center":active.replace(/^./,x=>x.toUpperCase()); $("#aether-hero-strip")?.classList.toggle("aether-hide",active!=="home");
    $("#aether-current-surface").textContent=("ORBIT / "+active).toUpperCase();
    const users=pulseUsers(), calls=pulseCalls(), worlds=document.querySelectorAll("#server-list>*").length, dms=document.querySelectorAll("#channel-list>*").length;
    $("#aether-metric-people").textContent=String(users.length||"—");
    $("#aether-metric-live").textContent=String(calls.length||"—");
    $("#aether-metric-worlds").textContent=String(worlds||"—");
    $("#aether-metric-dms").textContent=String(dms||"—");
    $("#aether-signal-count").textContent=String(users.length+calls.length||"—");
    $("#aether-radar-number").textContent=users.length?String(Math.min(999,users.length*7+calls.length*13)):"LIVE";
    const ch=window.currentChannel?.name||document.querySelector("#channel-name")?.textContent||"general";
    $("#aether-chat-title").textContent="#"+ch+" · live surface";
    const sig=(window.pulseState?.activity||[]).slice(-1)[0];
    $("#aether-signal-title").textContent=sig?.username||"Network standing by";
    $("#aether-signal-copy").textContent=sig?.activity||"Signals will surface as people interact.";
  }
  function wire(){
    $(".aether-command-button")?.addEventListener("click",openSearch);
    $("#aether-top-search")?.addEventListener("click",openSearch);
    $("#aether-top-notify")?.addEventListener("click",()=>document.querySelector('.rail-nav[data-view="notifications"]')?.click()||route("home"));
    $("#aether-top-call")?.addEventListener("click",()=>$("#voice-call-btn")?.click());
    $("#aether-top-ai")?.addEventListener("click",()=>{if(typeof window.openLayer==="function")window.openLayer("ai");else $("#command-palette")?.classList.remove("hidden")});
    $("#aether-settings-btn")?.addEventListener("click",openSettings);
    $("#aether-hero-space")?.addEventListener("click",()=>route("space"));
    $("#aether-hero-live")?.addEventListener("click",()=>route("calls"));
    $("#aether-shortcut-space")?.addEventListener("click",()=>route("space"));
    $("#aether-shortcut-people")?.addEventListener("click",()=>route("dms"));
    $("#aether-shortcut-unread")?.addEventListener("click",()=>openSearch());
    $("#aether-inspector-close")?.addEventListener("click",()=>$("#aether-inspector")?.classList.toggle("closed"));
    $("#aether-inspect-members")?.addEventListener("click",()=>$("#members-btn")?.click());
    $("#aether-inspect-video")?.addEventListener("click",()=>$("#video-call-btn")?.click());
    $("#aether-inspect-share")?.addEventListener("click",()=>$("#quick-screen-share-btn")?.click());
    $("#aether-inspect-space")?.addEventListener("click",()=>route("space"));
    $("#aether-chat-details")?.addEventListener("click",()=>$("#aether-inspector")?.classList.remove("closed"));
    $("#aether-theme-btn")?.addEventListener("click",()=>document.documentElement.classList.toggle("aether-soft"));
    $("#aether-profile-more")?.addEventListener("click",()=>$("#profile-card-btn")?.click());
    $$(".aether-inspector-tabs button").forEach(b=>b.addEventListener("click",()=>{ $$(".aether-inspector-tabs button").forEach(x=>x.classList.toggle("active",x===b)); const tab=b.dataset.aetherTab; $("#aether-inspector-title").textContent=tab==="overview"?"Command Pulse":tab==="people"?"People Matrix":tab==="signals"?"Signal Stream":"Orbit Space"; }));
    window.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}if(e.key==="Escape")document.body.classList.remove("mobile-sidebar-open")});
    $("#mobile-sidebar-btn")?.addEventListener("click",()=>{$("#app")?.classList.toggle("server-sidebar-open");document.body.classList.toggle("mobile-sidebar-open")});
  }
  function stars(){
    const root=$("#aether-stars");if(!root)return;
    for(let i=0;i<55;i++){const s=document.createElement("i");s.style.left=(Math.random()*100)+"%";s.style.top=(Math.random()*100)+"%";s.style.animationDelay=(-Math.random()*6)+"s";s.style.animationDuration=(4+Math.random()*7)+"s";root.appendChild(s)}
  }
  function boot(){
    stars();wire();sync();setInterval(sync,1800);
    const ob=new MutationObserver(()=>sync());ob.observe($("#app")||document.body,{subtree:true,childList:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
