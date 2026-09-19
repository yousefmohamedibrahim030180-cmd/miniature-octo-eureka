(()=>{const KEY="orbit_nexus_v2";
const defaults={atmosphere:"aether",intensity:72,reducedMotion:false,glass:62,surface:"luminous"};
let state;
try{state=Object.assign({},defaults,JSON.parse(localStorage.getItem(KEY)||"{}"))}catch{state={...defaults}}
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const atmos={
aether:{name:"Aether",accent:"#8ea6ff",glow:"#72d9ff",desc:"Calm high-tech"},
pulse:{name:"Pulse",accent:"#4de7d8",glow:"#65ffd0",desc:"Reactive realtime"},
solar:{name:"Solar",accent:"#ffc86b",glow:"#ff8b4d",desc:"Warm energetic"},
void:{name:"Void",accent:"#c19bff",glow:"#7056ff",desc:"Deep focus"},
cobalt:{name:"Cobalt",accent:"#5b8dff",glow:"#4ddcff",desc:"Studio precision"},
prism:{name:"Prism",accent:"#ff7ad9",glow:"#8e7cff",desc:"Creative spectrum"}
};
const surfaces={
night:{name:"Night",bg:"#050912",app:"linear-gradient(135deg,#050912,#07101a 48%,#050912)",panel:"rgba(8,13,22,.70)",text:"#edf2ff"},
luminous:{name:"Luminous",bg:"#eef3fb",app:"linear-gradient(135deg,#edf3fb,#f8fbff 48%,#eef2fa)",panel:"rgba(248,251,255,.76)",text:"#172033"},
pearl:{name:"Pearl",bg:"#f3f0f8",app:"linear-gradient(135deg,#eeeaf7,#fbf9ff 48%,#f1edf8)",panel:"rgba(255,255,255,.72)",text:"#27223b"},
mint:{name:"Mint",bg:"#eaf7f3",app:"linear-gradient(135deg,#e5f5f0,#f6fffc 48%,#e8f4f0)",panel:"rgba(250,255,253,.74)",text:"#16352f"}
};
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
function ensureLayer(){
 let layer=$("#nexus-live-layer");
 if(layer)return layer;
 layer=document.createElement("div");layer.id="nexus-live-layer";layer.innerHTML='<div class="nexus-live-noise"></div>';document.body.appendChild(layer);
 const st=document.createElement("style");st.id="nexus-runtime-style";
 st.textContent="#nexus-live-layer{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .28s ease,background .35s ease,filter .35s ease;mix-blend-mode:normal}#nexus-live-layer .nexus-live-noise{position:absolute;inset:0;opacity:.22;background:radial-gradient(circle at 20% 20%,rgba(255,255,255,.08),transparent 22%),radial-gradient(circle at 80% 70%,rgba(255,255,255,.05),transparent 25%);mix-blend-mode:screen}.nexus-reduced #nexus-live-layer{transition:none!important}";
 document.head.appendChild(st);return layer
}
function apply(){
 const a=atmos[state.atmosphere]||atmos.aether,s=surfaces[state.surface]||surfaces.luminous;
 document.body.dataset.nexus=state.atmosphere;document.body.dataset.nexusSurface=state.surface;document.body.dataset.nexusIntensity=String(state.intensity);document.body.dataset.nexusGlass=String(state.glass);
 document.body.classList.toggle("nexus-reduced",!!state.reducedMotion);
 document.body.style.setProperty("--nexus-accent",a.accent);document.body.style.setProperty("--nexus-intensity",(state.intensity/100).toFixed(2));document.body.style.setProperty("--nexus-glass",(state.glass/100).toFixed(2));document.body.style.setProperty("--nexus-blur",(5+state.glass*.24).toFixed(1)+"px");
 const app=$("#app");if(app)app.style.background=s.app;
 $$(".server-rail,.sidebar,.chat").forEach(el=>{el.style.background=s.panel;el.style.color=s.text;el.style.backdropFilter="blur("+(5+state.glass*.24).toFixed(1)+"px)";el.style.webkitBackdropFilter=el.style.backdropFilter});
 const layer=ensureLayer(),power=state.intensity/100;
 const hx=n=>Math.round(n).toString(16).padStart(2,"0");
 layer.style.opacity=String(.18+power*.68);
 layer.style.background="radial-gradient(circle at 12% 8%,"+a.accent+hx(18+power*55)+",transparent 34%),radial-gradient(circle at 88% 18%,"+a.glow+hx(12+power*42)+",transparent 32%),radial-gradient(circle at 52% 105%,"+a.accent+hx(7+power*28)+",transparent 42%),"+s.bg;
 const blur=(state.glass*.10).toFixed(1);
 layer.style.backdropFilter="blur("+blur+"px) saturate("+(100+Math.round(state.glass*.35))+"%)";layer.style.webkitBackdropFilter=layer.style.backdropFilter;
 const copy=$("#nexus-status-text");if(copy&&!$("#nexus-console")?.classList.contains("open"))copy.textContent=a.name.toUpperCase()+" • "+state.intensity+"%";
 persist()
}
function open(){let o=$("#nexus-console");if(!o){build();o=$("#nexus-console")}o.classList.add("open");render()}
function close(){$("#nexus-console")?.classList.remove("open")}
function toast(t){let n=$("#nexus-toast");if(!n)return;n.textContent=t;n.classList.add("show");clearTimeout(n._t);n._t=setTimeout(()=>n.classList.remove("show"),1500)}
function render(){const i=$("#nexus-intensity"),g=$("#nexus-glass"),r=$("#nexus-reduced");if(i)i.value=state.intensity;if(g)g.value=state.glass;if(r)r.checked=!!state.reducedMotion;if($("#nexus-intensity-out"))$("#nexus-intensity-out").textContent=state.intensity+"%";if($("#nexus-glass-out"))$("#nexus-glass-out").textContent=state.glass+"%";$$("[data-nexus-atmos]").forEach(b=>b.classList.toggle("active",b.dataset.nexusAtmos===state.atmosphere));$$("[data-nexus-surface]").forEach(b=>b.classList.toggle("active",b.dataset.nexusSurface===state.surface));apply()}
function build(){
 if($("#nexus-layer"))return;
 const l=document.createElement("div");l.id="nexus-layer";
 l.innerHTML='<div id="nexus-status" role="button" tabindex="0" title="Open Experience Lab"><span class="nexus-orb">◈</span><span class="nexus-status-copy"><b>ORBIT // NEXUS</b><small id="nexus-status-text">EXPERIENCE LAB</small></span><span class="nexus-launch-glyph">⌘</span></div><div id="nexus-console"><div class="nexus-console-card"><header><div><span>ORBIT // NEXUS</span><h2>Experience Lab</h2><p>Shape the atmosphere of your workspace.</p></div><button id="nexus-close">×</button></header><section class="nexus-atmos-grid">'+Object.entries(atmos).map(([k,v])=>'<button type="button" data-nexus-atmos="'+k+'"><i></i><b>'+v.name+'</b><small>'+v.desc+'</small></button>').join("")+'</section><section class="nexus-surface"><label>SURFACE</label><div class="nexus-surface-grid">'+Object.entries(surfaces).map(([k,v])=>'<button type="button" data-nexus-surface="'+k+'">'+v.name+'</button>').join("")+'</div></section><section class="nexus-controls"><label>ATMOSPHERE INTENSITY <output id="nexus-intensity-out"></output></label><input id="nexus-intensity" type="range" min="20" max="100" step="1"><label>GLASS DEPTH <output id="nexus-glass-out"></output></label><input id="nexus-glass" type="range" min="20" max="92" step="1"><label class="nexus-toggle"><input id="nexus-reduced" type="checkbox"><span></span> Reduce motion & ambient effects</label></section><footer><button id="nexus-reset" type="button">Reset</button><button id="nexus-done" type="button">Done</button></footer></div></div><div id="nexus-toast"></div>';
 document.body.appendChild(l);
 $("#nexus-status").onclick=open;$("#nexus-status").onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}};
 $("#nexus-close").onclick=close;$("#nexus-done").onclick=close;$("#nexus-console").onclick=e=>{if(e.target.id==="nexus-console")close()};
 $("#nexus-reset").onclick=()=>{state={...defaults};render();toast("NEXUS reset")};
 $("#nexus-intensity").oninput=e=>{state.intensity=Number(e.target.value);render();toast("Intensity • "+state.intensity+"%")};
 $("#nexus-glass").oninput=e=>{state.glass=Number(e.target.value);render();toast("Glass depth • "+state.glass+"%")};
 $("#nexus-reduced").onchange=e=>{state.reducedMotion=e.target.checked;render();toast(state.reducedMotion?"Motion reduced":"Ambient motion enabled")};
 $$("[data-nexus-atmos]").forEach(b=>b.onclick=()=>{state.atmosphere=b.dataset.nexusAtmos;render();toast("Atmosphere • "+atmos[state.atmosphere].name)});
 $$("[data-nexus-surface]").forEach(b=>b.onclick=()=>{state.surface=b.dataset.nexusSurface;render();toast("Surface • "+surfaces[state.surface].name)});
 render()
}
function react(){const t=$("#nexus-status-text"),a=atmos[state.atmosphere]||atmos.aether;if(t&&!$("#nexus-console")?.classList.contains("open"))t.textContent=a.name.toUpperCase()+" • "+state.intensity+"%"}
function boot(){build();apply();react();document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="n"){e.preventDefault();open()}if(e.key==="Escape")close()})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
window.OrbitNexus={open,close,state,apply,render};
})();