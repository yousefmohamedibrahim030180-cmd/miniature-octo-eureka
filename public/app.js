const $ = s => document.querySelector(s);

let token = localStorage.getItem("orbit_guest_token") || "";
let guestId = localStorage.getItem("orbit_guest_id") || "";
let guestName = localStorage.getItem("orbit_guest_name") || "";
let me = null;
let servers = [];
let currentServer = null;
let channels = [];
let currentChannel = null;
let socket = null;
let typingTimer = null;
let pendingIncomingCall = null;
const pageConfig = {
  home:{eyebrow:"ORBIT / COMMAND CENTER",title:"Home",subtitle:"A single control surface for your communities, conversations, and live rooms."},
  discover:{eyebrow:"DISCOVER",title:"Discover communities",subtitle:"Explore featured spaces, categories, and new conversations."},
  dms:{eyebrow:"DIRECT MESSAGES",title:"Messages",subtitle:"Private conversations, groups, and recent contacts."},
  friends:{eyebrow:"SOCIAL GRAPH",title:"Friends",subtitle:"Online people, requests, suggestions, and blocked users."},
  notifications:{eyebrow:"INBOX",title:"Notifications",subtitle:"Mentions, replies, calls, requests, and system events."},
  saved:{eyebrow:"LIBRARY",title:"Saved",subtitle:"Everything you deliberately kept for later."},
  explore:{eyebrow:"EXPLORE",title:"Explore",subtitle:"Media, events, polls, files, and community activity."},
  settings:{eyebrow:"PREFERENCES",title:"Settings",subtitle:"Fine-grained control over appearance, privacy, voice, and performance."}
};

