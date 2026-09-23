(() => {
  "use strict";
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const STORE_KEY="orbit_ui_preferences_v2";
  const readPrefs=()=>{try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}")}catch{return{}}};
  const prefs=readPrefs();
  const savePrefs=()=>localStorage.setItem(STORE_KEY,JSON.stringify(prefs));
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const letter=u=>String(u?.display_name||u?.username||"G").slice(0,1).toUpperCase();
  function applyPrefs(){
    const b=document.body;
    ["orbit-theme-aurora","orbit-theme-ice","orbit-theme-graphite","orbit-compact","orbit-reduce-motion"].forEach(c=>b.classList.remove(c));
    if(prefs.theme&&prefs.theme!=="default")b.classList.add("orbit-theme-"+prefs.theme);
    if(prefs.compact)b.classList.add("orbit-compact");
    if(prefs.reduceMotion)b.classList.add("orbit-reduce-motion");
  }
  applyPrefs();

  const tabs=[
    ["profile","◎","Profile","Account"],
    ["atmosphere","◌","Experience Lab","Atmospheres"],
    ["appearance","✦","Appearance","Interface"],
    ["notifications","♢","Notifications","Alerts"],
    ["privacy","◌","Privacy & Safety","Control"],
    ["voice","◉","Voice & Video","Calls"],
    ["shortcuts","⌘","Shortcuts","Keyboard"],
    ["session","□","Session","Security"]
  ];

  const state={tab:"profile"};

  function settingsShell(){
    return '<div class="page" id="settings-v2">'+
      '<div class="settings-shell">'+
        '<aside class="settings-nav"><div class="settings-nav-title"><strong>ORBIT SETTINGS</strong><span>Personalize your workspace, chats and account.</span></div>'+
          tabs.map(t=>'<button class="settings-tab '+(state.tab===t[0]?"active":"")+'" data-setting-tab="'+t[0]+'"><b>'+t[1]+'</b><span>'+t[2]+'</span><small>'+t[3]+'</small></button>').join("")+
        '</aside>'+
        '<section class="settings-content" id="settings-content"></section>'+
      '</div>'+
    '</div>';
  }

  function settingHeader(k,title,desc){state.tab=k;const c=$("#settings-content");if(!c)return;c.innerHTML='<span class="eyebrow">ORBIT SETTINGS / '+esc(title.toUpperCase())+'</span><h2>'+esc(title)+'</h2><p class="settings-sub">'+esc(desc)+'</p>';return c}
  function rowControl(title,desc,control){return '<div class="settings-row"><div class="settings-row-main"><strong>'+esc(title)+'</strong><span>'+esc(desc)+'</span></div><div class="setting-control">'+control+'</div></div>'}
  function toggle(id,on){return '<button class="toggle '+(on?"on":"")+'" id="'+id+'" aria-pressed="'+(on?"true":"false")+'"></button>'}

  function renderProfile(){
    const c=settingHeader("profile","Profile","Your public identity inside ORBIT.");
    const u=window.__ORBIT_USER||{};
    c.innerHTML+='<div class="profile-banner">'+
      '<span class="avatar">'+(u.avatar_url?'<img src="'+esc(u.avatar_url)+'" alt="">':esc(letter(u)))+'</span>'+
      '<div><strong>'+esc(u.display_name||u.username||"Guest")+'</strong><span>@'+esc(u.username||"guest")+'</span></div></div>'+
      '<div class="settings-card"><h3>Profile details</h3><p>These fields are synchronized with your ORBIT account.</p>'+
      '<div class="form"><label>Display name<input class="input" id="v2-name" value="'+esc(u.display_name||"")+'"></label>'+
      '<label>Bio<textarea class="textarea" id="v2-bio">'+esc(u.bio||"")+'</textarea></label>'+
      '<label>Activity<input class="input" id="v2-activity" value="'+esc(u.activity||"Online")+'"></label></div>'+
      '<div class="settings-actions"><button class="btn primary" id="v2-profile-save">Save profile</button></div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Account</h3><p>@'+esc(u.username||"guest")+' · Profile changes are stored on the ORBIT server.</p>'+
      '<div class="settings-note">Avatar management can be connected to the existing files service without changing the realtime layer.</div></div>';
    $("#v2-profile-save").onclick=async()=>{try{
      const r=await fetch("/api/me",{method:"PATCH",headers:{"Content-Type":"application/json","Authorization":"Bearer "+(localStorage.getItem("orbit_token")||"")},body:JSON.stringify({displayName:$("#v2-name").value,bio:$("#v2-bio").value,activity:$("#v2-activity").value})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to save");
      window.__ORBIT_USER=d.user||u; if(typeof window.__ORBIT_REFRESH_CHROME==="function")window.__ORBIT_REFRESH_CHROME();toastV2("Profile saved","Your profile was updated.");
      renderProfile();
    }catch(e){toastV2("Profile",e.message,true)}};
  }

  function renderAppearance(){
    const c=settingHeader("appearance","Appearance","Tune the visual language of ORBIT on this device.");
    const theme=prefs.theme||"default";
    const choices=[["default","Midnight","linear-gradient(135deg,#101621,#1b2030)"],["aurora","Aurora","linear-gradient(135deg,#33215d,#0c4b57)"],["ice","Ice","linear-gradient(135deg,#1c315f,#123f4c)"],["graphite","Graphite","linear-gradient(135deg,#30343c,#16191e)"]];
    c.innerHTML+='<div class="settings-card"><h3>Theme</h3><p>Choose the ambient color system used across the rebuilt interface.</p><div class="theme-grid">'+choices.map(x=>'<button class="theme-option '+(theme===x[0]?"active":"")+'" data-theme="'+x[0]+'"><div class="theme-swatch" style="background:'+x[2]+'"></div><span class="theme-name">'+x[1]+'</span></button>').join("")+'</div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Layout</h3><p>Control density and motion without changing the application structure.</p>'+
      rowControl("Compact chat","Reduce message and composer spacing.",toggle("set-compact",!!prefs.compact))+
      rowControl("Reduced motion","Minimize transitions and UI animation.",toggle("set-motion",!!prefs.reduceMotion))+
      rowControl("Glass surfaces","Keep the elevated translucent panels.",toggle("set-glass",prefs.glass!==false))+'</div>';
    $$("[data-theme]").forEach(b=>b.onclick=()=>{prefs.theme=b.dataset.theme;savePrefs();applyPrefs();renderAppearance()});
    $("#set-compact").onclick=()=>{prefs.compact=!prefs.compact;savePrefs();applyPrefs();renderAppearance()};
    $("#set-motion").onclick=()=>{prefs.reduceMotion=!prefs.reduceMotion;savePrefs();applyPrefs();renderAppearance()};
    $("#set-glass").onclick=()=>{prefs.glass=prefs.glass===false;savePrefs();document.body.classList.toggle("orbit-no-glass",prefs.glass===false);renderAppearance()};
  }

  function renderAtmosphere(){
    const c=settingHeader("atmosphere","Experience Lab","Turn ORBIT into a living space. Choose an atmosphere, lighting balance and motion level.");
    const current=window.__ORBIT_GET_ATMOSPHERE?.()||{mode:"nebula",light:"balanced",speed:42,stars:68,glow:66,parallax:true,motion:true};
    const modes=window.__ORBIT_ATMOSPHERES||[];
    const preview=mode=>window.__ORBIT_ATMOSPHERE_PREVIEW?window.__ORBIT_ATMOSPHERE_PREVIEW(mode):"";
    c.innerHTML +=
      '<div class="settings-card atmosphere-hero"><div class="experience-hero-copy"><span class="eyebrow">LIVING ORBIT</span><h3>Make the interface feel alive.</h3><p>Background motion stays behind your content so the chat remains clear. Your atmosphere is remembered on this device.</p></div><div class="experience-current">'+(preview(current.mode)||"")+'<span class="experience-current-label" data-orbit-preview-label></span></div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Atmosphere Gallery</h3><p>Choose from a large collection of space-inspired scenes.</p><div class="atmosphere-grid">'+modes.map(m=>'<button class="atmosphere-option '+(current.mode===m[0]?"active":"")+'" data-atmosphere="'+m[0]+'">'+preview(m[0])+'<span class="atmosphere-name">'+esc(m[1])+'</span><span class="atmosphere-type">'+esc(m[3])+' balance · '+esc(m[2])+'</span></button>').join("")+'</div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Light Balance</h3><p>Keep the interface deep, balanced or noticeably brighter without changing the content layout.</p><div class="light-balance">'+["dark","balanced","light"].map(v=>'<button class="'+(current.light===v?"active":"")+'" data-light="'+v+'">'+(v==="dark"?"Deep":v==="balanced"?"Balanced":"Light")+'</button>').join("")+'</div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Motion & depth</h3><p>Tune the energy level of the environment.</p>'+
      rowControl("Background motion","Let nebula clouds and orbital glow breathe behind the interface.",toggle("set-atm-motion",current.motion!==false))+
      rowControl("Mouse parallax","Move the environment subtly with your pointer.",toggle("set-atm-parallax",current.parallax!==false))+
      '<div class="settings-slider-row"><div><strong>Motion speed</strong><span>Ambient movement intensity.</span></div><input id="atm-speed" type="range" min="10" max="90" value="'+Number(current.speed||42)+'"><output id="atm-speed-value">'+Number(current.speed||42)+'</output></div>'+
      '<div class="settings-slider-row"><div><strong>Star density</strong><span>More particles create a deeper space field.</span></div><input id="atm-stars" type="range" min="15" max="100" value="'+Number(current.stars||68)+'"><output id="atm-stars-value">'+Number(current.stars||68)+'</output></div>'+
      '<div class="settings-slider-row"><div><strong>Glow intensity</strong><span>Control ambient light around the orbits.</span></div><input id="atm-glow" type="range" min="15" max="100" value="'+Number(current.glow||66)+'"><output id="atm-glow-value">'+Number(current.glow||66)+'</output></div>'+
      '</div>';

    const update=patch=>window.__ORBIT_SET_ATMOSPHERE?.({...current,...patch});
    $("[data-atmosphere]").forEach(b=>b.onclick=()=>{update({mode:b.dataset.atmosphere});renderAtmosphere()});
    $("[data-light]").forEach(b=>b.onclick=()=>{update({light:b.dataset.light});renderAtmosphere()});
    $("#set-atm-motion").onclick=()=>{update({motion:!(current.motion!==false)});renderAtmosphere()};
    $("#set-atm-parallax").onclick=()=>{update({parallax:!(current.parallax!==false)});renderAtmosphere()};
    [["atm-speed","speed","atm-speed-value"],["atm-stars","stars","atm-stars-value"],["atm-glow","glow","atm-glow-value"]].forEach(([id,key,out])=>{
      $("#"+id).oninput=e=>{$("#"+out).textContent=e.target.value;update({[key]:Number(e.target.value)})};
    });
  }

  function renderNotifications(){
    const c=settingHeader("notifications","Notifications","Choose how ORBIT behaves when activity arrives.");
    prefs.notifications=prefs.notifications||{};
    c.innerHTML+='<div class="settings-card"><h3>Alerts</h3><p>These preferences are stored on this device and are safe to change at any time.</p>'+
      rowControl("Message alerts","Show realtime message toasts.",toggle("set-msg-alerts",prefs.notifications.messages!==false))+
      rowControl("Friend requests","Show incoming friend request alerts.",toggle("set-friend-alerts",prefs.notifications.friends!==false))+
      rowControl("Call notifications","Show incoming call surfaces.",toggle("set-call-alerts",prefs.notifications.calls!==false))+
      '</div><div class="settings-card" style="margin-top:12px"><h3>Badge counts</h3><p>Control attention indicators in the top bar.</p>'+
      rowControl("Unread badges","Show unread message and notification counts.",toggle("set-badges",prefs.notifications.badges!==false))+'</div>';
    const binds=[
      ["set-msg-alerts","messages"],["set-friend-alerts","friends"],["set-call-alerts","calls"],["set-badges","badges"]
    ];
    binds.forEach(([id,k])=>$("#"+id).onclick=()=>{prefs.notifications[k]=prefs.notifications[k]===false;savePrefs();renderNotifications()});
  }

  function renderPrivacy(){
    const c=settingHeader("privacy","Privacy & Safety","Local controls for how your interface exposes account activity.");
    prefs.privacy=prefs.privacy||{};
    c.innerHTML+='<div class="settings-card"><h3>Presence</h3><p>These UI controls affect what ORBIT displays locally; server-side presence rules remain unchanged.</p>'+
      rowControl("Blur previews","Hide message previews in list surfaces.",toggle("set-blur",!!prefs.privacy.blurPreviews))+
      rowControl("Hide activity text","Collapse activity metadata in compact lists.",toggle("set-hide-activity",!!prefs.privacy.hideActivity))+
      '</div><div class="settings-card" style="margin-top:12px"><h3>Safety</h3><p>Keep your account secure on shared devices.</p>'+
      '<div class="settings-note">Use Sign out from the Session section whenever you move to another device. Authentication continues to use the existing ORBIT token and API.</div></div>';
    $("#set-blur").onclick=()=>{prefs.privacy.blurPreviews=!prefs.privacy.blurPreviews;savePrefs();applyPrivacy();renderPrivacy()};
    $("#set-hide-activity").onclick=()=>{prefs.privacy.hideActivity=!prefs.privacy.hideActivity;savePrefs();applyPrivacy();renderPrivacy()};
  }
  function applyPrivacy(){
    document.body.classList.toggle("orbit-blur-previews",!!prefs.privacy?.blurPreviews);
    document.body.classList.toggle("orbit-hide-activity",!!prefs.privacy?.hideActivity);
  }

  function renderVoice(){
    const c=settingHeader("voice","Voice & Video","Device-side defaults for ORBIT calls.");
    prefs.voice=prefs.voice||{};
    c.innerHTML+='<div class="settings-card"><h3>Call preferences</h3><p>These choices shape the local call experience while the existing WebRTC transport remains unchanged.</p>'+
      '<div class="settings-row"><div class="settings-row-main"><strong>Preferred quality</strong><span>Used as your local reference for call setup.</span></div><div class="setting-control"><select class="select-control" id="set-quality"><option '+(prefs.voice.quality==="auto"?"selected":"")+' value="auto">Auto</option><option '+(prefs.voice.quality==="high"?"selected":"")+' value="high">High</option><option '+(prefs.voice.quality==="balanced"?"selected":"")+' value="balanced">Balanced</option><option '+(prefs.voice.quality==="data"?"selected":"")+' value="data">Data saver</option></select></div></div>'+
      rowControl("Join muted","Start calls with your microphone preference remembered.",toggle("set-muted",!!prefs.voice.joinMuted))+
      rowControl("Keep camera off","Prefer voice-first sessions on this device.",toggle("set-camoff",!!prefs.voice.cameraOff))+
      '</div><div class="settings-card" style="margin-top:12px"><h3>Connection</h3><p>The realtime socket and WebRTC signaling remain managed by the existing ORBIT service.</p><div class="settings-note">STUN/TURN configuration is supplied by <code>/api/realtime-config</code>.</div></div>';
    $("#set-quality").onchange=e=>{prefs.voice.quality=e.target.value;savePrefs()};
    $("#set-muted").onclick=()=>{prefs.voice.joinMuted=!prefs.voice.joinMuted;savePrefs();renderVoice()};
    $("#set-camoff").onclick=()=>{prefs.voice.cameraOff=!prefs.voice.cameraOff;savePrefs();renderVoice()};
  }

  function renderShortcuts(){
    const c=settingHeader("shortcuts","Shortcuts","Fast controls for navigation and messaging.");
    c.innerHTML+='<div class="settings-card"><h3>Keyboard</h3><p>These shortcuts are already wired into the rebuilt shell.</p>'+
      '<div class="settings-row"><div class="settings-row-main"><strong>Search</strong><span>Open global search.</span></div><div class="setting-control"><kbd>Ctrl / ⌘ + K</kbd></div></div>'+
      '<div class="settings-row"><div class="settings-row-main"><strong>Escape</strong><span>Close the active modal.</span></div><div class="setting-control"><kbd>Esc</kbd></div></div>'+
      '<div class="settings-row"><div class="settings-row-main"><strong>Command</strong><span>Open the command center from the top bar.</span></div><div class="setting-control"><kbd>⌘</kbd></div></div>'+
      '</div>';
  }

  function renderSession(){
    const c=settingHeader("session","Session","Account session and local preferences.");
    const u=window.__ORBIT_USER||{};
    c.innerHTML+='<div class="settings-card"><h3>Current account</h3><p>Signed in as <b>@'+esc(u.username||"guest")+'</b>.</p>'+
      '<div class="settings-note">ORBIT uses the current access token in this browser. Signing out clears the token and returns to secure access.</div>'+
      '<div class="settings-actions"><button class="btn settings-danger" id="v2-signout">Sign out</button></div></div>'+
      '<div class="settings-card" style="margin-top:12px"><h3>Reset local interface</h3><p>Restore default theme, density and local notification preferences.</p><button class="btn" id="v2-reset">Reset preferences</button></div>';
    $("#v2-signout").onclick=()=>{localStorage.removeItem("orbit_token");localStorage.removeItem(STORE_KEY);location.reload()};
    $("#v2-reset").onclick=()=>{localStorage.removeItem(STORE_KEY);location.reload()};
  }

  function renderTab(){
    if(!$("#settings-content"))return;
    ({
      profile:renderProfile,atmosphere:renderAtmosphere,appearance:renderAppearance,notifications:renderNotifications,
      privacy:renderPrivacy,voice:renderVoice,shortcuts:renderShortcuts,session:renderSession
    }[state.tab]||renderProfile)();
    $$(".settings-tab").forEach(b=>b.classList.toggle("active",b.dataset.settingTab===state.tab));
  }

  function enhanceSettings(){
    const root=$("#surface");
    if(!root||!root.querySelector(".page")||$("#settings-v2"))return;
    if(document.querySelector("#top-title")?.textContent!=="Settings")return;
    window.__ORBIT_USER=window.__ORBIT_USER||window.__ORBIT_LAST_USER||{};
    root.innerHTML=settingsShell();
    $$(".settings-tab").forEach(b=>b.onclick=()=>{state.tab=b.dataset.settingTab;renderTab()});
    applyPrivacy();renderTab();
  }

  function toastV2(t,b,err=false){
    const stack=$("#toast-stack");if(!stack)return;
    const n=document.createElement("div");n.className="toast";n.innerHTML="<strong>"+esc(t)+"</strong><span>"+esc(b||"")+"</span>";
    if(err)n.style.borderColor="#ff647e45";stack.appendChild(n);setTimeout(()=>n.remove(),3500);
  }


  window.__ORBIT_ENHANCE_SETTINGS=enhanceSettings;
  window.__ORBIT_SETTINGS_V2=true;
})();