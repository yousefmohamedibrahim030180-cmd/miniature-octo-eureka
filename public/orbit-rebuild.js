(() => {
  "use strict";
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const S={token:localStorage.getItem("orbit_token")||"",user:null,servers:[],server:null,channels:[],channel:null,dms:[],dm:null,friends:{friends:[],incoming:[],outgoing:[]},notifications:[],view:"home",socket:null,typing:null,call:null};

  const NAV=[
    ["home","⌂","Home"],["space","✦","Network"],["messages","◈","Messages"],["communities","◎","Communities"],
    ["live","◉","Live"],["discover","⌁","Explore"],["events","▣","Events"],["projects","◇","Projects"],["files","▱","Files"],["ai","✧","AI Assistant"],["settings","⚙","Settings"]
  ];
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const letter=u=>String(u?.display_name||u?.username||"G").slice(0,1).toUpperCase();
  const time=v=>{try{return new Date(v).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}catch{return""}};
  const date=v=>{try{return new Date(v).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return""}};
  const avatar=u=>'<span class="avatar">'+(u?.avatar_url?'<img src="'+esc(u.avatar_url)+'" alt="">':esc(letter(u)))+'</span>';

  async function api(url,o={}){
    const h={...(o.headers||{})}; if(S.token)h.Authorization="Bearer "+S.token;
    if(o.body&&!h["Content-Type"])h["Content-Type"]="application/json";
    const r=await fetch(url,{...o,headers:h,cache:"no-store"}),d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Request failed"); return d;
  }
  function toast(t,b="",kind=""){const n=document.createElement("div");n.className="toast";n.innerHTML="<strong>"+esc(t)+"</strong>"+(b?"<span>"+esc(b)+"</span>":"");$("#toast-stack").appendChild(n);setTimeout(()=>n.remove(),4000)}
  function saveAuth(d){S.token=d.token||"";S.user=d.user||null;localStorage.setItem("orbit_token",S.token)}
  function openModal(title,body){$("#modal-root").innerHTML='<div class="modal-bg" id="modal-bg"><div class="modal"><div class="modal-head"><strong>'+esc(title)+'</strong><button class="icon" id="modal-x">×</button></div><div class="modal-body">'+body+'</div></div></div>';$("#modal-x").onclick=closeModal;$("#modal-bg").onclick=e=>{if(e.target.id==="modal-bg")closeModal()}}
  function closeModal(){$("#modal-root").innerHTML=""}
  function empty(t,p){return'<div class="empty"><div class="empty-box"><h2>'+esc(t)+'</h2><p>'+esc(p)+'</p></div></div>'}
  function msg(m){return'<article class="msg">'+avatar({username:m.username})+'<div class="msg-body"><div class="msg-head"><strong>'+esc(m.username||"Guest")+'</strong><time>'+esc(time(m.created_at))+'</time></div><div class="msg-text">'+esc(m.content||"")+'</div></div></article>'}
  function row(u,action){return'<div class="row">'+avatar(u)+'<span class="row-main"><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>@'+esc(u.username||"")+" · "+esc(u.status||"offline")+'</span></span>'+(action?'<div class="row-actions">'+action+"</div>":"")+"</div>"}

  function renderNav(){
    $("#rail-nav").innerHTML=NAV.map(n=>'<button class="'+(S.view===n[0]?"active":"")+'" data-view="'+n[0]+'"><span class="nav-icon">'+n[1]+'</span><span class="nav-text">'+n[2]+'</span></button>').join("");
  }
  function chrome(){
    const u=S.user||{};
    $("#rail-avatar").outerHTML='<span class="avatar" id="rail-avatar">'+(u.avatar_url?'<img src="'+esc(u.avatar_url)+'" alt="">':esc(letter(u)))+'</span>';
    $("#rail-name").textContent=u.display_name||u.username||"Guest";$("#rail-handle").textContent="@"+(u.username||"guest");
    const unread=S.dms.reduce((a,d)=>a+Number(d.unreadCount||0),0),notes=S.notifications.filter(n=>!n.read).length;
    $("#message-count").textContent=unread||"";$("#notification-count").textContent=notes||"";
  }

  function setView(v){
    S.view=v;
    $("#top-title").textContent=({home:"Home",space:"Network",messages:"Messages",communities:"Communities",live:"Live",discover:"Explore",events:"Events",projects:"Projects",files:"Files",ai:"AI Assistant",settings:"Settings",friends:"Friends",notifications:"Notifications",channel:"Chat"}[v]||"Home");
    renderNav();renderContext();renderSurface();
  }

  function renderContext(){
    const c=$("#ctx-body");
    if(S.view==="messages"){renderDMContext(c);return}
    c.innerHTML='<div class="ctx-section"><div class="ctx-row"><span>WORKSPACE</span><button id="create-server">+</button></div><div class="workspace">'+avatar(S.server||{username:"O"})+'<div><strong>'+esc(S.server?.name||"Choose a community")+'</strong><small>'+esc(S.server?.role||"No workspace")+'</small></div></div></div>'+
      '<div class="ctx-section"><input class="ctx-input" id="ctx-filter" placeholder="Search channels"></div>'+
      '<div class="ctx-section"><div class="ctx-row"><span>CHANNELS</span><button id="create-channel">+</button></div><div id="text-channels" class="channels"></div></div>'+
      '<div class="ctx-section"><div class="ctx-row"><span>VOICE</span></div><div id="voice-channels" class="channels"></div></div>'+
      '<button class="ctx-action" id="join-server">↗ Join server</button><button class="ctx-action" id="my-profile">◉ My profile</button>';
    $("#create-server").onclick=openCreateServer;$("#create-channel").onclick=openCreateChannel;$("#join-server").onclick=openJoinServer;$("#my-profile").onclick=()=>{S.settingsTab="profile";setView("settings")};
    $("#ctx-filter").oninput=e=>{$$("#text-channels .channel,#voice-channels .channel").forEach(b=>b.style.display=!e.target.value||b.textContent.toLowerCase().includes(e.target.value.toLowerCase())?"flex":"none")};
    renderChannels()
  }
  function renderDMContext(c){
    c.innerHTML='<div class="ctx-section"><div class="ctx-row"><span>MESSAGING</span><button id="new-dm-context">+</button></div><button class="ctx-action" id="ctx-friends">◎ Friends</button><button class="ctx-action" id="ctx-new-dm">＋ New conversation</button></div><div class="ctx-section"><div class="ctx-row"><span>RECENT</span></div><div class="channels" id="dm-context-list"></div></div>';
    $("#new-dm-context").onclick=openNewDM;$("#ctx-new-dm").onclick=openNewDM;$("#ctx-friends").onclick=()=>setView("home");
    $("#dm-context-list").innerHTML=S.dms.map(d=>'<button class="channel" data-dm-context="'+esc(d.id)+'"><span class="symbol">◈</span><span>'+esc(d.otherUser?.display_name||d.otherUser?.username||"Conversation")+'</span></button>').join("")||'<span class="muted" style="font-size:8px;padding:8px">No conversations.</span>';
    $$("[data-dm-context]").forEach(b=>b.onclick=()=>openDM(b.dataset.dmContext))
  }
  function renderChannels(){
    const txt=S.channels.filter(c=>c.type!=="voice"),voice=S.channels.filter(c=>c.type==="voice");
    $("#text-channels").innerHTML=txt.map(c=>'<button class="channel '+(String(S.channel?.id)===String(c.id)?"active":"")+'" data-channel="'+esc(c.id)+'"><span class="symbol">#</span><span>'+esc(c.name)+'</span></button>').join("")||'<span class="muted" style="font-size:8px;padding:8px">No text channels.</span>';
    $("#voice-channels").innerHTML=voice.map(c=>'<button class="channel" data-channel="'+esc(c.id)+'"><span class="symbol">◉</span><span>'+esc(c.name)+'</span></button>').join("")||'<span class="muted" style="font-size:8px;padding:8px">No voice channels.</span>';
    $$("[data-channel]").forEach(b=>b.onclick=()=>openChannel(b.dataset.channel))
  }

  async function openChannel(id){
    const c=S.channels.find(x=>String(x.id)===String(id));
    if(!c)return;
    S.channel=c;
    setView("channel");
    if(c.type==="voice"){toast("Voice channel","Press Join voice to enter this room.");return;}
  }

  function renderDiscover(root){
    root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">DISCOVER</span><h1>Explore</h1><p>Explore the communities already connected to your Orbit.</p></div><button class="btn primary" id="discover-create">＋ Create community</button></div><div class="grid g2">'+S.servers.map(s=>'<section class="card pad"><span class="eyebrow">COMMUNITY</span><h3 style="font:600 15px Space Grotesk;margin:7px 0">'+esc(s.name)+'</h3><span class="muted" style="font-size:8px">'+esc(s.role||"member")+'</span><div class="actions" style="margin-top:12px"><button class="btn primary" data-discover-open="'+esc(s.id)+'">Open</button></div></section>').join("")+'</div></div>';
    $("#discover-create").onclick=openCreateServer;
    $("[data-discover-open]").forEach(b=>b.onclick=async()=>{await selectServer(b.dataset.discoverOpen);const c=S.channels.find(x=>x.type==="text")||S.channels[0];if(c)openChannel(c.id)});
  }

  function renderSurface(){
    const root=$("#surface");
    if(S.view==="discover"){renderDiscover(root);return}
    if(S.view==="channel"){renderChannel(root);return}
    if(S.view==="messages"){renderMessages(root);return}
    if(S.view==="communities"){renderCommunities(root);return}
    if(S.view==="space"){renderSpace(root);return}
    if(S.view==="friends"){renderFriends(root);return}
    if(S.view==="events"){renderEvents(root);return}
    if(S.view==="projects"){renderProjects(root);return}
    if(S.view==="files"){renderFiles(root);return}
    if(S.view==="ai"){renderAI(root);return}
    if(S.view==="live"){renderLive(root);return}
    if(S.view==="notifications"){renderNotifications(root);return}
    if(S.view==="settings"){renderSettings(root);return}
    renderHome(root)
  }

  async function renderHome(root){
    root.innerHTML='<div class="page"><section class="card hero"><span class="eyebrow">ORBIT COMMAND CENTER</span><h1>A completely rebuilt application surface.</h1><p>One shell, one active view, one navigation system. Communities, messages, realtime and calls stay on the existing backend.</p><div class="actions"><button class="btn primary" id="home-open-chat">Open chat</button><button class="btn" id="home-communities">Communities</button><button class="btn" id="home-settings">Settings</button></div></section><div class="grid g3" style="margin-top:12px"><div class="card pad"><span class="eyebrow">COMMUNITIES</span><div class="metric">'+S.servers.length+'</div><span class="muted" style="font-size:8px">Available workspaces</span></div><div class="card pad"><span class="eyebrow">CONVERSATIONS</span><div class="metric">'+S.dms.length+'</div><span class="muted" style="font-size:8px">Direct messages</span></div><div class="card pad"><span class="eyebrow">REALTIME</span><div class="metric" style="font-size:21px">'+(S.socket?.connected?"ONLINE":"CONNECTING")+'</div><span class="muted" style="font-size:8px">Socket connection</span></div></div><div class="grid g2" style="margin-top:12px"><section class="card"><div class="ctx-row"><span>RECENT DMS</span><button class="tiny" id="home-new-dm">+</button></div><div id="home-dm-list" class="list" style="padding:0 12px 12px"></div></section><section class="card"><div class="ctx-row"><span>ACTIVE PEOPLE</span><button class="tiny" id="home-refresh">↻</button></div><div id="home-people" class="list" style="padding:0 12px 12px"></div></section></div></div>';
    $("#home-open-chat").onclick=()=>{const ch=S.channels.find(c=>c.type==="text");if(ch)openChannel(ch.id);else setView("communities")};$("#home-communities").onclick=()=>setView("communities");$("#home-settings").onclick=()=>setView("settings");$("#home-new-dm").onclick=openNewDM;$("#home-refresh").onclick=loadPeople;
    renderHomeDMs();loadPeople()
  }
  function renderHomeDMs(){const r=$("#home-dm-list");if(!r)return;r.innerHTML=S.dms.slice(0,5).map(d=>'<button class="row" data-home-dm="'+esc(d.id)+'">'+avatar(d.otherUser||{})+'<span class="row-main"><strong>'+esc(d.otherUser?.display_name||d.otherUser?.username||"Conversation")+'</strong><span>'+esc(d.lastMessage?.content||"No messages yet")+'</span></span></button>').join("")||'<span class="muted" style="font-size:8px;padding:10px">No direct messages yet.</span>';$$("[data-home-dm]").forEach(b=>b.onclick=()=>openDM(b.dataset.homeDm))}
  async function loadPeople(){try{const d=await api("/api/pulse"),r=$("#home-people");if(r)r.innerHTML=(d.users||[]).filter(u=>u.status!=="offline").slice(0,6).map(u=>row(u)).join("")||'<span class="muted" style="font-size:8px;padding:10px">No active people.</span>}catch{}}

  async function renderChannel(root){
    if(!S.channel){root.innerHTML=empty("Choose a channel","Select a community channel.");return}
    root.innerHTML='<div class="chat"><header class="chat-head">'+avatar(S.server||{})+'<div class="chat-head-main"><strong># '+esc(S.channel.name)+'</strong><span>'+esc(S.channel.type==="voice"?"Voice room":"Realtime conversation")+'</span></div><div class="chat-actions">'+(S.channel.type==="voice"?'<button id="join-voice" class="chat-action">Join voice</button>':"")+'<button id="channel-people" class="chat-action">People</button><button id="channel-call" class="chat-action">Video</button></div></header><section class="messages" id="channel-messages">'+empty("Loading","Loading messages…")+'</section><div class="composer-wrap"><form class="composer" id="channel-form"><button class="tool" type="button" id="channel-tool">+</button><input id="channel-input" placeholder="Message #'+esc(S.channel.name)+'" autocomplete="off"><button class="send">Send</button></form></div></div>';
    $("#channel-form").onsubmit=e=>{e.preventDefault();sendChannel()};$("#channel-input").oninput=()=>{if(S.socket){S.socket.emit("typing",{channelId:S.channel.id,isTyping:true});clearTimeout(S.typing);S.typing=setTimeout(()=>S.socket.emit("typing",{channelId:S.channel.id,isTyping:false}),900)}};
    $("#channel-tool").onclick=()=>toast("Attachments","The rebuilt shell is ready for the upload module.");$("#channel-people").onclick=showMembers;$("#channel-call").onclick=()=>startCall("channel","video");$("#join-voice")?.addEventListener("click",()=>startCall("channel","voice"));
    loadChannelMessages()
  }
  async function loadChannelMessages(){try{const d=await api("/api/channels/"+encodeURIComponent(S.channel.id)+"/messages"),r=$("#channel-messages");r.innerHTML=(d.messages||[]).map(msg).join("")||empty("Start the conversation","This channel is waiting for its first message.");r.scrollTop=r.scrollHeight;S.socket?.emit("channel:join",S.channel.id)}catch(e){toast("Channel",e.message,"error")}}
  function sendChannel(){const i=$("#channel-input"),c=i?.value.trim();if(!c||!S.socket||!S.channel)return;S.socket.emit("message:send",{channelId:S.channel.id,content:c});i.value="";i.focus()}

  function renderMessages(root){
    root.innerHTML='<div class="dm"><aside class="dm-left"><div class="dm-search"><input id="dm-filter" placeholder="Find a conversation"></div><div id="dm-list" class="dm-list"></div></aside><section class="dm-right"><header class="dm-head"><div id="dm-avatar">'+avatar({username:"O"})+'</div><div class="dm-head-main"><strong id="dm-name">Select a conversation</strong><span id="dm-status">Private conversation</span></div><div class="chat-actions"><button id="dm-voice" class="chat-action">Voice</button><button id="dm-video" class="chat-action">Video</button></div></header><section id="dm-body" class="dm-body">'+empty("No conversation selected","Choose someone from the left.")+'</section><div class="composer-wrap"><form class="composer" id="dm-form"><input id="dm-input" placeholder="Write a message…"><button class="send">Send</button></form></div></section></div>';
    $("#dm-form").onsubmit=e=>{e.preventDefault();sendDM()};$("#dm-filter").oninput=e=>drawDms(e.target.value);$("#dm-voice").onclick=()=>startCall("dm","voice");$("#dm-video").onclick=()=>startCall("dm","video");drawDms("");
    if(S.dm)paintDM(S.dm.id)
  }
  function drawDms(q){const r=$("#dm-list");if(!r)return;q=(q||"").toLowerCase();r.innerHTML=S.dms.filter(d=>(d.otherUser?.display_name||d.otherUser?.username||"").toLowerCase().includes(q)).map(d=>'<button class="dm-item '+(String(S.dm?.id)===String(d.id)?"active":"")+'" data-open-dm="'+esc(d.id)+'">'+avatar(d.otherUser||{})+'<span class="dm-copy"><strong>'+esc(d.otherUser?.display_name||d.otherUser?.username||"Conversation")+'</strong><span>'+esc(d.lastMessage?.content||"No messages yet")+'</span></span></button>').join("")||'<span class="muted" style="padding:10px;font-size:8px">No conversations.</span>';$$("[data-open-dm]").forEach(b=>b.onclick=()=>openDM(b.dataset.openDm))}
  async function openDM(id){const d=S.dms.find(x=>String(x.id)===String(id));if(!d)return;S.dm=d;setView("messages");await paintDM(d.id)}
  async function paintDM(id){const d=S.dms.find(x=>String(x.id)===String(id));if(!d)return;S.dm=d;const u=d.otherUser||{};$("#dm-avatar").innerHTML=avatar(u);$("#dm-name").textContent=u.display_name||u.username||"Conversation";$("#dm-status").textContent=(u.status==="online"?"Online":"Offline")+" · @"+(u.username||"");try{const x=await api("/api/dms/"+encodeURIComponent(id)+"/messages"),r=$("#dm-body");r.innerHTML=(x.messages||[]).map(msg).join("")||empty("Start the conversation","Say hello.");r.scrollTop=r.scrollHeight;S.socket?.emit("dm:join",id);await api("/api/dms/"+encodeURIComponent(id)+"/read",{method:"POST"});d.unreadCount=0;chrome();drawDms($("#dm-filter")?.value||"")}catch(e){toast("Messages",e.message,"error")}}
  async function sendDM(){const i=$("#dm-input"),c=i?.value.trim();if(!c||!S.dm)return;try{await api("/api/dms/"+encodeURIComponent(S.dm.id)+"/messages",{method:"POST",body:JSON.stringify({content:c})});i.value="";i.focus()}catch(e){toast("Message",e.message,"error")}}

  async function renderCommunities(root){root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">NETWORK</span><h1>Communities</h1><p>Create or enter your workspaces.</p></div><div class="actions"><button class="btn primary" id="add-community">＋ Create</button><button class="btn" id="join-community">↗ Join</button></div></div><div id="communities" class="grid g2"></div></div>';$("#add-community").onclick=openCreateServer;$("#join-community").onclick=openJoinServer;$("#communities").innerHTML=S.servers.map(s=>'<section class="card pad">'+row({username:s.name,display_name:s.name},'<button class="tiny primary" data-open-server="'+esc(s.id)+'">Open</button>')+'</section>').join("")||empty("No communities","Create your first space.");$$("[data-open-server]").forEach(b=>b.onclick=async()=>{await selectServer(b.dataset.openServer);const c=S.channels.find(x=>x.type==="text")||S.channels[0];if(c)openChannel(c.id)})}
  function renderSpace(root){root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">ORBIT / SPACE</span><h1>Network</h1><p>Your connected communities in one surface.</p></div></div><div class="grid g3">'+S.servers.map(s=>'<section class="card pad"><span class="eyebrow">COMMUNITY</span><h3 style="font:600 15px Space Grotesk;margin:7px 0">'+esc(s.name)+'</h3><span class="muted" style="font-size:8px">'+esc(s.role||"member")+'</span><div class="actions" style="margin-top:12px"><button class="btn primary" data-space="'+esc(s.id)+'">Enter</button></div></section>').join("")+'</div></div>';$$("[data-space]").forEach(b=>b.onclick=async()=>{await selectServer(b.dataset.space);const c=S.channels.find(x=>x.type==="text")||S.channels[0];if(c)openChannel(c.id)})}

  async function renderFriends(root){try{S.friends=await api("/api/friends")}catch{}const f=S.friends;root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">SOCIAL GRAPH</span><h1>Friends</h1><p>Connections and requests.</p></div><button class="btn primary" id="add-friend">＋ Add friend</button></div><div class="grid g2"><section class="card"><div class="ctx-row"><span>FRIENDS</span></div><div class="list" style="padding:0 12px 12px">'+(f.friends||[]).map(u=>row(u,'<button class="tiny primary" data-friend="'+esc(u.id)+'">Message</button>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No friends yet.</span>'+'</div></section><section class="card"><div class="ctx-row"><span>REQUESTS</span></div><div class="list" style="padding:0 12px 12px">'+(f.incoming||[]).map(r=>row(r.fromUser||{},'<button class="tiny primary" data-accept="'+esc(r.id)+'">Accept</button><button class="tiny" data-reject="'+esc(r.id)+'">Decline</button>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No pending requests.</span>'+'</div></section></div></div>';$("#add-friend").onclick=openAddFriend;$$("[data-friend]").forEach(b=>b.onclick=()=>createDM(b.dataset.friend));$$("[data-accept]").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+b.dataset.accept+"/accept",{method:"POST"});renderFriends(root);toast("Friend added","Request accepted.","success")}catch(e){toast("Request",e.message,"error")}});$$("[data-reject]").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+b.dataset.reject+"/reject",{method:"POST"});renderFriends(root)}catch(e){}})}
  async function renderEvents(root){if(!S.server){root.innerHTML=empty("Select a community","Choose a community first.");return}root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">EVENTS</span><h1>Events</h1><p>Community schedule.</p></div><button class="btn primary" id="new-event">＋ Create</button></div><div id="event-list" class="list"></div></div>';$("#new-event").onclick=openEvent;if(!S.server)return;try{const d=await api("/api/servers/"+S.server.id+"/events?upcoming=true");$("#event-list").innerHTML=(d.events||[]).map(e=>row({username:"E",display_name:e.title},'<span class="muted" style="font-size:8px">'+esc(date(e.when))+'</span>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No upcoming events.</span>'}catch(e){toast("Events",e.message,"error")}}
  async function renderProjects(root){if(!S.server){root.innerHTML=empty("Select a community","Choose a community first.");return}root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">PROJECTS</span><h1>Projects</h1><p>Shared work and tasks.</p></div><button class="btn primary" id="new-project">＋ Create</button></div><div id="project-list" class="list"></div></div>';$("#new-project").onclick=openProject;try{const d=await api("/api/servers/"+S.server.id+"/projects");$("#project-list").innerHTML=(d.projects||[]).map(p=>row({username:"◇",display_name:p.name},'<span class="muted" style="font-size:8px">'+esc(p.description||"Shared project")+'</span>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No projects.</span>'}catch(e){toast("Projects",e.message,"error")}}
  async function renderFiles(root){root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">FILES</span><h1>Files</h1><p>Shared uploads.</p></div></div><div id="file-list" class="list"></div></div>';try{const d=await api("/api/files?limit=50");$("#file-list").innerHTML=(d.files||[]).map(f=>row({username:"▱",display_name:f.name},'<a class="tiny" href="'+esc(f.download_url)+'" target="_blank">Open</a>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No files yet.</span>'}catch(e){toast("Files",e.message,"error")}}
  async function renderLive(root){if(!S.server){root.innerHTML=empty("Select a community","Choose a community first.");return}root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">LIVE</span><h1>Live rooms</h1><p>Realtime rooms and broadcasts.</p></div></div><div id="live-list" class="list"></div></div>';try{const d=await api("/api/servers/"+S.server.id+"/live");$("#live-list").innerHTML=(d.sessions||[]).map(x=>row({username:"◉",display_name:x.title},'<button class="tiny primary" data-live="'+esc(x.channelId)+'">Join</button>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">No active live rooms.</span>';$$("[data-live]").forEach(b=>b.onclick=()=>{S.channel=S.channels.find(c=>String(c.id)===String(b.dataset.live));if(S.channel)startCall("channel","video")})}catch(e){toast("Live",e.message,"error")}}
  async function renderNotifications(root){try{const d=await api("/api/notifications");S.notifications=d.notifications||[];chrome()}catch{}root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">INBOX</span><h1>Notifications</h1><p>Requests, messages and system activity.</p></div><button class="btn" id="read-all">Mark all read</button></div><div class="list">'+(S.notifications.map(n=>row({username:n.type==="friend_request"?"◎":"♢",display_name:n.title||"Notification"},'<span class="muted" style="font-size:8px">'+esc(n.body||"")+'</span>')).join("")||'<span class="muted" style="padding:10px;font-size:8px">All clear.</span>')+'</div></div>';$("#read-all").onclick=async()=>{await api("/api/notifications/read",{method:"POST"});renderNotifications(root)}}
  async function renderAI(root){root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">ORBIT AI</span><h1>Assistant</h1><p>AI workspace connected to your Orbit context.</p></div></div><section class="card" style="max-width:900px;margin:auto"><div class="messages" id="ai-log" style="height:55vh"></div><div class="composer-wrap"><form class="composer" id="ai-form"><input id="ai-input" placeholder="Ask ORBIT…"><button class="send">Send</button></form></div></section></div>';$("#ai-log").innerHTML=empty("Start a conversation","Ask a question and ORBIT AI will respond.");$("#ai-form").onsubmit=e=>{e.preventDefault();sendAI()}}
  async function sendAI(){const i=$("#ai-input"),t=i.value.trim();if(!t)return;const log=$("#ai-log");if(log.querySelector(".empty"))log.innerHTML="";log.insertAdjacentHTML("beforeend",msg({username:"You",content:t,created_at:new Date().toISOString()}));i.value="";try{const d=await api("/api/ai/chat",{method:"POST",body:JSON.stringify({message:t,serverId:S.server?.id||null})});log.insertAdjacentHTML("beforeend",msg({username:"ORBIT",content:d.message||d.reply||"",created_at:new Date().toISOString()}));log.scrollTop=log.scrollHeight}catch(e){toast("AI",e.message,"error")}}

  function renderSettings(root){root.innerHTML='<div class="page"><div class="page-head"><div><span class="eyebrow">PREFERENCES</span><h1>Settings</h1><p>Manage your profile and session.</p></div></div><div class="grid g2"><section class="card pad"><div class="form"><label>Display name<input class="input" id="set-name" value="'+esc(S.user?.display_name||"")+'"></label><label>Bio<textarea class="textarea" id="set-bio">'+esc(S.user?.bio||"")+'</textarea></label><label>Activity<input class="input" id="set-activity" value="'+esc(S.user?.activity||"Online")+'"></label><button class="btn primary" id="save-settings">Save</button></div></section><section class="card pad"><span class="eyebrow">SESSION</span><h3 style="font:600 16px Space Grotesk">Account</h3><p class="muted" style="font-size:9px">Signed in as @'+esc(S.user?.username||"guest")+'</p><button class="btn danger" id="signout">Sign out</button></section></div></div>';$("#save-settings").onclick=async()=>{try{const d=await api("/api/me",{method:"PATCH",body:JSON.stringify({displayName:$("#set-name").value,bio:$("#set-bio").value,activity:$("#set-activity").value})});S.user=d.user;chrome();toast("Saved","Profile updated.","success")}catch(e){toast("Settings",e.message,"error")}};$("#signout").onclick=()=>{localStorage.removeItem("orbit_token");S.socket?.disconnect();location.reload()}}
  function showMembers(){if(!S.server)return;openModal("Members",'<div id="members" class="list"></div>');api("/api/servers/"+S.server.id+"/members").then(d=>{$("#members").innerHTML=(d.members||[]).map(u=>row(u)).join("")})}

  function openCreateServer(){openModal("Create community",'<form class="form" id="server-form"><label>Name<input class="input" id="server-name" required></label><button class="btn primary">Create</button></form>');$("#server-form").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/servers",{method:"POST",body:JSON.stringify({name:$("#server-name").value})});closeModal();await loadServers();await selectServer(d.server.id);toast("Community created","Workspace ready.","success")}catch(e){toast("Community",e.message,"error")}}}
  async function openCreateChannel(){if(!S.server){toast("Channel","Select a community first.","error");return}openModal("Create channel",'<form class="form" id="channel-form"><label>Name<input class="input" id="channel-name" required></label><label>Type<select class="select" id="channel-type"><option value="text">Text</option><option value="announcement">Announcement</option><option value="voice">Voice</option></select></label><button class="btn primary">Create</button></form>');$("#channel-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/servers/"+S.server.id+"/channels",{method:"POST",body:JSON.stringify({name:$("#channel-name").value,type:$("#channel-type").value})});closeModal();await selectServer(S.server.id);toast("Channel created","The new channel is ready.","success")}catch(e){toast("Channel",e.message,"error")}}}
  function openJoinServer(){openModal("Join community",'<form class="form" id="join-form"><label>Invite code<input class="input" id="invite-code" required></label><button class="btn primary">Join</button></form>');$("#join-form").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/invites/"+encodeURIComponent($("#invite-code").value.trim())+"/accept",{method:"POST"});closeModal();await loadServers();await selectServer(d.server_id);toast("Joined","Community added.","success")}catch(e){toast("Join",e.message,"error")}}}
  function openAddFriend(){openModal("Add friend",'<form class="form" id="friend-form"><label>Username<input class="input" id="friend-user" required placeholder="@username"></label><button class="btn primary">Send request</button></form>');$("#friend-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username:$("#friend-user").value})});closeModal();toast("Friend request","Request sent.","success")}catch(x){toast("Friend request",x.message,"error")}}}
  function openNewDM(){openModal("New conversation",'<form class="form" id="dm-form-new"><label>Username<input class="input" id="dm-user" required placeholder="@username"></label><button class="btn primary">Open</button></form>');$("#dm-form-new").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/dms",{method:"POST",body:JSON.stringify({username:$("#dm-user").value})});closeModal();await loadDMs();openDM(d.dm.id)}catch(x){toast("Conversation",x.message,"error")}}}
  function openEvent(){if(!S.server)return;openModal("Create event",'<form class="form" id="event-form"><label>Title<input class="input" id="event-title"></label><label>When<input class="input" id="event-when" type="datetime-local"></label><label>Type<select class="select" id="event-type"><option>Community</option><option>Gaming</option><option>Class</option><option>Meeting</option><option>Watch party</option><option>Voice</option><option>Video</option></select></label><button class="btn primary">Create</button></form>');$("#event-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/servers/"+S.server.id+"/events",{method:"POST",body:JSON.stringify({title:$("#event-title").value,when:new Date($("#event-when").value).toISOString(),type:$("#event-type").value})});closeModal();renderEvents($("#surface"));toast("Event created","Added to the schedule.","success")}catch(x){toast("Event",x.message,"error")}}}
  function openProject(){if(!S.server)return;openModal("Create project",'<form class="form" id="project-form"><label>Name<input class="input" id="project-name"></label><label>Description<textarea class="textarea" id="project-desc"></textarea></label><button class="btn primary">Create</button></form>');$("#project-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/servers/"+S.server.id+"/projects",{method:"POST",body:JSON.stringify({name:$("#project-name").value,description:$("#project-desc").value})});closeModal();renderProjects($("#surface"));toast("Project created","Shared project ready.","success")}catch(x){toast("Project",x.message,"error")}}}
  function openSearch(){openModal("Search ORBIT",'<input class="input" id="search-input" placeholder="Search users, channels and content"><div id="search-out" style="margin-top:10px"></div>');$("#search-input").oninput=async e=>{const q=e.target.value.trim(),out=$("#search-out");if(!q){out.innerHTML="";return}try{const d=await api("/api/search?q="+encodeURIComponent(q));out.innerHTML=(d.results||d.hits||d.users||[]).map(x=>'<div class="row"><span class="row-main"><strong>'+esc(x.username||x.name||x.title||"Result")+'</strong><span>'+esc(x.content||x.preview||"Orbit result")+'</span></span></div>').join("")||'<span class="muted" style="font-size:8px">No results.</span>'}catch(x){out.innerHTML='<span class="muted" style="font-size:8px">'+esc(x.message)+'</span>'}};$("#search-input").focus()}
  function openCommand(){openModal("Command center",'<div class="list">'+NAV.concat([["friends","◎","Friends"],["notifications","♢","Notifications"]]).map(n=>'<button class="row" data-command="'+n[0]+'"><span class="row-main"><strong>'+n[1]+" "+n[2]+'</strong><span>Open surface</span></span></button>').join("")+"</div>");$$("[data-command]").forEach(b=>b.onclick=()=>{closeModal();setView(b.dataset.command)})}

  async function loadServers(){const d=await api("/api/servers");S.servers=d.servers||[];if(!S.server&&S.servers[0])await selectServer(S.servers[0].id,false)}
  async function selectServer(id){const s=S.servers.find(x=>String(x.id)===String(id));if(!s)return;S.server=s;const d=await api("/api/servers/"+encodeURIComponent(s.id)+"/channels");S.channels=d.channels||[];S.channel=S.channels.find(c=>c.type==="text")||S.channels[0]||null;renderContext()}
  async function loadDMs(){try{const d=await api("/api/dms");S.dms=d.dms||[];chrome()}catch{}}
  async function loadNotifications(){try{const d=await api("/api/notifications");S.notifications=d.notifications||[];chrome()}catch{}}

  function connectSocket(){
    if(!S.token)return;
    S.socket=io({auth:{token:S.token},transports:["polling"]});
    S.socket.on("connect",()=>{$("#system-status").textContent="Realtime connected";if(S.view==="home")renderHome($("#surface"))});
    S.socket.on("connect_error",e=>{$("#system-status").textContent="Realtime auth failed";toast("Realtime",e.message,"error")});
    S.socket.on("message:new",m=>{if(String(m.channel_id)===String(S.channel?.id)){const r=$("#channel-messages");if(r){if(r.querySelector(".empty"))r.innerHTML="";r.insertAdjacentHTML("beforeend",msg(m));r.scrollTop=r.scrollHeight}}});
    S.socket.on("dm:message",m=>{const d=S.dms.find(x=>String(x.id)===String(m.dm_id));if(!d)return;d.lastMessage=m;if(String(S.dm?.id)===String(m.dm_id)){const r=$("#dm-body");if(r){if(r.querySelector(".empty"))r.innerHTML="";r.insertAdjacentHTML("beforeend",msg(m));r.scrollTop=r.scrollHeight}}else d.unreadCount=Number(d.unreadCount||0)+1;chrome()});
    S.socket.on("friend:request",()=>toast("Friend request","You have a new request.","success"));S.socket.on("friend:accepted",()=>toast("Friend added","A request was accepted.","success"));
    S.socket.on("error:toast",p=>toast("ORBIT",p?.message||"Realtime action failed","error"));
    S.socket.on("call:participants",p=>p.forEach(x=>peer(x.socketId,true,x)));
    S.socket.on("call:participant-joined",p=>peer(p.socketId,false,p));
    S.socket.on("call:participant-left",p=>removePeer(p.socketId));
    S.socket.on("rtc:offer",offer);S.socket.on("rtc:answer",answer);S.socket.on("rtc:ice",ice);
    S.socket.on("call:incoming",incoming);
    S.socket.on("dm:call:incoming",x=>incoming({...x,scope:"dm"}));
    S.socket.on("dm:call:accepted",x=>{if(S.call?.scope==="dm"){S.call.callId=x.callId;S.call.roomId=x.roomId;peer(x.participant?.socketId,true,x.participant)}});
    S.socket.on("dm:call:participants",p=>p.forEach(x=>peer(x.socketId,true,x)));
    S.socket.on("dm:call:participant-left",x=>{removePeer(x.socketId);endCall()});
    S.socket.on("dmrtc:offer",offer);S.socket.on("dmrtc:answer",answer);S.socket.on("dmrtc:ice",ice);
    S.socket.on("dm:call:declined",()=>{toast("Call","The call was declined.");endCall()});S.socket.on("dm:call:cancelled",endCall);
    S.socket.on("presence:update",()=>{if(S.view==="home")loadPeople()});
  }

  async function startCall(scope,mode){
    if(scope==="dm"&&!S.dm){toast("Call","Open a direct conversation first.","error");return}
    if(scope==="channel"&&!S.channel){toast("Call","Select a channel first.","error");return}
    const media=await localMedia(mode);if(!media)return;endCall(true);
    S.call={scope,mode,active:true,roomId:scope==="channel"?S.channel.id:null,dmId:scope==="dm"?S.dm.id:null,callId:null,local:media.stream,mic:media.mic,cam:media.cam,screen:null,peers:new Map()};
    $("#call-overlay").classList.remove("hidden");$("#call-title").textContent=scope==="dm"?(S.dm.otherUser?.display_name||"Private call"):S.channel.name;$("#call-subtitle").textContent=mode==="voice"?"Voice room":"Video room";renderCallStage();syncCall();
    if(scope==="channel")S.socket?.emit("call:join",{channelId:S.channel.id,mode});
    else S.socket?.emit("dm:call",{dmId:S.dm.id,mode},a=>{if(!a?.ok){toast("Call",a?.error||"Unable to start call","error");endCall()}else{S.call.callId=a.callId;S.call.roomId=a.roomId}});
  }
  async function localMedia(mode){try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==="video"});return{stream,mic:stream.getAudioTracks()[0]||null,cam:stream.getVideoTracks()[0]||null}}catch(e){toast("Media",e.message||"Allow microphone/camera access.","error");return null}}
  async function peer(id,init,user){if(!id||!S.call?.active)return;if(S.call.peers.has(id)){if(init)makeOffer(id);return}const pc=new RTCPeerConnection({iceServers:await iceServers()});const item={pc,pending:[]};S.call.peers.set(id,item);if(S.call.local)S.call.local.getTracks().forEach(t=>pc.addTrack(t,S.call.local));pc.onicecandidate=e=>{if(e.candidate)S.socket?.emit(rtc("ice"),{to:id,candidate:e.candidate})};pc.ontrack=e=>attachRemote(id,e.streams?.[0]||new MediaStream([e.track]),user);pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState))removePeer(id)};if(init)await makeOffer(id);return pc}
  function rtc(k){return S.call.scope==="dm"?"dmrtc:"+k:"rtc:"+k}
  async function makeOffer(id){const p=S.call.peers.get(id);if(!p)return;const o=await p.pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});await p.pc.setLocalDescription(o);S.socket?.emit(rtc("offer"),{to:id,offer:p.pc.localDescription})}
  async function offer(p){if(!S.call?.active)return;const pc=await peer(p.from,false,p.fromUser);await pc.setRemoteDescription(new RTCSessionDescription(p.offer));const item=S.call.peers.get(p.from);for(const c of item.pending.splice(0)){try{await pc.addIceCandidate(c)}catch{}}const a=await pc.createAnswer();await pc.setLocalDescription(a);S.socket?.emit(rtc("answer"),{to:p.from,answer:pc.localDescription})}
  async function answer(p){const item=S.call?.peers.get(p.from);if(!item)return;await item.pc.setRemoteDescription(new RTCSessionDescription(p.answer));for(const c of item.pending.splice(0)){try{await item.pc.addIceCandidate(c)}catch{}}}
  async function ice(p){const item=S.call?.peers.get(p.from);if(!item||!p.candidate)return;if(!item.pc.remoteDescription){item.pending.push(p.candidate);return}try{await item.pc.addIceCandidate(p.candidate)}catch{}}
  function renderCallStage(){const st=$("#call-stage");st.innerHTML='<div class="tile" data-peer="self">'+(S.call.cam?'<video autoplay muted playsinline></video>':'<span class="avatar" style="width:66px;height:66px">'+esc(letter(S.user))+'</span>')+'<span>YOU</span></div>';const v=st.querySelector("video");if(v){v.srcObject=S.call.local;v.play().catch(()=>{})}}
  function attachRemote(id,stream,u){let t=document.querySelector('.tile[data-peer="'+CSS.escape(id)+'"]');if(!t){t=document.createElement("div");t.className="tile";t.dataset.peer=id;t.innerHTML='<video autoplay playsinline></video><span>'+esc(u?.username||"REMOTE")+"</span>";$("#call-stage").appendChild(t)}t.querySelector("video").srcObject=stream}
  function removePeer(id){const p=S.call?.peers.get(id);if(p?.pc)try{p.pc.close()}catch{}S.call?.peers.delete(id);document.querySelector('.tile[data-peer="'+CSS.escape(id)+'"]')?.remove()}
  async function iceServers(){try{const d=await api("/api/realtime-config");return d.iceServers||[{urls:"stun:stun.l.google.com:19302"}]}catch{return[{urls:"stun:stun.l.google.com:19302"}]}}
  async function toggleScreen(){
    if(!S.call?.active)return;
    if(S.call.screen){
      const old=S.call.screen; S.call.screen=null;
      try{old.stop()}catch{}
      for(const [id,p] of S.call.peers){
        const sender=p.pc.getSenders().find(x=>x.track?.kind==="video");
        if(sender)await sender.replaceTrack(S.call.cam||null);
        await makeOffer(id);
      }
      renderCallStage(); syncCall(); return;
    }
    if(!navigator.mediaDevices?.getDisplayMedia){toast("Screen share","This browser does not support screen sharing.","error");return}
    try{
      const ds=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:60}},audio:false});
      const track=ds.getVideoTracks()[0]; if(!track)return;
      S.call.screen=track;
      for(const [id,p] of S.call.peers){
        const sender=p.pc.getSenders().find(x=>x.track?.kind==="video");
        if(sender)await sender.replaceTrack(track);
        await makeOffer(id);
      }
      const self=document.querySelector('.tile[data-peer="self"] video"); if(self){self.srcObject=ds;self.muted=true;self.play().catch(()=>{})}
      track.onended=()=>{if(S.call?.screen===track){S.call.screen=null;syncCall()}}
      syncCall();
      const payload=S.call.scope==="dm"?{callId:S.call.callId,dmId:S.call.dmId}:{channelId:S.call.roomId};
      S.socket?.emit(S.call.scope==="dm"?"dm:call:media-state":"call:media-state",{...payload,screenShare:true,muted:!S.call.mic?.enabled,cameraOff:!S.call.cam?.enabled});
      toast("Screen sharing","Your screen is being shared.","success");
    }catch(e){if(e?.name!=="AbortError")toast("Screen share",e.message||"Unable to share screen.","error")}
  }

  function emitCallMedia(){
    if(!S.call?.active||!S.socket)return;
    const p=S.call.scope==="dm"?{callId:S.call.callId,dmId:S.call.dmId}:{channelId:S.call.roomId};
    S.socket.emit(S.call.scope==="dm"?"dm:call:media-state":"call:media-state",{...p,muted:!S.call.mic?.enabled,cameraOff:!S.call.cam?.enabled,screenShare:!!S.call.screen});
  }
  function syncCall(){if(!S.call)return;$("#call-mic").classList.toggle("off",!S.call.mic?.enabled);$("#call-camera").classList.toggle("off",!S.call.cam?.enabled);$("#call-screen").classList.toggle("active",!!S.call.screen)}
  function incoming(c){if(S.call?.active)return;S.call={pending:c};$("#incoming").classList.remove("hidden");$("#incoming-avatar").textContent=String(c.username||c.fromUser?.username||"G").slice(0,1).toUpperCase();$("#incoming-title").textContent=(c.username||c.fromUser?.username||"Someone")+" is calling";$("#incoming-subtitle").textContent=(c.mode==="voice"?"Voice":"Video")+" call · "+(c.scope==="dm"?"Private":"Community")}
  async function acceptIncoming(){const c=S.call?.pending;if(!c)return;$("#incoming").classList.add("hidden");if(c.scope==="dm"){S.dm=S.dms.find(d=>String(d.id)===String(c.dmId))||S.dm;const m=await localMedia(c.mode);if(!m)return;S.call={scope:"dm",mode:c.mode,active:true,roomId:c.roomId,dmId:c.dmId,callId:c.callId,local:m.stream,mic:m.mic,cam:m.cam,screen:null,peers:new Map()};$("#call-overlay").classList.remove("hidden");$("#call-title").textContent=c.username||"Private call";$("#call-subtitle").textContent=c.mode==="voice"?"Voice room":"Video room";renderCallStage();syncCall();S.socket.emit("dm:call:accept",{callId:c.callId});return}await selectServer(c.serverId);S.channel=S.channels.find(x=>String(x.id)===String(c.channelId));const m=await localMedia(c.mode);if(!m)return;S.call={scope:"channel",mode:c.mode,active:true,roomId:c.channelId,dmId:null,callId:null,local:m.stream,mic:m.mic,cam:m.cam,screen:null,peers:new Map()};$("#call-overlay").classList.remove("hidden");$("#call-title").textContent=S.channel?.name||"Channel call";$("#call-subtitle").textContent=c.mode==="voice"?"Voice room":"Video room";renderCallStage();S.socket.emit("call:join",{channelId:c.channelId,mode:c.mode})}
  function declineIncoming(){const c=S.call?.pending;if(c?.scope==="dm")S.socket?.emit("dm:call:decline",{callId:c.callId});S.call=null;$("#incoming").classList.add("hidden")}
  function endCall(silent){const c=S.call;if(!c||(!c.active&&!c.local))return; if(c.scope==="dm"&&c.callId)S.socket?.emit("dm:call:leave",{callId:c.callId,dmId:c.dmId}); else if(c.roomId)S.socket?.emit("call:leave",c.roomId);c.peers?.forEach(x=>{try{x.pc.close()}catch{}});c.local?.getTracks().forEach(t=>{try{t.stop()}catch{}});S.call=null;$("#call-stage").innerHTML="";$("#call-overlay").classList.add("hidden");if(!silent)toast("Call","Call ended.")}
  function bind(){
    $("#rail-nav").onclick=e=>{const b=e.target.closest("[data-view]");if(b)setView(b.dataset.view)};$("#search-open").onclick=openSearch;$("#command-open").onclick=openCommand;$("#notifications").onclick=()=>setView("notifications");$("#messages-open").onclick=()=>setView("messages");$("#calls-open").onclick=()=>{const c=S.channels.find(x=>x.type==="voice");if(c){S.channel=c;startCall("channel","voice")}else setView("communities")};$("#profile-open").onclick=()=>setView("settings");$("#collapse").onclick=()=>$("#app").classList.toggle("collapsed");
    $("#call-close").onclick=endCall;$("#call-leave").onclick=endCall;$("#call-mic").onclick=()=>{if(S.call?.mic){S.call.mic.enabled=!S.call.mic.enabled;syncCall();emitCallMedia()}};$("#call-camera").onclick=()=>{if(S.call?.cam){S.call.cam.enabled=!S.call.cam.enabled;syncCall();emitCallMedia()}};$("#call-screen").onclick=toggleScreen;$("#incoming-accept").onclick=acceptIncoming;$("#incoming-decline").onclick=declineIncoming;
    document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}if(e.key==="Escape")closeModal()})
  }

  function authScreen(mode){$("#boot").innerHTML='<div class="modal-bg"><div class="modal"><div class="modal-body"><span class="eyebrow">ORBIT</span><h1 style="font:700 28px Space Grotesk">Secure access</h1><p class="muted" style="font-size:9px">New frontend. Existing community and realtime backend.</p><div class="actions"><button class="btn '+(mode==="signin"?"primary":"")+'" id="signin-mode">Sign in</button><button class="btn '+(mode==="register"?"primary":"")+'" id="register-mode">Create account</button></div><form id="auth" class="form" style="margin-top:14px"><label>Username<input class="input" id="auth-user" required></label>'+(mode==="register"?'<label>Display name<input class="input" id="auth-display"></label>':"")+'<label>Password<input class="input" id="auth-pass" type="password" minlength="8" required></label><button class="btn primary">Continue</button><span id="auth-error" class="muted" style="font-size:8px"></span></form></div></div></div>';$("#signin-mode").onclick=()=>authScreen("signin");$("#register-mode").onclick=()=>authScreen("register");$("#auth").onsubmit=async e=>{e.preventDefault();try{const body={username:$("#auth-user").value,password:$("#auth-pass").value};if(mode==="register")body.displayName=$("#auth-display").value;const d=await api(mode==="register"?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify(body)});saveAuth(d);boot()}catch(x){$("#auth-error").textContent=x.message}}}
  async function boot(){
    try{const d=await api("/api/me");S.user=d.user;if(!S.user.account){return authScreen("signin")}$("#boot").innerHTML="";$("#app").classList.remove("hidden");await loadServers();await loadDMs();await loadNotifications();connectSocket();renderNav();chrome();setView("home")}catch(e){localStorage.removeItem("orbit_token");authScreen("signin")}
  }
  bind(); if(S.token)boot(); else authScreen("signin");
})();