function orbitToast(title, body="", kind="") {
  const stack=$("#toast-stack");
  if(!stack) return;
  const node=document.createElement("div");
  node.className="toast "+kind;
  node.innerHTML='<div><strong>'+escapeHtml(title)+'</strong>'+(body?'<span>'+escapeHtml(body)+'</span>':'')+'</div>';
  stack.appendChild(node);
  setTimeout(()=>node.remove(),3200);
}
function setView(view) {
  orbitUI.view=view;
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const global=$("#global-page"), chat=$("#chat-view");
  if(view==="home" && !servers?.length) view="home";
  if(["home","discover","dms","friends","notifications","saved","explore","settings"].includes(view)) {
    global.classList.remove("hidden");
    chat.classList.add("hidden");
    $("#members-panel").classList.add("hidden");
    $("#thread-panel").classList.add("hidden");
    renderPage(view);
  } else {
    global.classList.add("hidden");
    chat.classList.remove("hidden");
  }
}
function navigateChat() {
  setView("chat");
  document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.classList.remove("active"));
}
function renderPage(view) {
  const cfg=pageConfig[view]||pageConfig.home;
  $("#page-eyebrow").textContent=cfg.eyebrow;
  $("#page-title").textContent=cfg.title;
  $("#page-subtitle").textContent=cfg.subtitle;
  $("#page-actions").innerHTML="";
  if(view==="home") renderHome();
  if(view==="discover") renderDiscover();
  if(view==="dms") renderDMs();
  if(view==="friends") renderFriends();
  if(view==="notifications") renderNotifications();
  if(view==="saved") renderSaved();
  if(view==="explore") renderExplore();
  if(view==="settings") renderSettings();
}
function safeName() {
  return me?.username || "Guest";
}
function demoPeople() {
  const base=(servers||[]).flatMap(s=>s.id?[]:[]);
  const known=document.querySelectorAll("#member-list .member");
  const names=[...known].map(x=>x.querySelector("strong")?.textContent).filter(Boolean);
  return [...new Set([safeName(),"Nova","Apex","Luna","Mika","Rex",...names])].map((name,i)=>({
    name,status:i%4===0?"Idle":i%5===0?"Do Not Disturb":"Online",role:i===0?"owner":"member",initial:avatar(name)
  }));
}
function metricCard(label,value,detail){return '<div class="metric"><span>'+label+'</span><strong>'+value+'</strong><span>'+detail+'</span></div>'}
function renderHome() {
  const active=(servers||[]).length;
  $("#page-actions").innerHTML='<button id="home-create-server">+ Create server</button><button id="home-search">Search</button>';
  $("#page-body").innerHTML=
  '<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">CONTROL YOUR COMMUNITY</span><h2>Connect. Create. Belong.</h2><p>Orbit combines chat, communities, live voice, video, discovery, and power-user controls in one focused workspace.</p><button class="hero-action" id="home-open-chat">Open #'+escapeHtml(currentChannel?.name||"general")+'</button></div>'+
    '<div class="hero-card"><span class="eyebrow">LIVE NOW</span><h2>'+escapeHtml(currentChannel?.name||"Lounge")+'</h2><p>Start a private voice or video room, share your screen, and tune quality in real time.</p><button class="hero-action" id="home-start-call">Start video</button></div>'+
    '<div class="hero-card"><span class="eyebrow">YOUR PROFILE</span><h2>'+escapeHtml(orbitUI.profile.displayName||safeName())+'</h2><p>'+escapeHtml(orbitUI.profile.bio||"Make your profile feel like you.")+'</p><button class="hero-action" id="home-profile">Customize</button></div>'+
  '</div>'+
  '<div class="metric-grid" id="home-metrics">'+metricCard("Communities",active,"Connected workspaces")+metricCard("Your status",orbitUI.profile.status,"Presence")+metricCard("Unread",String(3),"Notifications")+metricCard("Call quality","HD","Ready for live rooms")+'</div>'+
  '<div class="section-block"><div class="section-heading"><h3>Quick actions</h3><span>Designed for keyboard-first power users</span></div><div class="card-grid">'+
   quickCard("⌕","Search everything","Find people, channels, messages, and servers.","home-search")+
   quickCard("◫","Create a poll","Ask your community with live results.","home-poll")+
   quickCard("◎","Open friends","See who is online and start a DM.","home-friends")+
  '</div></div>'+
  '<div class="section-block"><div class="section-heading"><h3>Recent activity</h3><span>Live workspace signal</span></div><div class="list-card">'+
    activityRow("◉","Nova joined Orbit Lobby","2 minutes ago","View")+
    activityRow("✦","A new event is ready to schedule","10 minutes ago","Open")+
    activityRow("↗","Screen sharing is ready in Lounge","18 minutes ago","Join")+
  '</div></div>';
  bindHomeActions();
}
function quickCard(icon,title,desc,id){return '<button class="content-card quick-action" data-action="'+id+'"><div class="chip">'+icon+'</div><h4>'+title+'</h4><p>'+desc+'</p></button>'}
function activityRow(icon,title,detail,action){return '<div class="list-row"><div class="chip">'+icon+'</div><div><strong>'+title+'</strong><span>'+detail+'</span></div><button class="activity-action">'+action+'</button></div>'}
function bindHomeActions(){
  $("#home-open-chat")?.addEventListener("click",navigateChat);
  $("#home-start-call")?.addEventListener("click",()=>{navigateChat();startCall("video")});
  $("#home-profile")?.addEventListener("click",()=>openProfileSettings());
  $("#home-create-server")?.addEventListener("click",()=>$("#new-server").click());
  $("#home-search")?.addEventListener("click",openCommandPalette);
  document.querySelectorAll(".quick-action").forEach(el=>el.addEventListener("click",()=>{
    const a=el.dataset.action;
    if(a==="home-search") openCommandPalette();
    if(a==="home-poll") openPollComposer();
    if(a==="home-friends") setView("friends");
  }));
}
function renderDiscover(){
  $("#page-actions").innerHTML='<button id="discover-search">Search communities</button><button id="discover-category">All categories</button>';
  const cards=[
    ["Nebula Arena","Gaming","12.4k","1.2k","Competitive matches and community events."],
    ["Build in Public","Technology","7.8k","620","Founders, makers, and shipping every week."],
    ["Creative Lab","Art & Media","4.2k","402","Design critiques, media nights, and showcases."],
    ["Code Foundry","Programming","9.1k","880","Projects, Q&A, pair programming, and help."],
    ["Study Hall","Education","5.6k","301","Focused study rooms with live accountability."],
    ["Night Shift","Community","3.3k","288","Late-night chats, music, and casual calls."]
  ];
  $("#page-body").innerHTML='<div class="card-grid">'+cards.map((x,i)=>
    '<div class="hero-card community-card"><span class="eyebrow">'+x[1].toUpperCase()+'</span><h2>'+x[0]+'</h2><p>'+x[4]+'</p><div><span class="chip">'+x[2]+' members</span><span class="chip">'+x[3]+' online</span></div><button class="hero-action discover-join" data-name="'+x[0]+'">View community</button></div>'
  ).join("")+'</div>';
  document.querySelectorAll(".discover-join").forEach(btn=>btn.onclick=()=>orbitToast("Preview opened",btn.dataset.name+" can be joined when public discovery is enabled.","success"));
  $("#discover-search")?.addEventListener("click",openCommandPalette);
}
function renderDMs(){
  const people=["Nova","Apex","Luna","Mika"];
  $("#page-actions").innerHTML='<button id="new-dm">New message</button><button id="new-group">New group</button>';
  $("#page-body").innerHTML='<div class="list-card">'+people.map((p,i)=>
    '<div class="list-row"><div class="avatar">'+avatar(p)+'</div><div><strong>'+p+'</strong><span>'+(i===0?"Online · playing a game":i===1?"Last seen 4 min ago":"Online · idle")+'</span></div><button class="dm-open" data-person="'+p+'">Open</button></div>'
  ).join("")+'</div><div class="section-block"><div class="section-heading"><h3>Group conversations</h3><span>Private rooms</span></div><div class="card-grid">'+
    quickCard("◉","Studio","5 members · project room","group-studio")+quickCard("◎","Night Crew","8 members · voice + text","group-night")+quickCard("✦","Creators","12 members · media sharing","group-creators")+
  '</div></div>';
  document.querySelectorAll(".dm-open").forEach(btn=>btn.onclick=()=>orbitToast("DM ready","Opening a private conversation with "+btn.dataset.person+".","success"));
  $("#new-dm")?.addEventListener("click",()=>openModal("New direct message",'<input placeholder="Search username"><button class="primary" id="modal-dm-start">Start conversation</button>'));
  $("#new-group")?.addEventListener("click",()=>openModal("Create group DM",'<input placeholder="Group name"><textarea placeholder="Invite usernames"></textarea><button class="primary" id="modal-group-create">Create group</button>'));
}
function renderFriends(){
  const tabs=["All","Online","Pending","Suggestions","Blocked"];
  $("#page-actions").innerHTML='<button id="add-friend">+ Add friend</button><button id="friend-search">Search users</button>';
  $("#page-body").innerHTML='<div class="settings-nav friend-tabs">'+tabs.map((t,i)=>'<button class="'+(i===0?"active":"")+'">'+t+'</button>').join("")+'</div><div class="section-block"><div class="list-card">'+demoPeople().map((p,i)=>
    '<div class="list-row"><div class="avatar">'+p.initial+'</div><div><strong>'+escapeHtml(p.name)+'</strong><span>'+p.status+' · '+(p.role==="owner"?"Owner":"Mutual server")+'</span></div><button data-friend="'+escapeHtml(p.name)+'">'+(i===0?"Profile":"Message")+'</button></div>'
  ).join("")+'</div></div>';
  $("#add-friend")?.addEventListener("click",()=>openModal("Add friend",'<input id="friend-name" placeholder="Username"><button class="primary" id="send-friend-request">Send request</button>'));
  $("#friend-search")?.addEventListener("click",openCommandPalette);
  document.querySelectorAll("[data-friend]").forEach(b=>b.onclick=()=>openProfilePopup(b.dataset.friend));
}
function renderNotifications(){
  const items=[
    ["Mentions","Nova mentioned you in #general","2 min ago","◇"],
    ["Friend request","Apex sent you a friend request","8 min ago","◎"],
    ["Call","Luna started a video room in Lounge","16 min ago","▣"],
    ["Event","Community night starts tomorrow","1 hr ago","★"],
    ["Security","New guest session detected on this device","Today","!"]
  ];
  $("#page-actions").innerHTML='<button id="mark-all-read">Mark all read</button><button id="notification-settings">Preferences</button>';
  $("#page-body").innerHTML='<div class="list-card">'+items.map((x,i)=>'<div class="list-row"><div class="chip">'+x[3]+'</div><div><strong>'+x[0]+'</strong><span>'+x[1]+' · '+x[2]+'</span></div><button class="notification-open" data-i="'+i+'">Open</button></div>').join("")+'</div>';
  $("#mark-all-read")?.addEventListener("click",()=>{$("#notification-badge").textContent="0";orbitToast("Inbox cleared","All notifications marked as read.","success")});
  $("#notification-settings")?.addEventListener("click",()=>renderSettings("notifications"));
}
function renderSaved(){
  const saved=orbitUI.saved.length?orbitUI.saved:[{title:"Product roadmap",meta:"#general · saved just now",text:"Build a community platform that feels premium and fast."},{title:"Voice quality checklist",meta:"Call settings",text:"720p, 30fps, echo cancellation, noise suppression."}];
  $("#page-actions").innerHTML='<button id="clear-saved">Clear all</button>';
  $("#page-body").innerHTML='<div class="list-card">'+saved.map((x,i)=>'<div class="list-row"><div class="chip">⌑</div><div><strong>'+escapeHtml(x.title)+'</strong><span>'+escapeHtml(x.meta||"Saved")+'</span></div><button data-unsave="'+i+'">Remove</button></div>').join("")+'</div>';
  $("#clear-saved")?.addEventListener("click",()=>{orbitUI.saved=[];localStorage.setItem("orbit_saved","[]");renderSaved();orbitToast("Saved cleared")});
}
function renderExplore(){
  $("#page-actions").innerHTML='<button id="explore-media">Media gallery</button><button id="explore-event">Create event</button>';
  $("#page-body").innerHTML='<div class="hero-grid">'+
    '<div class="hero-card"><span class="eyebrow">EVENTS</span><h2>Community Night</h2><p>Friday · 20:00 · Lounge</p><button class="hero-action" id="explore-event-open">View event</button></div>'+
    '<div class="hero-card"><span class="eyebrow">MEDIA</span><h2>Server gallery</h2><p>Images, videos, documents, and links organized by channel.</p><button class="hero-action" id="explore-media-open">Open gallery</button></div>'+
    '<div class="hero-card"><span class="eyebrow">POLLS</span><h2>Live opinion</h2><p>Ask, vote, and visualize results in the conversation.</p><button class="hero-action" id="explore-poll-open">Create poll</button></div>'+
  '</div>';
  $("#explore-media")?.addEventListener("click",()=>orbitToast("Gallery ready","Connect storage to enable persistent uploads.","success"));
  $("#explore-event")?.addEventListener("click",()=>openEventComposer());
  $("#explore-event-open")?.addEventListener("click",()=>openEventComposer());
  $("#explore-media-open")?.addEventListener("click",()=>orbitToast("Media gallery","Preview mode is ready."));
  $("#explore-poll-open")?.addEventListener("click",openPollComposer);
}
function renderSettings(section=orbitUI.settingsSection){
  orbitUI.settingsSection=section;
  const sections=[["account","Account"],["profile","Profile"],["privacy","Privacy"],["appearance","Appearance"],["voice","Voice & Video"],["notifications","Notifications"],["accessibility","Accessibility"],["performance","Performance"],["advanced","Advanced"],["security","Security"]];
  $("#page-body").innerHTML='<div class="settings-layout"><nav class="settings-nav">'+sections.map(([id,label])=>'<button class="'+(id===section?"active":"")+'" data-settings="'+id+'">'+label+'</button>').join("")+'</nav><div id="settings-card" class="settings-card"></div></div>';
  document.querySelectorAll("[data-settings]").forEach(b=>b.onclick=()=>renderSettings(b.dataset.settings));
  renderSettingsCard(section);
}
function settingRow(title,desc,key,value) {
  const on=value?" on":"";
  return '<div class="setting-row"><div><strong>'+title+'</strong><span>'+desc+'</span></div><button class="switch'+on+'" data-toggle="'+key+'"></button></div>';
}
function renderSettingsCard(section){
  const card=$("#settings-card");
  if(section==="appearance"){
    const dark=localStorage.getItem("orbit_theme")!=="light", reduced=localStorage.getItem("orbit_motion")==="reduced", compact=localStorage.getItem("orbit_density")==="compact", blur=localStorage.getItem("orbit_blur")!=="off";
    card.innerHTML='<h3>Appearance</h3><p>Shape the visual system without losing the premium Orbit feel.</p>'+
      settingRow("Dark theme","Deep graphite UI with electric accents.","theme",dark)+
      settingRow("Reduced motion","Keep transitions subtle and efficient.","motion",reduced)+
      settingRow("Compact density","Tighter message and navigation spacing.","density",compact)+
      settingRow("Glass blur","Use backdrop blur in overlays and panels.","blur",blur)+
      '<div class="setting-row"><div><strong>Accent</strong><span>Current '+escapeHtml(orbitUI.profile.accent)+'</span></div><input id="accent-picker" type="color" value="'+escapeHtml(orbitUI.profile.accent)+'" style="width:44px;height:30px"></div>';
  } else if(section==="voice"){
    card.innerHTML='<h3>Voice & Video</h3><p>Professional capture, quality, and connection controls.</p>'+
      settingRow("Noise suppression","Reduce fan, keyboard, and room noise.","noise",true)+
      settingRow("Echo cancellation","Avoid feedback while speaking.","echo",true)+
      settingRow("Automatic gain","Normalize microphone levels.","gain",true)+
      settingRow("Adaptive quality","Adjust capture based on network conditions.","autoQuality",true)+
      '<div class="setting-row"><div><strong>Preferred quality</strong><span>Used when starting a video room.</span></div><select id="global-quality" style="background:#0d131a;border:1px solid #2a3340;color:#fff;border-radius:8px;padding:8px"><option>720p</option><option>1080p</option><option>1080p60</option><option>1440p</option></select></div>';
  } else if(section==="profile"){
    card.innerHTML='<h3>Profile</h3><p>Guest mode keeps sign-up optional while still letting you look distinct.</p>'+
      '<input id="profile-display" value="'+escapeHtml(orbitUI.profile.displayName||safeName())+'" placeholder="Display name">'+
      '<textarea id="profile-bio" placeholder="Bio">'+escapeHtml(orbitUI.profile.bio||"")+'</textarea>'+
      '<select id="profile-status"><option>Online</option><option>Idle</option><option>Do Not Disturb</option><option>Invisible</option></select>'+
      '<button class="primary" id="save-profile-settings">Save profile</button>';
    $("#profile-status").value=orbitUI.profile.status||"Online";
    $("#save-profile-settings").onclick=()=>{orbitUI.profile.displayName=$("#profile-display").value.trim()||safeName();orbitUI.profile.bio=$("#profile-bio").value.trim();orbitUI.profile.status=$("#profile-status").value;localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));$("#me-name").textContent=orbitUI.profile.displayName;orbitToast("Profile updated","Your guest profile is ready.","success");};
  } else if(section==="account"){
    card.innerHTML='<h3>Account</h3><p>Orbit is currently using frictionless guest mode, so no account is required.</p><div class="content-card"><h4>Guest session</h4><p>Stored locally on this browser and protected by a signed session token.</p><span class="chip">Guest mode</span><span class="chip">30 day session</span></div>';
  } else if(section==="privacy"){
    card.innerHTML='<h3>Privacy</h3><p>Control how others can interact with you.</p>'+settingRow("Friend requests","Allow others to send requests.","friendReq",true)+settingRow("Direct messages","Allow DMs from shared communities.","dm",true)+settingRow("Read receipts","Show when you have opened a message.","receipts",false);
  } else if(section==="notifications"){
    card.innerHTML='<h3>Notifications</h3><p>Decide what deserves your attention.</p>'+settingRow("Desktop alerts","Show important alerts outside the app.","desktop",true)+settingRow("Mentions","Notify when someone mentions you.","mentions",true)+settingRow("DMs","Notify for private messages.","dmNotify",true)+settingRow("Calls","Notify when someone starts a call.","calls",true);
  } else if(section==="accessibility"){
    card.innerHTML='<h3>Accessibility</h3><p>Make Orbit easier to scan and operate.</p>'+settingRow("Reduced motion","Minimize transitions and micro-animation.","a11yMotion",false)+settingRow("High contrast","Boost borders and text contrast.","contrast",false)+settingRow("Larger text","Increase the app UI scale.","largeText",false)+settingRow("Reduced transparency","Remove glass blur layers.","reducedTransparency",false);
  } else if(section==="performance"){
    card.innerHTML='<h3>Performance</h3><p>Prefer smooth interaction over visual effects.</p>'+settingRow("Performance mode","Limit blur and reduce expensive effects.","perf",false)+settingRow("Hardware acceleration","Prefer GPU accelerated rendering.","gpu",true)+settingRow("Lazy media","Load rich media on demand.","lazy",true);
  } else if(section==="security"){
    card.innerHTML='<h3>Security center</h3><p>Visibility into the current guest session.</p><div class="list-card">'+activityRow("✓","Current browser session","Active now","Keep")+activityRow("◎","Signed guest token","Valid","Details")+activityRow("⚠","Persistent storage","Not connected","Setup")+'</div>';
  } else {
    card.innerHTML='<h3>Advanced</h3><p>Power-user switches and diagnostics.</p>'+settingRow("Developer mode","Expose debug information and connection status.","dev",false)+settingRow("Keyboard shortcuts","Enable global shortcuts.","shortcuts",true)+settingRow("Command palette","Use Ctrl+K to navigate faster.","palette",true);
  }
  document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>{
    b.classList.toggle("on");
    const key=b.dataset.toggle;
    if(key==="theme"){localStorage.setItem("orbit_theme",b.classList.contains("on")?"dark":"light");document.body.classList.toggle("light-theme",!b.classList.contains("on"))}
    if(key==="motion"){localStorage.setItem("orbit_motion",b.classList.contains("on")?"reduced":"full");document.body.classList.toggle("reduced-motion",b.classList.contains("on"))}
    if(key==="density"){localStorage.setItem("orbit_density",b.classList.contains("on")?"compact":"comfortable");document.body.classList.toggle("compact",b.classList.contains("on"))}
    if(key==="blur"){localStorage.setItem("orbit_blur",b.classList.contains("on")?"on":"off")}
    orbitToast("Preference updated");
  });
  $("#accent-picker")?.addEventListener("change",e=>{orbitUI.profile.accent=e.target.value;document.documentElement.style.setProperty("--accent",e.target.value);localStorage.setItem("orbit_profile",JSON.stringify(orbitUI.profile));});
}
function openProfilePopup(name){
  openModal(name+" · profile",'<div class="hero-card"><span class="eyebrow">PROFILE</span><h2>'+escapeHtml(name)+'</h2><p>Online community member with shared spaces and mutual conversations.</p><span class="chip">Online</span><span class="chip">2 mutual servers</span><span class="chip">Guest</span></div><div class="list-card" style="margin-top:10px">'+activityRow("✦","Activity","Playing in Orbit","View")+activityRow("◌","Mutual server","Orbit Lobby","Open")+'</div>');
}
function openProfileSettings(){setView("settings");renderSettings("profile");}
function openModal(title,body,subtitle=""){ $("#modal-title").textContent=title;$("#modal-subtitle").textContent=subtitle;$("#modal-body").innerHTML=body;$("#modal").classList.remove("hidden"); }
function closeOrbitModal(){ $("#modal").classList.add("hidden"); }
$("#modal-close")?.addEventListener("click",closeOrbitModal);
$("#modal")?.addEventListener("click",e=>{if(e.target.id==="modal")closeOrbitModal()});

