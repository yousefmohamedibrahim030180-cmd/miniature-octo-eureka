(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);

  function icon(kind) {
    const svg = {
      mic: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.8" width="10" height="13" rx="5"/><path d="M4.8 11.5a7.2 7.2 0 0 0 14.4 0M12 18.7V22M8.5 22h7"/></svg>',
      camera: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.8h11.2A1.8 1.8 0 0 1 17 8.6v6.8a1.8 1.8 0 0 1-1.8 1.8H4a1.8 1.8 0 0 1-1.8-1.8V8.6A1.8 1.8 0 0 1 4 6.8Z"/><path d="m17 10 4.2-2.2v8.4L17 14"/></svg>',
      screen: '<svg class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
    };
    return svg[kind] || "";
  }

  function refreshCallButtons() {
    const mic = $("#mic-btn"), cam = $("#camera-btn"), share = $("#share-btn");
    if (mic) {
      mic.innerHTML = icon("mic");
      mic.classList.add("icon-action");
      mic.setAttribute("aria-label", mic.classList.contains("off") ? "Unmute microphone" : "Mute microphone");
    }
    if (cam) {
      cam.innerHTML = icon("camera");
      cam.classList.add("icon-action");
      cam.setAttribute("aria-label", cam.classList.contains("off") ? "Turn camera on" : "Turn camera off");
    }
    if (share) {
      share.innerHTML = icon("screen") + '<span class="share-label">Share screen</span>';
      share.setAttribute("aria-label", callState?.screenTrack ? "Stop screen sharing" : "Share screen");
    }
  }

  function renegotiatePeer(item, reason) {
    if (!item?.pc || !window.socket || !callState?.active) return Promise.resolve();
    if (item.pc.signalingState !== "stable") return Promise.resolve();
    return item.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(offer => item.pc.setLocalDescription(offer))
      .then(() => {
        const peerId = [...callState.peers.entries()].find(([, value]) => value === item)?.[0];
        if (peerId) socket.emit(callSignalEvent("offer"), { to: peerId, offer: item.pc.localDescription });
      })
      .catch(err => console.warn("ORBIT renegotiation", reason, err));
  }

  async function orbitScreenShare() {
    try {
      if (!callState.active) {
        if (!window.currentChannel) return window.showError?.("Open a voice or video room first.");
        await window.startCall?.("video");
      }
      if (!callState.active) return;
      if (callState.screenTrack) {
        await window.stopScreenShare?.();
        refreshCallButtons();
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        return window.showError?.("Screen sharing isn't available in this browser.");
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "motion" },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("The browser did not return a screen video track.");

      callState.screenTrack = track;
      const local = callState.localStream;
      if (local && !local.getVideoTracks().includes(track)) local.addTrack(track);

      const peers = [...(callState.peers?.values?.() || [])];
      for (const item of peers) {
        if (!item?.pc) continue;
        let sender = item.pc.getSenders().find(s => s.track?.kind === "video" || (!s.track && s.kind === "video"));
        if (sender) {
          await sender.replaceTrack(track);
        } else {
          item.pc.addTrack(track, stream);
          sender = item.pc.getSenders().find(s => s.track === track);
        }
        await renegotiatePeer(item, "screen-share-start");
      }

      const selfTile = document.querySelector('.call-tile[data-peer="self"]');
      const video = selfTile?.querySelector("video");
      if (video) {
        video.srcObject = stream;
        video.classList.remove("mirror");
        video.play?.().catch(() => {});
      }
      selfTile?.classList.add("screen-sharing");
      const badge = selfTile?.querySelector(".tile-badge");
      if (badge) badge.textContent = "SCREEN";

      track.onended = () => {
        if (callState.screenTrack === track) window.stopScreenShare?.();
        refreshCallButtons();
      };

      $("#share-btn")?.classList.add("active", "screen-live");
      $("#dock-screen")?.classList.add("active");
      window.emitCallMediaState?.();
      window.orbitToast?.("Screen sharing started", "Your screen is now shared.", "success");
    } catch (err) {
      if (err?.name !== "AbortError") window.showError?.("Screen sharing failed: " + (err?.message || "permission denied"));
    } finally {
      refreshCallButtons();
    }
  }

  document.addEventListener("DOMContentLoaded", refreshCallButtons);
  [$("#mic-btn"), $("#camera-btn"), $("#share-btn")].forEach((el) => el?.addEventListener("click", () => setTimeout(refreshCallButtons, 50)));
  window.refreshOrbitCallButtons = refreshCallButtons;
  refreshCallButtons();

  // Re-bind only the three primary controls after app.js has finished its own bindings.
  $("#mic-btn") && ($("#mic-btn").onclick = window.toggleMic);
  $("#camera-btn") && ($("#camera-btn").onclick = window.toggleCamera);
  if ($("#share-btn")) $("#share-btn").onclick = orbitScreenShare;
})();
