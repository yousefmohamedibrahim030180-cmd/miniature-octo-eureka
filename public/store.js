(() => {
  const cfg = window.ORBIT_STORE_CONFIG || {};
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) {
    localStorage.setItem("orbit_referrer", ref.slice(0, 80));
    document.documentElement.dataset.ref = "1";
  }

  const referralId = localStorage.getItem("orbit_referral_id") || ("orbit_" + Math.random().toString(36).slice(2, 10));
  localStorage.setItem("orbit_referral_id", referralId);

  const status = document.getElementById("storeStatus");
  const modal = document.getElementById("buyModal");
  const modalTitle = document.getElementById("buyTitle");
  const modalText = document.getElementById("buyText");
  const modalLink = document.getElementById("buyLink");
  const close = () => modal?.classList.remove("open");

  document.querySelectorAll("[data-buy]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.buy;
      const item = (cfg.plans && cfg.plans[key]) || (cfg.products && cfg.products[key]);
      const url = item?.checkoutUrl || "";
      if (url) {
        const sep = url.includes("?") ? "&" : "?";
        const referrer = localStorage.getItem("orbit_referrer");
        const decorated = referrer ? url + sep + "checkout%5Bcustom%5D%5Breferral%5D=" + encodeURIComponent(referrer) : url;
        window.open(decorated, "_blank", "noopener,noreferrer");
        return;
      }
      modalTitle.textContent = item?.label || "ORBIT Store";
      modalText.textContent = "Checkout is ready to be connected. The storefront is live; the final step is adding your Lemon Squeezy checkout URL for this product.";
      modalLink.textContent = "Open setup guide";
      modalLink.href = "https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments";
      modal.classList.add("open");
    });
  });

  document.querySelectorAll("[data-copy-ref]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const url = location.origin + "/store.html?ref=" + encodeURIComponent(referralId);
      await navigator.clipboard.writeText(url);
      btn.textContent = "Copied";
      setTimeout(() => btn.textContent = "Copy invite link", 1400);
    });
  });

  document.querySelectorAll("[data-close]").forEach(x => x.addEventListener("click", close));
  modal?.addEventListener("click", e => { if (e.target === modal) close(); });

  if (status) {
    const configured = Object.values(cfg.plans || {}).filter(x => x.checkoutUrl).length;
    status.textContent = configured
      ? "Checkout connected · " + configured + " plans live"
      : "Storefront live · checkout awaiting merchant links";
  }
})();