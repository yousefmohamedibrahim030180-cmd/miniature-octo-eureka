(() => {
  "use strict";
  async function hydrateUser(){
    try{
      const token=localStorage.getItem("orbit_token")||"";
      if(!token)return;
      const r=await fetch("/api/me",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.user)return;
      window.__ORBIT_USER=d.user;
      patchUserFields();
    }catch{}
  }
  function patchUserFields(){
    const u=window.__ORBIT_USER||{};
    const n=document.querySelector("#v2-name"),b=document.querySelector("#v2-bio"),a=document.querySelector("#v2-activity");
    if(n&&document.activeElement!==n)n.value=u.display_name||"";
    if(b&&document.activeElement!==b)b.value=u.bio||"";
    if(a&&document.activeElement!==a)a.value=u.activity||"Online";
    const p=document.querySelector(".profile-banner");
    if(p){
      const strong=p.querySelector("strong"),span=p.querySelector("span:not(.avatar)");
      if(strong)strong.textContent=u.display_name||u.username||"Guest";
      if(span)span.textContent="@"+(u.username||"guest");
      const av=p.querySelector(".avatar"); if(av&&!av.querySelector("img"))av.textContent=String((u.display_name||u.username||"G").slice(0,1)).toUpperCase();
    }
  }
  const obs=new MutationObserver(()=>patchUserFields());
  obs.observe(document.body,{childList:true,subtree:true});
  hydrateUser();
})();