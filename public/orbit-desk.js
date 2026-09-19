/* ORBIT HOME — familiar community lobby, Discord-inspired information architecture */
(function(){
  "use strict";
  if(window.__orbitHomeSimpleInstalled)return;
  window.__orbitHomeSimpleInstalled=true;

  const q=s=>document.querySelector(s);
  const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const liveUsers=()=> (pulseState?.users||[]).filter(u=>String(u.status||"online").toLowerCase()!=="offline");
  const liveCalls=()=> (pulseState?.calls||[]);
  const go=v=>{try{setView(v)}catch(e){console.warn(e)}};
  const chat=()=>{try{goChat()}catch(e){console.warn(e)}};

  function userRow(u,compact=false){
    const name=u.display_name||u.username||"Guest";
    const state=u.activity||u.status||"Online";
    return '<button class="oh-user-row" data-oh-user="'+esc(u.id||"")+'">'+
      '<span class="oh-avatar">'+esc(avatar(u.username||"G"))+'</span>'+
      '<span class="oh-user-copy"><strong>'+esc(name)+'</strong><span>'+esc(state)+'</span></span>'+
      (compact?'':'<span class="oh-user-action">Message</span>')+
      '</button>';
  }

  function callCard(c){
    const people=(c.participants||[]).length||0;
    return '<button class="oh-active-card" data-oh-call="'+esc(c.channelId||"")+'">'+
      '<div class="oh-active-head"><span class="oh-active-title"><b class="oh-live-dot"></b>'+esc(c.channelName||"Live room")+'</span><span class="oh-live-pill">LIVE</span></div>'+
      '<div class="oh-active-screen"><div class="oh-screen-top"><span></span><span></span><span></span><i></i></div><div class="oh-screen-lines"><b></b><b></b><b></b><b></b><b></b></div><div class="oh-screen-caption">'+esc(c.mode==="voice"?"Voice room":"Screen sharing")+'</div></div>'+
      '<div class="oh-active-foot"><span>◉ '+people+' '+(people===1?'person':'people')+'</span><span>Join</span></div>'+
      '</button>';
  }

  async function renderOrbitHome(){
    const body=q("#page-body"); if(!body)return;
    const users=liveUsers().slice(0,16);
    const calls=liveCalls().slice(0,2);
    const current=currentServer||null;
    const meName=me?.display_name||me?.username||"Guest";
    const friendsData=await (async()=>{try{return await api("/api/friends")}catch(e){return {friends:[]}}})();
    const friends=(friendsData.friends||[]).slice(0,8);
    const online=friends.filter(u=>String(u.status||"").toLowerCase()!=="offline").slice(0,8);

    q("#page-actions").innerHTML='<button class="oh-top-btn" id="oh-add-friend">Add Friend</button>';

    body.innerHTML='<div class="orbit-home-simple">'+
      '<div class="oh-homebar">'+
        '<div class="oh-home-tabs">'+
          '<button class="oh-tab active">Friends</button>'+
          '<button class="oh-tab" id="oh-online">Online</button>'+
          '<button class="oh-tab" id="oh-all">All</button>'+
          '<button class="oh-tab" id="oh-pending">Pending <span class="oh-badge">0</span></button>'+
          '<button class="oh-tab" id="oh-suggested">Suggestions</button>'+
        '</div>'+
        '<button class="oh-top-btn primary" id="oh-add-friend-2">Add Friend</button>'+
      '</div>'+
      '<div class="oh-columns">'+
        '<main class="oh-main">'+
          '<div class="oh-notice"><span class="oh-notice-icon">i</span><div><strong>Welcome to Orbit</strong><span>Your communities, friends, messages and live rooms stay connected here.</span></div><button id="oh-notice-close">×</button></div>'+
          '<div class="oh-search"><span>⌕</span><input id="oh-friend-search" placeholder="Search friends, communities, or conversations" autocomplete="off"></div>'+
          '<section class="oh-section"><div class="oh-section-head"><div><strong>Online — '+online.length+'</strong><span>People currently around you</span></div><button id="oh-open-friends">View All</button></div>'+
            '<div class="oh-user-list" id="oh-online-list">'+
              (online.length?online.map(u=>userRow(u)).join(""):(users.length?users.slice(0,6).map(u=>userRow(u)).join(""):'<div class="oh-empty"><strong>Nobody is online yet</strong><span>Invite people to Orbit and they will appear here.</span></div>'))+
            '</div>'+
          '</section>'+
          '<section class="oh-section"><div class="oh-section-head"><div><strong>Recent conversations</strong><span>Jump back into the people and places you use most</span></div><button id="oh-open-dms">Open Messages</button></div>'+
            '<div class="oh-recent-list">'+
              (friends.length?friends.slice(0,6).map(u=>userRow(u)).join(""):'<div class="oh-empty"><strong>No conversations yet</strong><span>Start a message from the Messages page.</span></div>')+
            '</div>'+
          '</section>'+
        '</main>'+
        '<aside class="oh-side">'+
          '<section class="oh-side-card"><div class="oh-side-head"><strong>Active Now</strong><button id="oh-open-calls">View All</button></div>'+
            '<div class="oh-side-body">'+
              (calls.length?calls.map(callCard).join(""):'<div class="oh-empty"><strong>No active rooms</strong><span>Voice, video and screen sharing will appear here.</span></div>')+
            '</div>'+
          '</section>'+
          '<section class="oh-side-card"><div class="oh-side-head"><strong>Your Space</strong><button id="oh-open-community">Open</button></div>'+
            '<div class="oh-space-card"><span class="oh-space-avatar">'+esc((current?.name||"O").slice(0,1).toUpperCase())+'</span><div><strong>'+esc(current?.name||"Orbit Lobby")+'</strong><span>'+esc(current?'Jump into your current community':'Choose a community from the left rail')+'</span></div></div>'+
            '<div class="oh-space-actions"><button id="oh-open-chat">Open Chat</button><button id="oh-open-events">Events</button></div>'+
          '</section>'+
          '<section class="oh-side-card oh-profile-card"><div class="oh-profile-row"><span class="oh-avatar large">'+esc(avatar(me?.username||"G"))+'</span><div><strong>'+esc(meName)+'</strong><span>@'+esc(me?.username||"guest")+'</span></div><button id="oh-profile">Edit</button></div></section>'+
        '</aside>'+
      '</div>'+
    '</div>';

    const addFriend=()=>{go("friends");setTimeout(()=>q("#friend-add-btn")?.click(),50)};
    q("#oh-add-friend").onclick=addFriend;
    q("#oh-add-friend-2").onclick=addFriend;
    q("#oh-online").onclick=()=>go("friends");
    q("#oh-all").onclick=()=>go("friends");
    q("#oh-pending").onclick=()=>go("friends");
    q("#oh-suggested").onclick=()=>go("friends");
    q("#oh-open-friends").onclick=()=>go("friends");
    q("#oh-open-dms").onclick=()=>go("dms");
    q("#oh-open-calls").onclick=()=>go("calls");
    q("#oh-open-community").onclick=()=>go("communities");
    q("#oh-open-chat").onclick=chat;
    q("#oh-open-events").onclick=()=>go("events");
    q("#oh-profile").onclick=()=>go("settings");
    q("#oh-notice-close").onclick=e=>e.currentTarget.closest(".oh-notice")?.remove();
    q("#oh-friend-search").oninput=e=>{
      const term=e.target.value.toLowerCase().trim();
      document.querySelectorAll(".oh-user-row").forEach(row=>row.style.display=!term||row.innerText.toLowerCase().includes(term)?"flex":"none");
    };

    document.querySelectorAll("[data-oh-user]").forEach(b=>b.onclick=()=>openPulseProfile(b.dataset.ohUser));
    document.querySelectorAll("[data-oh-call]").forEach(b=>b.onclick=async()=>{
      const c=calls.find(x=>String(x.channelId)===String(b.dataset.ohCall));if(!c)return;
      const s=servers.find(x=>String(x.id)===String(c.serverId));if(s)await selectServer(s);
      const ch=(channels||[]).find(x=>String(x.id)===String(c.channelId));if(ch)await selectChannel(ch);
      chat();
    });
  }

  const base=window.renderHomePage;
  if(typeof base==="function"&&!base.__orbitHomeSimple){
    function wrapped(){
      base.apply(this,arguments);
      renderOrbitHome().catch(e=>console.warn("Orbit Home",e));
    }
    wrapped.__orbitHomeSimple=true;
    window.renderHomePage=wrapped;
  }
  setTimeout(()=>{try{if(orbitUI?.view==="home")renderOrbitHome()}catch(e){}},0);
})();
