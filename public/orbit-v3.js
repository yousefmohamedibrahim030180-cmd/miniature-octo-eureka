(function(){
  "use strict";
  if(window.__ORBIT3_LOADED__) return;
  window.__ORBIT3_LOADED__=true;

  var state={open:false,mode:"command",timer:null};

  function $(s){return document.querySelector(s)}
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}
  function safeRun(fn){try{return Promise.resolve(fn()).catch(function(){})}catch(e){return Promise.resolve()}}
  function root(){
    var el=$("#orbit3Layer");
    if(el)return el;
    el=document.createElement("div");
    el.id="orbit3Layer";
    el.className="orbit3-backdrop";
    el.hidden=true;
    el.setAttribute("aria-hidden","true");
    el.innerHTML=
      '<div class="orbit3-panel" role="dialog" aria-modal="true" aria-label="ORBIT 3.0">'+
        '<header class="orbit3-head">'+
          '<div class="orbit3-brand"><span class="orbit3-orb">O</span><div><span class="orbit3-kicker">ORBIT 3.0 · THE LIVING PLATFORM</span><strong class="orbit3-title" id="orbit3ModeTitle">Command Center</strong></div></div>'+
          '<button class="orbit3-close" id="orbit3Close" aria-label="Close">×</button>'+
        '</header>'+
        '<div class="orbit3-body" id="orbit3Body"></div>'+
      '</div>';
    document.body.appendChild(el);
    $("#orbit3Close").addEventListener("click",close);
    el.addEventListener("click",function(e){if(e.target===el)close()});
    return el;
  }
  function open(mode){
    state.mode=mode||"command";state.open=true;
    var el=root();el.hidden=false;el.setAttribute("aria-hidden","false");
    render();setTimeout(function(){var q=$("#orbit3Search");if(q)q.focus()},40);
  }
  function close(){state.open=false;var el=root();if(el){el.hidden=true;el.setAttribute("aria-hidden","true")}}
  function setTitle(v){var e=$("#orbit3ModeTitle");if(e)e.textContent=v}
  function toastSafe(t,b){
    try{if(typeof window.toast==="function")window.toast(t,b);else if(typeof window.showToast==="function")window.showToast(t,b)}catch(e){}
  }
  function userInfo(){
    try{var node=$("#profileBtn");return node?node.textContent.trim():"ORBIT User"}catch(e){return "ORBIT User"}
  }

  function render(){
    if(!state.open)return;
    var body=$("#orbit3Body");if(!body)return;
    if(state.mode==="worlds"){setTitle("Worlds");renderWorlds(body);return}
    if(state.mode==="themes"){setTitle("Identity Themes");renderThemes(body);return}
    setTitle("Command Center");
    body.innerHTML=
      '<div class="orbit3-command"><input class="orbit3-search" id="orbit3Search" placeholder="Search people, communities or actions…" autocomplete="off"><div class="orbit3-shortcut">CTRL K</div></div>'+
      '<div class="orbit3-results" id="orbit3Results"></div>'+
      '<div class="orbit3-grid">'+
        '<section class="orbit3-card"><div class="orbit3-card-head"><div><span class="orbit3-kicker">LIVE SYSTEM</span><h3>Everything happening, one layer.</h3><p>Jump between worlds, communication and identity without leaving the current ORBIT surface.</p></div><span class="orbit3-pill"><i class="orbit3-live-dot"></i> LIVE</span></div>'+
        '<div class="orbit3-actions">'+
          '<button class="orbit3-action" data-v3="worlds"><strong>🌌 ORBIT Worlds</strong><span>Turn communities into living spaces.</span></button>'+
          '<button class="orbit3-action" data-v3="live"><strong>📡 Live Pulse</strong><span>See your current activity footprint.</span></button>'+
          '<button class="orbit3-action" data-v3="themes"><strong>🎨 Identity Themes</strong><span>Change the visual personality of ORBIT.</span></button>'+
          '<button class="orbit3-action" data-v3="search"><strong>⚡ Instant Search</strong><span>Find people and communities immediately.</span></button>'+
        '</div></section>'+
        '<section class="orbit3-card"><div class="orbit3-card-head"><div><span class="orbit3-kicker">QUICK CONTROL</span><h3>Workspace shortcuts</h3><p>Fast actions stay above the complexity of the full app.</p></div></div>'+
        '<div class="orbit3-actions">'+
          '<button class="orbit3-action" data-v3="messages"><strong>◈ Messages</strong><span>Open your conversations.</span></button>'+
          '<button class="orbit3-action" data-v3="communities"><strong>◎ Communities</strong><span>Open the ORBIT worlds list.</span></button>'+
          '<button class="orbit3-action" data-v3="calls"><strong>◉ Calls</strong><span>Open realtime calling.</span></button>'+
          '<button class="orbit3-action" data-v3="settings"><strong>⚙ Settings</strong><span>Customize your workspace.</span></button>'+
        '</div></section>'+
      '</div>'+
      '<section class="orbit3-card" style="margin-top:14px"><div class="orbit3-card-head"><div><span class="orbit3-kicker">ORBIT STATUS</span><h3>Connected as '+esc(userInfo()||"ORBIT User")+'</h3><p>3.0 is running as a presentation layer, so existing messaging, calls and community data remain untouched.</p></div><span class="orbit3-pill"><i class="orbit3-live-dot"></i> SAFE LAYER</span></div></section>';
    bindBody();
  }

  function bindBody(){
    var q=$("#orbit3Search");
    if(q){
      q.addEventListener("input",function(){search(q.value)});
      q.addEventListener("keydown",function(e){if(e.key==="Escape")close()});
    }
    document.querySelectorAll("[data-v3]").forEach(function(b){b.addEventListener("click",function(){
      var v=b.getAttribute("data-v3");
      if(v==="worlds"){state.mode="worlds";render()}
      else if(v==="themes"){state.mode="themes";render()}
      else if(v==="search"){var x=$("#orbit3Search");if(x)x.focus()}
      else {close();navigate(v)}
    })});
  }

  var searchTimer=null;
  function search(q){
    clearTimeout(searchTimer);
    var box=$("#orbit3Results");if(!box)return;
    q=String(q||"").trim();
    if(!q){box.innerHTML="";return}
    box.innerHTML='<div class="orbit3-empty">Searching ORBIT…</div>';
    searchTimer=setTimeout(function(){safeRun(function(){
      return fetch("/api/search?q="+encodeURIComponent(q),{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(d){
        var users=Array.isArray(d.users)?d.users:[],communities=Array.isArray(d.communities)?d.communities:[];
        var rows=users.slice(0,6).map(function(u){return '<button class="orbit3-result" data-v3-result="messages"><span class="orbit3-avatar">'+(u.avatarUrl?'<img src="'+esc(u.avatarUrl)+'" alt="">':esc(String(u.displayName||u.username||"O").slice(0,1).toUpperCase()))+'</span><span><b>'+esc(u.displayName||u.username)+'</b><span>@'+esc(u.username||"user")+' · person</span></span></button>'});
        rows=rows.concat(communities.slice(0,6).map(function(c){return '<button class="orbit3-result" data-v3-community><span class="orbit3-avatar">'+(c.iconUrl?'<img src="'+esc(c.iconUrl)+'" alt="">':"◎")+'</span><span><b>'+esc(c.name)+'</b><span>'+esc(c.description||"ORBIT community")+'</span></span></button>'}));
        box.innerHTML=rows.length?rows.join(""):'<div class="orbit3-empty">No matching people or worlds.</div>';
        box.querySelectorAll("[data-v3-result]").forEach(function(b){b.onclick=function(){close();navigate("messages")}});
        box.querySelectorAll("[data-v3-community]").forEach(function(b){b.onclick=function(){close();navigate("communities")}});
      }).catch(function(){box.innerHTML='<div class="orbit3-empty">Search is temporarily unavailable.</div>'})
    })},180);
  }

  function navigate(view){
    var b=document.querySelector('#nav [data-view="'+view+'"]');
    if(b)b.click();
    else if(view==="live"||view==="worlds")open(view==="worlds"?"worlds":"command");
  }

  function renderWorlds(body){
    body.innerHTML='<div class="orbit3-card-head"><div><span class="orbit3-kicker">COMMUNITIES REIMAGINED</span><h3>Your ORBIT Worlds</h3><p>Every community becomes a living destination with its own identity, rhythm and people.</p></div><span class="orbit3-pill"><i class="orbit3-live-dot"></i> LIVE MAP</span></div><div id="orbit3WorldList" class="orbit3-worlds"><div class="orbit3-empty">Loading your worlds…</div></div><div class="orbit3-card" style="margin-top:12px"><div class="orbit3-card-head"><div><span class="orbit3-kicker">WORLD DESIGN</span><h3>Make every space feel different.</h3><p>World visuals are ready for the next layer: backgrounds, identity colors, events and live presence.</p></div><button class="orbit3-close" id="orbit3Back" style="width:auto;padding:0 12px">Back</button></div></div>';
    var back=$("#orbit3Back");if(back)back.onclick=function(){state.mode="command";render()};
    safeRun(function(){return fetch("/api/communities",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(d){
      var rows=Array.isArray(d.communities)?d.communities:[];
      var list=$("#orbit3WorldList");if(!list)return;
      if(!rows.length){list.innerHTML='<div class="orbit3-empty">No communities yet. Create or join a world from the Communities section.</div>';return}
      list.innerHTML=rows.map(function(c){return '<button class="orbit3-world" data-world="'+esc(c.id)+'"><span class="orbit3-world-icon">'+(c.iconUrl?'<img src="'+esc(c.iconUrl)+'" alt="">':esc(String(c.name||"O").slice(0,1).toUpperCase()))+'</span><span style="min-width:0;text-align:left"><span class="orbit3-world-name">'+esc(c.name)+'</span><span class="orbit3-world-meta">'+Number(c.memberCount||0)+' members · '+esc(c.role||"member")+'</span></span></button>'}).join("");
      list.querySelectorAll("[data-world]").forEach(function(b){b.onclick=function(){close();navigate("communities")}})
    }).catch(function(){var list=$("#orbit3WorldList");if(list)list.innerHTML='<div class="orbit3-empty">World data could not be loaded. Your existing communities are still available.</div>'})});
  }

  function applyTheme(v){
    ["void","aurora","ice","solar"].forEach(function(x){document.body.classList.remove("orbit3-theme-"+x)});
    if(v!=="void")document.body.classList.add("orbit3-theme-"+v);
    try{localStorage.setItem("orbit3-theme",v)}catch(e){}
    toastSafe("ORBIT Theme",v.charAt(0).toUpperCase()+v.slice(1)+" activated");
  }
  function renderThemes(body){
    body.innerHTML='<div class="orbit3-card-head"><div><span class="orbit3-kicker">VISUAL IDENTITY</span><h3>Choose your ORBIT atmosphere</h3><p>This layer changes presentation only. Your account, messages and communities remain untouched.</p></div><button class="orbit3-close" id="orbit3Back" style="width:auto;padding:0 12px">Back</button></div><div class="orbit3-theme-row">'+["void","aurora","ice","solar"].map(function(x){return '<button class="orbit3-theme" data-v3theme="'+x+'"><strong>'+x.toUpperCase()+'</strong></button>'}).join("")+'</div><section class="orbit3-card" style="margin-top:14px"><h3>Identity stack</h3><p>Combine this with your existing profile frame, effect, nameplate and chat theme in ORBIT Studio.</p></section>';
    var current="void";try{current=localStorage.getItem("orbit3-theme")||"void"}catch(e){}
    body.querySelectorAll("[data-v3theme]").forEach(function(b){b.addEventListener("click",function(){applyTheme(b.getAttribute("data-v3theme"));current=b.getAttribute("data-v3theme")})});
    var back=$("#orbit3Back");if(back)back.onclick=function(){state.mode="command";render()};
  }

  function installSurface(){
    var top=document.querySelector(".top-actions");
    if(top&&!top.querySelector("[data-orbit3-launcher]")){
      var b=document.createElement("button");b.className="top-action orbit3-btn";b.dataset.orbit3Launcher="1";b.textContent="◉ ORBIT 3.0";b.title="Open ORBIT 3.0 Command Center";
      b.addEventListener("click",function(){open("command")});top.insertBefore(b,top.firstChild);
    }
    var nav=document.querySelector("#nav");
    if(nav&&!nav.querySelector("[data-orbit3-nav]")){
      var b2=document.createElement("button");b2.className="nav-item orbit3-nav-item";b2.dataset.orbit3Nav="1";b2.type="button";
      b2.innerHTML='<span class="nav-icon">✦</span><span class="nav-text">Live Spaces</span><i class="orbit3-live-dot"></i>';
      b2.addEventListener("click",function(){open("worlds")});nav.appendChild(b2);
    }
  }

  document.addEventListener("keydown",function(e){
    if(e.ctrlKey&&e.key.toLowerCase()==="k"){e.preventDefault();e.stopImmediatePropagation();open("command")}
    if(e.key==="Escape"&&state.open)close();
  },true);

  var mo=new MutationObserver(function(){installSurface()});
  mo.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installSurface);else installSurface();

  try{var saved=localStorage.getItem("orbit3-theme");if(saved&&saved!=="void")document.body.classList.add("orbit3-theme-"+saved)}catch(e){}
})();