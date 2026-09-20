
/* ORBIT LAYOUT RUNTIME SHIM — keeps surfaces separated and navigation resilient */
(function(){
  "use strict";
  if(window.__orbitLayoutShim)return;
  window.__orbitLayoutShim=true;
  const q=s=>document.querySelector(s);
  const qa=s=>Array.from(document.querySelectorAll(s));
  let lastView="";
  function view(){
    return String(window.orbitUI?.view || document.querySelector(".rail-nav.active")?.dataset.view || "home");
  }
  function route(id){
    try{
      if(typeof window.setView==="function"){window.setView(id);return true}
      const b=q('.aether-nav[data-view="'+CSS.escape(id)+'"]');
      if(b){b.click();return true}
    }catch(err){console.error("[ORBIT layout]",err)}
    return false;
  }
  function sync(){
    const v=view();
    const home=v==="home";
    const hero=q("#aether-hero-strip");
    const global=q("#global-page");
    const chat=q("#chat-view");
    if(hero)hero.classList.toggle("aether-hide",!home);
    if(global && !global.classList.contains("hidden") && chat && !chat.classList.contains("hidden")){
      chat.classList.add("hidden");
    }
    qa(".aether-nav[data-view]").forEach(b=>{
      b.classList.toggle("active",b.dataset.view===v);
    });
    const name=q("#aether-context-name");
    if(name)name.textContent=home?"Command Center":v.replace(/^./,x=>x.toUpperCase());
    document.body.dataset.orbitSurface=v;
    if(v!==lastView){
      lastView=v;
      document.documentElement.style.setProperty("--orbit-surface-change",Date.now().toString());
    }
  }
  function bind(){
    qa(".aether-nav[data-view]").forEach(b=>{
      if(b.dataset.orbitLayoutBound==="1")return;
      b.dataset.orbitLayoutBound="1";
      b.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        route(b.dataset.view);
      });
    });
    const map={
      "#aether-hero-space":"space",
      "#aether-hero-live":"calls",
      "#aether-shortcut-space":"space",
      "#aether-shortcut-people":"dms",
      "#aether-inspect-space":"space"
    };
    Object.entries(map).forEach(([sel,id])=>{
      const el=q(sel);
      if(!el||el.dataset.orbitLayoutBound==="1")return;
      el.dataset.orbitLayoutBound="1";
      el.addEventListener("click",e=>{e.preventDefault();route(id)});
    });
    const mobile=q("#mobile-sidebar-btn");
    if(mobile&&mobile.dataset.orbitLayoutBound!=="1"){
      mobile.dataset.orbitLayoutBound="1";
      mobile.addEventListener("click",()=>{
        q("#app")?.classList.toggle("server-sidebar-open");
        q("#sidebar")?.classList.toggle("open");
      });
    }
    const search=q("#aether-top-search");
    if(search&&search.dataset.orbitLayoutBound!=="1"){
      search.dataset.orbitLayoutBound="1";
      search.addEventListener("click",()=>{
        const p=q("#command-palette");
        p?.classList.remove("hidden");
        setTimeout(()=>q("#command-input")?.focus(),25);
      });
    }
    const command=q("#aether-command");
    if(command&&command.dataset.orbitLayoutBound!=="1"){
      command.dataset.orbitLayoutBound="1";
      command.addEventListener("click",()=>{
        const p=q("#command-palette");p?.classList.remove("hidden");
        setTimeout(()=>q("#command-input")?.focus(),25);
      });
    }
    const themeBtns=qa("#aether-theme-btn,#aether-settings-btn");
    themeBtns.forEach(el=>{
      if(el.dataset.orbitLayoutBound==="1")return;
      el.dataset.orbitLayoutBound="1";
      el.addEventListener("click",()=>{
        q("#prism-theme-drawer")?.classList.add("open");
      });
    });
    sync();
  }
  function boot(){
    bind();sync();
    if(!window.__orbitLayoutShimTimer){
      window.__orbitLayoutShimTimer=setInterval(()=>{bind();sync()},700);
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();
