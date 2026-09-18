const $=s=>document.querySelector(s);
let token=localStorage.getItem("orbit_guest_token")||"";
const serverId=new URLSearchParams(location.search).get("server")||"";
let state=null,activeTab="overview",refreshTimer=null;

function esc(x){return String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function api(url,opts={}){opts.headers={...(opts.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};if(opts.body&&!opts.headers["Content-Type"])opts.headers["Content-Type"]="application/json";return fetch(url,opts).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;});}
function toast(msg,bad=false){const el=$("#toast");el.textContent=msg;el.className=bad?"show bad":"show";clearTimeout(toast.t);toast.t=setTimeout(()=>el.className="",2800);}
function fmt(ts){return new Date(ts).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function roleBadge(role){return '<span class="role '+esc(role)+'">'+esc(role)+'</span>';}
function metric(title,value,note,icon){return '<div class="metric"><span class="metric-icon">'+icon+'</span><div><strong>'+esc(value)+'</strong><span>'+esc(title)+'</span><small>'+esc(note||"")+'</small></div></div>';}
function isOwnerAdmin(){return ["owner","admin"].includes(String(state?.server?.role));}
function can(k){return Boolean(state?.permissions?.[k]);}

async function load(){
  if(!token||!serverId)return showDenied("Missing session or server.");
  try{
    $("#refresh-state").textContent="SYNCING";
    state=await api("/api/servers/"+encodeURIComponent(serverId)+"/admin/dashboard");
    $("#dashboard").classList.remove("hidden");$("#denied").classList.add("hidden");
    $("#server-name").textContent=state.server.name;
    $("#server-meta").textContent=String(state.server.role).toUpperCase()+" · "+state.stats.members+" members · "+state.stats.channels+" channels";
    $("#refresh-state").textContent="LIVE · "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    renderAll();
  }catch(e){showDenied(e.message);}
}
function showDenied(msg){$("#dashboard").classList.add("hidden");$("#denied").classList.remove("hidden");$("#denied p").textContent=msg||"Access denied.";}
function renderAll(){renderOverview();renderMembers();renderChannels();renderMessages();renderCalls();renderAudit();renderSecurity();}
function switchTab(tab){activeTab=tab;document.querySelectorAll(".admin-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+tab));}
function actionBar(title,sub,actions=""){return '<div class="section-head"><div><span class="eyebrow">CONTROL</span><h2>'+esc(title)+'</h2><p>'+esc(sub)+'</p></div><div class="section-actions">'+actions+'</div></div>';}
function panel(title,body){return '<div class="panel"><div class="panel-title"><strong>'+esc(title)+'</strong></div>'+body+'</div>';}

function renderOverview(){
 const s=state.stats;
 $("#tab-overview").innerHTML=actionBar("Server overview","A live operational view of everything happening inside this server.","<button class='ghost' data-action='refresh'>Refresh now</button>")+
 '<div class="metrics">'+metric("Members",s.members,s.online+" online","◎")+metric("Messages",s.messages,"Across all channels","≡")+metric("Channels",s.channels,s.textChannels+" text · "+s.voiceChannels+" voice","#")+metric("Live calls",s.activeCalls,s.activeCallParticipants+" participants","◉")+metric("Bans",s.banned,"Currently blocked","⛔")+metric("Audit events",s.auditEvents,"Tracked admin actions","⌁")+'</div>'+
 '<div class="overview-grid">'+
 panel("Server pulse",'<div class="pulse-row"><span>Lock status</span><b class="'+(state.server.settings.locked?"danger-text":"ok-text")+'">'+(state.server.settings.locked?"LOCKED":"OPEN")+'</b></div><div class="pulse-row"><span>Slowmode</span><b>'+state.server.settings.slowmode+'s</b></div><div class="pulse-row"><span>Verification</span><b>'+esc(state.server.settings.verification)+'</b></div><div class="pulse-row"><span>Your role</span><b>'+roleBadge(state.server.role)+'</b></div>')+
 panel("Live activity",state.calls.length?state.calls.map(c=>'<div class="call-row"><span class="call-icon">◉</span><div><strong>#'+esc(c.channelName)+'</strong><span>'+c.participants.length+' participant'+(c.participants.length===1?"":"s")+'</span></div><b>LIVE</b></div>').join(""):'<div class="empty-inline">No active calls right now.</div>')+
 '</div>'+panel("Recent server messages",state.messages.slice(0,8).map(m=>messageRow(m)).join("")||'<div class="empty-inline">No messages yet.</div>');
}
function messageRow(m){const role=(state.members.find(x=>String(x.id)===String(m.user_id))||{}).role||"member";return '<div class="message-row"><div class="avatar">'+esc((m.username||"G").slice(0,1).toUpperCase())+'</div><div class="message-content"><div><strong>'+esc(m.username||"Guest")+'</strong>'+roleBadge(role)+'<span>'+fmt(m.created_at)+'</span></div><p>'+esc(m.content)+'</p><small>#'+esc(m.channel_name||"channel")+'</small></div>'+(can("deleteMessages")?'<button class="danger-btn small" data-delete-message="'+esc(m.id)+'">Delete</button>':"")+'</div>';}
function renderMembers(){
 $("#tab-members").innerHTML=actionBar("Members","Inspect every member and manage server roles.",can("manageMembers")?'<span class="capability">OWNER / ADMIN CONTROLS</span>':'<span class="capability muted">READ ONLY</span>')+
 '<div class="toolbar"><input id="member-search" class="admin-search" placeholder="Search members"><select id="member-status-filter" class="admin-select"><option value="all">All</option><option value="online">Online</option><option value="offline">Offline</option></select></div><div id="member-table-wrap">'+memberTable(state.members)+'</div>'+
 '<div class="subsection"><h3>Banned users</h3><div class="chips">'+(state.bans.length?state.bans.map(u=>'<span class="ban-chip">'+esc(u.username)+' <button data-unban="'+esc(u.id)+'">Unban</button></span>').join(""):'<span class="muted">No bans.</span>')+'</div></div>';
}
function memberTable(list){
 return '<div class="table-wrap"><table><thead><tr><th>User</th><th>Status</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead><tbody>'+list.map(m=>'<tr><td><div class="user-cell"><div class="avatar">'+esc((m.username||"G").slice(0,1).toUpperCase())+'</div><div><strong>'+esc(m.username)+'</strong><span>@'+esc(m.username)+'</span></div></div></td><td><span class="'+(m.status==="online"?"status-online":"status-offline")+'">'+esc(m.status)+'</span></td><td>'+roleBadge(m.role)+'</td><td>'+fmt(m.joinedAt)+'</td><td>'+(can("manageRoles")&&m.role!=="owner"&&(state.server.role==="owner"||m.role!=="admin")?'<select class="role-select" data-role-user="'+esc(m.id)+'"><option value="member" '+(m.role==="member"?"selected":"")+'>member</option><option value="moderator" '+(m.role==="moderator"?"selected":"")+'>moderator</option><option value="admin" '+(m.role==="admin"?"selected":"")+'>admin</option></select> ':"")+(can("manageMembers")&&m.role!=="owner"&&(state.server.role==="owner"||m.role!=="admin")?'<button class="danger-btn small" data-kick="'+esc(m.id)+'">Kick</button><button class="danger-btn small solid" data-ban="'+esc(m.id)+'">Ban</button>':"")+'</td></tr>').join("")+'</tbody></table></div>';
}
function renderChannels(){
 $("#tab-channels").innerHTML=actionBar("Channels","See channel activity and remove broken or obsolete rooms.",'<span class="capability">'+state.channels.length+' TOTAL</span>')+
 '<div class="channel-grid">'+state.channels.map(c=>'<div class="channel-card"><div class="channel-card-top"><span class="channel-type">'+(c.type==="voice"?"VOICE":"TEXT")+'</span><strong>#'+esc(c.name)+'</strong>'+(can("deleteChannels")?'<button class="danger-icon" data-delete-channel="'+esc(c.id)+'">×</button>':"")+'</div><div class="channel-stats"><span>'+c.messageCount+' messages</span><span>'+c.activeParticipants.length+' live</span></div><div class="channel-card-id">'+esc(c.id)+'</div></div>').join("")+'</div>';
}
function renderMessages(){
 $("#tab-messages").innerHTML=actionBar("Message center","Search the server message history and moderate content from one place.","<input id='message-search' class='admin-search compact' placeholder='Search message text, user, channel'>")+
 '<div id="message-list">'+state.messages.map(m=>messageRow(m)).join("")+'</div>';
}
function renderCalls(){
 $("#tab-calls").innerHTML=actionBar("Live calls","Monitor every active voice/video room in this server.","<span class='live-label'>● LIVE</span>")+
 '<div class="calls-grid">'+(state.calls.length?state.calls.map(c=>'<div class="call-card"><div class="call-card-head"><strong>#'+esc(c.channelName)+'</strong><span class="live-label">LIVE</span></div><div class="call-card-main"><div class="participant-stack">'+c.participants.map(p=>'<span title="'+esc(p.username)+'">'+esc((p.username||"G").slice(0,1).toUpperCase())+'</span>').join("")+'</div><div><strong>'+c.participants.length+' participants</strong><small>'+esc(c.mode)+' room</small></div></div></div>').join(""):'<div class="empty-block">No active calls.</div>')+'</div>';
}
function renderAudit(){
 $("#tab-audit").innerHTML=actionBar("Audit log","Server-scoped administrative events with actor, target and timestamp.","<span class='capability'>LAST "+state.audit.length+"</span>")+
 '<div class="audit-list">'+(state.audit.length?state.audit.map(a=>'<div class="audit-row"><div class="audit-mark">⌁</div><div><strong>'+esc(a.action)+'</strong><span>'+esc(a.user_id||"system")+' · '+fmt(a.created_at)+'</span><code>'+esc(JSON.stringify(a.details||{}))+'</code></div></div>').join(""):'<div class="empty-block">No scoped admin events yet.</div>')+'</div>';
}
function renderSecurity(){
 const locked=Boolean(state.server.settings.locked),disabled=isOwnerAdmin()?"":"disabled";
 $("#tab-security").innerHTML=actionBar("Security & controls","High-impact controls are restricted to server owner/admin.",can("manageSecurity")?"<span class='capability'>PRIVILEGED</span>":"<span class='capability muted'>READ ONLY</span>")+
 '<div class="security-grid"><div class="setting-card"><div><strong>Server lock</strong><span>Block ordinary members from sending messages.</span></div><button class="toggle '+(locked?"on":"")+'" '+disabled+' data-toggle-lock>'+ (locked?"LOCKED":"OPEN") +'</button></div>'+
 '<div class="setting-card"><div><strong>Slowmode</strong><span>Minimum delay for regular member messages.</span></div><select class="admin-select" '+disabled+' data-slowmode><option value="0">Off</option><option value="5" '+(state.server.settings.slowmode===5?"selected":"")+'>5 seconds</option><option value="10" '+(state.server.settings.slowmode===10?"selected":"")+'>10 seconds</option><option value="30" '+(state.server.settings.slowmode===30?"selected":"")+'>30 seconds</option><option value="60" '+(state.server.settings.slowmode===60?"selected":"")+'>60 seconds</option><option value="120" '+(state.server.settings.slowmode===120?"selected":"")+'>120 seconds</option></select></div>'+
 '<div class="setting-card"><div><strong>Verification</strong><span>Server entry policy displayed in this control center.</span></div><select class="admin-select" '+disabled+' data-verification><option value="open" '+(state.server.settings.verification==="open"?"selected":"")+'>Open</option><option value="verified" '+(state.server.settings.verification==="verified"?"selected":"")+'>Verified</option><option value="high" '+(state.server.settings.verification==="high"?"selected":"")+'>High</option></select></div></div>';
}
document.addEventListener("click",async e=>{
 try{
  if(e.target.closest("#refresh-btn")||e.target.closest("[data-action='refresh']")){await load();return;}
  if(e.target.closest("#back-btn")||e.target.closest("#denied-back")){location.href="/?server="+encodeURIComponent(serverId);return;}
  const tab=e.target.closest(".admin-tab");if(tab){switchTab(tab.dataset.tab);return;}
  const del=e.target.closest("[data-delete-message]");if(del){if(!confirm("Delete this message for everyone?"))return;await api("/api/messages/"+encodeURIComponent(del.dataset.deleteMessage),{method:"DELETE"});toast("Message deleted");await load();return;}
  const kick=e.target.closest("[data-kick]");if(kick){if(!confirm("Kick this member from the server?"))return;await api("/api/servers/"+serverId+"/admin/members/"+kick.dataset.kick+"/kick",{method:"POST"});toast("Member kicked");await load();return;}
  const ban=e.target.closest("[data-ban]");if(ban){if(!confirm("Ban this member from the server? They will lose access."))return;await api("/api/servers/"+serverId+"/admin/members/"+ban.dataset.ban+"/ban",{method:"POST"});toast("Member banned");await load();return;}
  const unban=e.target.closest("[data-unban]");if(unban){await api("/api/servers/"+serverId+"/admin/members/"+unban.dataset.unban+"/unban",{method:"POST"});toast("Member unbanned");await load();return;}
  const dc=e.target.closest("[data-delete-channel]");if(dc){if(!confirm("Delete this channel and its message history?"))return;await api("/api/servers/"+serverId+"/admin/channels/"+dc.dataset.deleteChannel,{method:"DELETE"});toast("Channel deleted");await load();return;}
  if(e.target.closest("[data-toggle-lock]")){await saveSettings({locked:!state.server.settings.locked});return;}
 }catch(err){toast(err.message,true);}
});
document.addEventListener("change",async e=>{
 try{
  const role=e.target.closest("[data-role-user]");if(role){await api("/api/servers/"+serverId+"/admin/members/"+role.dataset.roleUser+"/role",{method:"PATCH",body:JSON.stringify({role:role.value})});toast("Role updated");await load();return;}
  const slow=e.target.closest("[data-slowmode]");if(slow){await saveSettings({slowmode:Number(slow.value)});return;}
  const ver=e.target.closest("[data-verification]");if(ver){await saveSettings({verification:ver.value});return;}
  if(e.target.id==="member-status-filter")filterMembers();
 }catch(err){toast(err.message,true);}
});
document.addEventListener("input",e=>{if(e.target.id==="member-search")filterMembers();if(e.target.id==="message-search")filterMessages();});
function filterMembers(){const q=String($("#member-search")?.value||"").toLowerCase(),st=String($("#member-status-filter")?.value||"all");$("#member-table-wrap").innerHTML=memberTable(state.members.filter(m=>(!q||m.username.toLowerCase().includes(q))&&(st==="all"||m.status===st)));}
function filterMessages(){const q=String($("#message-search")?.value||"").toLowerCase();$("#message-list").innerHTML=state.messages.filter(m=>!q||m.content.toLowerCase().includes(q)||m.username.toLowerCase().includes(q)||String(m.channel_name||"").toLowerCase().includes(q)).map(messageRow).join("")||'<div class="empty-block">No messages match.</div>';}
async function saveSettings(patch){const result=await api("/api/servers/"+serverId+"/admin/settings",{method:"PATCH",body:JSON.stringify(patch)});if(state?.server)state.server.settings=result.settings;toast("Security settings saved");renderOverview();renderSecurity();}
async function boot(){await load();refreshTimer=setInterval(load,8000);}
boot().catch(e=>showDenied(e.message));
