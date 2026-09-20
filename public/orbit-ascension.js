/* ORBIT ASCENSION APEX — Interaction shell, preserving the current app contracts. */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[m]));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  function route(view){
    if(typeof window.setView==="function"){window.setView(view);return}
    const b=document.querySelector('.rail-nav[data-view="'+view+'"]');b?.click();
  }
  const sections=[
    {id:"home",icon:"⌂",label:"Home",hint:"Your command center",subs:[["Pulse","Live network signal"],["Activity","Realtime activity"],["Quick actions","Jump into ORBIT"]]},
    {id:"dms",icon:"✉",label:"Messages",hint:"Private conversations",subs:[["Direct Messages","All conversations"],["Unread","Needs attention"],["Mentions","Your mentions"],["Archived","Hidden threads"],["Starred","Pinned people"]]},
    {id:"space",icon:"◈",label:"Orbit Space",hint:"Connected social graph",subs:[["People","Presence network"],["Communities","Worlds & spaces"],["Live Rooms","Active calls"],["Events","Upcoming moments"]]},
    {id:"communities",icon:"◉",label:"Communities",hint:"Your connected worlds",subs:[["My Communities","Joined spaces"],["Discover","Find communities"],["Favorites","Pinned worlds"],["Active Now","Live presence"],["Events","Community schedule"]]},
    {id:"calls",icon:"☎",label:"Live",hint:"Voice & video",subs:[["Live Now","Active rooms"],["Following","People you follow"],["Recommended","Suggested rooms"],["Upcoming","Scheduled rooms"],["My Streams","Your broadcasts"]]},
    {id:"discover",icon:"✦",label:"Discover",hint:"Explore the network",subs:[["Recommended","Personalized discovery"],["Trending","What's active"],["People","Find creators"],["Communities","Explore worlds"],["Live","Watch live"],["Events","Find events"]]},
    {id:"events",icon:"◷",label:"Events",hint:"Schedule & RSVP",subs:[["Upcoming","Next events"],["My RSVP","Your attendance"],["Community","Community calendar"],["Past","Event history"]]},
    {id:"projects",icon:"◫",label:"Projects",hint:"Shared workspaces",subs:[["My Projects","Personal work"],["Shared","Collaborative"],["Recent","Recently touched"],["Active","In progress"],["Archived","Completed"]]},
    {id:"files",icon:"□",label:"Files",hint:"Your shared files",subs:[["Recent","Latest uploads"],["Shared With Me","Incoming files"],["My Files","Your uploads"],["Media","Images & video"],["Documents","Work files"],["Favorites","Saved files"]]},
    {id:"ai",icon:"✧",label:"AI",hint:"Intelligence layer",subs:[["Assistant","Ask ORBIT"],["Summaries","Conversation digests"],["Content Tools","Writing & organization"],["Community AI","Moderation help"],["Smart Search","Semantic search"],["AI History","Past sessions"]]}
  ];
  function navLink(label){
    const map={"Direct Messages":"dms","My Communities":"communities","Discover":"discover","Live Now":"calls","Upcoming":"events","My Projects":"projects","Recent":"files","Assistant":"ai","People":"space"};
    return map[label]||null;
  }
  function buildNav(){
    const rail=$("#app .server-rail"); if(!rail||$("#aa-global-nav")) return;
    const nav=document.createElement("div");nav.id="aa-global-nav";
    nav.innerHTML='<div class="aa-nav-label">CORE NAVIGATION</div>'+sections.map((s,i)=>
      '<button class="aa-nav-btn" data-aa-view="'+s.id+'"><span class="aa-nav-icon">'+s.icon+'</span><span class="aa-nav-copy"><strong>'+s.label+'</strong><span>'+s.hint+'</span></span>'+(s.id==="dms"&&Number(dmState?.list?.length||0)?'<b class="aa-nav-badge">'+Math.min(99,dmState.list.length)+'</b>':"")+'<span class="aa-nav-chevron">›</span></button>'+
      '<div class="aa-nav-sub" data-aa-sub="'+s.id+'">'+s.subs.map(x=>'<button class="aa-sub-btn" data-aa-subroute="'+esc(x[0])+'" data-aa-target="'+esc(navLink(x[0])||s.id)+'">'+esc(x[0])+'<span>'+esc(x[1])+'</span></button>').join("")+'</div>'
    ).join("");
    const bottom=document.createElement("div");bottom.className="aa-global-bottom";
    bottom.innerHTML='<div class="aa-mini-row"><div class="aa-mini-status"><div class="aa-mini-avatar" id="aa-mini-avatar">O</div><div class="aa-mini-copy"><strong id="aa-mini-name">ORBIT USER</strong><span><i class="aa-top-dot"></i> ONLINE</span></div></div><button class="aa-mini-action" id="aa-profile">◎</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button class="aa-mini-action" id="aa-settings">⚙ Settings</button><button class="aa-mini-action" id="aa-command">⌘ Commands</button></div>';
    rail.append(nav,bottom);
    const sync=()=>{
      const active=(window.orbitUI?.view||"home");
      $$(".aa-nav-btn").forEach(b=>{const on=b.dataset.aaView===active;b.classList.toggle("active",on);});
    };
    $$(".aa-nav-btn",nav).forEach(btn=>btn.addEventListener("click",()=>{
      const sub=$('.aa-nav-sub[data-aa-sub="'+btn.dataset.aaView+'"]');
      $$(".aa-nav-btn").forEach(b=>{if(b!==btn)b.classList.remove("open")});
      $$(".aa-nav-sub").forEach(x=>{if(x!==sub)x.classList.remove("open")});
      btn.classList.toggle("open");sub.classList.toggle("open");
      route(btn.dataset.aaView);
      sync();
      setTimeout(refreshContext,80);
    }));
    $$(".aa-sub-btn",nav).forEach(btn=>btn.addEventListener("click",e=>{
      e.stopPropagation();route(btn.dataset.aaTarget);setTimeout(refreshContext,100);
    }));
    $("#aa-settings").onclick=()=>{route("settings");setTimeout(()=>document.querySelector('#profile-card-btn')?.focus(),50)};
    $("#aa-profile").onclick=()=>document.querySelector("#profile-card-btn")?.click();
    $("#aa-command").onclick=openApexPalette;
    window.__orbitAscensionSync=sync;
    sync();
  }
  function buildTopbar(){
    const content=$("#app .content"); if(!content||$("#aa-commandbar")) return;
    const bar=document.createElement("div");bar.id="aa-commandbar";
    bar.innerHTML='<label class="aa-command-search"><span>⌕</span><input id="aa-universal-search" placeholder="Search people, messages, communities, events, files…"><kbd>CTRL K</kbd></label><div class="aa-top-actions"><button class="aa-top-btn" id="aa-top-notify">◇<b>Alerts</b></button><button class="aa-top-btn" id="aa-top-call">☎<b>Call</b></button><button class="aa-top-btn"><span class="aa-top-dot"></span><b>Online</b></button><button class="aa-top-btn primary" id="aa-top-profile">◎<b>Profile</b></button><button class="aa-top-btn" id="aa-top-cmd">⌘<b>Command</b></button></div>';
    content.prepend(bar);
    $("#aa-universal-search").onkeydown=e=>{if(e.key==="Enter"){if(typeof window.openSearchModal==="function")window.openSearchModal(e.currentTarget.value);else route("discover")}};
    $("#aa-universal-search").onclick=()=>{if(typeof window.openApexPalette==="function")openApexPalette()};
    $("#aa-top-notify").onclick=()=>route("notifications");
    $("#aa-top-call").onclick=()=>route("calls");
    $("#aa-top-profile").onclick=()=>document.querySelector("#profile-card-btn")?.click();
    $("#aa-top-cmd").onclick=openApexPalette;
  }
  function buildContext(){
    const content=$("#app .content");if(!content||$("#aa-context"))return;
    content.classList.add("aa-context-open");
    const pane=document.createElement("aside");pane.id="aa-context";
    pane.innerHTML='<header class="aa-context-head"><div><strong id="aa-ctx-title">ORBIT CONTEXT</strong><span id="aa-ctx-subtitle">Live application context</span></div><button class="aa-right-close" id="aa-context-close">×</button></header><div class="aa-context-tabs"><button class="aa-context-tab active" data-ctx-tab="overview">Overview</button><button class="aa-context-tab" data-ctx-tab="media">Shared</button><button class="aa-context-tab" data-ctx-tab="activity">Activity</button></div><div id="aa-context-scroll" class="aa-context-scroll"></div>';
    content.appendChild(pane);
    $("#aa-context-close").onclick=()=>{content.classList.remove("aa-context-open");document.body.classList.add("aa-context-hidden")};
    $$(".aa-context-tab").forEach(b=>b.onclick=()=>{$$(".aa-context-tab").forEach(x=>x.classList.toggle("active",x===b));renderContext(b.dataset.ctxTab)});
  }
  function renderContext(tab="overview"){
    const root=$("#aa-context-scroll");if(!root)return;
    const me=window.me||{};const ch=window.currentChannel||{};const srv=window.currentServer||{};
    const dms=window.dmState||{};const other=dms.active?.otherUser||null;
    const name=other?.display_name||other?.username||ch.name||me.display_name||me.username||"ORBIT";
    const sub=other?"DIRECT MESSAGE":ch.name?"#"+ch.name:srv.name||"Command Center";
    $("#aa-ctx-title").textContent=name;$("#aa-ctx-subtitle").textContent=sub;
    if(tab==="overview"){
      const online=Number(window.pulseState?.users?.length||0);
      const calls=Number(window.pulseState?.calls?.length||0);
      const members=Number(srv.memberCount||0);
      root.innerHTML='<div class="aa-profile-hero"><div class="aa-profile-row"><div class="aa-profile-avatar">'+esc(name.slice(0,1).toUpperCase())+'</div><div class="aa-profile-copy"><strong>'+esc(name)+'</strong><span>● '+(other?"PRIVATE CONTACT":"CONNECTED")+'</span><em>'+esc(other?"@"+(other.username||"user"):ch.type||"ORBIT")+'</em></div></div><div class="aa-profile-badges"><span class="aa-pill">ORBIT</span><span class="aa-pill">Realtime</span><span class="aa-pill">'+(other?"Direct":"Network")+'</span></div></div>'+
      '<div class="aa-section"><div class="aa-section-head"><strong>QUICK ACTIONS</strong><span>LIVE</span></div><div class="aa-action-grid"><button class="aa-action primary" id="aa-ctx-voice">Voice Call</button><button class="aa-action primary" id="aa-ctx-video">Video Call</button><button class="aa-action" id="aa-ctx-share">Share Screen</button><button class="aa-action" id="aa-ctx-search">Search</button></div></div>'+
      '<div class="aa-section"><div class="aa-section-head"><strong>NETWORK</strong><span>REALTIME</span></div><div class="aa-context-grid"><div class="aa-metric"><strong>'+online+'</strong><span>Active now</span></div><div class="aa-metric"><strong>'+calls+'</strong><span>Live rooms</span></div><div class="aa-metric"><strong>'+members+'</strong><span>Members</span></div><div class="aa-metric"><strong>'+Number((window.servers||[]).length)+'</strong><span>Communities</span></div></div></div>'+
      '<div class="aa-section"><div class="aa-section-head"><strong>SHARED SIGNAL</strong><span>CHANNEL</span></div><div class="aa-list"><div class="aa-list-row"><div class="aa-list-icon">◌</div><div><strong>'+esc(ch.name||"No channel selected")+'</strong><span>'+esc(ch.type||"Command surface")+'</span></div></div><div class="aa-list-row"><div class="aa-list-icon">◈</div><div><strong>'+esc(srv.name||"Orbit Space")+'</strong><span>'+esc(srv.role||"Workspace")+'</span></div></div></div></div>';
      $("#aa-ctx-voice").onclick=()=>typeof window.startDMCall==="function"&&other?window.startDMCall("voice"):$("#voice-call-btn")?.click();
      $("#aa-ctx-video").onclick=()=>typeof window.startDMCall==="function"&&other?window.startDMCall("video"):$("#video-call-btn")?.click();
      $("#aa-ctx-share").onclick=()=>$("#quick-screen-share-btn")?.click();
      $("#aa-ctx-search").onclick=()=>typeof window.openSearchModal==="function"&&window.openSearchModal("");
    }else if(tab==="media"){
      const nodes=$$("#messages .message-attachment,#dm-messages .od-home-dm-attachment");const imgs=nodes.filter(x=>x.querySelector("img")).length;const files=nodes.length-imgs;
      root.innerHTML='<div class="aa-section"><div class="aa-section-head"><strong>SHARED MEDIA</strong><span>'+nodes.length+' ITEMS</span></div><div class="aa-context-grid"><div class="aa-metric"><strong>'+imgs+'</strong><span>Images / video</span></div><div class="aa-metric"><strong>'+files+'</strong><span>Files</span></div></div></div><div class="aa-section"><div class="aa-list">'+(nodes.length?nodes.slice(0,12).map((n,i)=>'<div class="aa-list-row"><div class="aa-list-icon">'+(n.querySelector("img")?"▧":"↗")+'</div><div><strong>Shared item '+(i+1)+'</strong><span>Open from conversation</span></div></div>').join(""):'<div class="aa-list-row"><div><strong>No shared media yet</strong><span>Attachments will appear here when the current conversation contains them.</span></div></div>')+'</div></div>';
    }else{
      const activity=Array.isArray(window.pulseState?.activity)?pulseState.activity.slice(-8).reverse():[];
      root.innerHTML='<div class="aa-section"><div class="aa-section-head"><strong>LIVE ACTIVITY</strong><span>REALTIME</span></div><div class="aa-list">'+(activity.length?activity.map(x=>'<div class="aa-list-row"><div class="aa-list-icon">✦</div><div><strong>'+esc(x.username||x.user?.username||"ORBIT")+'</strong><span>'+esc(x.text||x.activity||x.type||"Activity detected")+'</span></div></div>').join(""):'<div class="aa-list-row"><div><strong>Waiting for live activity</strong><span>Realtime events will surface here automatically.</span></div></div>')+'</div></div>';
    }
  }
  function refreshContext(){document.body.classList.remove("aa-context-hidden");renderContext($(".aa-context-tab.active")?.dataset.ctxTab||"overview");window.__orbitAscensionSync?.()}
  function buildHomeBoost(){
    const body=$("#page-body");if(!body||$("#aa-home-boost")||String(window.orbitUI?.view||"")!=="home")return;
    const boost=document.createElement("div");boost.id="aa-home-boost";
    const user=window.me?.display_name||window.me?.username||"Operator";
    boost.innerHTML='<div class="aa-home-hero"><section class="aa-home-hero-main"><span class="aa-home-kicker">ORBIT ASCENSION // COMMAND CENTER</span><h2>Good evening, '+esc(user)+'.</h2><p>Your social workspace is live. Navigate conversations, people, communities, media and live rooms from one connected surface.</p><div class="aa-quick-grid"><button class="aa-quick" data-aa-home="dms"><strong>✉</strong>Messages</button><button class="aa-quick" data-aa-home="space"><strong>◈</strong>Open Space</button><button class="aa-quick" data-aa-home="calls"><strong>☎</strong>Join Live</button><button class="aa-quick" data-aa-home="ai"><strong>✧</strong>Ask AI</button></div></section><section class="aa-home-telemetry"><div class="aa-orbit-signal"><div class="aa-signal-ring"></div><div class="aa-signal-copy"><strong id="aa-live-count">0</strong><span>ACTIVE NOW</span></div></div><div><div class="aa-section-head"><strong>NETWORK TELEMETRY</strong><span>LIVE</span></div><div class="aa-context-grid"><div class="aa-metric"><strong id="aa-messages-count">0</strong><span>Conversations</span></div><div class="aa-metric"><strong id="aa-communities-count">0</strong><span>Communities</span></div><div class="aa-metric"><strong id="aa-calls-count">0</strong><span>Live rooms</span></div><div class="aa-metric"><strong id="aa-events-count">—</strong><span>Events</span></div></div></div></section></div><div class="aa-home-columns"><section class="aa-panel-card"><header class="aa-panel-card-head"><strong>LIVE SIGNAL</strong><span>Realtime activity stream</span></header><div id="aa-activity" class="aa-activity"></div></section><section class="aa-panel-card"><header class="aa-panel-card-head"><strong>ACTIVE NOW</strong><span>Presence</span></header><div id="aa-presence" class="aa-presence"></div></section></div>';
    body.prepend(boost);
    $$("[data-aa-home]",boost).forEach(b=>b.onclick=()=>route(b.dataset.aaHome));
    updateHomeTelemetry();
  }
  function updateHomeTelemetry(){
    const boost=$("#aa-home-boost");if(!boost)return;
    const users=Array.isArray(window.pulseState?.users)?pulseState.users.filter(x=>String(x.status||"online").toLowerCase()!=="offline"):[];
    const activity=Array.isArray(pulseState?.activity)?pulseState.activity.slice(-7).reverse():[];
    $("#aa-live-count")&&( $("#aa-live-count").textContent=String(users.length));
    $("#aa-messages-count")&&($("#aa-messages-count").textContent=String(window.dmState?.list?.length||0));
    $("#aa-communities-count")&&($("#aa-communities-count").textContent=String(window.servers?.length||0));
    $("#aa-calls-count")&&($("#aa-calls-count").textContent=String(window.pulseState?.calls?.length||0));
    const ar=$("#aa-activity");if(ar)ar.innerHTML=activity.length?activity.map(a=>'<div class="aa-activity-row"><div class="aa-activity-avatar">'+esc(String(a.username||a.user?.username||"O").slice(0,1).toUpperCase())+'</div><div class="aa-activity-copy"><strong>'+esc(a.username||a.user?.username||"ORBIT")+'</strong><span>'+esc(a.text||a.activity||a.type||"Network activity")+'</span><time>'+esc(a.createdAt||a.created_at||"now")+'</time></div></div>').join(""):'<div class="aa-activity-row"><div class="aa-activity-avatar">✦</div><div class="aa-activity-copy"><strong>ORBIT signal ready</strong><span>Live messages, presence, calls and events will surface here as they happen.</span></div></div>';
    const pr=$("#aa-presence");if(pr)pr.innerHTML=users.slice(0,8).map(u=>'<div class="aa-presence-user"><div class="aa-mini-avatar">'+esc(String(u.username||u.display_name||"U").slice(0,1).toUpperCase())+'</div><strong>'+esc(u.display_name||u.username||"User")+'</strong><span>● '+esc(u.activity||"Online")+'</span></div>').join("")||'<div class="aa-activity-row"><div class="aa-activity-copy"><strong>No active presence</strong><span>When someone becomes active, they appear here.</span></div></div>';
  }
  function openApexPalette(){
    let p=$("#aa-command-palette");
    if(!p){
      p=document.createElement("section");p.id="aa-command-palette";
      p.innerHTML='<div class="aa-cp-card"><div class="aa-cp-top"><span>⌘</span><input id="aa-cp-input" placeholder="Search commands, people, pages, actions…"><kbd>ESC</kbd></div><div id="aa-cp-grid" class="aa-cp-grid"></div></div>';
      document.body.appendChild(p);
      p.onclick=e=>{if(e.target===p)p.classList.remove("open")};
      $("#aa-cp-input",p).addEventListener("input",e=>renderApexCommands(e.target.value));
      $("#aa-cp-input",p).addEventListener("keydown",e=>{if(e.key==="Escape")p.classList.remove("open")});
    }
    p.classList.add("open");$("#aa-cp-input",p).value="";renderApexCommands("");setTimeout(()=>$("#aa-cp-input",p).focus(),20);
  }
  function renderApexCommands(q){
    const items=[
      ["⌕","Search everything","People · messages · communities","search"],
      ["✉","Open Messages","Direct and group conversations","dms"],
      ["◈","Open Orbit Space","People and communities in one graph","space"],
      ["◉","Open Communities","Your connected worlds","communities"],
      ["●","Open Live","Live rooms and calls","calls"],
      ["✦","Discover","Explore creators and communities","discover"],
      ["◷","Events","Upcoming events and RSVP","events"],
      ["◫","Projects","Shared projects and tasks","projects"],
      ["□","Files","Recent and shared files","files"],
      ["✧","Open AI","AI assistant and history","ai"],
      ["◇","Notifications","Your notification center","notifications"],
      ["⚙","Settings","Full account and app settings","settings"],
      ["☎","Start voice call","Use current voice room","voice"],
      ["▣","Start video call","Use current voice room","video"],
      ["▤","Share screen","Start screen sharing","share"]
    ].filter(x=>(x[1]+" "+x[2]).toLowerCase().includes(String(q||"").toLowerCase()));
    const root=$("#aa-cp-grid");if(!root)return;
    root.innerHTML=items.map((x,i)=>'<button class="aa-cp-item" data-aa-cmd="'+i+'"><i>'+x[0]+'</i><div><strong>'+esc(x[1])+'</strong><span>'+esc(x[2])+'</span></div></button>').join("");
    $$(".aa-cp-item",root).forEach((b,i)=>b.onclick=()=>{
      $("#aa-command-palette").classList.remove("open");const a=items[i][3];
      if(a==="search")return typeof window.openSearchModal==="function"&&window.openSearchModal("");
      if(a==="voice")return route("calls"),setTimeout(()=>$("#voice-call-btn")?.click(),100);
      if(a==="video")return route("calls"),setTimeout(()=>$("#video-call-btn")?.click(),100);
      if(a==="share")return $("#quick-screen-share-btn")?.click();
      route(a);setTimeout(refreshContext,90);
    });
  }
  function boot(){
    document.body.classList.add("orbit-ascension");
    buildNav();buildTopbar();buildContext();
    buildHomeBoost();
    refreshContext();
    const observer=new MutationObserver(()=>{
      if(!$("#aa-global-nav"))buildNav();
      if(!$("#aa-commandbar"))buildTopbar();
      if(!$("#aa-context"))buildContext();
      if(orbitUI?.view==="home")buildHomeBoost();
      window.__orbitAscensionSync?.();
    });
    observer.observe($("#app")||document.body,{childList:true,subtree:true});
    setInterval(()=>{if(orbitUI?.view==="home")updateHomeTelemetry();refreshContext()},1800);
    window.openApexPalette=openApexPalette;
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openApexPalette()}
      if(e.key==="Escape")$("#aa-command-palette")?.classList.remove("open");
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();