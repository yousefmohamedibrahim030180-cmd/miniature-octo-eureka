/* ORBIT PRISM OS — runtime bridge, visual controls, and resilient navigation */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const navIds=["home","dms","space","communities","calls","discover","events","projects","files","ai"];

  const THEMES={
    prism:{name:"Prism",desc:"Electric aurora + glass",vars:{
      "--p-bg":"#070a12","--p-bg2":"#0c1020","--p-surface":"rgba(16,21,37,.72)","--p-orb-1":"rgba(124,108,255,.24)","--p-orb-2":"rgba(61,229,255,.16)","--p-orb-3":"rgba(255,94,196,.12)","--p-grid":"rgba(124,108,255,.08)"}},
    aurora:{name:"Aurora",desc:"Cool luminous atmosphere",vars:{
      "--p-bg":"#061016","--p-bg2":"#09152a","--p-surface":"rgba(10,27,39,.72)","--p-orb-1":"rgba(52,224,184,.20)","--p-orb-2":"rgba(75,166,255,.18)","--p-orb-3":"rgba(171,117,255,.13)","--p-grid":"rgba(61,229,255,.075)"}},
    cyber:{name:"Cyber Rose",desc:"Hot pink + ultraviolet",vars:{
      "--p-bg":"#110612","--p-bg2":"#160b27","--p-surface":"rgba(35,14,45,.74)","--p-orb-1":"rgba(255,63,177,.22)","--p-orb-2":"rgba(145,92,255,.18)","--p-orb-3":"rgba(255,158,70,.11)","--p-grid":"rgba(255,94,196,.075)"}},
    ocean:{name:"Deep Ocean",desc:"Blue depth + cyan light",vars:{
      "--p-bg":"#041019","--p-bg2":"#071c2b","--p-surface":"rgba(8,27,40,.74)","--p-orb-1":"rgba(39,127,255,.20)","--p-orb-2":"rgba(0,231,255,.17)","--p-orb-3":"rgba(52,255,184,.10)","--p-grid":"rgba(61,229,255,.07)"}},
    mono:{name:"Carbon Mono",desc:"Minimal high-contrast",vars:{
      "--p-bg":"#070707","--p-bg2":"#151515","--p-surface":"rgba(26,26,26,.78)","--p-orb-1":"rgba(255,255,255,.08)","--p-orb-2":"rgba(255,255,255,.045)","--p-orb-3":"rgba(255,255,255,.025)","--p-grid":"rgba(255,255,255,.045)"}}
  };
  const BACKGROUNDS={
    aurora:"aurora",prism:"prism",grid:"grid",mesh:"mesh",minimal:"minimal"
  };

  const pulseUsers=()=>Array.isArray(window.pulseState?.users)?window.pulseState.users:[];
  const pulseCalls=()=>Array.isArray(window.pulseState?.calls)?window.pulseState.calls:[];
  function route(id){
    try{
      if(typeof window.setView==="function"){ window.setView(id); sync(); return true; }
      const b=document.querySelector('.rail-nav[data-view="'+id+'"]');
      if(b){ b.onclick?.(); sync(); return true; }
    }catch(err){ console.error("Orbit route failed",id,err); }
    return false;
  }
  function openSearch(){
    const palette=$("#command-palette"),input=$("#command-input");
    if(palette&&input){palette.classList.remove("hidden");setTimeout(()=>input.focus(),40);return}
    $("#quick-search")?.focus();
  }
  function applyVars(theme){
    const root=document.documentElement, t=THEMES[theme]||THEMES.prism;
    Object.entries(t.vars).forEach(([k,v])=>root.style.setProperty(k,v));
    document.body.dataset.prismTheme=theme;
  }
  function applyVisualPrefs(){
    const pref=JSON.parse(localStorage.getItem("orbit_prism_prefs")||"{}");
    const theme=pref.theme||"prism", bg=pref.background||"aurora", speed=Number(pref.speed||1);
    applyVars(theme);
    document.body.classList.remove("prism-calm","prism-electric");
    if(speed<.8)document.body.classList.add("prism-calm");
    if(speed>1.15)document.body.classList.add("prism-electric");
    document.documentElement.style.setProperty("--p-speed",String(speed));
    document.body.classList.toggle("prism-reduced",Boolean(pref.reduced));
    const stars=$("#aether-stars"); if(stars)stars.style.opacity=pref.stars===false?".10":".75";
    const layers=document.querySelector(".prism-aurora-layer"),mesh=document.querySelector(".prism-mesh-layer");
    if(layers)layers.style.opacity=bg==="minimal"?"0":bg==="grid"?".30":".98";
    if(mesh)mesh.style.opacity=(bg==="mesh"||bg==="grid")?".70":"0";
    document.body.classList.toggle("prism-bg-grid",bg==="grid");
    document.body.classList.toggle("prism-bg-mesh",bg==="mesh");
    document.body.classList.toggle("prism-bg-minimal",bg==="minimal");
  }
  function savePref(key,val){
    const pref=JSON.parse(localStorage.getItem("orbit_prism_prefs")||"{}");pref[key]=val;
    localStorage.setItem("orbit_prism_prefs",JSON.stringify(pref));applyVisualPrefs();syncThemeDrawer();
  }
  function ensureScene(){
    if(!document.querySelector(".prism-aurora-layer")){
      const wrap=document.createElement("div");wrap.className="prism-aurora-layer";wrap.innerHTML='<span class="prism-aurora a"></span><span class="prism-aurora b"></span><span class="prism-aurora c"></span>';document.body.appendChild(wrap);
    }
    if(!document.querySelector(".prism-mesh-layer")){const m=document.createElement("div");m.className="prism-mesh-layer";document.body.appendChild(m)}
    if(!document.querySelector(".prism-scan-layer")){const s=document.createElement("div");s.className="prism-scan-layer";document.body.appendChild(s)}
  }
  function stars(){
    const root=$("#aether-stars");if(!root||root.children.length>0)return;
    const frag=document.createDocumentFragment();
    for(let i=0;i<70;i++){
      const s=document.createElement("i");
      s.style.left=(Math.random()*100)+"%";s.style.top=(Math.random()*100)+"%";
      s.style.animationDelay=(-Math.random()*9)+"s";s.style.animationDuration=(3+Math.random()*8)+"s";
      frag.appendChild(s);
    }
    root.appendChild(frag);
  }
  function themeDrawer(){
    if($("#prism-theme-drawer"))return $("#prism-theme-drawer");
    const d=document.createElement("aside");d.id="prism-theme-drawer";d.className="prism-theme-drawer";
    d.setAttribute("aria-label","Orbit visual settings");
    const pref=JSON.parse(localStorage.getItem("orbit_prism_prefs")||"{}");
    d.innerHTML=
      '<div class="prism-theme-head"><div><strong>PRISM CONTROL</strong><span>Shape the atmosphere of your ORBIT.</span></div><button id="prism-theme-close" type="button">×</button></div>'+
      '<div class="prism-theme-section"><label>COLOR UNIVERSE</label><div class="prism-theme-grid" id="prism-theme-grid"></div></div>'+
      '<div class="prism-theme-section"><label>BACKGROUND FIELD</label><div class="prism-theme-grid" id="prism-bg-grid"></div></div>'+
      '<div class="prism-theme-section"><label>MOTION</label><div class="prism-slider"><input id="prism-speed" type="range" min=".35" max="1.6" step=".05"><output id="prism-speed-out"></output></div></div>'+
      '<div class="prism-toggle-row"><span>Atmospheric particles</span><input class="prism-toggle" id="prism-stars" type="checkbox"></div>'+
      '<div class="prism-toggle-row"><span>Reduce motion</span><input class="prism-toggle" id="prism-reduced" type="checkbox"></div>';
    document.body.appendChild(d);
    $("#prism-theme-close").onclick=()=>d.classList.remove("open");
    return d;
  }
  function syncThemeDrawer(){
    const d=themeDrawer(),pref=JSON.parse(localStorage.getItem("orbit_prism_prefs")||"{}");
    const grid=$("#prism-theme-grid",d),bg=$("#prism-bg-grid",d);
    if(grid&&!grid.dataset.ready){
      Object.entries(THEMES).forEach(([id,t])=>{
        const b=document.createElement("button");b.type="button";b.className="prism-theme-card";b.dataset.theme=id;
        b.innerHTML='<i style="background:linear-gradient(135deg,'+t.vars["--p-orb-1"]+','+t.vars["--p-orb-2"]+','+t.vars["--p-orb-3"]+')"></i><b>'+t.name+'</b><span>'+t.desc+"</span>";
        b.onclick=()=>savePref("theme",id);grid.appendChild(b);
      });grid.dataset.ready="1";
    }
    if(bg&&!bg.dataset.ready){
      const cards=[["aurora","Aurora Flow","moving color"],["prism","Prism Bloom","soft spectrum"],["grid","Signal Grid","tech field"],["mesh","Orbit Mesh","layered geometry"],["minimal","Minimal","clean space"]];
      cards.forEach(([id,n,desc])=>{
        const b=document.createElement("button");b.type="button";b.className="prism-theme-card";b.dataset.bg=id;
        const style={aurora:"linear-gradient(135deg,#2dffca,#5977ff,#b45cff)",prism:"linear-gradient(120deg,#7566ff,#20d9ec,#ff58bc)",grid:"linear-gradient(120deg,#091222,#5d62ff,#091222)",mesh:"radial-gradient(circle,#ff5dbe,#5d5cff 45%,#07101d)",minimal:"linear-gradient(135deg,#0b0d13,#1b1d27)"}[id];
        b.innerHTML='<i style="background:'+style+'"></i><b>'+n+'</b><span>'+desc+"</span>";b.onclick=()=>savePref("background",id);bg.appendChild(b);
      });bg.dataset.ready="1";
    }
    $$(".prism-theme-card",d).forEach(x=>x.classList.toggle("active",x.dataset.theme===pref.theme||x.dataset.bg===pref.background));
    const speed=$("#prism-speed",d);if(speed){speed.value=String(pref.speed||1);$("#prism-speed-out",d).textContent=Math.round(Number(speed.value)*100)+"%"}
    if($("#prism-stars",d))$("#prism-stars",d).checked=pref.stars!==false;
    if($("#prism-reduced",d))$("#prism-reduced",d).checked=Boolean(pref.reduced);
  }
  function openVisualSettings(){const d=themeDrawer();syncThemeDrawer();d.classList.add("open")}
  function bindRescue(){
    if(window.__orbitPrismRescueBound)return;
    window.__orbitPrismRescueBound=true;
    document.addEventListener("click",e=>{
      const nav=e.target.closest?.(".aether-nav[data-view]");
      if(nav){e.preventDefault();e.stopPropagation();route(nav.dataset.view);return}
      const id=e.target.closest?.("#aether-settings-btn,#aether-theme-btn");
      if(id){e.preventDefault();e.stopPropagation();openVisualSettings();return}
      const map={"#aether-hero-space":"space","#aether-hero-live":"calls","#aether-shortcut-space":"space","#aether-shortcut-people":"dms","#aether-inspect-space":"space"};
      for(const [sel,id2] of Object.entries(map)){if(e.target.closest?.(sel)){e.preventDefault();e.stopPropagation();route(id2);return}}
      if(e.target.closest?.("#aether-top-search")||e.target.closest?.(".aether-command-button")){e.preventDefault();e.stopPropagation();openSearch();return}
      if(e.target.closest?.("#aether-top-call")){$("#voice-call-btn")?.click();return}
      if(e.target.closest?.("#aether-top-ai")){if(typeof window.openLayer==="function")window.openLayer("ai");return}
    },true);
  }
  function wireVisualControls(){
    const d=themeDrawer(),speed=$("#prism-speed",d),starsIn=$("#prism-stars",d),red=$("#prism-reduced",d);
    if(speed)speed.oninput=()=>savePref("speed",Number(speed.value));
    if(starsIn)starsIn.onchange=()=>savePref("stars",starsIn.checked);
    if(red)red.onchange=()=>savePref("reduced",red.checked);
  }
  function sync(){
    const active=String(window.orbitUI?.view||document.querySelector(".rail-nav.active")?.dataset.view||"home");
    $$(".aether-nav").forEach(b=>b.classList.toggle("active",b.dataset.view===active));
    $("#aether-context-name")&&( $("#aether-context-name").textContent=active==="home"?"Command Center":active.replace(/^./,x=>x.toUpperCase()) );
    $("#aether-hero-strip")?.classList.toggle("aether-hide",active!=="home");
    $("#aether-current-surface")&&( $("#aether-current-surface").textContent=("ORBIT / "+active).toUpperCase());
    const users=pulseUsers(),calls=pulseCalls(),worlds=document.querySelectorAll("#server-list>*").length,dms=document.querySelectorAll("#channel-list>*").length;
    $("#aether-metric-people")&&( $("#aether-metric-people").textContent=String(users.length||"—"));
    $("#aether-metric-live")&&( $("#aether-metric-live").textContent=String(calls.length||"—"));
    $("#aether-metric-worlds")&&( $("#aether-metric-worlds").textContent=String(worlds||"—"));
    $("#aether-metric-dms")&&( $("#aether-metric-dms").textContent=String(dms||"—"));
    $("#aether-signal-count")&&( $("#aether-signal-count").textContent=String(users.length+calls.length||"—"));
    $("#aether-radar-number")&&( $("#aether-radar-number").textContent=users.length?String(Math.min(999,users.length*7+calls.length*13)):"LIVE");
    const ch=window.currentChannel?.name||$("#channel-name")?.textContent||"general";
    $("#aether-chat-title")&&( $("#aether-chat-title").textContent="#"+ch+" · live surface");
    const sig=(window.pulseState?.activity||[]).slice(-1)[0];
    $("#aether-signal-title")&&( $("#aether-signal-title").textContent=sig?.username||"Network standing by");
    $("#aether-signal-copy")&&( $("#aether-signal-copy").textContent=sig?.activity||"Signals will surface as people interact.");
    document.body.dataset.orbitSurface=active;
  }
  function wire(){
    $("#aether-command")?.addEventListener("click",openSearch);
    $("#aether-top-search")?.addEventListener("click",openSearch);
    $("#aether-top-call")?.addEventListener("click",()=>$("#voice-call-btn")?.click());
    $("#aether-top-ai")?.addEventListener("click",()=>typeof window.openLayer==="function"?window.openLayer("ai"):$("#command-palette")?.classList.remove("hidden"));
    $("#aether-settings-btn")?.addEventListener("click",openVisualSettings);
    $("#aether-theme-btn")?.addEventListener("click",openVisualSettings);
    $("#aether-inspector-close")?.addEventListener("click",()=>$("#aether-inspector")?.classList.toggle("closed"));
    $("#aether-chat-details")?.addEventListener("click",()=>$("#aether-inspector")?.classList.remove("closed"));
    $("#aether-inspect-members")?.addEventListener("click",()=>$("#members-btn")?.click());
    $("#aether-inspect-video")?.addEventListener("click",()=>$("#video-call-btn")?.click());
    $("#aether-inspect-share")?.addEventListener("click",()=>$("#quick-screen-share-btn")?.click());
    $("#aether-profile-more")?.addEventListener("click",()=>$("#profile-card-btn")?.click());
    $$(".aether-inspector-tabs button").forEach(b=>b.addEventListener("click",()=>{
      $$(".aether-inspector-tabs button").forEach(x=>x.classList.toggle("active",x===b));
      const tab=b.dataset.aetherTab;
      $("#aether-inspector-title").textContent=tab==="overview"?"Command Pulse":tab==="people"?"People Matrix":tab==="signals"?"Signal Stream":"Orbit Space";
    }));
    window.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}
      if(e.key==="Escape"){document.body.classList.remove("mobile-sidebar-open");$("#prism-theme-drawer")?.classList.remove("open")}
    });
    $("#mobile-sidebar-btn")?.addEventListener("click",()=>{$("#app")?.classList.toggle("server-sidebar-open");document.body.classList.toggle("mobile-sidebar-open")});
    wireVisualControls();
  }
  function boot(){
    document.body.classList.add("orbit-prism");
    ensureScene();stars();applyVisualPrefs();themeDrawer();syncThemeDrawer();wire();bindRescue();sync();setInterval(sync,1500);
    const ob=new MutationObserver(()=>sync());ob.observe($("#app")||document.body,{subtree:true,childList:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();