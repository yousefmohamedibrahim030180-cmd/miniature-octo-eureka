const { contextBridge, ipcRenderer } = require("electron");

const STYLE_ID = "orbit-desktop-mythic-style";
const BAR_ID = "orbit-desktop-titlebar";

function installDesktopChrome(){
  if(!document.documentElement)return;
  document.documentElement.classList.add("orbit-desktop-runtime");
  document.body?.classList.add("orbit-desktop-app");
  if(!document.body || document.getElementById(BAR_ID))return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    html.orbit-desktop-runtime, body.orbit-desktop-app{background:#070910!important}
    body.orbit-desktop-app{padding-top:36px!important;box-sizing:border-box}
    #orbit-desktop-titlebar{position:fixed;left:0;right:0;top:0;height:36px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:0 10px 0 14px;background:linear-gradient(180deg,rgba(10,12,20,.98),rgba(8,10,16,.96));border-bottom:1px solid rgba(117,128,255,.18);box-shadow:0 8px 30px rgba(0,0,0,.22),inset 0 -1px 0 rgba(255,255,255,.025);-webkit-app-region:drag;font-family:Inter,system-ui,sans-serif}
    #orbit-desktop-titlebar .od-brand{display:flex;align-items:center;gap:9px;min-width:180px}
    #orbit-desktop-titlebar .od-orb{width:19px;height:19px;border-radius:50%;display:grid;place-items:center;color:#dbe0ff;font-size:10px;font-weight:900;background:conic-gradient(from 0deg,#7c86ff,#b76cff,#47d6ff,#7c86ff);box-shadow:0 0 18px rgba(104,118,255,.55),0 0 40px rgba(73,214,255,.12)}
    #orbit-desktop-titlebar .od-brand strong{font-size:9px;letter-spacing:.24em;color:#f5f7ff}
    #orbit-desktop-titlebar .od-brand span{font-size:8px;color:#70778e;letter-spacing:.11em}
    #orbit-desktop-titlebar .od-spacer{flex:1}
    #orbit-desktop-titlebar .od-live{display:flex;align-items:center;gap:7px;padding:5px 9px;border:1px solid rgba(105,117,255,.16);border-radius:999px;background:rgba(44,48,82,.24);color:#8f99b8;font-size:7px;letter-spacing:.11em;text-transform:uppercase}
    #orbit-desktop-titlebar .od-dot{width:6px;height:6px;border-radius:50%;background:#45df90;box-shadow:0 0 12px rgba(69,223,144,.8);animation:orbitDesktopPulse 1.8s ease-in-out infinite}
    #orbit-desktop-titlebar .od-win-controls{display:flex;align-items:center;gap:3px;margin-left:2px}
    #orbit-desktop-titlebar button{width:32px;height:28px;border:0;border-radius:7px;background:transparent;color:#969fb8;cursor:pointer;-webkit-app-region:no-drag;transition:.15s ease;font:600 12px/1 Inter,system-ui,sans-serif}
    #orbit-desktop-titlebar button:hover{background:rgba(255,255,255,.06);color:#fff}
    #orbit-desktop-titlebar #od-close:hover{background:#d9415d;color:#fff}
    #orbit-desktop-titlebar #od-max{font-size:11px}
    @keyframes orbitDesktopPulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1)}}
    body.orbit-desktop-app #app{min-height:calc(100vh - 36px)!important;height:calc(100vh - 36px)!important}
  `;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.innerHTML = `
    <div class="od-brand"><div class="od-orb">◈</div><strong>ORBIT</strong><span>DESKTOP</span></div>
    <div class="od-spacer"></div>
    <div class="od-live"><i class="od-dot"></i> LIVE NETWORK</div>
    <div class="od-win-controls">
      <button id="od-min" title="Minimize">—</button>
      <button id="od-max" title="Maximize">□</button>
      <button id="od-close" title="Close">×</button>
    </div>
  `;
  document.body.appendChild(bar);

  document.getElementById("od-min").onclick=()=>ipcRenderer.send("orbit-window-control","minimize");
  document.getElementById("od-max").onclick=()=>ipcRenderer.send("orbit-window-control","maximize");
  document.getElementById("od-close").onclick=()=>ipcRenderer.send("orbit-window-control","close");
}

window.addEventListener("DOMContentLoaded",installDesktopChrome);
document.addEventListener("readystatechange",installDesktopChrome);
setTimeout(installDesktopChrome,1200);

contextBridge.exposeInMainWorld("orbitDesktop",{
  isDesktop:true,
  platform:process.platform,
  version:"1.3.0"
});
