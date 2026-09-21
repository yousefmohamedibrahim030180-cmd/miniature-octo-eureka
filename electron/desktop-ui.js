(()=>{try{
document.body.classList.add("orbit-desktop-shell");
if(document.getElementById("orbitDesktopTunePanel"))return;
const prefsKey="orbit-desktop-ui";
const defaults={scale:1.1,gap:10,width:"wide"};
let prefs={...defaults,...JSON.parse(localStorage.getItem(prefsKey)||"{}")};
const apply=()=>{
 document.body.style.setProperty("--orbit-chat-gap",prefs.gap+"px");
 document.body.style.setProperty("--orbit-chat-font",Math.round(13*(prefs.scale/1.1)*10)/10+"px");
 document.body.style.setProperty("--orbit-composer-font",Math.round(12*(prefs.scale/1.1)*10)/10+"px");
 document.body.style.setProperty("--orbit-desktop-chat-width",prefs.width==="wide"?"310px":prefs.width==="compact"?"270px":"290px");
 let tag=document.getElementById("orbitDesktopDynamicStyle");
 if(!tag){tag=document.createElement("style");tag.id="orbitDesktopDynamicStyle";document.head.appendChild(tag)}
 tag.textContent=".orbit-desktop-shell .chat{grid-template-columns:minmax(0,1fr) var(--orbit-desktop-chat-width)}";
 document.querySelectorAll("#orbitDesktopTunePanel .odt-scale button").forEach(b=>b.classList.toggle("active",Number(b.dataset.value)===prefs.scale));
 document.querySelectorAll("#orbitDesktopTunePanel .odt-gap button").forEach(b=>b.classList.toggle("active",Number(b.dataset.value)===prefs.gap));
 document.querySelectorAll("#orbitDesktopTunePanel .odt-width button").forEach(b=>b.classList.toggle("active",b.dataset.value===prefs.width));
 localStorage.setItem(prefsKey,JSON.stringify(prefs));
};
const wrap='<button id="orbitDesktopTuneBtn" title="Desktop appearance">Aa&nbsp; Display</button>'+
'<div id="orbitDesktopTunePanel"><h3>Desktop appearance</h3>'+
'<p>Customize the downloaded ORBIT app without changing account or call settings.</p>'+
'<div class="odt-row"><div class="odt-label">Text size</div><div class="odt-options odt-scale">'+
'<button data-value="1">100%</button><button data-value="1.1">110%</button><button data-value="1.2">120%</button><button data-value="1.3">130%</button></div></div>'+
'<div class="odt-row"><div class="odt-label">Chat spacing</div><div class="odt-options odt-gap">'+
'<button data-value="6">Tight</button><button data-value="10">Normal</button><button data-value="14">Roomy</button><button data-value="18">Large</button></div></div>'+
'<div class="odt-row"><div class="odt-label">Chat side panel</div><div class="odt-options odt-width">'+
'<button data-value="compact">Compact</button><button data-value="normal">Normal</button><button data-value="wide">Wide</button></div></div>'+
'<div class="odt-footer"><button id="orbitDesktopReset">Reset</button><button class="primary" id="orbitDesktopDone">Done</button></div></div>';
const actions=document.querySelector(".top-actions");
if(actions)actions.insertAdjacentHTML("beforeend",wrap);else document.body.insertAdjacentHTML("beforeend",wrap);
document.getElementById("orbitDesktopTuneBtn").onclick=()=>document.getElementById("orbitDesktopTunePanel").classList.toggle("open");
document.getElementById("orbitDesktopDone").onclick=()=>document.getElementById("orbitDesktopTunePanel").classList.remove("open");
document.getElementById("orbitDesktopReset").onclick=()=>{prefs={...defaults};apply()};
document.querySelectorAll("#orbitDesktopTunePanel .odt-scale button").forEach(b=>b.onclick=()=>{prefs.scale=Number(b.dataset.value);apply()});
document.querySelectorAll("#orbitDesktopTunePanel .odt-gap button").forEach(b=>b.onclick=()=>{prefs.gap=Number(b.dataset.value);apply()});
document.querySelectorAll("#orbitDesktopTunePanel .odt-width button").forEach(b=>b.onclick=()=>{prefs.width=b.dataset.value;apply()});
document.addEventListener("click",e=>{const p=document.getElementById("orbitDesktopTunePanel"),b=document.getElementById("orbitDesktopTuneBtn");if(p?.classList.contains("open")&&!p.contains(e.target)&&!b.contains(e.target))p.classList.remove("open")});
apply();
window.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="d"){e.preventDefault();document.getElementById("orbitDesktopTuneBtn")?.click()}});
}catch(e){console.debug("ORBIT desktop customization unavailable",e)}})()