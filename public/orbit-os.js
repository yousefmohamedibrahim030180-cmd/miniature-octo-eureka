/* ORBIT SOCIAL OS — shell interaction bridge */
(function(){
  "use strict";
  if(window.__orbitSocialOS)return;
  window.__orbitSocialOS=true;
  const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
  const route=(view)=>{
    try{
      if(view==="dms" && typeof window.setView==="function"){ window.setView("home"); return; }
      if(view==="calls" && typeof window.setView==="function"){ window.setView("calls"); return; }
      if(typeof window.setView==="function"){ window.setView(view); return; }
      const b=q('.aether-nav[data-view="'+view+'"]'); b?.click();
    }catch(err){console.error("[ORBIT Social OS]",err)}
  };
  function bindNav(){
    qa(".nav-item[data-view]").forEach(b=>{
      if(b.dataset.osBound==="1")return;
      b.dataset.osBound="1";
      b.addEventListener("click",()=>route(b.dataset.view));
    });
  }
  function bindActions(){
    const searchers=["#openSearch","#quickCommand","#aether-command"];
    searchers.forEach(sel=>{
      const el=q(sel); if(!el||el.dataset.osBound==="1")return;
      el.dataset.osBound="1";
      el.addEventListener("click",()=>{
        q("#command-palette")?.classList.remove("hidden");
        setTimeout(()=>q("#command-input")?.focus(),30);
      });
    });
    const topMsg=q("#aether-top-messages");
    if(topMsg&&topMsg.dataset.osBound!=="1"){topMsg.dataset.osBound="1";topMsg.addEventListener("click",()=>route("dms"))}
    const topCall=q("#aether-top-call");
    if(topCall&&topCall.dataset.osBound!=="1"){topCall.dataset.osBound="1";topCall.addEventListener("click",()=>route("calls"))}
    const collapse=q("#collapseContext");
    if(collapse&&collapse.dataset.osBound!=="1"){
      collapse.dataset.osBound="1";
      collapse.addEventListener("click",()=>{
        document.body.classList.toggle("os-context-collapsed");
        collapse.textContent=document.body.classList.contains("os-context-collapsed")?"›":"‹";
      });
    }
    const close=q("#closeRight");
    if(close&&close.dataset.osBound!=="1"){
      close.dataset.osBound="1";
      close.addEventListener("click",()=>document.body.classList.toggle("os-right-collapsed"));
    }
    const mobile=q("#mobile-sidebar-btn");
    if(mobile&&mobile.dataset.osBound!=="1"){
      mobile.dataset.osBound="1";
      mobile.addEventListener("click",()=>{
        q("#app")?.classList.toggle("server-sidebar-open");
        q("#sidebar")?.classList.toggle("open");
      });
    }
    qa(".aether-inspector-tabs button").forEach(tab=>{
      if(tab.dataset.osBound==="1")return;
      tab.dataset.osBound="1";
      tab.addEventListener("click",()=>{
        qa(".aether-inspector-tabs button").forEach(x=>x.classList.remove("active"));
        tab.classList.add("active");
        document.body.dataset.contextTab=tab.dataset.aetherTab||"overview";
      });
    });
  }
  function sync(){
    const v=String(window.orbitUI?.view||q(".nav-item.active")?.dataset.view||"home");
    const labels={home:"Command Center",space:"Orbit Space",dms:"Messages",calls:"Live",communities:"Communities",discover:"Discover",events:"Events",projects:"Projects",files:"Files",ai:"AI"};
    qa(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
    const crumb=q("#pageCrumb"); if(crumb)crumb.textContent=labels[v]||"Home";
    const title=q("#rightTitle"); if(title)title.textContent=v==="home"?"Activity":(labels[v]||"Activity");
    const eyebrow=q("#contextEyebrow"); if(eyebrow)eyebrow.textContent=(v==="home"?"HOME":String(labels[v]||"ORBIT").toUpperCase());
    const ctx=q("#contextTitle"); if(ctx)ctx.textContent=v==="home"?"Command Center":(labels[v]||"Orbit");
    const surface=q("#aether-current-surface"); if(surface)surface.textContent="ORBIT / "+String(labels[v]||"HOME").toUpperCase();
    document.body.dataset.orbitOsView=v;
  }
  function layout(){
    const root=q("#app");
    if(!root)return;
    root.classList.toggle("os-context-collapsed",document.body.classList.contains("os-context-collapsed"));
    root.classList.toggle("os-right-collapsed",document.body.classList.contains("os-right-collapsed"));
  }
  function boot(){bindNav();bindActions();sync();layout();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
  setInterval(()=>{bindNav();bindActions();sync();layout()},800);
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();q("#command-palette")?.classList.remove("hidden");setTimeout(()=>q("#command-input")?.focus(),30)}
    if(e.key==="Escape")q("#command-palette")?.classList.add("hidden");
  });
})();