async function openSearch(query){
  const q=String(query||"").trim();
  if(!q) return openCommandPalette();
  try{
    const data=await api("/api/search?q="+encodeURIComponent(q));
    openModal("Search results","<div class=\"list-card\">"+
      data.users.map(u=>activityRow("◎",u.username,"User · "+(u.guest?"Guest":"Member"),"Open")).join("")+
      data.servers.map(s=>activityRow("◈",s.name,s.memberCount+" members","Open")).join("")+
      data.channels.map(c=>activityRow(c.type==="voice"?"◉":"#","#"+c.name,c.type,"Open")).join("")+
      data.messages.map(m=>activityRow("◫",m.content.slice(0,55),m.username,"Open")).join("")+
    "</div>");
  }catch(err){orbitToast("Search failed",err.message,"error")}
}

const commands=[
  ["⌂","Open Home","home"],["✦","Discover communities","discover"],["◌","Direct messages","dms"],["◎","Friends","friends"],["◇","Notifications","notifications"],["⌑","Saved","saved"],["⌖","Explore","explore"],["⚙","Settings","settings"],
  ["+","Create server","create-server"],["#","Create channel","create-channel"],["◉","Join voice room","voice"],["▣","Start video call","video"],["↗","Share screen","share"],["⌕","Search","search"],["⚡","Toggle performance mode","performance"]
];
function openCommandPalette(){
  $("#command-palette").classList.remove("hidden");$("#command-input").value="";orbitUI.commandIndex=0;renderCommandResults("");setTimeout(()=>$("#command-input").focus(),30);
}
function closeCommandPalette(){$("#command-palette").classList.add("hidden")}
function renderCommandResults(query){
  const q=String(query||"").toLowerCase();
  orbitUI.commandItems=commands.filter(c=>(c[1]+" "+c[2]).toLowerCase().includes(q));
  $("#command-results").innerHTML=(orbitUI.commandItems.length?orbitUI.commandItems: [["⌕","No command matches","none"]]).map((c,i)=>'<button class="command-item '+(i===orbitUI.commandIndex?"selected":"")+'" data-command="'+i+'"><span class="command-icon">'+c[0]+'</span><div><strong>'+c[1]+'</strong><span>'+c[2]+'</span></div><span>↵</span></button>').join("");
  document.querySelectorAll(".command-item").forEach((b,i)=>b.onclick=()=>runCommand(i));
}
function runCommand(i){
  const item=orbitUI.commandItems[i]; if(!item) return;
  closeCommandPalette();
  const act=item[2];
  if(pageConfig[act]) return setView(act);
  if(act==="create-server") return $("#new-server").click();
  if(act==="create-channel") return $("#new-channel").click();
  if(act==="voice") return navigateChat(),startCall("voice");
  if(act==="video") return navigateChat(),startCall("video");
  if(act==="share") return navigateChat(),callState.active?toggleScreenShare():startCall("video");
  if(act==="search") return openSearch("");
  if(act==="performance"){document.body.classList.toggle("reduced-motion");orbitToast("Performance mode",document.body.classList.contains("reduced-motion")?"Enabled":"Disabled");}
}
$("#command-input")?.addEventListener("input",e=>renderCommandResults(e.target.value));
$("#command-palette")?.addEventListener("click",e=>{if(e.target.id==="command-palette")closeCommandPalette()});
window.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette();return}
  if(e.key==="Escape"){closeCommandPalette();hideCallPopover();$("#context-menu").classList.add("hidden");return}
  if((e.ctrlKey||e.metaKey)&&e.key==="/"){setView("settings");renderSettings("advanced");return}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="m"){e.preventDefault();toggleMic();return}
});
$("#quick-search")?.addEventListener("keydown",e=>{if(e.key==="Enter")openSearch(e.target.value)});
$("#sidebar-search")?.addEventListener("click",()=>openCommandPalette());
document.querySelectorAll(".rail-nav[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));

$("#profile-card-btn")?.addEventListener("click",()=>openProfileSettings());
$("#join-server")?.addEventListener("click",()=>openModal("Join server",'<input id="invite-code" placeholder="Invite code or full invite URL"><button class="primary" id="accept-invite">Join community</button>'));
document.addEventListener("click",async e=>{
  if(e.target.id==="accept-invite"){
    const raw=$("#invite-code").value.trim();
    const code=raw.includes("invite=")?new URL(raw).searchParams.get("invite"):raw;
    try{await api("/api/invites/"+encodeURIComponent(code)+"/accept",{method:"POST",body:"{}"});closeOrbitModal();await loadServers();orbitToast("Joined community","The server is now in your workspace.","success")}
    catch(err){orbitToast("Invite failed",err.message,"error")}
  }
  if(e.target.id==="poll-btn")openPollComposer();
  if(e.target.id==="send-friend-request"){orbitToast("Friend request sent","The user will see it in Notifications.","success");closeOrbitModal()}
  if(e.target.id==="modal-dm-start"){orbitToast("Conversation created","Your DM is ready.","success");closeOrbitModal()}
  if(e.target.id==="modal-group-create"){orbitToast("Group created","Your group DM is ready.","success");closeOrbitModal()}
});

function openPollComposer(){
  openModal("Create poll",'<input id="poll-question" placeholder="Ask your community a question"><input id="poll-a" placeholder="Option A"><input id="poll-b" placeholder="Option B"><input id="poll-c" placeholder="Option C (optional)"><button class="primary" id="create-poll">Publish poll</button>');
}
function openEventComposer(){
  openModal("Create community event",'<input placeholder="Event title"><input placeholder="Date & time"><select><option>Voice</option><option>Video</option><option>Gaming</option><option>Meeting</option></select><textarea placeholder="Description"></textarea><button class="primary" id="create-event">Create event</button>');
}
document.addEventListener("click",e=>{
  if(e.target.id==="create-poll"){closeOrbitModal();orbitToast("Poll published","Live results are ready in the channel.","success")}
  if(e.target.id==="create-event"){closeOrbitModal();orbitToast("Event created","Members can now mark Interested or Going.","success")}
});

document.addEventListener("contextmenu",e=>{
  const message=e.target.closest(".message");
  if(!message) return;
  e.preventDefault();
  const menu=$("#context-menu");
  menu.style.left=Math.min(e.clientX,window.innerWidth-210)+"px";
  menu.style.top=Math.min(e.clientY,window.innerHeight-260)+"px";
  menu.innerHTML='<button data-context="react">React</button><button data-context="reply">Reply</button><button data-context="thread">Create thread</button><button data-context="save">Bookmark</button><button data-context="copy">Copy message</button><button class="danger" data-context="delete">Delete</button>';
  menu.classList.remove("hidden");
  menu.querySelectorAll("[data-context]").forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.context;
    if(action==="copy") {await navigator.clipboard?.writeText(message.querySelector(".msg-body")?.textContent||"");orbitToast("Copied","Message copied to clipboard.","success");}
    if(action==="save"){orbitUI.saved.push({title:message.querySelector(".msg-head strong")?.textContent||"Message",meta:"#"+(currentChannel?.name||"channel")+" · saved",text:message.querySelector(".msg-body")?.textContent||""});localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));orbitToast("Saved","Message added to your library.","success");}
    if(action==="thread")openThreadFromElement(message);
    if(action==="reply"){ $("#message").value="@"+(message.querySelector(".msg-head strong")?.textContent||"user")+" "; $("#message").focus(); }
    menu.classList.add("hidden");
  });
});
window.addEventListener("click",e=>{if(!e.target.closest("#context-menu"))$("#context-menu")?.classList.add("hidden")});

