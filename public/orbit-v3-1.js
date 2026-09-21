(function(){
  "use strict";
  if(window.__ORBIT31_LOADED__) return;
  window.__ORBIT31_LOADED__=true;

  var state={mode:"presence",open:false,users:[],notifications:[],socket:null};
  var $=function(s){return document.querySelector(s)};
  var esc=function(v){return String(v==null?"":v).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})};
  var safe=function(fn){try{return Promise.resolve(fn()).catch(function(){})}catch(e){return Promise.resolve()}};
  function layer(){
    var el=$("#orbit31Layer");if(el)return el;
    el=document.createElement("div");el.id="orbit31Layer";el.className="orbit31-backdrop";el.hidden=true;el.setAttribute("aria-hidden","true");
    el.innerHTML='<div class="orbit31-panel" role="dialog" aria-modal="true" aria-label="ORBIT live layer"><header class="orbit31-head"><div><span class="orbit31-kicker">ORBIT 3.1 · LIVE SYSTEM</span><strong class="orbit31-title" id="orbit31Title">Live Presence</strong></div><button class="orbit31-close" id="orbit31Close" aria-label="Close">×</button></header><div class="orbit31-body" id="orbit31Body"></div></div>';
    document.body.appendChild(el);
    $("#orbit31Close").onclick=close;
    el.onclick=function(e){if(e.target===el)close()};
    return el;
  }
  function open(mode){state.mode=mode||"presence";state.open=true;var el=layer();el.hidden=false;el.setAttribute("aria-hidden","false");render()}
  function close(){state.open=false;var el=$("#orbit31Layer");if(el){el.hidden=true;el.setAttribute("aria-hidden","true")}}
  function setTitle(v){var t=$("#orbit31Title");if(t)t.textContent=v}
  function onlineUsers(){return state.users.filter(function(u){return u&&u.status==="online"})}
  function avatar(u){return '<span class="orbit31-avatar">'+(u&&u.avatarUrl?'<img src="'+esc(u.avatarUrl)+'" alt="">':esc(String(u&& (u.displayName||u.username)||"O").slice(0,1).toUpperCase()))+'</span>'}
  function render(){
    if(!state.open)return;
    var body=$("#orbit31Body");if(!body)return;
    if(state.mode==="activity"){setTitle("Activity Center");renderActivity(body);return}
    setTitle("Live Presence");renderPresence(body);
  }
  function renderPresence(body){
    body.innerHTML='<div class="orbit31-summary"><div class="orbit31-stat"><b id="o31Online">—</b><span>ONLINE NOW</span></div><div class="orbit31-stat"><b id="o31Updated">—</b><span>LIVE UPDATES</span></div><div class="orbit31-stat"><b id="o31Visible">—</b><span>VISIBLE PEOPLE</span></div></div><div id="o31PresenceList"><div class="orbit31-empty">Loading live presence…</div></div>';
    refreshPresence();
  }
  function refreshPresence(){
    safe(function(){return fetch("/api/presence",{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error("presence");return r.json()}).then(function(d){
      state.users=Array.isArray(d.users)?d.users:[];
      drawPresence();
    }).catch(function(){drawPresence(true)})});
  }
  function drawPresence(failed){
    var list=$("#o31PresenceList"),on=onlineUsers();
    if($("#o31Online"))$("#o31Online").textContent=on.length;
    if($("#o31Updated"))$("#o31Updated").textContent="LIVE";
    if($("#o31Visible"))$("#o31Visible").textContent=state.users.length;
    if(!list)return;
    if(!on.length){list.innerHTML='<div class="orbit31-empty">'+(failed?"Live presence is temporarily unavailable.":"Nobody else is online right now.")+'</div>';return}
    list.innerHTML='<div class="orbit31-list">'+on.map(function(u){return '<div class="orbit31-row">'+avatar(u)+'<div class="orbit31-main"><strong>'+esc(u.displayName||u.username)+'</strong><span>@'+esc(u.username||"user")+' · Level '+Number(u.level||1)+'</span></div><span class="orbit31-status"><i class="orbit31-dot"></i> Online</span></div>'}).join("")+'</div>';
  }
  function groupNotifications(){
    var map={};
    state.notifications.forEach(function(n){var k=String(n.kind||"system");if(!map[k])map[k]=[];map[k].push(n)});
    return map;
  }
  function renderActivity(body){
    body.innerHTML='<div class="orbit31-summary"><div class="orbit31-stat"><b id="o31Unread">—</b><span>UNREAD</span></div><div class="orbit31-stat"><b id="o31Total">—</b><span>RECENT EVENTS</span></div><div class="orbit31-stat"><b>LIVE</b><span>ACTIVITY STREAM</span></div></div><div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="orbit31-action" id="o31ReadAll">Mark all read</button></div><div id="o31ActivityList"><div class="orbit31-empty">Loading activity…</div></div>';
    safe(function(){return fetch("/api/notifications",{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error("notifications");return r.json()}).then(function(d){state.notifications=Array.isArray(d.notifications)?d.notifications:[];drawActivity()}).catch(function(){drawActivity(true)})});
    setTimeout(function(){var b=$("#o31ReadAll");if(b)b.onclick=function(){safe(function(){return fetch("/api/notifications/read",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"}}).then(function(){state.notifications.forEach(function(n){n.read=true});drawActivity()})})}},0);
  }
  function drawActivity(failed){
    var list=$("#o31ActivityList"),ns=state.notifications;
    var unread=ns.filter(function(n){return !n.read}).length;
    if($("#o31Unread"))$("#o31Unread").textContent=unread;
    if($("#o31Total"))$("#o31Total").textContent=ns.length;
    if(!list)return;
    if(!ns.length){list.innerHTML='<div class="orbit31-empty">'+(failed?"Activity is temporarily unavailable.":"No activity yet.")+'</div>';return}
    var groups=groupNotifications();
    var order=Object.keys(groups).sort(function(a,b){return groups[b].length-groups[a].length});
    list.innerHTML=order.map(function(k){return '<section class="orbit31-card" style="margin-bottom:10px;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:12px;background:#ffffff03"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span class="orbit31-kicker">'+esc(k.toUpperCase())+'</span><span class="orbit31-pill"></span></div><div class="orbit31-list">'+groups[k].slice(0,20).map(function(n){return '<article class="orbit31-row orbit31-notif"><div class="orbit31-avatar">'+esc((n.title||"O").slice(0,1).toUpperCase())+'</div><div class="orbit31-main"><strong>'+esc(n.title||"Notification")+'</strong><span>'+esc(n.body||"")+'</span></div><span class="orbit31-time">'+(n.created_at?new Date(n.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"")+'</span>'+(n.read?"":"<span class='orbit31-unread'>NEW</span>")+'</article>'}).join("")+'</div></section>'}).join("");
  }
  function install(){
    var top=document.querySelector(".top-actions");
    if(top&&!top.querySelector("[data-orbit31-presence]")){
      var b=document.createElement("button");b.className="top-action";b.dataset.orbit31Presence="1";b.innerHTML='<i class="orbit31-dot" style="display:inline-block;margin-right:6px"></i> Live';
      b.title="Open live presence";b.onclick=function(){open("presence")};top.insertBefore(b,top.firstChild);
    }
    if(top&&!top.querySelector("[data-orbit31-activity]")){
      var b2=document.createElement("button");b2.className="top-action";b2.dataset.orbit31Activity="1";b2.textContent="♢ Activity";b2.onclick=function(){open("activity")};top.insertBefore(b2,top.firstChild);
    }
    var nav=document.querySelector("#nav");
    if(nav&&!nav.querySelector("[data-orbit31-nav]")){
      var n=document.createElement("button");n.className="nav-item";n.dataset.orbit31Nav="1";n.type="button";n.innerHTML='<span class="nav-icon">◌</span><span class="nav-text">Activity</span>';n.onclick=function(){open("activity")};nav.appendChild(n);
    }
  }
  function bindSocket(){
    var S=window.__ORBIT_APP_STATE__;
    state.socket=S&&S.socket?S.socket:null;
    if(state.socket&&state.socket.on){
      state.socket.on("presence:update",function(payload){
        if(!payload||!payload.user)return;
        var id=payload.user.id;
        state.users=state.users.filter(function(u){return u.id!==id});
        var next=Object.assign({},payload.user,{status:payload.status||payload.user.status});
        state.users.push(next);
        if(state.open&&state.mode==="presence")drawPresence();
      });
      state.socket.on("notification:new",function(payload){
        var n=payload&&payload.notification;if(!n)return;
        state.notifications.unshift(n);
        if(state.open&&state.mode==="activity")drawActivity();
      });
    }
  }
  document.addEventListener("keydown",function(e){
    var key=e.key.toLowerCase();
    if(e.ctrlKey&&e.shiftKey&&key==="p"){e.preventDefault();e.stopPropagation();open("presence")}
    else if(e.ctrlKey&&e.shiftKey&&key==="a"){e.preventDefault();e.stopPropagation();open("activity")}
    else if(e.ctrlKey&&e.shiftKey&&key==="w"){e.preventDefault();e.stopPropagation();open("presence")}
    else if(e.key==="Escape"&&state.open){close()}
  },true);
  var mo=new MutationObserver(function(){install();bindSocket()});
  mo.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){install();bindSocket()});else{install();bindSocket()}
})();