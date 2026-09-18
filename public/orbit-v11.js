
(function(){
  "use strict";

  var v11 = {
    mounted:false,
    dragging:false,
    panX:0,
    panY:0,
    zoom:1,
    clockTimer:null,
    syncTimer:null,
    observer:null
  };

  function qs(s){ return document.querySelector(s); }
  function esc(value){
    return String(value == null ? "" : value).replace(/[&<>"']/g,function(m){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m];
    });
  }
  function stateUsers(){
    try{return Array.isArray(pulseState.users)?pulseState.users:[];}catch(e){return []}
  }
  function stateCalls(){
    try{return Array.isArray(pulseState.calls)?pulseState.calls:[];}catch(e){return []}
  }
  function stateActivity(){
    try{return Array.isArray(pulseState.activity)?pulseState.activity:[];}catch(e){return []}
  }
  function serverList(){
    try{return Array.isArray(servers)?servers:[];}catch(e){return []}
  }
  function activeView(){
    try{return orbitUI && orbitUI.view ? orbitUI.view : "home";}catch(e){return "home"}
  }
  function getMe(){
    try{return me||{};}catch(e){return {}}
  }

  function syncWorld(){
    var users=stateUsers().filter(function(u){return String(u.status||"online").toLowerCase()!=="offline";});
    var calls=stateCalls();
    var active=activeView();
    var energy=Math.min(1,0.26 + Math.min(0.45,users.length/16*0.45) + Math.min(0.22,calls.length/5*0.22));
    document.body.classList.add("orbit-v11");
    document.documentElement.style.setProperty("--v11-energy",String(energy));
    document.documentElement.style.setProperty("--v11-accent",active==="calls"||callState.active?"#83e6ff":"#9b82ff");
    document.documentElement.style.setProperty("--v11-cyan",active==="live"?"#78e9ff":"#59d7ff");
    if(active!=="home"){
      document.body.classList.remove("orbit-focus-on");
    }
  }

  function nav(view){
    try{ setView(view); }catch(e){ console.warn("Orbit V11 nav",e); }
  }
  function goToChat(){
    try{ goChat(); }catch(e){ console.warn(e); }
  }

  function openCommand(){
    try{ openCommandPalette(); }catch(e){
      var cp=qs("#command-palette"); if(cp)cp.classList.remove("hidden");
    }
  }

  function joinLive(call){
    if(!call)return;
    try{
      var s=serverList().find(function(x){return String(x.id)===String(call.serverId);});
      var run=Promise.resolve();
      if(s) run=selectServer(s);
      run.then(function(){
        var ch=(channels||[]).find(function(x){return String(x.id)===String(call.channelId);});
        if(ch)return selectChannel(ch).then(function(){goToChat(); return startCall(call.mode==="voice"?"voice":"video");});
        goToChat();
      }).catch(function(e){ if(typeof orbitToast==="function")orbitToast("Live room",e.message||"Could not join room","error"); });
    }catch(e){console.warn(e)}
  }

  function launchAction(action){
    if(action==="chat"){goToChat();return}
    if(action==="search"){try{openSearchModal("");}catch(e){openCommand()}return}
    if(action==="community"){nav("communities");return}
    if(action==="calls"){nav("calls");return}
    if(action==="files"){nav("files");return}
    if(action==="ai"){nav("ai");return}
    if(action==="settings"){nav("settings");return}
    if(action==="live"){nav("live");return}
    if(action==="focus"){
      document.body.classList.toggle("orbit-focus-on");
      var app=qs("#app");if(app)app.classList.toggle("v11-focus-mode",document.body.classList.contains("orbit-focus-on"));
      toast(document.body.classList.contains("orbit-focus-on")?"Focus mode enabled":"Focus mode disabled","Ctrl+Shift+Space toggles immersive workspace.");
    }
  }

  function toast(title,detail){
    var t=qs("#v11-toast");
    if(!t)return;
    var a=t.querySelector("strong"),b=t.querySelector("span");
    if(a)a.textContent=title;
    if(b)b.textContent=detail||"";
    t.classList.add("show");
    clearTimeout(v11.toastTimer);
    v11.toastTimer=setTimeout(function(){t.classList.remove("show");},2200);
  }

  function buildNodes(){
    var users=stateUsers().filter(function(u){return String(u.status||"online").toLowerCase()!=="offline";}).slice(0,8);
    var calls=stateCalls().slice(0,4);
    var serversNow=serverList().slice(0,6);
    var nodes=[];
    users.forEach(function(u,i){nodes.push({type:"user",id:"u"+u.id,title:u.display_name||u.username||"Guest",sub:u.activity||u.status||"Online",icon:"●",status:"ONLINE",payload:u,angle:(i*39+8),radius:38 + (i%2)*10});});
    calls.forEach(function(c,i){nodes.push({type:"call",id:"c"+c.channelId,title:"#"+(c.channelName||"room"),sub:(c.mode==="voice"?"Voice":"Video")+" · "+((c.participants||[]).length||0)+" people",icon:"◉",status:"LIVE NOW",payload:c,angle:(i*48+26),radius:30 + (i%2)*10});});
    serversNow.forEach(function(s,i){nodes.push({type:"server",id:"s"+s.id,title:s.name||"Community",sub:(s.memberCount||0)+" members",icon:"◈",status:String(s.id)===String(currentServer&&currentServer.id)?"ACTIVE":"SPACE",payload:s,angle:(i*54+17),radius:45});});
    return nodes.slice(0,16);
  }

  function nodePosition(angle,radius){
    var rad=angle*Math.PI/180;
    return {
      x:50 + Math.cos(rad)*(radius),
      y:50 + Math.sin(rad)*(radius*0.74)
    };
  }

  function renderOrbit(){
    var root=qs("#v11-orbit-space");
    if(!root)return;
    var nodes=buildNodes();
    var html=
      '<div class="v11-orbit-ring v11-ring-1"></div>'+
      '<div class="v11-orbit-ring v11-ring-2"></div>'+
      '<div class="v11-orbit-ring v11-ring-3"></div>'+
      '<div class="v11-orbit-ring v11-ring-4"></div>'+
      '<div class="v11-core"><div class="v11-core-inner"><strong>ORBIT</strong><span>Spatial OS</span><div class="v11-core-status"><i></i>'+(stateCalls().length?"LIVE NETWORK":"SYSTEM ONLINE")+'</div></div></div>';
    nodes.forEach(function(n,i){
      var pos=nodePosition(n.angle,n.radius);
      var payload=JSON.stringify(n.payload||{}).replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
      html+='<button class="v11-orbit-node '+n.type+'" data-v11-node="'+esc(n.id)+'" data-v11-type="'+n.type+'" data-v11-index="'+i+'" style="left:'+pos.x+'%;top:'+pos.y+'%;transform:translate(-50%,-50%);animation-delay:'+(i*35)+'ms">'+
        '<div class="v11-node-head"><span class="v11-node-icon">'+n.icon+'</span><div class="v11-node-copy"><strong>'+esc(n.title)+'</strong><span>'+esc(n.sub)+'</span></div></div>'+
        '<div class="v11-node-status"><i></i><span>'+esc(n.status)+'</span></div></button>';
    });
    root.innerHTML=html;
    root.querySelectorAll("[data-v11-node]").forEach(function(btn){
      btn.addEventListener("click",function(e){
        e.stopPropagation();
        var type=btn.getAttribute("data-v11-type");
        var idx=Number(btn.getAttribute("data-v11-index"));
        var item=nodes[idx];
        if(!item)return;
        if(type==="user" && typeof openPulseProfile==="function")openPulseProfile(item.payload.id);
        if(type==="call")joinLive(item.payload);
        if(type==="server"){
          Promise.resolve(selectServer(item.payload)).then(goToChat).catch(function(err){toast("Community",err.message||"Could not open");});
        }
      });
    });
  }

  function renderPanels(){
    var users=stateUsers().filter(function(u){return String(u.status||"online").toLowerCase()!=="offline";}).slice(0,5);
    var calls=stateCalls().slice(0,4);
    var acts=stateActivity().slice(0,7);
    var liveHtml=calls.length?calls.map(function(c){
      return '<button class="v11-live-item" data-v11-call="'+esc(c.channelId)+'"><span class="v11-live-icon">◉</span><span class="v11-live-copy"><strong>#'+esc(c.channelName||"room")+'</strong><span>'+esc(c.mode==="voice"?"Voice":"Video")+' · '+((c.participants||[]).length||0)+' people</span></span><span class="v11-live-join">Join</span></button>';
    }).join(""):'<div class="v11-empty">No active rooms. Start a room to populate the live universe.</div>';
    var actHtml=acts.length?acts.map(function(a){
      var u=a.user||{};var txt="Activity";
      if(a.type==="message")txt="message in #"+(a.channelName||"channel");
      if(a.type==="call-start")txt="joined "+(a.mode==="voice"?"voice":"video");
      if(a.type==="call-end")txt="left "+(a.channelName||"room");
      if(a.type==="screen-share")txt="started screen share";
      if(a.type==="presence")txt="presence · "+(a.activity||u.status||"online");
      return '<button class="v11-activity-item" data-v11-user="'+esc(u.id||"")+'"><span class="v11-activity-icon">✦</span><span class="v11-activity-copy"><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>'+esc(txt)+(a.preview?' · '+esc(a.preview):"")+'</span></span><span class="v11-activity-time">'+formatTime(a.createdAt)+'</span></button>';
    }).join(""):'<div class="v11-empty">Activity will stream here as people interact.</div>';
    var live=qs("#v11-live-list"),feed=qs("#v11-activity-list"),online=qs("#v11-online-count");
    if(live)live.innerHTML=liveHtml;if(feed)feed.innerHTML=actHtml;if(online)online.textContent=String(users.length);
    document.querySelectorAll("[data-v11-call]").forEach(function(btn){
      btn.onclick=function(){var c=calls.find(function(x){return String(x.channelId)===String(btn.getAttribute("data-v11-call"));});if(c)joinLive(c)};
    });
    document.querySelectorAll("[data-v11-user]").forEach(function(btn){
      btn.onclick=function(){var id=btn.getAttribute("data-v11-user");if(id&&typeof openPulseProfile==="function")openPulseProfile(id)};
    });
  }

  function formatTime(ts){
    var d=ts?new Date(ts):new Date();
    if(Number.isNaN(d.getTime()))return "";
    return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  }

  function renderHome(){
    if(activeView()!=="home")return;
    var body=qs("#page-body");
    if(!body)return;
    var existing=qs("#v11-home-shell");
    if(existing){renderOrbit();renderPanels();return;}
    body.innerHTML=
      '<div id="v11-home-shell">'+
        '<div class="v11-topbar">'+
          '<div class="v11-topbar-left"><div class="v11-brandmark">◈</div><div class="v11-top-context"><strong>ORBIT SPATIAL OS</strong><span>Universal workspace · realtime presence · command layer</span></div></div>'+
          '<div class="v11-topbar-right"><div class="v11-live-pill"><i></i><span>Realtime</span></div><div class="v11-clock-pill" id="v11-clock">--:--:--</div><button class="v11-top-button" data-v11-action="search">Search</button><button class="v11-top-button primary" data-v11-action="command">Ctrl K</button></div>'+
        '</div>'+
        '<section class="v11-hero">'+
          '<div class="v11-hero-copy"><div class="v11-kicker">INFINITE COMMAND CENTER</div><h1>Everything around you. One Orbit.</h1><p>Communities, conversations, live rooms, people and workspaces collapse into one spatial control surface that reacts in realtime.</p><div class="v11-hero-meta"><span class="v11-meta-chip"><b id="v11-online-count">0</b> online</span><span class="v11-meta-chip"><b id="v11-room-count">0</b> live rooms</span><span class="v11-meta-chip"><b id="v11-space-count">0</b> spaces</span><span class="v11-meta-chip"><b>CTRL K</b> command</span></div></div>'+
          '<div class="v11-hero-actions"><button class="v11-hero-action primary" data-v11-action="chat"><span>Open current Space</span><small>↵</small></button><button class="v11-hero-action" data-v11-action="focus"><span>Enter Focus Mode</span><small>Ctrl Shift Space</small></button><button class="v11-hero-action" data-v11-action="command"><span>Launch Command Center</span><small>Ctrl K</small></button></div>'+
        '</section>'+
        '<section class="v11-workspace">'+
          '<section class="v11-orbit-stage" id="v11-orbit-stage">'+
            '<div class="v11-stage-hud"><div><span class="v11-hud-chip"><i class="v11-hud-dot"></i><b>SPATIAL MAP</b></span><span class="v11-hud-chip">Drag / wheel to navigate</span></div><div><span class="v11-hud-chip">Zoom <b id="v11-zoom-label">100%</b></span></div></div>'+
            '<div class="v11-orbit-space" id="v11-orbit-space"></div>'+
          '</section>'+
          '<aside class="v11-right-stack">'+
            '<section class="v11-panel live"><div class="v11-panel-head"><div><strong>Live rooms</strong><span>active spaces in your network</span></div><button class="v11-panel-link" data-v11-action="calls">Open calls</button></div><div class="v11-live-list" id="v11-live-list"></div></section>'+
            '<section class="v11-panel activity"><div class="v11-panel-head"><div><strong>Activity stream</strong><span>realtime social graph</span></div><button class="v11-panel-link" data-v11-action="community">Communities</button></div><div class="v11-activity-list" id="v11-activity-list"></div></section>'+
          '</aside>'+
        '</section>'+
        '<section class="v11-launch-grid">'+
          '<button class="v11-launch-card" data-v11-action="search"><div class="v11-launch-icon">⌕</div><strong>Universal Search</strong><span>People, spaces, messages and files.</span></button>'+
          '<button class="v11-launch-card" data-v11-action="community"><div class="v11-launch-icon">◈</div><strong>Communities</strong><span>Jump between worlds and spaces.</span></button>'+
          '<button class="v11-launch-card" data-v11-action="calls"><div class="v11-launch-icon">☎</div><strong>Live Studio</strong><span>Voice, video and screen sharing.</span></button>'+
          '<button class="v11-launch-card" data-v11-action="files"><div class="v11-launch-icon">□</div><strong>Cloud Workspace</strong><span>Shared files, media and attachments.</span></button>'+
        '</section>'+
      '</div>';
    bindHomeActions();
    setupStage();
    renderOrbit();
    renderPanels();
    updateCounts();
    updateClock();
  }

  function bindHomeActions(){
    document.querySelectorAll("[data-v11-action]").forEach(function(btn){
      btn.onclick=function(){
        var action=btn.getAttribute("data-v11-action");
        if(action==="command"){openCommand();return}
        launchAction(action);
      };
    });
  }

  function updateCounts(){
    var online=stateUsers().filter(function(u){return String(u.status||"online").toLowerCase()!=="offline";}).length;
    var rooms=stateCalls().length;
    var spaces=serverList().length;
    var a=qs("#v11-online-count"),b=qs("#v11-room-count"),c=qs("#v11-space-count");
    if(a)a.textContent=String(online);
    if(b)b.textContent=String(rooms);
    if(c)c.textContent=String(spaces);
  }

  function updateClock(){
    var el=qs("#v11-clock");if(!el)return;
    el.textContent=new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }

  function setupStage(){
    var stage=qs("#v11-orbit-stage");
    if(!stage || stage.dataset.v11Wired==="1")return;
    stage.dataset.v11Wired="1";
    stage.addEventListener("pointerdown",function(e){
      if(e.target.closest(".v11-orbit-node"))return;
      v11.dragging=true;stage.classList.add("dragging");stage.setPointerCapture(e.pointerId);
      v11.startX=e.clientX;v11.startY=e.clientY;v11.baseX=v11.panX;v11.baseY=v11.panY;
    });
    stage.addEventListener("pointermove",function(e){
      if(!v11.dragging)return;
      v11.panX=v11.baseX+(e.clientX-v11.startX);
      v11.panY=v11.baseY+(e.clientY-v11.startY);
      applyStageTransform();
    });
    stage.addEventListener("pointerup",function(){v11.dragging=false;stage.classList.remove("dragging")});
    stage.addEventListener("pointercancel",function(){v11.dragging=false;stage.classList.remove("dragging")});
    stage.addEventListener("wheel",function(e){
      e.preventDefault();
      v11.zoom=Math.max(.72,Math.min(1.30,v11.zoom+(e.deltaY>0?-0.05:0.05)));
      applyStageTransform();
    },{passive:false});
    stage.addEventListener("dblclick",function(){
      v11.panX=0;v11.panY=0;v11.zoom=1;applyStageTransform();
    });
  }

  function applyStageTransform(){
    var root=qs("#v11-orbit-space");if(!root)return;
    root.style.setProperty("--v11-pan-x",v11.panX+"px");
    root.style.setProperty("--v11-pan-y",v11.panY+"px");
    root.style.setProperty("--v11-zoom",String(v11.zoom));
    var label=qs("#v11-zoom-label");if(label)label.textContent=Math.round(v11.zoom*100)+"%";
  }

  function installDock(){
    if(qs("#v11-dock"))return;
    var dock=document.createElement("div");
    dock.id="v11-dock";
    dock.className="v11-floating-dock";
    dock.innerHTML=
      '<button class="v11-dock-btn" data-v11-dock="home">Home</button>'+
      '<button class="v11-dock-btn" data-v11-dock="chat">Chat</button>'+
      '<button class="v11-dock-btn" data-v11-dock="communities">Worlds</button>'+
      '<button class="v11-dock-btn" data-v11-dock="calls">Calls</button>'+
      '<button class="v11-dock-btn" data-v11-dock="files">Files</button>'+
      '<button class="v11-dock-btn" data-v11-dock="ai">AI</button>'+
      '<span class="v11-dock-sep"></span><button class="v11-dock-btn v11-dock-focus" data-v11-dock="focus">Focus</button>';
    document.body.appendChild(dock);
    dock.querySelectorAll("[data-v11-dock]").forEach(function(btn){
      btn.onclick=function(){
        var v=btn.getAttribute("data-v11-dock");
        if(v==="focus"){launchAction("focus");return}
        if(v==="chat"){goToChat();return}
        nav(v==="home"?"home":v);
      };
    });
    syncDock();
  }

  function syncDock(){
    var current=activeView();
    document.querySelectorAll("[data-v11-dock]").forEach(function(btn){
      var v=btn.getAttribute("data-v11-dock");
      btn.classList.toggle("active",(v==="home"&&current==="home") || v===current);
    });
  }

  function installLiveFloating(){
    if(qs("#v11-live-floating"))return;
    var el=document.createElement("aside");
    el.id="v11-live-floating";
    el.className="v11-live-floating";
    el.innerHTML='<div class="v11-live-floating-head"><strong>Live Universe</strong><span>always on</span></div><div class="v11-live-floating-list" id="v11-live-floating-list"></div>';
    document.body.appendChild(el);
  }

  function renderLiveFloating(){
    var root=qs("#v11-live-floating-list");if(!root)return;
    var calls=stateCalls().slice(0,3);
    root.innerHTML=calls.length?calls.map(function(c){
      return '<button class="v11-mini-call" data-v11-mini="'+esc(c.channelId)+'"><span class="pulse-dot"></span><span><strong>#'+esc(c.channelName||"room")+'</strong><span>'+esc(c.mode==="voice"?"Voice":"Video")+' · '+((c.participants||[]).length||0)+' participants</span></span></button>';
    }).join(""):'<div class="v11-empty">No live room</div>';
    root.querySelectorAll("[data-v11-mini]").forEach(function(btn){
      btn.onclick=function(){var c=calls.find(function(x){return String(x.channelId)===String(btn.getAttribute("data-v11-mini"));});if(c)joinLive(c)};
    });
  }

  function enhanceCalls(){
    var panel=qs("#call-panel");if(!panel)return;
    panel.classList.add("v11-call-enhanced");
    if(!qs("#v11-call-corner")){
      var c=document.createElement("div");
      c.id="v11-call-corner";c.className="v11-call-corner";
      c.innerHTML='<span>SPATIAL HUD</span><span id="v11-call-clock">00:00</span>';
      panel.appendChild(c);
    }
    var clock=qs("#v11-call-clock");
    if(clock && callState.active){
      var s=Math.max(0,Math.floor((Date.now()-callStartedAt)/1000));
      clock.textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
    }
  }

  function keyboard(e){
    var mod=e.ctrlKey||e.metaKey;
    if(mod && e.key.toLowerCase()==="k"){
      e.preventDefault();openCommand();return;
    }
    if(mod && e.key==="/" && !e.shiftKey){
      e.preventDefault();try{openSearchModal("");}catch(err){openCommand()}return;
    }
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="m"){
      e.preventDefault();if(callState.active && typeof toggleMic==="function")toggleMic();return;
    }
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="c"){
      e.preventDefault();if(!callState.active){goToChat();startCall("video");}return;
    }
    if(e.ctrlKey && e.shiftKey && e.code==="Space"){
      e.preventDefault();launchAction("focus");return;
    }
    if(e.key==="Escape"){
      var cp=qs("#command-palette");if(cp&&!cp.classList.contains("hidden"))return;
      document.body.classList.remove("orbit-focus-on");
      var app=qs("#app");if(app)app.classList.remove("v11-focus-mode");
    }
  }

  function bindObserver(){
    if(v11.observer)return;
    var target=qs("#global-page")||document.body;
    v11.observer=new MutationObserver(function(){
      var view=activeView();
      if(view==="home"){
        var body=qs("#page-body");
        if(body && !qs("#v11-home-shell"))renderHome();
      }
      syncDock();
      syncWorld();
    });
    v11.observer.observe(target,{childList:true,subtree:true});
  }

  function patchRenderHome(){
    if(typeof renderHomePage!=="function" || renderHomePage.__v11)return;
    var base=renderHomePage;
    function wrapped(){
      base();
      try{renderHome();}
      catch(e){console.warn("Orbit V11 home render",e);}
    }
    wrapped.__v11=true;
    renderHomePage=wrapped;
  }

  function boot(){
    document.body.classList.add("orbit-v11");
    installDock();
    installLiveFloating();
    bindObserver();
    document.addEventListener("keydown",keyboard,{capture:true});
    patchRenderHome();
    var callTimer=setInterval(function(){
      syncWorld();
      syncDock();
      renderLiveFloating();
      if(activeView()==="home")renderHome();
      enhanceCalls();
      if(qs("#v11-home-shell")){
        renderOrbit();
        renderPanels();
        updateCounts();
      }
      updateClock();
    },1200);
    v11.syncTimer=callTimer;
    updateClock();
    setInterval(updateClock,1000);
    if(activeView()==="home")renderHome();
    enhanceCalls();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
  else boot();
})();