function openThreadFromElement(el){
  $("#thread-panel").classList.remove("hidden");
  $("#thread-root").innerHTML='<div class="content-card"><strong>'+escapeHtml(el.querySelector(".msg-head strong")?.textContent||"Message")+'</strong><p>'+escapeHtml(el.querySelector(".msg-body")?.textContent||"")+'</p></div>';
  $("#thread-meta").textContent="0 replies";
  orbitUI.threadReplies=[];
}
$("#close-thread")?.addEventListener("click",()=>$("#thread-panel").classList.add("hidden"));
$("#thread-composer")?.addEventListener("submit",e=>{e.preventDefault();const v=$("#thread-input").value.trim();if(!v)return;$("#thread-messages").insertAdjacentHTML("beforeend",'<div class="message"><div class="avatar">'+avatar(safeName())+'</div><div><div class="msg-head"><strong>'+escapeHtml(safeName())+'</strong><time>now</time></div><div class="msg-body">'+escapeHtml(v)+'</div></div></div>');$("#thread-input").value="";$("#thread-meta").textContent=document.querySelectorAll("#thread-messages .message").length+" replies"});

document.addEventListener("click",e=>{
  const quick=e.target.closest("[data-action]");
  if(quick && !quick.closest("#page-body")) return;
});

// Patch message renderer for hover actions when the original function exists.
if(typeof appendMessage==="function"){
  const originalAppendMessage=appendMessage;
  appendMessage=function(m){
    const before=document.querySelectorAll("#messages .message").length;
    originalAppendMessage(m);
    const all=document.querySelectorAll("#messages .message");
    const el=all[all.length-1];
    if(!el)return;
    el.dataset.messageId=m.id||"";
    el.insertAdjacentHTML("afterbegin",'<div class="msg-actions"><button class="msg-action" data-msg-action="react">☺</button><button class="msg-action" data-msg-action="reply">↩</button><button class="msg-action" data-msg-action="thread">◫</button><button class="msg-action" data-msg-action="save">⌑</button><button class="msg-action" data-msg-action="more">⋯</button></div>');
    el.querySelectorAll("[data-msg-action]").forEach(b=>b.onclick=async()=>{
      const a=b.dataset.msgAction;
      if(a==="reply"){$("#message").value="@"+m.username+" ";$("#message").focus();}
      if(a==="thread")openThreadFromElement(el);
      if(a==="save"){orbitUI.saved.push({title:m.username,meta:"#"+(currentChannel?.name||"channel")+" · saved",text:m.content});localStorage.setItem("orbit_saved",JSON.stringify(orbitUI.saved));orbitToast("Saved","Message bookmarked.","success");}
      if(a==="react")orbitToast("Reaction added","👍");
      if(a==="more")openModal("Message actions",'<div class="list-card">'+activityRow("↩","Reply","Continue the conversation","Reply")+activityRow("◫","Thread","Open a focused thread","Open")+activityRow("⌑","Bookmark","Save for later","Save")+'</div>');
    });
  };
}
if(typeof selectChannel==="function"){
  const originalSelect=selectChannel;
  selectChannel=async function(channel){
    await originalSelect(channel);
    if(channel?.type==="voice"){startCall("voice").catch(()=>{});}
  };
}
if(typeof selectServer==="function"){
  const originalSelectServer=selectServer;
  selectServer=async function(s){navigateChat();await originalSelectServer(s);$("#workspace-avatar").textContent=avatar(s.name);};
}

