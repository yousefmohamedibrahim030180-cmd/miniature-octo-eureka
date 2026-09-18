/* ORBIT DESK product layer */
(function(){
  "use strict";
  if(window.__orbitDeskInstalled)return;
  window.__orbitDeskInstalled=true;

  function q(s){return document.querySelector(s)}
  function esc(x){return String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
  function go(view){try{setView(view)}catch(e){console.warn(e)}}
  function chat(){try{goChat()}catch(e){console.warn(e)}}
  function fmtTime(ts){if(!ts)return "";const d=new Date(ts);return Number.isNaN(d.getTime())?"":d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
  function currentProjectTasks(projects){
    const selected=orbitUI.projectId&&projects.find(p=>String(p.id)===String(orbitUI.projectId));
    return (selected||projects[0])?.tasks||[];
  }

  async function renderDesk(){
    if(!q("#page-body"))return;
    const server=currentServer||null;
    q("#page-actions").innerHTML=
      '<button id="desk-search">Search Orbit</button><button id="desk-chat" class="primary">Open Space</button>';

    q("#page-body").innerHTML=
      '<div class="orbit-desk">'+
        '<header class="orbit-desk-head">'+
          '<div class="orbit-desk-title"><span class="orbit-desk-kicker">ORBIT WORKSPACE</span><h2>Your Desk</h2><p>One place to talk, meet, plan, and move work forward.</p></div>'+
          '<div class="orbit-desk-head-actions"><button class="orbit-desk-btn" id="desk-focus">Focus</button><button class="orbit-desk-btn" id="desk-ai">ORBIT AI</button><button class="orbit-desk-btn primary" id="desk-new-chat">New conversation</button></div>'+
        '</header>'+
        '<div class="orbit-desk-grid">'+
          '<main class="orbit-desk-main">'+
            '<section class="orbit-desk-card orbit-continue">'+
              '<div class="orbit-continue-copy"><span class="eyebrow">CONTINUE WHERE YOU LEFT OFF</span><h3>'+(server?esc(server.name):'Orbit Lobby')+'</h3><p>'+(server?'Pick up the current conversation, jump into a live room, or work on shared tasks without leaving your community.':'Create or join a community and Orbit will turn it into a shared workspace.')+'</p>'+
              '<div class="orbit-continue-meta"><span class="orbit-desk-chip"><b>'+(server?esc(currentChannel?.name||"general"):'No space')+'</b> current Space</span><span class="orbit-desk-chip"><b>'+(pulseState.users||[]).filter(u=>String(u.status||"online")!=="offline").length+'</b> online</span><span class="orbit-desk-chip"><b>'+(pulseState.calls||[]).length+'</b> live rooms</span></div></div>'+
              '<div class="orbit-continue-action"><button id="desk-open-space" class="orbit-desk-btn primary">Open current Space →</button></div>'+
            '</section>'+
            '<div class="orbit-desk-statline" id="desk-stats"></div>'+
            '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Live now</strong><span>People and rooms that need attention</span></div><button class="orbit-desk-btn" id="desk-calls">View all</button></div><div id="desk-live-list" class="orbit-desk-list"></div></section>'+
            '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Shared work</strong><span>Tasks from the active community</span></div><button class="orbit-desk-btn" id="desk-projects">Projects</button></div><div id="desk-tasks"></div></section>'+
          '</main>'+
          '<aside class="orbit-desk-side">'+
            '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Activity</strong><span>Realtime workspace feed</span></div></div><div id="desk-activity" class="orbit-desk-list"></div></section>'+
            '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Upcoming</strong><span>Community events</span></div><button class="orbit-desk-btn" id="desk-events">Events</button></div><div id="desk-events-list" class="orbit-desk-list"></div></section>'+
          '</aside>'+
        '</div>'+
        '<div class="orbit-desk-footgrid">'+
          '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Recent files</strong><span>Shared workspace files</span></div><button class="orbit-desk-btn" id="desk-files">Files</button></div><div id="desk-files-list" class="orbit-desk-list"></div></section>'+
          '<section class="orbit-desk-card"><div class="orbit-desk-card-head"><div><strong>Why Orbit</strong><span>The product model</span></div></div><div class="orbit-desk-list"><div class="orbit-desk-item"><div class="orbit-desk-icon">◈</div><div class="orbit-desk-item-main"><strong>Conversation + execution</strong><span>Chat, calls, projects, files and events stay in the same workspace.</span></div></div><div class="orbit-desk-item"><div class="orbit-desk-icon">⌘</div><div class="orbit-desk-item-main"><strong>Fewer context switches</strong><span>Open the work surface you need without rebuilding your workflow in another tool.</span></div></div></div></section>'+
        '</div>'+
      '</div>';

    $("#desk-search").onclick=()=>openSearchModal("");
    $("#desk-chat").onclick=chat;
    $("#desk-open-space").onclick=chat;
    $("#desk-new-chat").onclick=()=>{chat();$("#message")?.focus()};
    $("#desk-focus").onclick=()=>{document.body.classList.toggle("orbit-focus-on");orbitToast("Focus mode",document.body.classList.contains("orbit-focus-on")?"Focus enabled":"Focus disabled","success")};
    $("#desk-ai").onclick=()=>go("ai");
    $("#desk-calls").onclick=()=>go("calls");
    $("#desk-projects").onclick=()=>go("projects");
    $("#desk-events").onclick=()=>go("events");
    $("#desk-files").onclick=()=>go("files");

    const pulse=pulseState||{users:[],calls:[],activity:[]};
    const users=(pulse.users||[]).filter(u=>String(u.status||"online")!=="offline");
    const calls=(pulse.calls||[]).slice(0,5);
    const activity=(pulse.activity||[]).slice(0,6);

    q("#desk-stats").innerHTML=
      '<div class="orbit-desk-stat"><span>Communities</span><strong>'+servers.length+'</strong><small>Connected workspaces</small></div>'+
      '<div class="orbit-desk-stat"><span>People online</span><strong>'+users.length+'</strong><small>Realtime presence</small></div>'+
      '<div class="orbit-desk-stat"><span>Live rooms</span><strong>'+calls.length+'</strong><small>Active voice/video</small></div>'+
      '<div class="orbit-desk-stat"><span>Current Space</span><strong>'+esc(currentChannel?.name||"general")+'</strong><small>'+esc(server?.name||"Orbit Lobby")+'</small></div>';

    q("#desk-live-list").innerHTML=calls.length?calls.map(c=>
      '<button class="orbit-desk-item" data-desk-call="'+esc(c.channelId)+'"><div class="orbit-desk-icon">◉</div><div class="orbit-desk-item-main"><strong>#'+esc(c.channelName||"room")+'</strong><span>'+esc(c.mode==="voice"?"Voice":"Video")+' · '+((c.participants||[]).length||0)+' participants</span></div><span class="orbit-desk-item-end">Join →</span></button>'
    ).join(""):'<div class="orbit-desk-empty"><strong>No live rooms</strong>Start a room when you are ready.</div>';
    document.querySelectorAll("[data-desk-call]").forEach(b=>b.onclick=async()=>{
      const c=calls.find(x=>String(x.channelId)===String(b.dataset.deskCall)); if(!c)return;
      const s=servers.find(x=>String(x.id)===String(c.serverId)); if(s)await selectServer(s);
      const ch=(channels||[]).find(x=>String(x.id)===String(c.channelId)); if(ch)await selectChannel(ch);
      chat();
    });

    q("#desk-activity").innerHTML=activity.length?activity.map(a=>{
      const u=a.user||{}; let t="Activity";
      if(a.type==="message")t="message in #"+(a.channelName||"channel");
      if(a.type==="call-start")t="joined "+(a.mode==="voice"?"voice":"video");
      if(a.type==="call-end")t="left "+(a.channelName||"room");
      if(a.type==="screen-share")t="started screen share";
      if(a.type==="presence")t="presence: "+(a.activity||u.status||"online");
      return '<button class="orbit-desk-item" data-desk-user="'+esc(u.id||"")+'"><div class="orbit-desk-icon">✦</div><div class="orbit-desk-item-main"><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>'+esc(t)+(a.preview?' · '+esc(a.preview):"")+'</span></div><span class="orbit-desk-item-end">'+fmtTime(a.createdAt)+'</span></button>';
    }).join(""):'<div class="orbit-desk-empty"><strong>No activity yet</strong>New actions will appear here.</div>';
    document.querySelectorAll("[data-desk-user]").forEach(b=>b.onclick=()=>openPulseProfile(b.dataset.deskUser));

    let projects=[],events=[],files=[];
    try{
      const tasksUrl=server?"/api/servers/"+encodeURIComponent(server.id)+"/projects":null;
      const eventsUrl=server?"/api/servers/"+encodeURIComponent(server.id)+"/events?upcoming=1":null;
      const [p,e,f]=await Promise.all([
        tasksUrl?api(tasksUrl):Promise.resolve({projects:[]}),
        eventsUrl?api(eventsUrl):Promise.resolve({events:[]}),
        api("/api/files?limit=6")
      ]);
      projects=p.projects||[]; events=e.events||[]; files=f.files||[];
    }catch(err){
      console.warn("Desk data",err);
    }

    const tasks=currentProjectTasks(projects).slice(0,5);
    q("#desk-tasks").innerHTML=tasks.length?tasks.map(t=>
      '<button class="orbit-task-row" data-desk-task="1"><span class="orbit-task-dot"></span><span class="orbit-task-copy"><strong>'+esc(t.title||"Task")+'</strong><span>'+esc(t.label||"Workspace")+'</span></span><span class="orbit-task-status">'+esc(t.status||"backlog")+'</span></button>'
    ).join(""):'<div class="orbit-desk-empty"><strong>No shared tasks</strong>'+ (server?'Create a project to turn conversation into trackable work.':'Select a community to see shared projects.')+'</div>';
    q("#desk-tasks").querySelectorAll("[data-desk-task]").forEach(b=>b.onclick=()=>go("projects"));

    q("#desk-events-list").innerHTML=events.length?events.slice(0,4).map(e=>{
      const d=new Date(e.when);
      return '<button class="orbit-desk-item" data-desk-event="1"><div class="orbit-desk-icon">◷</div><div class="orbit-desk-item-main"><strong>'+esc(e.title)+'</strong><span>'+esc(e.type||"Community")+' · '+(Number(e.rsvpCount||0))+' going</span></div><span class="orbit-desk-item-end">'+(Number.isNaN(d.getTime())?"":d.toLocaleDateString([],{month:"short",day:"numeric"}))+'</span></button>';
    }).join(""):'<div class="orbit-desk-empty"><strong>No upcoming events</strong>'+ (server?'Schedule the next community moment.':'Choose a community first.')+'</div>';
    q("#desk-events-list").querySelectorAll("[data-desk-event]").forEach(b=>b.onclick=()=>go("events"));

    q("#desk-files-list").innerHTML=files.length?files.slice(0,5).map(f=>
      '<button class="orbit-desk-item" data-desk-file="1"><div class="orbit-desk-icon">'+(String(f.type||"").includes("pdf")?"PDF":"FILE")+'</div><div class="orbit-desk-item-main"><strong>'+esc(f.name||"file")+'</strong><span>'+Math.max(0,Math.round(Number(f.size||0)/1024))+' KB · '+esc(f.type||"file")+'</span></div><span class="orbit-desk-item-end">Open →</span></button>'
    ).join(""):'<div class="orbit-desk-empty"><strong>No recent files</strong>Upload a file from the Files workspace.</div>';
    q("#desk-files-list").querySelectorAll("[data-desk-file]").forEach(b=>b.onclick=()=>go("files"));
  }

  const base=window.renderHomePage;
  if(typeof base==="function" && !base.__orbitDesk){
    function wrapped(){
      base.apply(this,arguments);
      renderDesk().catch(e=>console.warn("Orbit Desk render",e));
    }
    wrapped.__orbitDesk=true;
    window.renderHomePage=wrapped;
  }
  setTimeout(()=>{if(orbitUI?.view==="home")renderDesk().catch(()=>{})},0);
})();