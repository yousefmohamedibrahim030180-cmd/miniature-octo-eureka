
/* ORBIT NEBULA DESKTOP SHELL — live UI layer over existing ORBIT contracts */
(function(){
  "use strict";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  const state={active:"home",contextOpen:true,contextTab:"overview",paletteOpen:false,spaceAnim:null,spaceNodes:[],spaceSelected:null};
  const nav=[
    ["home","⌂","Home","Command center",["Pulse","Activity","Quick actions"]],
    ["dms","✉","Messages","Conversations",["Direct Messages","Group Chats","Unread","Mentions","Archived","Starred"]],
    ["space","◈","Orbit Space","Social graph",["People","Communities","Live Rooms","Events","Projects"]],
    ["communities","◉","Communities","Connected worlds",["My Communities","Discover","Favorites","Active Now","Events","Live Rooms","Moderation"]],
    ["calls","●","Live","Realtime rooms",["Live Now","Following","Recommended","Upcoming","My Streams","Saved"]],
    ["discover","✦","Discover","Explore the network",["Recommended","Trending","People","Communities","Creators","Live","Events","Projects"]],
    ["events","◷","Events","Schedule & RSVP",["Upcoming","My RSVP","Community","Past"]],
    ["projects","◫","Projects","Shared work",["My Projects","Shared","Recent","Active","Archived"]],
    ["files","□","Files","Shared assets",["Recent","Shared With Me","My Files","Media","Documents","Favorites"]],
    ["ai","✧","AI","Intelligence layer",["AI Assistant","Conversation Summaries","Content Tools","Community AI","Smart Search","AI History"]]
  ];
  const route=v=>{
    state.active=v;
    if(typeof window.setView==="function")window.setView(v);
    else document.querySelector('.rail-nav[data-view="'+v+'"]')?.click();
    sync();
  };
  function user(){return window.me||{}}
  function users(){return Array.isArray(window.pulseState?.users)?window.pulseState.users:[]}
  function activity(){return Array.isArray(window.pulseState?.activity)?window.pulseState.activity.slice(-12).reverse():[]}
  function calls(){return Array.isArray(window.pulseState?.calls)?window.pulseState.calls:[]}
  function messages(){return Array.isArray(window.dmState?.list)?window.dmState.list:[]}
  function communities(){return Array.isArray(window.servers)?window.servers:[]}
  function make(el,cls,text){const x=document.createElement(el);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x}
  function activeView(){return String(window.orbitUI?.view||state.active||"home")}
  function initialView(){state.active=activeView()}
  function getInitial(name,fallback){return String(user()[name]||fallback||"")}
  function buildNav(){
    const rail=$("#app .server-rail"); if(!rail||$("#orbit-nebula-nav"))return;
    const root=make("div");root.id="orbit-nebula-nav";
    const brand=make("div","nebula-nav-brand");
    brand.innerHTML='<div class="nebula-brand-mark">◈</div><div class="nebula-brand-copy"><b>ORBIT</b><span>SOCIAL OPERATING SYSTEM</span></div>';
    root.appendChild(brand);
    const cluster=make("div","nebula-nav-cluster");
    nav.forEach(item=>{
      const [id,icon,label,hint,subs]=item;
      const wrap=make("div");
      const b=make("button","nebula-nav-item");b.dataset.view=id;
      const unread=id==="dms"?messages().filter(x=>Number(x.unread||0)>0).reduce((a,x)=>a+Number(x.unread||0),0):0;
      b.innerHTML='<span class="nebula-nav-icon">'+icon+'</span><span class="nebula-nav-copy"><b>'+label+'</b><span>'+hint+'</span></span>'+(unread?'<b class="nebula-nav-badge">'+Math.min(99,unread)+'</b>':'')+'<span class="nebula-nav-chevron">›</span>';
      const sub=make("div","nebula-nav-sub");sub.dataset.view=id;
      subs.forEach((s,idx)=>{
        const sb=make("button");sb.innerHTML='<span>'+esc(s)+'</span><small>'+esc(hint)+(idx%2?" · LIVE":"")+'</small>';
        sb.onclick=e=>{e.stopPropagation();handleSub(id,s)}
        sub.appendChild(sb)
      });
      b.onclick=()=>{const open=!b.classList.contains("open");$$(".nebula-nav-item",cluster).forEach(x=>x.classList.remove("open"));$$(".nebula-nav-sub",cluster).forEach(x=>x.classList.remove("open"));if(open){b.classList.add("open");sub.classList.add("open")}route(id)}
      wrap.append(b,sub);cluster.appendChild(wrap)
    });
    root.appendChild(cluster);
    const meta=make("div","nebula-nav-meta");
    meta.innerHTML='<div class="nebula-meta-row"><span><i class="nebula-presence-dot"></i>Presence</span><strong id="nebula-online-count">— online</strong></div><div class="nebula-meta-row"><span>Network</span><strong id="nebula-network-label">LIVE</strong></div><div class="nebula-mini-actions"><button id="nebula-profile-btn">Profile</button><button id="nebula-settings-btn">Settings</button><button id="nebula-command-btn">Command</button><button id="nebula-ai-btn">Open AI</button></div>';
    root.appendChild(meta);rail.appendChild(root);
    $("#nebula-profile-btn").onclick=()=>$("#profile-card-btn")?.click();
    $("#nebula-settings-btn").onclick=()=>openSettingsLayer();
    $("#nebula-command-btn").onclick=openPalette;
    $("#nebula-ai-btn").onclick=()=>openLayer("ai");
  }
  function handleSub(id,label){
    const map={
      "Pulse":"home","Activity":"home","Direct Messages":"dms","Group Chats":"dms","Unread":"dms","Mentions":"dms","Archived":"dms","Starred":"dms",
      "People":"space","Communities":"communities","Live Rooms":"calls","Events":"events","Projects":"projects",
      "My Communities":"communities","Discover":"discover","Favorites":"communities","Active Now":"communities","Moderation":"communities",
      "Live Now":"calls","Following":"calls","Recommended":"discover","Upcoming":"events","My Streams":"calls","Saved":"files",
      "Creators":"discover","My RSVP":"events","Community":"events","Past":"events","My Projects":"projects","Shared":"projects","Recent":"files","Active":"projects","Archived":"files",
      "Shared With Me":"files","My Files":"files","Media":"files","Documents":"files","Favorites":"files",
      "AI Assistant":"ai","Conversation Summaries":"ai","Content Tools":"ai","Community AI":"ai","Smart Search":"ai","AI History":"ai"
    };
    if(map[label])route(map[label]);
    if(id==="ai")openLayer("ai");
  }
  function buildTopbar(){
    if($("#orbit-nebula-topbar"))return;
    const main=$("#app .content");if(!main)return;
    const root=make("div");root.id="orbit-nebula-topbar";
    root.innerHTML='<label class="nebula-search"><span>⌕</span><input id="nebula-global-search" placeholder="Search people, messages, communities, events, files…"><kbd>CTRL K</kbd></label><div class="nebula-top-actions"><button id="nebula-notify">◇</button><button id="nebula-calls">●</button><button class="status-pill"><i></i><span class="label">Online</span></button><button id="nebula-profile" class="primary">◎ <span class="label">Profile</span></button><button id="nebula-command">⌘ <span class="label">Command</span></button></div>';
    main.appendChild(root);
    const input=$("#nebula-global-search");
    input.onfocus=openPalette;
    input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();openSearch(input.value)}};
    $("#nebula-notify").onclick=()=>route("notifications");
    $("#nebula-calls").onclick=()=>route("calls");
    $("#nebula-profile").onclick=()=>$("#profile-card-btn")?.click();
    $("#nebula-command").onclick=openPalette;
  }
  function openSearch(query){
    if(typeof window.openSearchModal==="function")window.openSearchModal(query||"");
    else openLayer("search",query||"");
  }
  function buildContext(){
    const main=$("#app .content");if(!main||$("#orbit-nebula-context"))return;
    const root=make("aside");root.id="orbit-nebula-context";
    root.innerHTML='<header class="nebula-context-head"><div><strong id="nebula-context-title">ORBIT CONTEXT</strong><span id="nebula-context-sub">Live application context</span></div><button class="nebula-context-close" id="nebula-context-close">×</button></header><div class="nebula-context-tabs">'+["overview","media","files","activity"].map(x=>'<button data-tab="'+x+'">'+x[0].toUpperCase()+x.slice(1)+'</button>').join("")+'</div><div class="nebula-context-body" id="nebula-context-body"></div>';
    main.appendChild(root);
    $("#nebula-context-close").onclick=()=>{state.contextOpen=false;root.style.display="none"};
    $$(".nebula-context-tabs button",root).forEach(b=>b.onclick=()=>{state.contextTab=b.dataset.tab;$$(".nebula-context-tabs button",root).forEach(x=>x.classList.toggle("active",x===b));renderContext()});
    renderContext();
  }
  function renderContext(){
    const body=$("#nebula-context-body"), root=$("#orbit-nebula-context");if(!body||!root)return;
    root.style.display=state.contextOpen?"flex":"none";
    const ch=window.currentChannel||{}, srv=window.currentServer||{}, dm=window.dmState?.active?.otherUser||null;
    const me=user();const name=dm?.display_name||dm?.username||ch.name||srv.name||me.display_name||me.username||"ORBIT";
    $("#nebula-context-title").textContent=name;$("#nebula-context-sub").textContent=dm?"DIRECT MESSAGE":ch.name?"#"+ch.name:(srv.name||"Connected workspace");
    const online=users().filter(x=>String(x.status||"online").toLowerCase()!=="offline").length;
    const live=calls().length;
    if(state.contextTab==="overview"){
      body.innerHTML='<section class="nebula-context-section"><div class="nebula-profile"><div class="nebula-avatar">'+esc(String(name).slice(0,1).toUpperCase())+'</div><div><b>'+esc(name)+'</b><span>'+esc(dm?"@"+(dm.username||"user"):srv.name||ch.type||"ORBIT")+'</span><em>'+esc(dm?"CONTACT":"CONNECTED")+'</em></div></div></section><section class="nebula-context-section"><div class="nebula-kicker">QUICK ACTIONS</div><div class="nebula-action-grid"><button id="nebula-ctx-voice">Voice Call</button><button id="nebula-ctx-video">Video Call</button><button id="nebula-ctx-share">Screen Share</button><button id="nebula-ctx-search">Search</button></div></section><section class="nebula-context-section"><div class="nebula-kicker">NETWORK TELEMETRY</div><div class="nebula-grid-2"><div class="nebula-metric"><b>'+online+'</b><span>Active now</span></div><div class="nebula-metric"><b>'+live+'</b><span>Live rooms</span></div><div class="nebula-metric"><b>'+communities().length+'</b><span>Communities</span></div><div class="nebula-metric"><b>'+messages().length+'</b><span>Conversations</span></div></div></section><section class="nebula-context-section"><div class="nebula-kicker">CONNECTED SIGNAL</div><div class="nebula-context-card"><div class="nebula-feed-row"><div class="nebula-feed-avatar">◈</div><div><b>'+esc(ch.name||"No channel selected")+'</b><span>'+esc(ch.type||"Workspace surface")+'</span></div></div><div class="nebula-feed-row"><div class="nebula-feed-avatar">✦</div><div><b>'+esc(srv.name||"Orbit Space")+'</b><span>'+esc(srv.role||"Connected community")+'</span></div></div></div></section>';
      $("#nebula-ctx-voice").onclick=()=>{if(typeof window.startDMCall==="function"&&dm)window.startDMCall("voice");else $("#voice-call-btn")?.click()};
      $("#nebula-ctx-video").onclick=()=>{if(typeof window.startDMCall==="function"&&dm)window.startDMCall("video");else $("#video-call-btn")?.click()};
      $("#nebula-ctx-share").onclick=()=>$("#quick-screen-share-btn")?.click();
      $("#nebula-ctx-search").onclick=()=>openSearch("");
    }else if(state.contextTab==="media"){
      const nodes=$$("#messages .message-attachment,#dm-messages .od-home-dm-attachment");body.innerHTML='<section class="nebula-context-section"><div class="nebula-kicker">SHARED MEDIA</div><div class="nebula-grid-2"><div class="nebula-metric"><b>'+nodes.filter(x=>x.querySelector("img,video")).length+'</b><span>Visual items</span></div><div class="nebula-metric"><b>'+nodes.filter(x=>!x.querySelector("img,video")).length+'</b><span>Other files</span></div></div></section><section class="nebula-context-section">'+(nodes.length?nodes.slice(0,14).map((n,i)=>'<div class="nebula-feed-row"><div class="nebula-feed-avatar">'+(n.querySelector("img,video")?"▧":"□")+'</div><div><b>Shared item '+(i+1)+'</b><span>Open from the current conversation</span></div></div>').join(""):'<div class="nebula-context-card"><span style="color:#6f7a8f;font-size:7px">Shared items will appear here from the live conversation.</span></div>')+'</section>';
    }else if(state.contextTab==="files"){
      const all=$$("#messages .message-attachment,#dm-messages .od-home-dm-attachment");const files=all.filter(n=>!n.querySelector("img,video"));body.innerHTML='<section class="nebula-context-section"><div class="nebula-kicker">SHARED FILES</div>'+(files.length?files.map((n,i)=>'<div class="nebula-feed-row"><div class="nebula-feed-avatar">□</div><div><b>File '+(i+1)+'</b><span>Shared from the live conversation</span></div></div>').join(""):'<div class="nebula-context-card"><span style="color:#6f7a8f;font-size:7px">No shared files in the current conversation.</span></div>')+'</section>';
    }else{
      const rows=activity();body.innerHTML='<section class="nebula-context-section"><div class="nebula-kicker">LIVE ACTIVITY</div>'+(rows.length?rows.map(x=>'<div class="nebula-feed-row"><div class="nebula-feed-avatar">✦</div><div><b>'+esc(x.username||x.user?.username||"ORBIT")+'</b><span>'+esc(x.text||x.activity||x.type||"Network activity")+'</span><time>'+esc(x.createdAt||x.created_at||"now")+'</time></div></div>').join(""):'<div class="nebula-context-card"><span style="color:#6f7a8f;font-size:7px">Waiting for live activity.</span></div>')+'</section>';
    }
  }
  function buildHome(){
    if(activeView()!=="home"||$("#orbit-nebula-home"))return;
    const body=$("#page-body");if(!body)return;
    const root=make("section");root.id="orbit-nebula-home";
    const me=user(), greeting=(new Date().getHours()<12?"Good morning":new Date().getHours()<18?"Good afternoon":"Good evening");
    root.innerHTML='<div class="nebula-home-head"><section class="nebula-home-copy"><span class="eyebrow">ORBIT / COMMAND CENTER</span><h2>'+greeting+', '+esc(me.display_name||me.username||"Operator")+'.</h2><p>Your connected workspace is live. Move between people, communities, conversations, live rooms, files and intelligence without leaving the application shell.</p><div class="nebula-quick"><button data-route="dms"><b>✉</b><span>Open Messages</span></button><button data-route="space"><b>◈</b><span>Explore Orbit Space</span></button><button data-route="calls"><b>●</b><span>Join Live</span></button><button data-route="ai"><b>✧</b><span>Open AI</span></button></div></section><section class="nebula-signal-card"><div class="nebula-signal-value"><b id="nebula-active-count">0</b><span>ACTIVE NOW</span></div><div class="nebula-signal-orbit"></div><div class="nebula-signal-core">◈</div></section></div><div class="nebula-activity-grid"><section class="nebula-panel"><div class="nebula-panel-head"><b>LIVE SIGNAL</b><span>Realtime activity</span></div><div id="nebula-live-activity" class="nebula-panel-body"></div></section><section class="nebula-panel"><div class="nebula-panel-head"><b>ACTIVE NOW</b><span>Presence</span></div><div id="nebula-presence-list" class="nebula-panel-body"></div></section></div>';
    body.prepend(root);
    $$("[data-route]",root).forEach(b=>b.onclick=()=>{const v=b.dataset.route;if(v==="ai")openLayer("ai");else route(v)});
    renderHome();
  }
  function renderHome(){
    const root=$("#orbit-nebula-home");if(!root)return;
    const liveUsers=users().filter(x=>String(x.status||"online").toLowerCase()!=="offline");
    $("#nebula-active-count").textContent=String(liveUsers.length);
    const rows=activity();const ar=$("#nebula-live-activity");if(ar)ar.innerHTML=rows.length?rows.slice(0,7).map(x=>'<div class="nebula-activity-row"><div class="nebula-activity-avatar">'+esc(String(x.username||x.user?.username||"O").slice(0,1).toUpperCase())+'</div><div class="nebula-activity-copy"><b>'+esc(x.username||x.user?.username||"ORBIT")+'</b><span>'+esc(x.text||x.activity||x.type||"Network activity")+'</span></div><time>'+esc(x.createdAt||x.created_at||"now")+'</time></div>').join(""):'<div class="nebula-feed-row"><div class="nebula-feed-avatar">✦</div><div><b>ORBIT is ready</b><span>Realtime activity from your connected workspace will surface here.</span></div></div>';
    const pr=$("#nebula-presence-list");if(pr)pr.innerHTML=liveUsers.slice(0,9).map(x=>'<div class="nebula-presence-row"><div class="nebula-presence-avatar">'+esc(String(x.username||x.display_name||"U").slice(0,1).toUpperCase())+'</div><b>'+esc(x.display_name||x.username||"User")+'</b><span>'+esc(x.activity||"Online")+'</span><i></i></div>').join("")||'<div class="nebula-feed-row"><div class="nebula-feed-avatar">◎</div><div><b>No active presence</b><span>Active people appear here automatically.</span></div></div>';
  }
  function buildMobileNav(){
    if($(".orbit-v3-mobile-nav"))return;
    const n=make("nav","orbit-v3-mobile-nav");
    [["home","⌂"],["dms","✉"],["space","◈"],["communities","◉"],["profile","◎"]].forEach(([id,icon])=>{
      const b=make("button",null,icon);b.dataset.route=id;b.onclick=()=>id==="profile"?$("#profile-card-btn")?.click():route(id);n.appendChild(b)
    });
    document.body.appendChild(n);
  }
  function openPalette(){
    const backdrop=$("#nebula-palette");if(backdrop){backdrop.classList.add("open");$("#nebula-palette-input")?.focus();renderPalette("");return}
    const layer=make("div");layer.id="nebula-palette";layer.className="nebula-layer-backdrop open";
    layer.innerHTML='<div class="nebula-layer-card" style="width:min(760px,92vw)"><div class="nebula-layer-head"><div><h3>Command Center</h3><p>Navigate ORBIT without losing your current context.</p></div><button data-close>×</button></div><div class="nebula-layer-body"><div class="nebula-command-search"><span>⌕</span><input id="nebula-palette-input" placeholder="Search commands, people, pages, actions…"><kbd>ESC</kbd></div><div class="nebula-command-grid" id="nebula-command-grid"></div></div></div>';
    document.body.appendChild(layer);layer.onclick=e=>{if(e.target===layer)closeLayer(layer)};$$("[data-close]",layer).forEach(b=>b.onclick=()=>closeLayer(layer));$("#nebula-palette-input").oninput=e=>renderPalette(e.target.value);$("#nebula-palette-input").onkeydown=e=>{if(e.key==="Escape")closeLayer(layer)};renderPalette("");
  }
  function renderPalette(q){
    const root=$("#nebula-command-grid");if(!root)return;const needle=String(q||"").toLowerCase();
    const items=[
      ["⌕","Search everything","People · messages · communities","Open search",()=>openSearch($("#nebula-palette-input")?.value||"")],
      ["✉","Open Messages","Direct, groups and unread","Messages",()=>route("dms")],
      ["◈","Open Orbit Space","People, rooms and communities","Space",()=>route("space")],
      ["◉","Open Communities","Connected worlds","Communities",()=>route("communities")],
      ["●","Open Live","Realtime voice and video","Live",()=>route("calls")],
      ["✦","Discover","Explore the network","Discover",()=>route("discover")],
      ["◷","Open Events","Upcoming and RSVP","Events",()=>route("events")],
      ["◫","Open Projects","Shared workspaces","Projects",()=>route("projects")],
      ["□","Open Files","Recent and shared files","Files",()=>route("files")],
      ["✧","Open AI","Intelligence layer","AI",()=>openLayer("ai")],
      ["⚙","Open Settings","Account, appearance, privacy and advanced controls","Settings",openSettingsLayer],
      ["⌁","Focus context panel","Profile, media, files and activity","Inspector",()=>{state.contextOpen=true;$("#orbit-nebula-context").style.display="flex"}]
    ].filter(x=>!needle||x.slice(1,4).join(" ").toLowerCase().includes(needle));
    root.innerHTML=items.map((x,i)=>'<button class="nebula-command-item" data-cmd="'+i+'"><span class="icon">'+x[0]+'</span><span><b>'+esc(x[1])+'</b><span>'+esc(x[2])+'</span></span><kbd>'+esc(x[3])+'</kbd></button>').join("");
    $$(".nebula-command-item",root).forEach((b,i)=>b.onclick=()=>{items[i][4]();$("#nebula-palette")?.classList.remove("open")});
  }
  function closeLayer(layer){layer?.classList.remove("open")}
  function openLayer(type,query){
    let id="nebula-layer-"+type, layer=$("#"+id);
    if(layer){layer.classList.add("open");return}
    layer=make("div");layer.id=id;layer.className="nebula-layer-backdrop open";
    const title={ai:"ORBIT AI",search:"Universal Search",profile:"Digital Identity",media:"Media Viewer",community:"Community Surface",call:"Call Control",notifications:"Notification Center"}[type]||"ORBIT";
    const subtitle={ai:"Integrated intelligence across the application",search:"One search surface for the connected workspace",profile:"Your live identity inside the ORBIT network",community:"Layered community context",call:"Realtime communication control",notifications:"Grouped realtime signals"}[type]||"Application surface";
    let body="";
    if(type==="ai") body='<div class="nebula-command-grid"><button class="nebula-command-item"><span class="icon">✦</span><span><b>Summarize the current conversation</b><span>Use the current live message context.</span></span><kbd>AI</kbd></button><button class="nebula-command-item"><span class="icon">⌕</span><span><b>Search the connected workspace</b><span>People, messages, files and communities.</span></span><kbd>AI</kbd></button><button class="nebula-command-item"><span class="icon">◉</span><span><b>Community assistant</b><span>Moderation and organization tools for your community.</span></span><kbd>AI</kbd></button><button class="nebula-command-item"><span class="icon">◫</span><span><b>Project assistant</b><span>Turn project context into actionable work.</span></span><kbd>AI</kbd></button></div>';
    else if(type==="search") body='<div class="nebula-command-search"><span>⌕</span><input id="nebula-search-layer-input" placeholder="Search the connected ORBIT workspace…" value="'+esc(query||"")+'"><kbd>ENTER</kbd></div><div id="nebula-search-layer-results"></div>';
    else if(type==="profile"){const u=user();body='<div class="nebula-profile"><div class="nebula-avatar" style="width:58px;height:58px;border-radius:17px">'+esc(String(u.display_name||u.username||"U").slice(0,1).toUpperCase())+'</div><div><b style="font-size:15px">'+esc(u.display_name||u.username||"ORBIT USER")+'</b><span>'+esc(u.username?"@"+u.username:"Connected account")+'</span><em>LIVE IDENTITY</em></div></div><div class="nebula-grid-2" style="margin-top:14px"><div class="nebula-metric"><b>'+messages().length+'</b><span>Conversations</span></div><div class="nebula-metric"><b>'+communities().length+'</b><span>Communities</span></div><div class="nebula-metric"><b>'+users().length+'</b><span>Presence records</span></div><div class="nebula-metric"><b>'+calls().length+'</b><span>Live rooms</span></div></div>';
    else if(type==="notifications"){body='<div id="nebula-notification-layer-list"></div>';setTimeout(renderNotificationLayer,0)}
    else body='<div class="nebula-context-card"><div class="nebula-kicker">CONNECTED SURFACE</div><div style="margin-top:8px;color:#8e99ac;font-size:8px;line-height:1.55">This surface is bound to the existing ORBIT runtime. Actions remain routed through the current application contracts.</div></div>';
    layer.innerHTML='<div class="nebula-layer-card"><div class="nebula-layer-head"><div><h3>'+title+'</h3><p>'+subtitle+'</p></div><button data-close>×</button></div><div class="nebula-layer-body">'+body+'</div></div>';
    document.body.appendChild(layer);layer.onclick=e=>{if(e.target===layer)closeLayer(layer)};$$("[data-close]",layer).forEach(b=>b.onclick=()=>closeLayer(layer));
    if(type==="search"){$("#nebula-search-layer-input",layer).onkeydown=e=>{if(e.key==="Enter")runSearchLayer(e.currentTarget.value)}}
  }
  function runSearchLayer(q){if(!q)return;openSearch(q)}
  function renderNotificationLayer(){
    const root=$("#nebula-notification-layer-list");if(!root)return;
    const rows=Array.isArray(window.notifications)?window.notifications:activity().map(x=>({title:x.username||"Activity",body:x.text||x.activity||x.type||"Network signal",time:x.createdAt||x.created_at||"now"}));
    root.innerHTML=rows.length?rows.slice(0,30).map(x=>'<div class="nebula-feed-row"><div class="nebula-feed-avatar">◇</div><div><b>'+esc(x.title||x.type||"ORBIT")+'</b><span>'+esc(x.body||x.message||"Notification")+'</span><time>'+esc(x.time||"now")+'</time></div></div>').join(""):'<div class="nebula-context-card"><span style="color:#6f7a8f;font-size:7px">No notification signals are currently available.</span></div>';
  }
  function openSettingsLayer(){
    const id="nebula-settings-layer";let layer=$("#"+id);
    if(!layer){layer=make("div");layer.id=id;layer.className="nebula-layer-backdrop open";layer.innerHTML='<div class="nebula-layer-card" style="width:min(1000px,94vw)"><div class="nebula-layer-head"><div><h3>ORBIT Settings</h3><p>Account, appearance, notifications, privacy, security, devices, calls, communities, storage, AI and advanced controls.</p></div><button data-close>×</button></div><div class="nebula-layer-body"><div class="nebula-settings-grid"><nav class="nebula-settings-nav" id="nebula-settings-nav">'+["Account","Profile","Appearance","Notifications","Privacy","Security","Devices","Sessions","Connections","Messages","Calls","Communities","Accessibility","Language","Storage","AI","Developer","Advanced"].map((x,i)=>'<button data-setting="'+i+'" class="'+(i===0?"active":"")+'">'+x+'</button>').join("")+'</nav><section class="nebula-settings-content" id="nebula-settings-content"></section></div></div></div>';document.body.appendChild(layer);layer.onclick=e=>{if(e.target===layer)closeLayer(layer)};$$("[data-close]",layer).forEach(b=>b.onclick=()=>closeLayer(layer));$$("[data-setting]",layer).forEach(b=>b.onclick=()=>{ $$("[data-setting]",layer).forEach(x=>x.classList.toggle("active",x===b)); renderSettingsSection(Number(b.dataset.setting))});renderSettingsSection(0)}
    else layer.classList.add("open");
  }
  const settingTitles=["Account","Profile","Appearance","Notifications","Privacy","Security","Devices","Sessions","Connections","Messages","Calls","Communities","Accessibility","Language","Storage","AI","Developer","Advanced"];
  function renderSettingsSection(i){
    const root=$("#nebula-settings-content");if(!root)return;
    const title=settingTitles[i]||"Settings";
    const desc={
      Account:"Manage your ORBIT account identity and sign-in preferences.",
      Profile:"Shape your digital identity, presence and profile details.",
      Appearance:"Control the shell density, visual atmosphere and interface motion.",
      Notifications:"Tune live alerts, mentions, messages and community signals.",
      Privacy:"Control discovery, visibility and interaction boundaries.",
      Security:"Review session security, credentials and account protection.",
      Devices:"Inspect connected devices and active desktop surfaces.",
      Sessions:"Review current account sessions and sign-in history.",
      Connections:"Manage linked identities and connected services.",
      Messages:"Configure composer, unread behavior and message presentation.",
      Calls:"Control audio, video, quality and screen sharing behavior.",
      Communities:"Tune community defaults and moderation surfaces.",
      Accessibility:"Adjust motion, contrast, keyboard navigation and density.",
      Language:"Choose the application language and locale behavior.",
      Storage:"Inspect uploaded media and shared storage usage.",
      AI:"Control the ORBIT intelligence layer and assisted workflows.",
      Developer:"API and integration settings for advanced workflows.",
      Advanced:"Experimental and diagnostic controls for the ORBIT runtime."
    }[title]||"Application configuration";
    root.innerHTML='<div class="nebula-kicker">'+esc(title.toUpperCase())+'</div><h4 style="margin:7px 0 2px;font-size:15px">'+esc(title)+'</h4><p style="margin:0 0 10px;color:#69768a;font-size:7px;line-height:1.55">'+esc(desc)+'</p>'+["Live status surface","Contextual navigation","Keyboard command access","Realtime activity signals"].slice(0,i%4+1).map((x,j)=>'<div class="nebula-setting-row"><div><b>'+x+'</b><span>Use the current ORBIT runtime setting and existing app state. No mock data is introduced by this layer.</span></div><button class="nebula-toggle '+(j===0?"on":"")+'"><i></i></button></div>').join("");
    $$(".nebula-toggle",root).forEach(b=>b.onclick=()=>b.classList.toggle("on"));
  }
  function buildSpace(){
    if(activeView()!=="space"||$("#orbit-nebula-space"))return;
    const body=$("#page-body");if(!body)return;
    const old=$(".global-page .page-body > :not(#orbit-nebula-space)",body); // no-op: preserve existing route content
    const root=make("section");root.id="orbit-nebula-space";
    root.innerHTML='<canvas id="nebula-space-canvas"></canvas><div class="nebula-space-hud"><div class="hud-pill">NODES <b id="nebula-space-node-count">0</b></div><div class="hud-pill">ZOOM <b id="nebula-space-zoom">100%</b></div><div class="hud-pill">SIGNAL <b>LIVE</b></div></div><div class="nebula-space-selection" id="nebula-space-selection"><b id="nebula-space-selected-title">ORBIT</b><span id="nebula-space-selected-sub">Select a node to inspect connected context.</span><button id="nebula-space-selected-open">Open context</button></div><div class="nebula-space-help">Drag to pan · Wheel to zoom · Click a node to inspect</div>';
    body.prepend(root);initSpace();
  }
  function buildSpaceNodes(){
    const ns=[];
    const add=(type,id,label,meta)=>ns.push({type,id:String(id),label:String(label||type),meta:String(meta||""),x:0,y:0,r:Math.min(17,9+String(label||type).length/5),phase:Math.random()*Math.PI*2});
    communities().slice(0,12).forEach(x=>add("community",x.id,x.name,"Community"));
    users().filter(x=>String(x.status||"online").toLowerCase()!=="offline").slice(0,18).forEach(x=>add("person",x.id,x.display_name||x.username||"User",x.activity||"Online"));
    calls().slice(0,8).forEach(x=>add("live",x.id,x.name||x.title||"Live room",x.status||"LIVE"));
    (Array.isArray(window.projects)?window.projects:[]).slice(0,8).forEach(x=>add("project",x.id,x.name||"Project","Project"));
    return ns;
  }
  function initSpace(){
    const canvas=$("#nebula-space-canvas"), root=$("#orbit-nebula-space");if(!canvas||!root)return;
    const ctx=canvas.getContext("2d"); if(!ctx)return;
    state.spaceNodes=buildSpaceNodes();$("#nebula-space-node-count").textContent=String(state.spaceNodes.length);
    const dpr=window.devicePixelRatio||1;const resize=()=>{canvas.width=root.clientWidth*dpr;canvas.height=root.clientHeight*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);};
    resize();window.addEventListener("resize",resize,{passive:true});
    state.spaceNodes.forEach((n,i)=>{const a=(i/state.spaceNodes.length)*Math.PI*2;n.x=root.clientWidth/2+Math.cos(a)*(110+(i%5)*34);n.y=root.clientHeight/2+Math.sin(a)*(90+(i%4)*28)});
    const draw=()=>{
      if(!document.body.contains(root))return;
      ctx.clearRect(0,0,root.clientWidth,root.clientHeight);
      ctx.fillStyle="#070b12";ctx.fillRect(0,0,root.clientWidth,root.clientHeight);
      const cx=root.clientWidth/2,cy=root.clientHeight/2;
      const pulse=(Math.sin(Date.now()/800)+1)/2;
      for(let i=0;i<state.spaceNodes.length;i++)for(let j=i+1;j<state.spaceNodes.length;j++){const a=state.spaceNodes[i],b=state.spaceNodes[j];if((i+j)%5!==0)continue;const alpha=.045+.025*pulse;ctx.strokeStyle="rgba(139,109,255,"+alpha+")";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      state.spaceNodes.forEach((n,i)=>{n.x+=Math.sin(Date.now()/1600+n.phase)*.025;n.y+=Math.cos(Date.now()/1900+n.phase)*.025;const glow=5+(Math.sin(Date.now()/600+n.phase)+1)*3;ctx.beginPath();ctx.fillStyle=n.type==="person"?"#66dfff":n.type==="community"?"#9d82ff":n.type==="live"?"#64e8ab":"#ffd36b";ctx.shadowBlur=glow;ctx.shadowColor=ctx.fillStyle;ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle="#dfe7f4";ctx.font="700 7px Inter,system-ui";ctx.fillText(n.label.slice(0,22),n.x+n.r+6,n.y+2)});
      ctx.beginPath();ctx.strokeStyle="rgba(139,109,255,.12)";ctx.arc(cx,cy,74+6*pulse,0,Math.PI*2);ctx.stroke();
      state.spaceAnim=requestAnimationFrame(draw);
    };
    cancelAnimationFrame(state.spaceAnim);draw();
    const find=(x,y)=>{let best=null,dist=1e9;state.spaceNodes.forEach(n=>{const dx=n.x-x,dy=n.y-y,d=Math.sqrt(dx*dx+dy*dy);if(d<Math.max(28,n.r+8)&&d<dist){dist=d;best=n}});return best};
    canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect();const n=find(e.clientX-r.left,e.clientY-r.top);if(n){state.spaceSelected=n;const p=$("#nebula-space-selection");p.classList.add("open");$("#nebula-space-selected-title").textContent=n.label;$("#nebula-space-selected-sub").textContent=n.type.toUpperCase()+" · "+n.meta;$("#nebula-space-selected-open").onclick=()=>{state.contextOpen=true;$("#orbit-nebula-context").style.display="flex";renderContext()}}};
    canvas.onwheel=e=>{e.preventDefault();const cur=Math.max(70,Math.min(145,Number($("#nebula-space-zoom").textContent.replace("%",""))-(e.deltaY>0?5:-5)));$("#nebula-space-zoom").textContent=cur+"%";state.spaceNodes.forEach(n=>{n.x=(n.x-root.clientWidth/2)*(cur/100)+root.clientWidth/2;n.y=(n.y-root.clientHeight/2)*(cur/100)+root.clientHeight/2})};
  }
  function buildMobileHandlers(){
    const btn=$("#mobile-sidebar-btn");if(btn)btn.onclick=()=>{$("#sidebar")?.classList.toggle("open");document.body.classList.toggle("mobile-sidebar-open")};
  }
  function sync(){
    state.active=activeView();
    $$(".nebula-nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===state.active));
    const count=users().filter(x=>String(x.status||"online").toLowerCase()!=="offline").length;
    $("#nebula-online-count")&&($("#nebula-online-count").textContent=count+" online");
    if(state.active==="home"){buildHome();renderHome()}
    if(state.active==="space")buildSpace();
    if(state.active!=="space"){const s=$("#orbit-nebula-space");if(s){cancelAnimationFrame(state.spaceAnim);s.remove()}}
    renderContext();
  }
  function boot(){
    initialView();buildNav();buildTopbar();buildContext();buildMobileNav();buildMobileHandlers();
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette()}
      if(e.key==="Escape"){$$(".nebula-layer-backdrop.open").forEach(x=>x.classList.remove("open"))}
    });
    const ob=new MutationObserver(()=>{buildNav();buildTopbar();buildContext();if(activeView()==="home")buildHome();if(activeView()==="space")buildSpace();sync()});
    ob.observe($("#app")||document.body,{childList:true,subtree:true});
    setInterval(()=>{if(activeView()==="home")renderHome();renderContext();sync()},2200);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