window.addEventListener("load",()=>{
  const theme=localStorage.getItem("orbit_theme");
  const motion=localStorage.getItem("orbit_motion");
  const density=localStorage.getItem("orbit_density");
  const accent=orbitUI.profile.accent;
  if(theme==="light")document.body.classList.add("light-theme");
  if(motion==="reduced")document.body.classList.add("reduced-motion");
  if(density==="compact")document.body.classList.add("compact");
  document.documentElement.style.setProperty("--accent",accent||"#7652e8");
  setView("home");
});

/* ===========================
   ORBIT FUNCTIONAL CORE
   =========================== */
async function refreshFriends() {
  try { const d=await api("/api/friends"); return d; } catch { return {friends:[],incoming:[],outgoing:[]}; }
}
async function refreshDMs() {
  try { const d=await api("/api/dms"); return d.dms||[]; } catch { return []; }
}
async function refreshNotifications() {
  try { const d=await api("/api/notifications"); return d.notifications||[]; } catch { return []; }
}
function setPageButton(text,id,onClick){ const b=document.createElement("button"); b.id=id;b.textContent=text;b.onclick=onClick;return b; }
function renderFriendsFunctional() {
  $("#page-actions").innerHTML="";
  $("#page-actions").append(
    setPageButton("+ Add friend","add-friend-fn",()=>openModal("Add friend",'<input id="friend-name-fn" placeholder="Exact username"><button class="primary" id="send-friend-request-fn">Send request</button>')),
    setPageButton("Refresh","friends-refresh-fn",()=>{renderFriends();orbitToast("Friends refreshed");})
  );
  refreshFriends().then(d=>{
    const incoming=d.incoming||[], friends=d.friends||[], outgoing=d.outgoing||[];
    $("#page-body").innerHTML=
      '<div class="section-block"><div class="section-heading"><h3>Friends</h3><span>'+friends.length+' accepted</span></div><div class="list-card">'+
      (friends.length?friends.map(u=>'<div class="list-row"><div class="avatar">'+avatar(u.username)+'</div><div><strong>'+escapeHtml(u.username)+'</strong><span>'+u.status+' · friend</span></div><button class="friend-dm-fn" data-user="'+escapeHtml(u.username)+'">Message</button></div>').join(""):'<div class="content-card"><h4>No friends yet</h4><p>Add someone by exact guest username.</p></div>')+
      '</div></div>'+
      '<div class="section-block"><div class="section-heading"><h3>Requests</h3><span>'+incoming.length+' incoming · '+outgoing.length+' outgoing</span></div><div class="list-card">'+
      incoming.map(r=>'<div class="list-row"><div class="avatar">'+avatar(r.fromUser?.username)+'</div><div><strong>'+escapeHtml(r.fromUser?.username||"Guest")+'</strong><span>Incoming request</span></div><button class="accept-fn" data-id="'+r.id+'">Accept</button></div>').join("")+
      outgoing.map(r=>'<div class="list-row"><div class="avatar">'+avatar(r.toUser?.username)+'</div><div><strong>'+escapeHtml(r.toUser?.username||"Guest")+'</strong><span>Request pending</span></div><button disabled>Pending</button></div>').join("")+
      '</div></div>';
    document.querySelectorAll(".accept-fn").forEach(b=>b.onclick=async()=>{try{await api("/api/friends/request/"+b.dataset.id+"/accept",{method:"POST",body:"{}"});orbitToast("Friend request accepted","You are now connected.","success");renderFriends()}catch(e){orbitToast("Request failed",e.message,"error")}});
    document.querySelectorAll(".friend-dm-fn").forEach(b=>b.onclick=async()=>{try{const d=await api("/api/dms",{method:"POST",body:JSON.stringify({username:b.dataset.user})});setView("dms");orbitToast("Conversation ready","DM with "+b.dataset.user+" is ready.","success")}catch(e){orbitToast("DM failed",e.message,"error")}});
  });
}
function renderDMsFunctional() {
  $("#page-actions").innerHTML="";
  $("#page-actions").append(
    setPageButton("New message","new-dm-fn",()=>openModal("New direct message",'<input id="dm-user-fn" placeholder="Exact username"><button class="primary" id="create-dm-fn">Start conversation</button>')),
    setPageButton("Refresh","dm-refresh-fn",()=>renderDMs())
  );
  refreshDMs().then(dms=>{
    $("#page-body").innerHTML='<div class="list-card">'+(dms.length?dms.map(dm=>{
      const u=dm.otherUser;
      return '<div class="list-row"><div class="avatar">'+avatar(u?.username||"G")+'</div><div><strong>'+escapeHtml(u?.username||dm.name||"Group")+'</strong><span>'+(dm.lastMessage?escapeHtml(dm.lastMessage.content.slice(0,80)):"No messages yet")+'</span></div><button class="open-dm-fn" data-id="'+dm.id+'" data-name="'+escapeHtml(u?.username||"Group")+'">Open</button></div>'
    }).join(""):'<div class="content-card"><h4>No direct messages yet</h4><p>Create a DM to start a private conversation.</p></div>')+'</div>';
    document.querySelectorAll(".open-dm-fn").forEach(b=>b.onclick=()=>openDMConversation(b.dataset.id,b.dataset.name));
  });
}
async function openDMConversation(dmId,name){
  const d=await api("/api/dms/"+encodeURIComponent(dmId)+"/messages");
  openModal("Direct message · "+name,'<div id="dm-modal-feed" class="list-card" style="max-height:360px;overflow:auto">'+(d.messages||[]).map(m=>'<div class="list-row"><div class="avatar">'+avatar(m.username)+'</div><div><strong>'+escapeHtml(m.username)+'</strong><span>'+escapeHtml(m.content)+'</span></div><span>'+new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+'</span></div>').join("")+'</div><form id="dm-send-form" class="thread-composer"><input id="dm-send-input" placeholder="Write a message"><button>Send</button></form>');
  socket?.emit("dm:join",dmId);
  $("#dm-send-form").onsubmit=async e=>{e.preventDefault();const v=$("#dm-send-input").value.trim();if(!v)return;const x=await api("/api/dms/"+encodeURIComponent(dmId)+"/messages",{method:"POST",body:JSON.stringify({content:v})});const feed=$("#dm-modal-feed");feed.insertAdjacentHTML("beforeend",'<div class="list-row"><div class="avatar">'+avatar(x.message.username)+'</div><div><strong>'+escapeHtml(x.message.username)+'</strong><span>'+escapeHtml(x.message.content)+'</span></div><span>now</span></div>');$("#dm-send-input").value="";feed.scrollTop=feed.scrollHeight;};
}
function renderNotificationsFunctional(){
  $("#page-actions").innerHTML="";
  $("#page-actions").append(setPageButton("Mark all read","mark-read-fn",async()=>{await api("/api/notifications/read",{method:"POST",body:"{}"});$("#notification-badge").textContent="0";orbitToast("Inbox cleared","All notifications are marked as read.","success");renderNotifications();}));
  refreshNotifications().then(items=>{
    $("#notification-badge").textContent=String(items.filter(n=>!n.read).length||0);
    $("#page-body").innerHTML='<div class="list-card">'+(items.length?items.map(n=>'<div class="list-row"><div class="chip">'+(n.type==="friend_request"?"◎":n.type==="reply"?"↩":"◇")+'</div><div><strong>'+escapeHtml(n.title)+'</strong><span>'+escapeHtml(n.body||"")+' · '+new Date(n.created_at).toLocaleString()+'</span></div><button class="notification-action">Open</button></div>').join(""):'<div class="content-card"><h4>All clear</h4><p>You have no new notifications.</p></div>')+'</div>';
  });
}
async function sendFriendRequestFromModal(){
  const username=$("#friend-name-fn")?.value.trim();if(!username)return;
  try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});closeOrbitModal();orbitToast("Friend request sent","Waiting for acceptance.","success");}catch(e){orbitToast("Request failed",e.message,"error")}
}
document.addEventListener("click",async e=>{
  if(e.target.id==="send-friend-request-fn")await sendFriendRequestFromModal();
  if(e.target.id==="create-dm-fn"){const username=$("#dm-user-fn")?.value.trim();if(!username)return;try{await api("/api/dms",{method:"POST",body:JSON.stringify({username})});closeOrbitModal();orbitToast("DM created","Opening Messages.");renderDMs();}catch(err){orbitToast("DM failed",err.message,"error")}}
});

