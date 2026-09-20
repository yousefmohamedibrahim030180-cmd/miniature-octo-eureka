
/* ORBIT CONTROL — premium power layer; intentionally isolated from core runtime */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const KEY="orbit_control_state_v1";
  const ACT="orbit_control_activity_v1";
  const THEMES={
    prism:{name:"Prism",bg:"linear-gradient(145deg,#16132d,#091521)",glow:"rgba(148,121,255,.34)",accent:"#9b7cff",accent2:"#53e4ff",o1:"rgba(124,108,255,.24)",o2:"rgba(61,229,255,.16)",o3:"rgba(255,94,196,.12)"},
    aurora:{name:"Aurora",bg:"linear-gradient(145deg,#09231f,#071425)",glow:"rgba(68,228,188,.30)",accent:"#55e4bd",accent2:"#6bb7ff",o1:"rgba(52,224,184,.2)",o2:"rgba(75,166,255,.18)",o3:"rgba(171,117,255,.12)"},
    cyber:{name:"Cyber Rose",bg:"linear-gradient(145deg,#2a1027,#140b27)",glow:"rgba(255,74,188,.28)",accent:"#ff5ebf",accent2:"#9e78ff",o1:"rgba(255,63,177,.22)",o2:"rgba(145,92,255,.18)",o3:"rgba(255,158,70,.11)"},
    ocean:{name:"Deep Ocean",bg:"linear-gradient(145deg,#062439,#07131d)",glow:"rgba(0,213,255,.25)",accent:"#46e1ff",accent2:"#3aa8ff",o1:"rgba(39,127,255,.20)",o2:"rgba(0,231,255,.17)",o3:"rgba(52,255,184,.10)"},
    ember:{name:"Ember",bg:"linear-gradient(145deg,#2a1710,#161012)",glow:"rgba(255,141,76,.27)",accent:"#ff9f6b",accent2:"#ffd36e",o1:"rgba(255,123,65,.22)",o2:"rgba(255,186,81,.14)",o3:"rgba(255,75,125,.10)"},
    graphite:{name:"Graphite",bg:"linear-gradient(145deg,#202329,#0d1015)",glow:"rgba(255,255,255,.10)",accent:"#c9d0dc",accent2:"#7f8ca1",o1:"rgba(255,255,255,.08)",o2:"rgba(180,195,215,.08)",o3:"rgba(255,255,255,.04)"}
  };
  const NAVS=[["home","Home","⌂"],["dms","Messages","✉"],["space","Orbit Space","◈"],["communities","Worlds","◉"],["calls","Live rooms","●"],["discover","Discover","✦"],["events","Events","◷"],["projects","Projects","◫"],["files","Files","□"],["ai","ORBIT AI","✧"]];
  const defaults={theme:"prism",accentPower:1,motion:true,sound:true,focus:false,compact:false,zen:false,ambient:true,notes:true};
  let state={...defaults,...JSON.parse(localStorage.getItem(KEY)||"{}")};
  let activities=JSON.parse(localStorage.getItem(ACT)||"[]");
  let activeTab="overview", toastTimer=null, deferredInstall=null;

  const persist=()=>localStorage.setItem(KEY,JSON.stringify(state));
  const saveActivities=()=>localStorage.setItem(ACT,JSON.stringify(activities.slice(-40)));
  const note=(title,copy)=>{
    const row={id:Date.now()+Math.random(),title:String(title),copy:String(copy),time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})};
    activities.push(row);saveActivities();renderActivity();updateCounters();
  };
  const toast=(msg)=>{
    let t=$("#orbit-control-toast");
    if(!t){t=document.createElement("div");t.id="orbit-control-toast";document.body.appendChild(t)}
    t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2100);
  };
  const run=(label,fn)=>{
    try{fn();note(label,"Action executed from Orbit Control");toast(label)}
    catch(e){console.error("[orbit-control]",e);toast("Action unavailable")}
  };
  const setTheme=(id)=>{
    const t=THEMES[id]||THEMES.prism;state.theme=id;persist();
    const root=document.documentElement;
    root.style.setProperty("--oc-accent",t.accent);
    root.style.setProperty("--oc-accent-2",t.accent2);
    root.style.setProperty("--p-orb-1",t.o1);
    root.style.setProperty("--p-orb-2",t.o2);
    root.style.setProperty("--p-orb-3",t.o3);
    root.style.setProperty("--orbit-accent",t.accent);
    document.body.dataset.orbitTheme=id;
    $$(".oc-theme").forEach(x=>x.classList.toggle("active",x.dataset.theme===id));
  };
  const applyState=()=>{
    document.body.classList.toggle("oc-reduce-motion",!state.motion);
    document.body.classList.toggle("oc-focus",!!state.focus);
    document.body.classList.toggle("oc-compact",!!state.compact);
    document.body.classList.toggle("oc-zen",!!state.zen);
    document.body.classList.toggle("oc-ambient-off",!state.ambient);
    setTheme(state.theme);
  };
  const socket=()=>window.__orbitRealtimeSocket||window.__orbitSocket||null;
  const socketLabel=()=>{
    const s=socket();
    if(!navigator.onLine)return ["Offline","off"];
    if(!s)return ["Standby","warn"];
    if(s.connected)return ["Realtime online","ok"];
    return ["Reconnecting","warn"];
  };
  const currentView=()=>document.querySelector(".aether-nav.active")?.dataset.view||window.orbitUI?.view||"home";
  const getStats=()=>{
    const people=document.querySelectorAll(".presence,.od-presence-dot").length;
    const channels=document.querySelectorAll("#channel-list > *").length;
    const notices=Math.min(99,activities.length);
    return {people,channels,notices};
  };
  function nav(view){
    const b=document.querySelector('.aether-nav[data-view="'+CSS.escape(view)+'"]');
    if(b){b.click();return}
    const legacy=document.querySelector('[data-view="'+CSS.escape(view)+'"]');
    legacy?.click();
  }
  function clickSel(sel){$(sel)?.click()}
  function actionFor(id){
    const map={
      voice:()=>clickSel("#voice-call-btn"),
      video:()=>clickSel("#video-call-btn"),
      share:()=>clickSel("#quick-screen-share-btn"),
      members:()=>clickSel("#members-btn")||clickSel("#aether-inspect-members"),
      channel:()=>clickSel("#new-channel"),
      voiceChannel:()=>clickSel("#new-voice-channel"),
      poll:()=>clickSel("#poll-btn"),
      files:()=>nav("files"),
      discover:()=>nav("discover"),
      space:()=>nav("space"),
      ai:()=>nav("ai"),
      events:()=>nav("events"),
      projects:()=>nav("projects"),
      communities:()=>nav("communities"),
      dms:()=>nav("dms"),
      calls:()=>nav("calls"),
      home:()=>nav("home"),
      fullscreen:()=>document.documentElement.requestFullscreen?.(),
      focus:()=>toggle("focus"),
      zen:()=>toggle("zen")
    };
    return map[id]||(()=>{});
  }
  function toggle(k){
    state[k]=!state[k];persist();applyState();render();
    note(k==="focus"?"Focus mode":k==="zen"?"Zen mode":k==="compact"?"Compact layout":k==="motion"?"Reduced motion":k==="sound"?"Sound feedback":k==="ambient"?"Ambient layer":"Control",state[k]?"Enabled":"Disabled");
  }
  function panelHtml(){
    return '<div id="orbit-control-panel"><div class="oc-panel">'+
      '<div class="oc-panel-head"><div class="oc-brand"><div class="oc-brand-orb">◈</div><div class="oc-brand-copy"><strong>ORBIT CONTROL</strong><span>POWER LAYER · '+(location.hostname||"LOCAL")+'</span></div></div><button class="oc-panel-x" data-oc-close>×</button></div>'+
      '<div class="oc-tabs">'+
        '<button class="oc-tab active" data-oc-tab="overview">Overview</button><button class="oc-tab" data-oc-tab="commands">Command</button><button class="oc-tab" data-oc-tab="appearance">Visuals</button><button class="oc-tab" data-oc-tab="system">System</button>'+
      '</div>'+
      '<div class="oc-scroll">'+
        '<section class="oc-section active" data-oc-section="overview">'+
          '<div class="oc-card"><div class="oc-card-title"><strong>RUNTIME HEALTH</strong><span id="oc-health-time">LIVE</span></div><div class="oc-health" style="margin-top:10px"><i class="oc-health-dot" id="oc-health-dot"></i><div><strong id="oc-health-label">Checking runtime…</strong><span id="oc-health-copy">Network, realtime and local surface state</span></div></div></div>'+
          '<div class="oc-grid"><div class="oc-metric"><b id="oc-metric-view">HOME</b><span>Current surface</span></div><div class="oc-metric"><b id="oc-metric-people">—</b><span>Presence nodes</span></div><div class="oc-metric"><b id="oc-metric-channels">—</b><span>Visible channels</span></div><div class="oc-metric"><b id="oc-metric-notices">0</b><span>Control events</span></div></div>'+
          '<div class="oc-card"><div class="oc-card-title"><strong>QUICK OPS</strong><span>One click</span></div><div class="oc-action-grid" style="margin-top:10px">'+
            '<button class="oc-action" data-oc-action="voice"><i class="oc-icon">☎</i><b>Start voice</b><span>Open the current voice room.</span></button>'+
            '<button class="oc-action" data-oc-action="video"><i class="oc-icon">▣</i><b>Start video</b><span>Open a live video call.</span></button>'+
            '<button class="oc-action" data-oc-action="share"><i class="oc-icon">▤</i><b>Share screen</b><span>Share the current display.</span></button>'+
            '<button class="oc-action" data-oc-action="poll"><i class="oc-icon">◫</i><b>Create poll</b><span>Launch a fast channel poll.</span></button>'+
            '<button class="oc-action" data-oc-action="channel"><i class="oc-icon">+</i><b>New channel</b><span>Add a text or announcement space.</span></button>'+
            '<button class="oc-action" data-oc-action="voiceChannel"><i class="oc-icon">◉</i><b>Voice channel</b><span>Spin up a live room.</span></button>'+
          '</div></div>'+
          '<div class="oc-card"><div class="oc-card-title"><strong>RECENT CONTROL SIGNALS</strong><span>LOCAL</span></div><div id="oc-activity" class="oc-activity" style="margin-top:9px"></div></div>'+
        '</section>'+
        '<section class="oc-section" data-oc-section="commands">'+
          '<div class="oc-search"><input id="oc-command-search" placeholder="Jump to a page, action, or capability…"></div>'+
          '<div id="oc-command-list" class="oc-command-list"></div>'+
        '</section>'+
        '<section class="oc-section" data-oc-section="appearance">'+
          '<div class="oc-card"><div class="oc-card-title"><strong>ATMOSPHERE LAB</strong><span>Persistent</span></div><p>Switch the visual personality without touching the core application layout.</p><div id="oc-theme-grid" class="oc-theme-grid" style="margin-top:10px"></div><div class="oc-range-row"><label><span>Ambient intensity</span><b id="oc-accent-value">'+Math.round(state.accentPower*100)+'%</b></label><input id="oc-accent-power" class="oc-range" type="range" min="20" max="140" value="'+Math.round(state.accentPower*100)+'"></div></div>'+
          '<div class="oc-card" id="oc-appearance-toggles"></div>'+
        '</section>'+
        '<section class="oc-section" data-oc-section="system">'+
          '<div class="oc-card" id="oc-system-card"></div>'+
          '<div class="oc-card"><div class="oc-card-title"><strong>KEYBOARD MATRIX</strong><span>Global</span></div><div class="oc-shortcuts" style="margin-top:8px">'+
            '<div class="oc-shortcut"><span>Open command center</span><kbd>Ctrl / ⌘ + Shift + O</kbd></div>'+
            '<div class="oc-shortcut"><span>Focus mode</span><kbd>Ctrl / ⌘ + Alt + F</kbd></div>'+
            '<div class="oc-shortcut"><span>Global search</span><kbd>Ctrl / ⌘ + K</kbd></div>'+
            '<div class="oc-shortcut"><span>Close overlays</span><kbd>Esc</kbd></div>'+
          '</div></div>'+
          '<button class="oc-primary" data-oc-install>Install ORBIT surface</button>'+
          '<button class="oc-danger" data-oc-clear>Reset local control preferences</button>'+
        '</section>'+
      '</div></div></div>';
  }
  function launcherHtml(){return '<button id="orbit-control-launcher" type="button" aria-label="Orbit Control"><span class="oc-launch-glyph">◈</span><i class="oc-launch-dot"></i></button><div id="orbit-control-toast"></div>'}
  function commands(){
    const base=[
      ...NAVS.map(x=>({id:x[0],icon:x[2],title:"Open "+x[1],copy:"Navigate to "+x[1]})),
      {id:"voice",icon:"☎",title:"Start voice",copy:"Open voice call"},
      {id:"video",icon:"▣",title:"Start video",copy:"Open video call"},
      {id:"share",icon:"▤",title:"Share screen",copy:"Start screen sharing"},
      {id:"channel",icon:"+",title:"Create channel",copy:"Open channel creator"},
      {id:"voiceChannel",icon:"◉",title:"Create voice channel",copy:"Open voice channel creator"},
      {id:"poll",icon:"◫",title:"Create poll",copy:"Open poll builder"},
      {id:"focus",icon:"◎",title:"Toggle focus mode",copy:"Give the conversation maximum space"},
      {id:"zen",icon:"☼",title:"Toggle zen mode",copy:"Hide navigation chrome"},
      {id:"fullscreen",icon:"⛶",title:"Enter fullscreen",copy:"Expand ORBIT to the display"},
      {id:"theme",icon:"◌",title:"Open atmosphere lab",copy:"Change the visual mood"},
      {id:"members",icon:"◉",title:"Open members",copy:"View channel members"}
    ];
    return base;
  }
  function renderCommands(filter=""){
    const list=$("#oc-command-list");if(!list)return;
    const q=filter.toLowerCase().trim();
    const rows=commands().filter(c=>(c.title+" "+c.copy).toLowerCase().includes(q));
    list.innerHTML=rows.map(c=>'<button class="oc-command-item" data-oc-cmd="'+c.id+'"><i>'+c.icon+'</i><div><strong>'+c.title+'</strong><span>'+c.copy+'</span></div></button>').join("")||'<div class="oc-empty">No command matches that signal.</div>';
    $$(".oc-command-item",list).forEach(b=>b.onclick=()=>{const id=b.dataset.ocCmd;if(id==="theme"){setTab("appearance")}else{run(b.innerText.split("\n")[0],actionFor(id));closePanel()}});
  }
  function renderThemes(){
    const root=$("#oc-theme-grid");if(!root)return;
    root.innerHTML=Object.entries(THEMES).map(([id,t])=>'<button class="oc-theme '+(state.theme===id?"active":"")+'" data-theme="'+id+'" style="--theme-bg:'+t.bg+';--theme-glow:'+t.glow+'"><strong>'+t.name+'</strong><span>Live atmosphere</span></button>').join("");
    $$(".oc-theme",root).forEach(b=>b.onclick=()=>{setTheme(b.dataset.theme);note("Atmosphere changed",THEMES[b.dataset.theme].name);toast("Theme: "+THEMES[b.dataset.theme].name)});
  }
  function renderToggles(){
    const root=$("#oc-appearance-toggles");if(!root)return;
    const rows=[
      ["motion","Motion","Keep cinematic transitions enabled."],
      ["sound","Sound feedback","Use small audio cues for local controls."],
      ["focus","Focus mode","Collapse the inspector and widen the workspace."],
      ["compact","Compact layout","Tighten lists and control surfaces."],
      ["zen","Zen mode","Hide navigation chrome for a clean canvas."],
      ["ambient","Ambient layer","Keep the living background atmosphere visible."]
    ];
    root.innerHTML='<div class="oc-card-title"><strong>PERSONAL MODES</strong><span>Local</span></div>'+rows.map(r=>'<div class="oc-toggle-row"><div class="oc-toggle-copy"><strong>'+r[1]+'</strong><span>'+r[2]+'</span></div><button class="oc-toggle '+(state[r[0]]?"on":"")+'" data-oc-toggle="'+r[0]+'"><i></i></button></div>').join("");
    $$(".oc-toggle",root).forEach(b=>b.onclick=()=>toggle(b.dataset.ocToggle));
  }
  function renderSystem(){
    const root=$("#oc-system-card");if(!root)return;
    const [label,kind]=socketLabel();
    root.innerHTML='<div class="oc-card-title"><strong>SYSTEM SNAPSHOT</strong><span>LIVE</span></div><div style="display:grid;gap:8px;margin-top:9px">'+
      '<div class="oc-shortcut"><span>Connection</span><kbd>'+label+'</kbd></div>'+
      '<div class="oc-shortcut"><span>Browser</span><kbd>'+escapeSmall(navigator.userAgent.split(" ").slice(-1)[0]||"Browser")+'</kbd></div>'+
      '<div class="oc-shortcut"><span>Viewport</span><kbd>'+innerWidth+" × "+innerHeight+'</kbd></div>'+
      '<div class="oc-shortcut"><span>Storage</span><kbd>'+((JSON.stringify(localStorage).length/1024).toFixed(1))+' KB</kbd></div>'+
      '<div class="oc-shortcut"><span>Session</span><kbd>'+escapeSmall(currentView().toUpperCase())+'</kbd></div>'+
    '</div>';
  }
  function escapeSmall(x){return String(x).replace(/[<>&"]/g,"")}
  function updateHealth(){
    const dot=$("#oc-health-dot"),lab=$("#oc-health-label"),copy=$("#oc-health-copy"),time=$("#oc-health-time");
    if(!dot||!lab)return;
    const [label,kind]=socketLabel();
    dot.className="oc-health-dot "+(kind==="ok"?"":kind==="warn"?"warn":"off");
    lab.textContent=label;
    copy.textContent=navigator.onLine?"Realtime transport + browser online state":"Browser reports offline mode";
    if(time)time.textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const v=$("#oc-metric-view");if(v)v.textContent=String(currentView()).toUpperCase();
    const stats=getStats();$("#oc-metric-people")&&( $("#oc-metric-people").textContent=stats.people );$("#oc-metric-channels")&&($("#oc-metric-channels").textContent=stats.channels);$("#oc-metric-notices")&&($("#oc-metric-notices").textContent=activities.length);
    updateCounters();
  }
  function updateCounters(){const n=$("#aether-top-notify .aether-live-badge");if(n)n.textContent=Math.max(1,Math.min(9,activities.length||1))}
  function renderActivity(){
    const root=$("#oc-activity");if(!root)return;
    if(!activities.length){root.innerHTML='<div class="oc-empty">Your control signals will appear here as you use the platform.</div>';return}
    root.innerHTML=activities.slice(-8).reverse().map(a=>'<div class="oc-activity-row"><i class="oc-activity-dot"></i><div class="oc-activity-copy"><strong>'+escapeSmall(a.title)+'</strong><span>'+escapeSmall(a.copy)+'</span><time>'+escapeSmall(a.time)+'</time></div></div>').join("");
  }
  function render(){
    renderThemes();renderToggles();renderSystem();renderCommands($("#oc-command-search")?.value||"");renderActivity();updateHealth();
  }
  function setTab(tab){
    activeTab=tab;
    $$(".oc-tab").forEach(b=>b.classList.toggle("active",b.dataset.ocTab===tab));
    $$(".oc-section").forEach(s=>s.classList.toggle("active",s.dataset.ocSection===tab));
    if(tab==="commands")renderCommands($("#oc-command-search")?.value||"");
    render();
  }
  function openPanel(tab=activeTab){const p=$("#orbit-control-panel");if(!p)return;p.classList.add("open");setTab(tab);$("#oc-command-search")?.focus()}
  function closePanel(){$("#orbit-control-panel")?.classList.remove("open")}
  function build(){
    if($("#orbit-control-launcher"))return;
    document.body.insertAdjacentHTML("beforeend",launcherHtml()+panelHtml());
    $("#orbit-control-launcher").onclick=()=>openPanel("overview");
    $("[data-oc-close]").onclick=closePanel;
    $("#orbit-control-panel").addEventListener("click",e=>{if(e.target.id==="orbit-control-panel")closePanel()});
    $$(".oc-tab").forEach(b=>b.onclick=()=>setTab(b.dataset.ocTab));
    $("#oc-command-search").addEventListener("input",e=>renderCommands(e.target.value));
    $("#oc-accent-power").addEventListener("input",e=>{
      state.accentPower=Number(e.target.value)/100;persist();const v=e.target.value;
      document.documentElement.style.setProperty("--oc-accent-power",state.accentPower);$("#oc-accent-value").textContent=v+"%";
    });
    $$("#orbit-control-panel [data-oc-action]").forEach(b=>b.onclick=()=>{const id=b.dataset.ocAction;run(b.querySelector("b")?.textContent||"Action",actionFor(id));closePanel()});
    $("[data-oc-install]").onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null}else{toast("Install prompt will appear when supported by this browser.")}};
    $("[data-oc-clear]").onclick=()=>{localStorage.removeItem(KEY);localStorage.removeItem(ACT);state={...defaults};activities=[];applyState();render();toast("Local controls reset")};
    document.addEventListener("keydown",e=>{
      const mod=e.ctrlKey||e.metaKey;
      if(e.key==="Escape"){closePanel();return}
      if(mod&&e.shiftKey&&e.key.toLowerCase()==="o"){e.preventDefault();$("#orbit-control-panel")?.classList.toggle("open");openPanel("overview");return}
      if(mod&&e.altKey&&e.key.toLowerCase()==="f"){e.preventDefault();toggle("focus");return}
      if(mod&&e.key.toLowerCase()==="k"){setTimeout(()=>{$("#command-input")?.focus()},30);return}
    },false);
    window.addEventListener("online",()=>{note("Network restored","Browser is online");updateHealth()});
    window.addEventListener("offline",()=>{note("Network interrupted","Browser reports offline mode");updateHealth()});
    window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e});
    window.addEventListener("resize",()=>{if($("#orbit-control-panel")?.classList.contains("open"))renderSystem()});
    document.addEventListener("click",e=>{
      const el=e.target.closest?.("button,a");
      if(!el||el.closest("#orbit-control-panel,#orbit-control-launcher"))return;
      const label=(el.getAttribute("aria-label")||el.title||el.innerText||"").trim().replace(/\s+/g," ");
      if(!label)return;
      if(/^(Search|Command)$/i.test(label))return;
      if(/^(Voice|Video|Share|Send|Enter Orbit Space|Open Live)$/i.test(label))note(label,"Platform action");
    },false);
    const attachSocket=()=>{
      const s=socket();
      if(!s||s.__orbitControlAttached)return;
      s.__orbitControlAttached=true;
      s.on("message:new",m=>{
        if(document.hidden||!document.querySelector("#chat-view:not(.hidden)")){note("New message","A realtime message arrived while this surface was not active.");}
      });
      s.on("connect",()=>updateHealth());
      s.on("disconnect",()=>updateHealth());
    };
    setInterval(()=>{applyState();updateHealth();attachSocket()},2500);
    applyState();render();
  }
  window.addEventListener("DOMContentLoaded",build);
  if(document.readyState!=="loading")build();
})();
