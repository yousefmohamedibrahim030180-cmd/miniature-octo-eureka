(() => {
  "use strict";

  const KEY = "orbit_atmosphere_v1";

  const MODES = [
    ["void","Void","Deep black space with slow violet orbit energy","dark"],
    ["nebula","Nebula","Purple clouds, distant starlight and soft cyan dust","dark"],
    ["aurora","Aurora","Living green-cyan aurora with violet haze","balanced"],
    ["solar","Solar Flare","Warm solar glow with energetic orbital rings","balanced"],
    ["eclipse","Eclipse","Dark eclipse core with a bright halo","dark"],
    ["galaxy","Galaxy","Dense star field with blue-violet galactic depth","balanced"],
    ["plasma","Plasma","Electric blue plasma streams with high-energy glow","dark"],
    ["ice","Ice Galaxy","Cool crystalline space with pale blue highlights","light"],
    ["moon","Moon Glow","Soft lunar atmosphere with silver-blue light","light"],
    ["prism","Prism","Refined spectral light with glassy color shifts","light"],
    ["cyber","Cyber Space","Deep graphite space with precise cyan/violet energy","dark"],
    ["redplanet","Red Planet","Mars-inspired dust, ember glow and orbit lines","balanced"],
    ["blueplanet","Blue Planet","Oceanic blue planet glow with clean cyan light","balanced"],
    ["wormhole","Wormhole","A deep spatial tunnel with rotating violet rings","dark"],
    ["stardust","Stardust","Fine particles and soft white-blue star dust","balanced"],
    ["quantum","Quantum","Layered particles, fine grids and shifting violet energy","balanced"],
    ["pearl","Pearl Orbit","Bright pearl glass atmosphere with subtle silver rings","light"],
    ["dawn","Solar Dawn","Warm sunrise gradient fading into deep space","light"],
    ["meteor","Meteor Field","Fast faint streaks crossing a deep orbital field","dark"],
    ["singularity","Singularity","Dense central gravity well with a bright rim","dark"],
    ["ocean","Deep Ocean","Midnight ocean blue with floating light particles","balanced"],
    ["horizon","Blue Horizon","Clean blue-white horizon glow across dark space","light"],
    ["lavender","Lavender Space","Soft lavender glass light with violet depth","light"],
    ["midnight","Midnight","Minimal dark navy atmosphere for maximum focus","dark"]
  ];

  const defaults = {
    mode: "nebula",
    light: "balanced",
    speed: 42,
    stars: 68,
    glow: 66,
    parallax: true,
    motion: true
  };

  const read = () => {
    try { return {...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "{}"))}; }
    catch { return {...defaults}; }
  };

  let prefs = read();

  function mount() {
    if (document.querySelector(".orbit-space-bg")) return;
    const root = document.createElement("div");
    root.className = "orbit-space-bg";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="orbit-space-nebula"></div>' +
      '<div class="orbit-space-glow orbit-glow-a"></div>' +
      '<div class="orbit-space-glow orbit-glow-b"></div>' +
      '<div class="orbit-space-ring orbit-ring-a"></div>' +
      '<div class="orbit-space-ring orbit-ring-b"></div>' +
      '<div class="orbit-space-ring orbit-ring-c"></div>' +
      '<div class="orbit-space-stars"></div>' +
      '<div class="orbit-space-dust"></div>' +
      '<div class="orbit-space-vignette"></div>';
    document.body.prepend(root);

    const stars = root.querySelector(".orbit-space-stars");
    const dust = root.querySelector(".orbit-space-dust");
    for (let i = 0; i < 110; i++) {
      const s = document.createElement("i");
      s.style.setProperty("--x", Math.random() * 100 + "%");
      s.style.setProperty("--y", Math.random() * 100 + "%");
      s.style.setProperty("--size", (Math.random() * 2.2 + 0.5).toFixed(2) + "px");
      s.style.setProperty("--delay", (-Math.random() * 8).toFixed(2) + "s");
      s.style.setProperty("--dur", (4 + Math.random() * 8).toFixed(2) + "s");
      s.style.setProperty("--alpha", (0.18 + Math.random() * 0.82).toFixed(2));
      stars.appendChild(s);
    }
    for (let i = 0; i < 28; i++) {
      const d = document.createElement("i");
      d.style.setProperty("--x", Math.random() * 100 + "%");
      d.style.setProperty("--y", Math.random() * 100 + "%");
      d.style.setProperty("--r", (Math.random() * 18 + 4).toFixed(1) + "px");
      d.style.setProperty("--delay", (-Math.random() * 14).toFixed(2) + "s");
      dust.appendChild(d);
    }

    if (window.matchMedia) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (reduced.matches) prefs.motion = false;
    }

    window.addEventListener("pointermove", e => {
      if (!prefs.parallax || !prefs.motion) return;
      const x = (e.clientX / Math.max(1, innerWidth) - .5) * 2;
      const y = (e.clientY / Math.max(1, innerHeight) - .5) * 2;
      document.documentElement.style.setProperty("--orbit-mx", (x * 12).toFixed(2) + "px");
      document.documentElement.style.setProperty("--orbit-my", (y * 10).toFixed(2) + "px");
    }, {passive:true});
  }

  function apply(next = {}) {
    prefs = {...prefs, ...next};
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
    mount();
    const root = document.documentElement;
    document.body.dataset.orbitAtmosphere = prefs.mode || defaults.mode;
    document.body.dataset.orbitLight = prefs.light || defaults.light;
    document.body.classList.toggle("orbit-atmosphere-motion", prefs.motion !== false);
    document.body.classList.toggle("orbit-atmosphere-static", prefs.motion === false);
    document.body.classList.toggle("orbit-no-parallax", prefs.parallax === false);
    root.style.setProperty("--orbit-speed", Math.max(5, Number(prefs.speed || 42)) / 42);
    root.style.setProperty("--orbit-stars-opacity", Math.max(15, Math.min(100, Number(prefs.stars || 68))) / 100);
    root.style.setProperty("--orbit-glow-strength", Math.max(15, Math.min(100, Number(prefs.glow || 66))) / 100);
    document.querySelectorAll("[data-orbit-preview-label]").forEach(el => {
      const item = MODES.find(m => m[0] === prefs.mode);
      el.textContent = item ? item[1] : "Atmosphere";
    });
  }

  function createPreview(mode) {
    const item = MODES.find(m => m[0] === mode) || MODES[1];
    return '<div class="atmosphere-mini-preview" data-preview-atmosphere="' + item[0] + '">' +
      '<span class="mini-orbit one"></span><span class="mini-orbit two"></span><span class="mini-core"></span>' +
      '<span class="mini-star s1"></span><span class="mini-star s2"></span><span class="mini-star s3"></span>' +
      '<strong>' + item[1] + '</strong></div>';
  }

  window.__ORBIT_ATMOSPHERES = MODES;
  window.__ORBIT_ATMOSPHERE_DEFAULTS = defaults;
  window.__ORBIT_SET_ATMOSPHERE = apply;
  window.__ORBIT_ATMOSPHERE_PREVIEW = createPreview;

  mount();
  apply(prefs);

  window.addEventListener("storage", e => {
    if (e.key === KEY) apply(read());
  });
})();