function openPollComposerFunctional(){
  openModal("Create poll",'<input id="poll-question-fn" placeholder="Question"><input id="poll-a-fn" placeholder="Option A"><input id="poll-b-fn" placeholder="Option B"><input id="poll-c-fn" placeholder="Option C (optional)"><button class="primary" id="publish-poll-fn">Publish poll</button>');
}
document.addEventListener("click",async e=>{
  if(e.target.id==="publish-poll-fn"){
    const options=["#poll-a-fn","#poll-b-fn","#poll-c-fn"].map(s=>$(s)?.value.trim()).filter(Boolean);
    try{const d=await api("/api/channels/"+currentChannel.id+"/polls",{method:"POST",body:JSON.stringify({question:$("#poll-question-fn").value.trim(),options})});closeOrbitModal();orbitToast("Poll published","The poll is now live in #"+currentChannel.name,"success");await renderChannelPolls(d.poll)}catch(err){orbitToast("Poll failed",err.message,"error")}
  }
});
async function renderChannelPolls(newPoll=null){
  if(!currentChannel||currentChannel.type==="voice")return;
  const d=await api("/api/channels/"+currentChannel.id+"/polls");
  const polls=d.polls||[];
  for(const p of polls) insertPollCard(p);
  if(newPoll) insertPollCard(newPoll);
}
function insertPollCard(p){
  if(document.querySelector('[data-poll="'+p.id+'"]'))return;
  const el=document.createElement("div");el.className="content-card poll-card";el.dataset.poll=p.id;
  el.innerHTML='<div class="eyebrow">LIVE POLL</div><h4>'+escapeHtml(p.question)+'</h4>'+p.options.map(o=>'<button class="poll-option" data-poll="'+p.id+'" data-option="'+o.id+'"><span>'+escapeHtml(o.text)+'</span><b>'+o.votes+'</b></button>').join("");
  $("#messages").appendChild(el);
  el.querySelectorAll(".poll-option").forEach(b=>b.onclick=async()=>{try{const x=await api("/api/polls/"+p.id+"/vote",{method:"POST",body:JSON.stringify({optionId:b.dataset.option})});el.querySelectorAll(".poll-option").forEach((n,i)=>n.querySelector("b").textContent=x.poll.options[i]?.votes||0);orbitToast("Vote saved","Your choice has been recorded.","success")}catch(err){orbitToast("Vote failed",err.message,"error")}});
}
function patchFunctionalNavigation(){
  // Replace page renderers with functional versions.
  const rf=renderFriends, rd=renderDMs, rn=renderNotifications;
  renderFriends=renderFriendsFunctional;
  renderDMs=renderDMsFunctional;
  renderNotifications=renderNotificationsFunctional;
  if(typeof openPollComposerFunctional==="function")window.openPollComposer=openPollComposerFunctional;
  return {rf,rd,rn};
}
window.__orbitFunctionalReady = true;


