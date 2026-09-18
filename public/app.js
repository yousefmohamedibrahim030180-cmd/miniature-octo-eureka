const $=s=>document.querySelector(s);
let token=localStorage.getItem("orbit_token")||"", me=null, servers=[], currentServer=null, channels=[], currentChannel=null, socket=null, typingTimer=null;

function api(url,opts={}){opts.headers={...(opts.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};if(opts.body&&!opts.headers["Content-Type"])opts.headers["Content-Type"]="application/json";return fetch(url,opts).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d});}
function showAuth(mode){$("#auth").classList.remove("hidden");$("#app").classList.add("hidden");document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===mode));$("#login-form").classList.toggle("hidden",mode!=="login");$("#register-form").classList.toggle("hidden",mode!=="register");}
function showApp(){$("#auth").classList.add("hidden");$("#app").classList.remove("hidden");}
function fmt(ts){return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});}
function avatar(name){return (name||"U").slice(0,1).toUpperCase();}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showAuth(b.dataset.tab));
$("#login-form").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({login:$("#login").value,password:$("#login-password").value})});token=d.token;localStorage.setItem("orbit_token",token);await boot()}catch(err){$("#auth-error").textContent=err.message}};
$("#register-form").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/auth/register",{method:"POST",body:JSON.stringify({email:$("#reg-email").value,username:$("#reg-username").value,password:$("#reg-password").value})});token=d.token;localStorage.setItem("orbit_token",token);await boot()}catch(err){$("#auth-error").textContent=err.message}};
$("#logout").onclick=()=>{localStorage.removeItem("orbit_token");token="";if(socket)socket.disconnect();showAuth("login")};

async function boot(){
 try{
  const meRes=await api("/api/me");me=meRes.user;showApp();$("#me-name").textContent=me.username;$("#me-avatar").textContent=avatar(me.username);
  if(!socket){socket=io({auth:{token}});wireSocket()}
  await loadServers();
 }catch{localStorage.removeItem("orbit_token");token="";showAuth("login")}
}
function wireSocket(){
 socket.on("connect_error",()=>{});
 socket.on("message:new",m=>{if(currentChannel&&String(m.channel_id)===String(currentChannel.id)) appendMessage(m)});
 socket.on("typing",x=>{if(!currentChannel)return;$("#typing").textContent=x.isTyping?x.username+" is typing…":""});
 socket.on("presence:update",x=>{document.querySelectorAll("[data-user='"+x.userId+"'] .presence").forEach(n=>n.textContent=x.status)});
}
async function loadServers(){const d=await api("/api/servers");servers=d.servers;renderServers();if(!currentServer&&servers[0])selectServer(servers[0]);}
function renderServers(){$("#server-list").innerHTML=servers.map(s=>`<button class="server-item ${currentServer?.id===s.id?"active":""}" data-id="${s.id}" title="${escapeHtml(s.name)}">${escapeHtml(s.name.slice(0,2).toUpperCase())}</button>`).join("");document.querySelectorAll(".server-item").forEach(b=>b.onclick=()=>selectServer(servers.find(s=>String(s.id)===b.dataset.id)))}
async function selectServer(s){currentServer=s;renderServers();$("#workspace-name").textContent=s.name;const d=await api(`/api/servers/${s.id}/channels`);channels=d.channels;$("#workspace-role").textContent=d.role;renderChannels();if(channels[0])selectChannel(channels[0]);loadMembers();}

function renderChannels(){$("#channel-list").innerHTML=channels.map(c=>`<button class="channel ${currentChannel?.id===c.id?"active":""}" data-id="${c.id}"><span class="hash">#</span><span>${escapeHtml(c.name)}</span></button>`).join("");document.querySelectorAll(".channel").forEach(b=>b.onclick=()=>selectChannel(channels.find(c=>String(c.id)===b.dataset.id)))}
async function selectChannel(c){currentChannel=c;renderChannels();$("#channel-name").textContent=c.name;$("#channel-meta").textContent=c.type==="announcement"?"Announcement channel":"Realtime conversation";$("#composer").classList.remove("hidden");$("#message").placeholder="Message #"+c.name;$("#messages").innerHTML="";const d=await api(`/api/channels/${c.id}/messages`);d.messages.forEach(appendMessage);socket.emit("channel:join",c.id);}

