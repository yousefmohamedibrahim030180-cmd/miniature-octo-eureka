(()=>{const KEY="orbit_nexus_v1",state=Object.assign({atmosphere:"aether",intensity:72,reducedMotion:false,glass:62,surface:"luminous"},JSON.parse(localStorage.getItem(KEY)||"{}"));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const atmos={aether:{name:"Aether",accent:"#8ea6ff",desc:"Calm high-tech"},pulse:{name:"Pulse",accent:"#4de7d8",desc:"Reactive realtime"},solar:{name:"Solar",accent:"#ffc86b",desc:"Warm energetic"},void:{name:"Void",accent:"#c19bff",desc:"Deep focus"},cobalt:{name:"Cobalt",accent:"#5b8dff",desc:"Studio precision"},prism:{name:"Prism",accent:"#ff7ad9",desc:"Creative spectrum"}};
const save=()=>{localStorage.setItem(KEY,JSON.stringify(state));document.body.dataset.nexus=state.atmosphere;document.body.dataset.nexusSurface=state.surface;document.body.dataset.nexusIntensity=String(state.intensity);document.body.dataset.nexusGlass=String(state.glass);document.body.style.setProperty("--nexus-accent",atmos[state.atmosphere].accent);document.body.style.setProperty("--nexus-intensity",(state.intensity/100).toFixed(2));document.body.style.setProperty("--nexus-glass",(state.glass/100).toFixed(2));document.body.classList.toggle("nexus-reduced",!!state.reducedMotion);};
function open(){let o=$("#nexus-console");if(!o){build();o=$("#nexus-console")}o.classList.add("open");$("#nexus-intensity")?.focus()}
function close(){$("#nexus-console")?.classList.remove("open")}
function toast(t){let n=$("#nexus-toast");if(!n)return;n.textContent=t;n.classList.add("show");clearTimeout(n._t);n._t=setTimeout(()=>n.classList.remove("show"),1800)}
function setAtmosphere(k){if(!atmos[k])return;state.atmosphere=k;save();render();document.body.animate([{filter:"brightness(1)"},{filter:"brightness(1.035)"},{filter:"brightness(1)"}],{duration:260});toast("Atmosphere • "+atmos[k].name)}
function build(){
 const l=document.createElement("div");l.id="nexus-layer";
 l.innerHTML='<div class="nexus-ambient"><i></i><i></i><i></i><div class="nexus-grid"></div></div><button id="nexus-status" type="button" title="Open Experience Lab"><span class="nexus-orb">◈</span><span class="nexus-status-copy"><b>ORBIT // NEXUS</b><small id="nexus-status-text">EXPERIENCE LAB</small></span><span class="nexus-launch-glyph">⌘</span></button><div id="nexus-console"><div class="nexus-console-card"><header><div><span>ORBIT // NEXUS</span><h2>Experience Lab</h2><p>Shape the atmosphere of your workspace.</p></div><button id="nexus-close">×</button></header><section class="nexus-atmos-grid">'+Object.entries(atmos).map(([k,v])=>'<button data-nexus-atmos="'+k+'"><i></i><b>'+v.name+'</b><small>'+v.desc+'</small></button>').join("")+'</section><section class="nexus-surface"><label>SURFACE</label><div class="nexus-surface-grid"><button data-nexus-surface="night">Night</button><button data-nexus-surface="luminous">Luminous</button><button data-nexus-surface="pearl">Pearl</button><button data-nexus-surface="mint">Mint</button></div></section><section class="nexus-controls"><label>ATMOSPHERE INTENSITY <output id="nexus-intensity-out"></output></label><input id="nexus-intensity" type="range" min="20" max="100" step="1"><label>GLASS DEPTH <output id="nexus-glass-out"></output></label><input id="nexus-glass" type="range" min="20" max="92" step="1"><label class="nexus-toggle"><input id="nexus-reduced" type="checkbox"><span></span> Reduce motion & ambient effects</label></section><footer><button id="nexus-reset">Reset</button><button id="nexus-done">Done</button></footer></div></div><div id="nexus-toast"></div>';
 document.body.appendChild(l);
 $("#nexus-status").onclick=open;$("#nexus-close").onclick=close;$("#nexus-done").onclick=close;
 $("#nexus-console").onclick=e=>{if(e.target.id==="nexus-console")close()};
 $("#nexus-reset").onclick=()=>{Object.assign(state,{atmosphere:"aether",intensity:72,reducedMotion:false,glass:62,surface:"luminous"});save();render();toast("NEXUS reset")};
 $("#nexus-intensity").oninput=e=>{state.intensity=+e.target.value;save();render(false);toast("Intensity • "+state.intensity+"%")};
 $("#nexus-glass").oninput=e=>{state.glass=+e.target.value;save();render(false);toast("Glass depth • "+state.glass+"%")};
 $("#nexus-reduced").onchange=e=>{state.reducedMotion=e.target.checked;save();render(false);toast(state.reducedMotion?"Motion reduced":"Ambient motion enabled")};
 $("[data-nexus-atmos]").forEach(b=>b.onclick=()=>setAtmosphere(b.dataset.nexusAtmos));
 $("[data-nexus-surface]").forEach(b=>b.onclick=()=>{state.surface=b.dataset.nexusSurface;save();render();document.body.animate([{opacity:".985"},{opacity:"1"}],{duration:180});toast("Surface • "+b.textContent)});
 render();
}
function render(announce=true){
 $("#nexus-intensity")?.setAttribute("value",state.intensity);if($("#nexus-intensity"))$("#nexus-intensity").value=state.intensity;
 if($("#nexus-glass"))$("#nexus-glass").value=state.glass;
 if($("#nexus-intensity-out"))$("#nexus-intensity-out").textContent=state.intensity+"%";
 if($("#nexus-glass-out"))$("#nexus-glass-out").textContent=state.glass+"%";
 if($("#nexus-reduced"))$("#nexus-reduced").checked=!!state.reducedMotion;
 $("[data-nexus-atmos]").forEach(b=>b.classList.toggle("active",b.dataset.nexusAtmos===state.atmosphere));
 $("[data-nexus-surface]").forEach(b=>b.classList.toggle("active",b.dataset.nexusSurface===state.surface));
 const t=$("#nexus-status-text");if(t&&!$("#nexus-console")?.classList.contains("open"))t.textContent=atmos[state.atmosphere].name.toUpperCase()+" • "+state.intensity+"%";
 if(announce)save();
}
function react(){const call=document.body.classList.contains("call-open"),focus=document.body.dataset.orbitAdaptive==="focus",creative=document.body.dataset.orbitAdaptive==="creative";document.body.dataset.nexusContext=call?"call":creative?"creative":focus?"focus":"workspace";const t=$("#nexus-status-text");if(t&&!$("#nexus-console")?.classList.contains("open"))t.textContent=(call?"LIVE CALL":creative?"CREATIVE SURFACE":focus?"FOCUS MODE":"EXPERIENCE LAB")+" • "+atmos[state.atmosphere].name.toUpperCase()}
function boot(){save();build();react();new MutationObserver(react).observe(document.body,{attributes:true,attributeFilter:["class","data-orbit-adaptive"]});document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="n"){e.preventDefault();open()}if(e.key==="Escape")close()});document.addEventListener("pointerdown",e=>{const el=e.target.closest(".message, .channel-item, .member, .head-action, .call-btn");if(!el||state.reducedMotion)return;document.body.classList.remove("nexus-click-pulse");void document.body.offsetWidth;document.body.classList.add("nexus-click-pulse")},{passive:true})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();window.OrbitNexus={open,close,setAtmosphere,state};})();