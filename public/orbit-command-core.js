/* ORBIT COMMAND CORE
   Additive UX layer. It only decorates existing ORBIT views and triggers existing nav buttons.
*/
(()=>{"use strict";
  if(window.__ORBIT_COMMAND_CORE__)return;
  window.__ORBIT_COMMAND_CORE__=true;

  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const navMap={home:"Home",messages:"Messages",communities:"Servers",calls:"Calls",missions:"Missions",studio:"Studio",settings:"Settings"};

  function routeButton(route){
    const b=$('[data-view="'+route+'"]');
    if(b){b.click();return true}
    return false;
  }
  function curtain(){
    let c=$("#orbitLeapCurtain");
    if(!c){c=document.createElement("div");c.id="orbitLeapCurtain";document.body.appendChild(c)}
    c.classList.add("show");
    setTimeout(()=>c.classList.remove("show"),260);
  }
  function go(route){
    curtain();
    setTimeout(()=>routeButton(route),65);
  }

  function launcher(){
    if($("#orbitLauncher"))return;
    const el=document.createElement("div");
    el.id="orbitLauncher";
    el.className="orbit-launcher";
    el.setAttribute("aria-label","ORBIT Core navigation");
    el.innerHTML=[
      ["home","◉","Home"],["messages","◈","Chat"],["communities","◎","Servers"],
      ["calls","◌","Calls"],["missions","✦","Missions"],["studio","◇","Studio"]
    ].map(x=>'<button class="orbit-launch" data-orbit-route="'+x[0]+'"><span>'+x[1]+'</span><small>'+x[2]+'</small></button>').join("");
    document.body.appendChild(el);
    $$(".orbit-launch").forEach(b=>b.onclick=()=>go(b.dataset.orbitRoute));
    syncLauncher();
  }
  function syncLauncher(){
    const active=$("#nav button.active")?.dataset.view;
    $$(".orbit-launch").forEach(b=>b.classList.toggle("active",b.dataset.orbitRoute===active));
  }

  async function presenceCount(){
    try{
      const r=await fetch("/api/presence",{credentials:"same-origin"});
      if(!r.ok)return null;
      const d=await r.json();
      return Array.isArray(d.users)?d.users.filter(u=>u&&u.status==="online").length:null;
    }catch{return null}
  }

  function core(){
    if($("#orbitCore"))return;
    const page=$("#surface .page");
    if(!page)return;
    if(!$("#surface .page").classList.contains("orbit-core-ready")){
      page.classList.add("orbit-core-ready");
    }
    const existing=$("#orbitCore");
    if(existing)return;

    const box=document.createElement("section");
    box.id="orbitCore";
    box.className="orbit-core";
    box.innerHTML=
      '<div class="orbit-core-content">'+
      '<span class="orbit-core-kicker">ORBIT // COMMAND CORE</span>'+
      '<h2>Your space. Your people. Your orbit.</h2>'+
      '<p>A living command center for conversation, communities, calls and identity. Jump anywhere without leaving the flow.</p>'+
      '<div class="orbit-core-actions">'+
      '<button class="orbit-core-btn primary" data-core-route="messages">Open Chat</button>'+
      '<button class="orbit-core-btn" data-core-route="communities">Explore Servers</button>'+
      '<button class="orbit-core-btn" data-core-route="studio">Customize</button>'+
      '<button class="orbit-core-btn" data-core-route="calls">Calls</button>'+
      '</div>'+
      '<div class="orbit-presence-mini"><span class="count" id="orbitPresenceCount">—</span><span>PEOPLE ONLINE ACROSS ORBIT</span></div>'+
      '</div>'+
      '<div class="orbit-core-live"><i></i><span>ORBIT SYSTEM LIVE</span></div>';
    page.prepend(box);
    $$("#orbitCore [data-core-route]").forEach(b=>b.onclick=()=>go(b.dataset.coreRoute));
    presenceCount().then(n=>{if(n!=null){const e=$("#orbitPresenceCount");if(e)e.textContent=n}});
  }

  function isHome(){return $("#viewTitle")?.textContent?.trim()==="Home" && !!$("#surface .page");}
  function removeCore(){
    const el=$("#orbitCore");
    if(el)el.remove();
  }
  function boot(){
    launcher();
    if(isHome())core(); else removeCore();
    syncLauncher();
  }

  const observer=new MutationObserver(()=>{
    clearTimeout(observer._timer);
    observer._timer=setTimeout(boot,40);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  document.addEventListener("click",e=>{
    const b=e.target.closest("#nav [data-view]");
    if(b){
      curtain();
      setTimeout(()=>{syncLauncher();if(b.dataset.view==="home")core();else removeCore()},120);
    }
  },true);

  document.addEventListener("keydown",e=>{
    if(e.ctrlKey&&!e.shiftKey&&!e.altKey){
      const k=e.key.toLowerCase();
      const map={1:"home",2:"messages",3:"communities",4:"calls",5:"missions",6:"studio"};
      if(map[k]){
        e.preventDefault();
        go(map[k]);
      }
    }
  },true);

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();