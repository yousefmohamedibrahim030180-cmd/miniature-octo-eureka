(function(){
  const DECORATIONS={
    none:{name:"None"},
    halo:{name:"Halo"},
    crown:{name:"Crown"},
    orbit:{name:"Orbit Ring"},
    spark:{name:"Sparkles"},
    fire:{name:"Fire"},
    ice:{name:"Ice"},
    cyber:{name:"Cyber Frame"},
    royal:{name:"Royal"},
    dragon:{name:"Dragon Flame"}
  };

  function currentKey(){
    return String(me?.avatar_decoration || localStorage.getItem("orbit_avatar_decoration") || "none");
  }
  function applyNode(node,key=currentKey(),customUrl=""){
    if(!node)return;
    node.dataset.orbitDecoration=key;
    node.style.setProperty("--orbit-decoration-image",customUrl ? 'url("'+customUrl.replace(/"/g,"%22")+'")' : "none");
    node.classList.remove("orbit-deco-none","orbit-deco-halo","orbit-deco-crown","orbit-deco-orbit","orbit-deco-spark","orbit-deco-fire","orbit-deco-ice","orbit-deco-cyber","orbit-deco-royal","orbit-deco-dragon","orbit-deco-custom");
    node.classList.add("orbit-deco-"+key);
    if(customUrl)node.classList.add("orbit-deco-custom");
  }
  function applyOwn(){
    const node=document.querySelector("#me-avatar");
    if(node)applyNode(node,currentKey(),me?.avatar_decoration_url||localStorage.getItem("orbit_avatar_decoration_url")||"");
  }
  async function saveDecoration(key,customUrl=""){
    const updated=await api("/api/me",{method:"PATCH",body:JSON.stringify({avatarDecoration:key,avatarDecorationUrl:customUrl})});
    me=updated.user;
    localStorage.setItem("orbit_avatar_decoration",key);
    if(customUrl)localStorage.setItem("orbit_avatar_decoration_url",customUrl);
    else localStorage.removeItem("orbit_avatar_decoration_url");
    applyOwn();
    return updated.user;
  }
  function styleCard(key){
    return '<button type="button" class="orbit-deco-card '+(currentKey()===key?'active':'')+'" data-orbit-deco="'+key+'"><span class="orbit-deco-preview orbit-deco-'+key+'"></span><strong>'+DECORATIONS[key].name+'</strong></button>';
  }
  function injectProfileControls(){
    const host=document.querySelector(".avatar-profile-editor");
    if(!host || host.querySelector(".orbit-decoration-editor")){ applyOwn(); return; }
    const wrap=document.createElement("div");
    wrap.className="orbit-decoration-editor";
    wrap.innerHTML=
      '<div class="orbit-decoration-head"><div><strong>Avatar Decoration</strong><span>Animated frames that sit over your avatar, like a premium profile effect.</span></div><span class="orbit-deco-badge">LIVE</span></div>'+
      '<div class="orbit-decoration-grid">'+
        styleCard("none")+styleCard("halo")+styleCard("crown")+styleCard("orbit")+styleCard("spark")+styleCard("fire")+styleCard("ice")+styleCard("cyber")+styleCard("royal")+styleCard("dragon")+
      '</div>'+
      '<div class="orbit-decoration-custom"><div class="orbit-deco-preview orbit-deco-'+currentKey()+'" id="orbit-decoration-preview"><span>'+escapeHtml(me?.username?.slice(0,1)||"G")+'</span></div><div><strong>Custom frame</strong><span>Upload a transparent PNG/WebP/GIF up to 1 MB.</span></div><button type="button" id="orbit-decoration-upload">Upload</button><button type="button" id="orbit-decoration-remove">Remove</button></div>';
    host.appendChild(wrap);

    wrap.querySelectorAll("[data-orbit-deco]").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        try{
          await saveDecoration(btn.dataset.orbitDeco,"");
          wrap.querySelectorAll("[data-orbit-deco]").forEach(x=>x.classList.toggle("active",x===btn));
          const preview=wrap.querySelector("#orbit-decoration-preview");
          if(preview)applyNode(preview,btn.dataset.orbitDeco,"");
          orbitToast("Avatar decoration",DECORATIONS[btn.dataset.orbitDeco].name+" applied.","success");
        }catch(err){orbitToast("Decoration failed",err.message,"error");}
      });
    });

    wrap.querySelector("#orbit-decoration-upload").onclick=()=>{
      const input=document.createElement("input");
      input.type="file";input.accept="image/png,image/webp,image/gif";
      input.onchange=()=>{
        const file=input.files?.[0];if(!file)return;
        if(file.size>1_000_000){orbitToast("Decoration","Custom frame must be 1 MB or smaller.","error");return;}
        const fr=new FileReader();
        fr.onload=async()=>{
          try{
            const up=await api("/api/uploads",{method:"POST",body:JSON.stringify({name:file.name,type:file.type,size:file.size,data:String(fr.result),purpose:"avatar-decoration"})});
            const url="/api/avatar/"+encodeURIComponent(up.file.id);
            await saveDecoration("none",url);
            const preview=wrap.querySelector("#orbit-decoration-preview");
            applyNode(preview,"none",url);
            wrap.querySelectorAll("[data-orbit-deco]").forEach(x=>x.classList.remove("active"));
            orbitToast("Avatar decoration","Custom frame uploaded and applied.","success");
          }catch(err){orbitToast("Upload failed",err.message,"error");}
        };
        fr.readAsDataURL(file);
      };
      input.click();
    };
    wrap.querySelector("#orbit-decoration-remove").onclick=async()=>{
      try{
        await saveDecoration("none","");
        const preview=wrap.querySelector("#orbit-decoration-preview");
        applyNode(preview,"none","");
        wrap.querySelectorAll("[data-orbit-deco]").forEach(x=>x.classList.toggle("active",x.dataset.orbitDeco==="none"));
        orbitToast("Avatar decoration","Decoration removed.","success");
      }catch(err){orbitToast("Remove failed",err.message,"error");}
    };
    applyOwn();
  }

  const observer=new MutationObserver(()=>{
    injectProfileControls();
    applyOwn();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener("load",()=>{injectProfileControls();applyOwn();});
  setTimeout(()=>{injectProfileControls();applyOwn();},500);
})();