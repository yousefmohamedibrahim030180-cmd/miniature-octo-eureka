(() => {
  "use strict";
  const incoming = document.getElementById("incoming");
  if (!incoming) return;

  const originalHTML = incoming.innerHTML;
  incoming.classList.add("incoming-call-upgrade");

  // Keep the existing IDs/handlers so the backend call flow is untouched.
  const avatar = document.getElementById("incoming-avatar");
  const title = document.getElementById("incoming-title");
  const subtitle = document.getElementById("incoming-subtitle");
  const accept = document.getElementById("incoming-accept");
  const decline = document.getElementById("incoming-decline");

  if (!incoming.querySelector(".incoming-card")) {
    const oldAvatar = avatar;
    const oldCopy = incoming.querySelector(".incoming-copy");
    const oldAccept = accept;
    const oldDecline = decline;
    const card = document.createElement("div");
    card.className = "incoming-card";
    card.innerHTML = `
      <div class="incoming-avatar-wrap"></div>
      <div class="incoming-copy"></div>
      <div class="incoming-actions"></div>
      <div class="incoming-ringing"><i></i><span>Incoming call • Ringing</span></div>
    `;
    card.querySelector(".incoming-avatar-wrap").appendChild(oldAvatar);
    card.querySelector(".incoming-copy").appendChild(oldCopy?.querySelector("#incoming-title") || title);
    card.querySelector(".incoming-copy").appendChild(oldCopy?.querySelector("#incoming-subtitle") || subtitle);
    card.querySelector(".incoming-actions").appendChild(oldAccept);
    card.querySelector(".incoming-actions").appendChild(oldDecline);
    incoming.replaceChildren(card);
  }

  let audioCtx = null;
  let ringTimer = null;
  let ringing = false;

  function stopRingtone() {
    ringing = false;
    if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
    try {
      if (audioCtx) audioCtx.suspend();
    } catch {}
  }

  function tone(freq, start, duration, gainValue) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  function ringBurst() {
    if (!ringing) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
      const now = audioCtx.currentTime + 0.03;
      // A recognizable two-tone "ring ring" pattern.
      tone(880, now, .22, .12);
      tone(660, now + .24, .22, .10);
      tone(880, now + .55, .22, .12);
      tone(660, now + .79, .22, .10);
    } catch {}
    ringTimer = setTimeout(ringBurst, 2200);
  }

  function startRingtone() {
    if (ringing) return;
    ringing = true;
    ringBurst();
  }

  function syncIncoming() {
    const visible = !incoming.classList.contains("hidden");
    incoming.classList.toggle("incoming-call-upgrade", visible);
    if (visible) startRingtone();
    else stopRingtone();
  }

  // Make the two actions stop the sound immediately, before their existing handlers run.
  accept?.addEventListener("click", stopRingtone, true);
  decline?.addEventListener("click", stopRingtone, true);
  window.addEventListener("beforeunload", stopRingtone);

  new MutationObserver(syncIncoming).observe(incoming, {
    attributes: true,
    attributeFilter: ["class"]
  });

  // If a browser wakes the page after a user gesture, resume the ringtone.
  ["pointerdown", "keydown", "touchstart"].forEach(type => {
    document.addEventListener(type, () => {
      if (ringing && audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
    }, {passive:true});
  });

  syncIncoming();
})();