function appendMessage(m){const e=document.createElement("article");e.className="message";e.innerHTML=`<div class="avatar">${escapeHtml(avatar(m.username))}</div><div><div class="msg-head"><strong>${escapeHtml(m.username)}</strong><time>${fmt(m.created_at)}</time></div><div class="msg-body">${escapeHtml(m.content)}</div></div>`;$("#messages").appendChild(e);$("#messages").scrollTop=$("#messages").scrollHeight}
$("#composer").onsubmit=e=>{e.preventDefault();const v=$("#message").value.trim();if(v&&socket&&currentChannel){socket.emit("message:send",{channelId:currentChannel.id,content:v});$("#message").value="";socket.emit("typing",{channelId:currentChannel.id,isTyping:false})}};
$("#message").oninput=()=>{if(!socket||!currentChannel)return;socket.emit("typing",{channelId:currentChannel.id,isTyping:true});clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit("typing",{channelId:currentChannel.id,isTyping:false}),900)};

$("#new-server").onclick=()=>openModal("Create a server",`<input id="server-name" placeholder="e.g. Orbit Community"><button class="primary" id="create-server">Create server</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="create-server"){try{const d=await api("/api/servers",{method:"POST",body:JSON.stringify({name:$("#server-name").value})});closeModal();await loadServers();selectServer(d.server)}catch(err){alert(err.message)}}
if(e.target.id==="new-channel"){if(!currentServer)return;openModal("Create channel",`<input id="channel-name-input" placeholder="general"><select id="channel-type"><option value="text">Text</option><option value="announcement">Announcement</option></select><button class="primary" id="create-channel">Create channel</button>`)}
if(e.target.id==="create-channel"){try{const d=await api(`/api/servers/${currentServer.id}/channels`,{method:"POST",body:JSON.stringify({name:$("#channel-name-input").value,type:$("#channel-type").value})});closeModal();channels.push(d.channel);renderChannels();selectChannel(d.channel)}catch(err){alert(err.message)}}
if(e.target.id==="invite-btn"&&currentServer){try{const d=await api(`/api/servers/${currentServer.id}/invites`,{method:"POST",body:"{}"});openModal("Invite link",`<input value="${location.origin}/?invite=${d.invite.code}" readonly><p style="color:#8b93a3;font-size:12px">Valid for 7 days.</p>`)}catch(err){alert(err.message)}}
if(e.target.id==="members-btn"){ $("#members-panel").classList.remove("hidden");loadMembers()}
if(e.target.id==="close-members"){ $("#members-panel").classList.add("hidden")}
if(e.target.id==="admin-btn"){ if(currentServer)openControl() }
if(e.target.id==="modal-close")closeModal();
});
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
$("#new-channel").onclick=null;
async function loadMembers(){if(!currentServer)return;const d=await api(`/api/servers/${currentServer.id}/members`);$("#member-list").innerHTML=d.members.map(m=>`<div class="member" data-user="${m.id}"><div class="avatar">${escapeHtml(avatar(m.username))}</div><div class="member-info"><strong>${escapeHtml(m.username)}</strong><span class="presence">${m.status} · ${m.role}</span></div></div>`).join("")}
function openControl(){openModal("Control center",`<div class="control-grid"><div class="control-row"><strong>Server</strong><span>${escapeHtml(currentServer.name)}</span></div><div class="control-row"><strong>Role model</strong><span>Owner · Admin · Moderator · Member</span></div><div class="control-row"><strong>Realtime</strong><span>Socket.IO rooms, typing, presence and live messages</span></div><div class="control-row"><strong>Security</strong><span>JWT sessions, bcrypt passwords, server-side permission checks</span></div><button class="primary" id="regen-invite">Generate fresh invite</button></div>`)}
document.addEventListener("click",async e=>{if(e.target.id==="regen-invite"){try{const d=await api(`/api/servers/${currentServer.id}/invites`,{method:"POST",body:"{}"});openModal("Fresh invite",`<input value="${location.origin}/?invite=${d.invite.code}" readonly>`)}catch(err){alert(err.message)}}});
function openModal(title,body){$("#modal-title").textContent=title;$("#modal-body").innerHTML=body;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
function escapeHtml(x){return String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

(async()=>{if(token)await boot();else showAuth("login");const invite=new URLSearchParams(location.search).get("invite");if(invite&&token){try{await api("/api/invites/"+invite+"/accept",{method:"POST",body:"{}"});await loadServers();}catch{}}})();