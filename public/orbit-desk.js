/* ORBIT SOCIAL — community first home */
(function(){
  "use strict";
  if(window.__orbitSocialInstalled)return;
  window.__orbitSocialInstalled=true;

  const q=s=>document.querySelector(s);
  const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const liveUsers=()=> (pulseState?.users||[]).filter(u=>String(u.status||"online").toLowerCase()!=="offline");
  const liveCalls=()=> (pulseState?.calls||[]);
  const activity=()=> (pulseState?.activity||[]);
  const go=v=>{try{setView(v)}catch(e){console.warn(e)}};
  const chat=()=>{try{goChat()}catch(e){console.warn(e)}};

  function personMarkup(u){
    return '<button class="osocial-person" data-social-user="'+esc(u.id)+'">'+
      '<span class="osocial-avatar">'+esc(avatar(u.username||"G"))+'</span>'+
      '<span class="osocial-person-copy"><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>'+esc(u.activity||u.status||"Online")+'</span></span>'+
      '<i class="osocial-online-dot"></i></button>';
  }

  function activityMarkup(a){
    const u=a.user||{};let text="active in Orbit";
    if(a.type==="message")text="messaged #"+(a.channelName||"channel");
    if(a.type==="call-start")text="joined "+(a.mode==="voice"?"voice":"video")+" in #"+(a.channelName||"room");
    if(a.type==="call-end")text="left #"+(a.channelName||"room");
    if(a.type==="screen-share")text="started screen sharing";
    if(a.type==="presence")text=(a.activity||u.status||"online");
    return '<button class="osocial-row" data-social-user="'+esc(u.id||"")+'"><span class="osocial-row-icon">✦</span><span class="osocial-row-main"><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>'+esc(text)+(a.preview?' · '+esc(a.preview):"")+'</span></span><span class="osocial-row-end">'+formatPulseTime(a.createdAt)+'</span></button>';
  }

  async function renderSocial(){
    const body=q("#page-body"); if(!body)return;
    q("#page-actions").innerHTML='<button id="social-search">Search Orbit</button><button id="social-chat" class="primary">Open Space</button>';
    const users=liveUsers().slice(0,8),calls=liveCalls().slice(0,5),acts=activity().slice(0,7);
    const current=currentServer||null;
    const textChannels=(channels||[]).filter(c=>c.type!=="voice").slice(0,8);
    const communityCards=(servers||[]).slice(0,6);

    body.innerHTML='<div class="orbit-social">'+
      '<header class="osocial-header"><div class="osocial-brand"><div class="osocial-mark">◈</div><div class="osocial-brand-copy"><strong>ORBIT SOCIAL</strong><span>People · Communities · Conversations · Live</span></div></div><div class="osocial-actions"><button class="osocial-btn" id="social-discover">Discover</button><button class="osocial-btn" id="social-friends">Friends</button><button class="osocial-btn primary" id="social-new">New conversation</button></div></header>'+
      '<section class="osocial-hero"><div class="osocial-hero-copy"><span class="eyebrow">YOUR SOCIAL SPACE</span><h1>Stay close to your people.</h1><p>Orbit puts conversations, friendships, communities, profiles and live presence in one calm social home. No project boards, no busywork — just people and the places they gather.</p><div class="osocial-presence"><span class="osocial-pill"><b>'+users.length+'</b> online now</span><span class="osocial-pill"><b>'+calls.length+'</b> live rooms</span><span class="osocial-pill"><b>'+servers.length+'</b> communities</span><span class="osocial-pill"><b>@'+esc(me?.username||"guest")+'</b> your identity</span></div></div><div class="osocial-hero-actions"><button class="osocial-btn primary" id="social-open-chat">Open current Space →</button><button class="osocial-btn" id="social-start-call">Start a live room</button><button class="osocial-btn" id="social-profile">My profile</button></div></section>'+
      '<div class="osocial-grid">'+
        '<main class="osocial-main">'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Live together</strong><span>People who are here right now</span></div><button class="osocial-link" id="social-view-calls">View live rooms</button></div><div class="osocial-live"><div class="osocial-people"><div class="osocial-people-grid">'+(users.length?users.map(personMarkup).join(""):'<div class="osocial-empty"><strong>No one else is online</strong>Invite your friends and community members to Orbit.</div>')+'</div></div><div class="osocial-rooms">'+(calls.length?calls.map(c=>'<button class="osocial-room" data-social-call="'+esc(c.channelId)+'"><span class="osocial-room-icon">◉</span><span class="osocial-room-copy"><strong>#'+esc(c.channelName||"room")+'</strong><span>'+esc(c.mode==="voice"?"Voice":"Video")+' · '+((c.participants||[]).length||0)+' people</span></span><span class="osocial-room-join">Join</span></button>').join(""):'<div class="osocial-empty"><strong>No live rooms</strong>Start voice or video when you want to hang out.</div>')+'</div></div></section>'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Your communities</strong><span>Jump straight to the people you follow</span></div><button class="osocial-link" id="social-view-communities">All communities</button></div><div class="osocial-discovery">'+(communityCards.length?communityCards.map(s=>'<div class="osocial-community-card"><span class="osocial-avatar">'+esc((s.name||"O").slice(0,1).toUpperCase())+'</span><strong>'+esc(s.name||"Community")+'</strong><span>'+Number(s.memberCount||0)+' members</span><button class="osocial-btn" data-social-community="'+esc(s.id)+'">Open community</button></div>').join(""):'<div class="osocial-empty"><strong>Your community list is empty</strong>Create a community to start your first social space.</div>')+'</div></section>'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Recent conversations</strong><span>What your social graph is doing</span></div><button class="osocial-link" id="social-view-activity">Open activity</button></div><div class="osocial-activity-list">'+(acts.length?acts.map(activityMarkup).join(""):'<div class="osocial-empty"><strong>No recent activity</strong>New messages, calls and presence changes will appear here.</div>')+'</div></section>'+
        '</main>'+
        '<aside class="osocial-side">'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>People you know</strong><span>Friends and connections</span></div><button class="osocial-link" id="social-friends-2">Friends</button></div><div id="social-friend-list" class="osocial-friend-list"><div class="osocial-empty"><strong>Loading friends…</strong></div></div></section>'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Upcoming</strong><span>'+(current?esc(current.name):"Choose a community")+'</span></div><button class="osocial-link" id="social-events">Events</button></div><div id="social-event-list" class="osocial-event-list"><div class="osocial-empty"><strong>Loading events…</strong></div></div></section>'+
          '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Spaces</strong><span>Jump directly into conversation</span></div><button class="osocial-link" id="social-space-settings">Manage</button></div><div class="osocial-channel-list">'+(textChannels.length?textChannels.map(c=>'<button class="osocial-channel" data-social-channel="'+esc(c.id)+'"><b># '+esc(c.name)+'</b><span>Open</span></button>').join(""):'<div class="osocial-empty"><strong>No text spaces</strong>Select a community first.</div>')+'</div></section>'+
        '</aside>'+
      '</div>'+
      '<div class="osocial-bottom">'+
        '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Make your profile yours</strong><span>Identity is part of the community</span></div><button class="osocial-link" id="social-profile-2">Customize</button></div><div class="osocial-community-list"><div class="osocial-row" id="social-profile-row"><span class="osocial-avatar">'+esc(avatar(me?.username||"G"))+'</span><span class="osocial-row-main"><strong>'+esc(me?.display_name||me?.username||"Guest")+'</strong><span>@'+esc(me?.username||"guest")+' · '+esc(orbitUI?.profile?.bio||"Add a bio, avatar and presence to be recognizable.")+'</span></span><span class="osocial-row-end">Profile →</span></div></div></section>'+
        '<section class="osocial-card"><div class="osocial-card-head"><div><strong>Community discovery</strong><span>Find a new place to belong</span></div><button class="osocial-link" id="social-discover-2">Explore</button></div><div class="osocial-community-list"><div class="osocial-row" id="social-discover-row"><span class="osocial-row-icon">✦</span><span class="osocial-row-main"><strong>Discover communities</strong><span>Explore gaming, creative, tech, study and social spaces.</span></span><span class="osocial-row-end">Explore →</span></div></div></section>'+
      '</div>'+
    '</div>';

    q("#social-search").onclick=()=>openSearchModal("");
    q("#social-chat").onclick=chat;
    q("#social-open-chat").onclick=chat;
    q("#social-new").onclick=()=>{chat();q("#message")?.focus()};
    q("#social-start-call").onclick=()=>{chat(); if(currentChannel?.type==="voice")startCall("video"); else orbitToast("Live room","Open a Voice Space first, then start video.","error")};
    q("#social-profile").onclick=()=>{go("settings");setTimeout(()=>renderSettingsPage("profile"),0)};
    q("#social-profile-2").onclick=q("#social-profile-row").onclick=q("#social-profile").onclick;
    q("#social-discover").onclick=q("#social-discover-2").onclick=q("#social-discover-row").onclick=()=>go("discover");
    q("#social-friends").onclick=q("#social-friends-2").onclick=()=>go("friends");
    q("#social-events").onclick=()=>go("events");
    q("#social-space-settings").onclick=()=>{if(currentServer)$("#workspace-menu")?.click();else go("communities")};
    q("#social-view-calls").onclick=()=>go("calls");
    q("#social-view-communities").onclick=()=>go("communities");
    q("#social-view-activity").onclick=()=>go("notifications");

    document.querySelectorAll("[data-social-user]").forEach(b=>b.onclick=()=>openPulseProfile(b.dataset.socialUser));
    document.querySelectorAll("[data-social-community]").forEach(b=>b.onclick=async()=>{
      const s=servers.find(x=>String(x.id)===String(b.dataset.socialCommunity));if(!s)return;
      await selectServer(s);goChat();
    });
    document.querySelectorAll("[data-social-channel]").forEach(b=>b.onclick=async()=>{
      const c=(channels||[]).find(x=>String(x.id)===String(b.dataset.socialChannel));if(c){await selectChannel(c);chat()}
    });
    document.querySelectorAll("[data-social-call]").forEach(b=>b.onclick=async()=>{
      const c=calls.find(x=>String(x.channelId)===String(b.dataset.socialCall));if(!c)return;
      const s=servers.find(x=>String(x.id)===String(c.serverId));if(s)await selectServer(s);
      const ch=(channels||[]).find(x=>String(x.id)===String(c.channelId));if(ch)await selectChannel(ch);
      chat();
      startCall(c.mode==="voice"?"voice":"video");
    });

    try{
      const [fd,ed]=await Promise.all([
        api("/api/friends"),
        current?api("/api/servers/"+encodeURIComponent(current.id)+"/events?upcoming=1"):Promise.resolve({events:[]})
      ]);
      const friends=(fd.friends||[]).slice(0,6);
      q("#social-friend-list").innerHTML=friends.length?friends.map(u=>'<button class="osocial-row" data-friend-dm="'+esc(u.username)+'"><span class="osocial-avatar">'+esc(avatar(u.username))+'</span><span class="osocial-row-main"><strong>'+esc(u.display_name||u.username)+'</strong><span>'+esc(u.status||"offline")+' · @'+esc(u.username)+'</span></span><span class="osocial-row-end">Message</span></button>').join(""):'<div class="osocial-empty"><strong>No friends yet</strong>Add friends from the Friends page and they will appear here.</div>';
      document.querySelectorAll("[data-friend-dm]").forEach(b=>b.onclick=async()=>{try{await api("/api/dms",{method:"POST",body:JSON.stringify({username:b.dataset.friendDm})});go("dms");renderDMPage()}catch(e){orbitToast("DM failed",e.message,"error")}});
      const events=(ed.events||[]).slice(0,4);
      q("#social-event-list").innerHTML=events.length?events.map(e=>{const d=new Date(e.when);return '<button class="osocial-row" data-social-event="1"><span class="osocial-row-icon">◷</span><span class="osocial-row-main"><strong>'+esc(e.title)+'</strong><span>'+esc(e.type||"Community")+' · '+Number(e.rsvpCount||0)+' going</span></span><span class="osocial-row-end">'+(Number.isNaN(d.getTime())?"":d.toLocaleDateString([],{month:"short",day:"numeric"}))+'</span></button>}).join(""):'<div class="osocial-empty"><strong>No upcoming events</strong>'+(current?'Start something for the community.':'Choose a community to see events.')+'</div>';
      q("#social-event-list").querySelectorAll("[data-social-event]").forEach(b=>b.onclick=()=>go("events"));
    }catch(e){
      q("#social-friend-list").innerHTML='<div class="osocial-empty"><strong>Friends unavailable</strong>Open Friends to connect.</div>';
      q("#social-event-list").innerHTML='<div class="osocial-empty"><strong>Events unavailable</strong>Open Events to see community activity.</div>';
    }
  }

  const base=window.renderHomePage;
  if(typeof base==="function"&&!base.__orbitSocial){
    function wrapped(){
      base.apply(this,arguments);
      renderSocial().catch(e=>console.warn("Orbit Social",e));
    }
    wrapped.__orbitSocial=true;
    window.renderHomePage=wrapped;
  }
  setTimeout(()=>{try{if(orbitUI?.view==="home")renderSocial()}catch(e){}},0);
})();