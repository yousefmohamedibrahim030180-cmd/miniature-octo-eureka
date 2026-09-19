(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const state = () => window.__orbitCallState;
  const channel = () => window.__orbitCurrentChannel;
  const sock = () => window.__orbitSocket;

  function icon(kind) {
    const icons = {
      mic: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.8" width="10" height="13" rx="5"/><path d="M4.8 11.5a7.2 7.2 0 0 0 14.4 0M12 18.7V22M8.5 22h7"/></svg>',
      camera: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.8h11.2A1.8 1.8 0 0 1 17 8.6v6.8a1.8 1.8 0 0 1-1.8 1.8H4a1.8 1.8 0 0 1-1.8-1.8V8.6A1.8 1.8 0 0 1 4 6.8Z"/><path d="m17 10 4.2-2.2v8.4L17 14"/></svg>',
      screen: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      leave: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.6 5.8c-.8 1.5-1 3.2-.6 4.9.6 2.9 2.6 5.5 5.1 6.8 1.8 1 3.5.9 5.1.2l2.4-1.2c.5-.2.7-.8.4-1.2l-1.7-2.1c-.3-.4-.9-.5-1.3-.2l-1.5 1c-1.2-.5-2.4-1.4-3.2-2.4-.9-1-1.5-2.2-1.8-3.5l1.1-1.4c.3-.4.2-1-.2-1.3L8.1 5.2c-.5-.4-1.2-.1-1.5.6Z"/></svg>'
    };
    return icons[kind] || "";
  }

  function refreshCallButtons() {
    const s = state();
    const mic = $("#mic-btn"), cam = $("#camera-btn"), share = $("#share-btn"), hang = $("#hangup-btn");
    if (mic) {
      mic.innerHTML = icon("mic");
      mic.classList.add("icon-action");
      mic.setAttribute("aria-label", mic.classList.contains("off") ? "Unmute microphone" : "Mute microphone");
      mic.title = mic.classList.contains("off") ? "Unmute microphone" : "Mute microphone";
    }
    if (cam) {
      cam.innerHTML = icon("camera");
      cam.classList.add("icon-action");
      cam.disabled = !s?.cameraTrack;
      cam.classList.toggle("disabled-control", !s?.cameraTrack);
      cam.setAttribute("aria-label", cam.classList.contains("off") ? "Turn camera on" : "Turn camera off");
    }
    if (share) {
      share.innerHTML = icon("screen") + '<span class="share-label">' + (s?.screenTrack ? "Stop sharing" : "Share screen") + '</span>';
      share.title = s?.screenTrack ? "Stop sharing" : "Share your screen";
      share.setAttribute("aria-label", share.title);
    }
    if (hang) hang.innerHTML = icon("leave") + '<span>Leave</span>';
  }

  async function renegotiate(item) {
    const s = state(), ws = sock();
    if (!item?.pc || !ws || !s?.active || item.pc.signalingState !== "stable") return;
    try {
      const offer = await item.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await item.pc.setLocalDescription(offer);
      const peerId = [...s.peers.entries()].find(([, value]) => value === item)?.[0];
      if (peerId && typeof window.callSignalEvent === "function") {
        ws.emit(window.callSignalEvent("offer"), { to: peerId, offer: item.pc.localDescription });
      }
    } catch (err) {
      console.warn("ORBIT renegotiation failed", err);
    }
  }

  function findVideoSender(pc) {
    return pc.getSenders().find(sender => sender.track?.kind === "video") ||
      pc.getTransceivers?.().find(t => t.sender?.track?.kind === "video")?.sender ||
      null;
  }

  async function stopScreenShareFixed() {
    const s = state(), ws = sock();
    const track = s?.screenTrack;
    if (!track) return;

    try { s.localStream?.removeTrack?.(track); } catch {}
    try { track.stop(); } catch {}
    s.screenTrack = null;

    for (const item of s.peers.values()) {
      const sender = findVideoSender(item.pc);
      if (sender) {
        await sender.replaceTrack(s.cameraTrack || null).catch(() => {});
      }
    }

    const self = document.querySelector('.call-tile[data-peer="self"]');
    self?.classList.remove("screen-sharing");
    const badge = self?.querySelector(".tile-badge");
    if (badge) badge.textContent = "YOU";
    if (self) {
      const video = self.querySelector("video");
      video.srcObject = s.localStream || null;
      video.classList.toggle("mirror", Boolean(s.settings?.mirror));
      video.play?.().catch(() => {});
    }

    $("#share-btn")?.classList.remove("active", "screen-live");
    $("#dock-screen")?.classList.remove("active");

    if (ws) {
      if (typeof window.emitCallMediaState === "function") window.emitCallMediaState();
    }
    window.orbitToast?.("Screen sharing stopped", "Your screen is no longer shared.");
    refreshCallButtons();
  }

  async function toggleScreenShareFixed() {
    const s = state();
    try {
      if (!s?.active) {
        const ch = channel();
        if (!ch) return window.showError?.("Open a voice or video room first.");
        await window.startCall?.("video");
      }

      const current = state();
      if (!current?.active) return;
      if (current.screenTrack) return stopScreenShareFixed();

      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing is not supported by this browser.");
      }

      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "motion", frameRate: { ideal: 30, max: 60 } },
        audio: false
      });

      const track = display.getVideoTracks()[0];
      if (!track) throw new Error("No screen video track was returned.");
      current.screenTrack = track;

      try { current.localStream?.addTrack?.(track); } catch {}

      for (const item of current.peers.values()) {
        let sender = findVideoSender(item.pc);
        if (sender) {
          await sender.replaceTrack(track);
        } else {
          item.pc.addTrack(track, display);
          sender = findVideoSender(item.pc);
        }
        await renegotiate(item);
      }

      const self = document.querySelector('.call-tile[data-peer="self"]');
      if (self) {
        const video = self.querySelector("video");
        video.srcObject = display;
        video.classList.remove("mirror");
        video.play?.().catch(() => {});
        self.classList.add("screen-sharing");
        const badge = self.querySelector(".tile-badge");
        if (badge) badge.textContent = "SCREEN";
      }

      track.onended = () => {
        if (state()?.screenTrack === track) stopScreenShareFixed();
      };

      $("#share-btn")?.classList.add("active", "screen-live");
      $("#dock-screen")?.classList.add("active");
      if (typeof window.emitCallMediaState === "function") window.emitCallMediaState();
      window.orbitToast?.("Screen sharing started", "Your screen is now being shared.", "success");
    } catch (err) {
      if (err?.name !== "AbortError") {
        window.showError?.("Screen sharing failed: " + (err?.message || "permission denied"));
      }
    } finally {
      refreshCallButtons();
    }
  }

  function bind() {
    const mic = $("#mic-btn"), cam = $("#camera-btn"), share = $("#share-btn");
    if (mic) mic.onclick = typeof window.toggleMic === "function" ? window.toggleMic : mic.onclick;
    if (cam) cam.onclick = typeof window.toggleCamera === "function" ? window.toggleCamera : cam.onclick;
    if (share) share.onclick = toggleScreenShareFixed;
    refreshCallButtons();
  }

  document.addEventListener("DOMContentLoaded", bind);
  window.addEventListener("load", bind);
  setTimeout(bind, 0);
  setTimeout(bind, 800);
  setInterval(refreshCallButtons, 1200);
  window.stopScreenShare = stopScreenShareFixed;
  window.refreshOrbitCallButtons = refreshCallButtons;
})();