/* Activate the functional layer after all declarations are initialized. */
patchFunctionalNavigation();
openPollComposer = openPollComposerFunctional;

$("#attach")?.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,video/*,audio/*,.pdf,.zip,.txt,.doc,.docx";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1500000) {
      orbitToast("File too large", "Guest mode supports files up to 1.5 MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const upload = await api("/api/uploads", {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            type: file.type,
            size: file.size,
            data: String(reader.result)
          })
        });
        if (socket && currentChannel) {
          socket.emit("message:send", {
            channelId: currentChannel.id,
            content: "📎 " + file.name,
            attachment: upload.file
          });
          orbitToast("File sent", file.name, "success");
        }
      } catch (err) {
        orbitToast("Upload failed", err.message, "error");
      }
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

$("#poll-btn")?.addEventListener("click", () => openPollComposerFunctional());

/* Make threads use the persisted backend thread instead of local-only state. */
openThreadFromElement = async function(el) {
  const messageId = el?.dataset?.messageId;
  if (!messageId) return;
  try {
    const d = await api("/api/messages/" + encodeURIComponent(messageId) + "/thread");
    $("#thread-panel").classList.remove("hidden");
    $("#thread-panel").dataset.messageId = messageId;
    $("#thread-root").innerHTML =
      '<div class="content-card"><strong>' +
      escapeHtml(el.querySelector(".msg-head strong")?.textContent || "Message") +
      '</strong><p>' +
      escapeHtml(el.querySelector(".msg-body")?.textContent || "") +
      '</p></div>';
    $("#thread-meta").textContent = (d.thread.replies?.length || 0) + " replies";
    $("#thread-messages").innerHTML = (d.thread.replies || []).map(r =>
      '<div class="message"><div class="avatar">' + avatar(r.username) +
      '</div><div><div class="msg-head"><strong>' + escapeHtml(r.username) +
      '</strong><time>now</time></div><div class="msg-body">' + escapeHtml(r.content) +
      '</div></div></div>'
    ).join("");
  } catch (err) {
    orbitToast("Thread failed", err.message, "error");
  }
};

$("#thread-composer")?.addEventListener("submit", async e => {
  e.preventDefault();
  const messageId = $("#thread-panel").dataset.messageId;
  const content = $("#thread-input").value.trim();
  if (!messageId || !content) return;
  try {
    const d = await api("/api/messages/" + encodeURIComponent(messageId) + "/thread", {
      method: "POST",
      body: JSON.stringify({ content })
    });
    const r = d.reply;
    $("#thread-messages").insertAdjacentHTML(
      "beforeend",
      '<div class="message"><div class="avatar">' + avatar(r.username) +
      '</div><div><div class="msg-head"><strong>' + escapeHtml(r.username) +
      '</strong><time>now</time></div><div class="msg-body">' + escapeHtml(r.content) +
      '</div></div></div>'
    );
    $("#thread-input").value = "";
    $("#thread-meta").textContent = (d.thread.replies?.length || 0) + " replies";
  } catch (err) {
    orbitToast("Reply failed", err.message, "error");
  }
});
