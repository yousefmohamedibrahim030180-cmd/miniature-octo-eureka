/* ORBIT UI V2 — focused channel actions */
(function(){
  "use strict";
  function boot(){
    const more=document.getElementById("channel-more-btn");
    const menu=document.getElementById("channel-more-menu");
    if(!more||!menu||more.dataset.bound==="1") return;
    more.dataset.bound="1";
    const close=()=>{menu.classList.add("hidden");more.setAttribute("aria-expanded","false");};
    more.setAttribute("aria-expanded","false");
    more.addEventListener("click",function(e){
      e.stopPropagation();
      const open=menu.classList.toggle("hidden")===false;
      more.setAttribute("aria-expanded",String(open));
    });
    menu.querySelectorAll("button[data-action]").forEach(item=>{
      item.addEventListener("click",()=>{
        const map={"quick-share":"quick-share-btn",invite:"invite-btn",members:"members-btn",admin:"admin-btn"};
        const target=document.getElementById(map[item.dataset.action]);
        close();
        if(target) target.click();
      });
    });
    document.addEventListener("click",e=>{if(!menu.contains(e.target)&&e.target!==more)close();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
  const observer=new MutationObserver(boot);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
