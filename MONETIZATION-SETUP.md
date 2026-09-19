# ORBIT Monetization Setup

The storefront is live at `/store.html`.

## Payments

ORBIT is prepared for Lemon Squeezy checkout links. Create these products/variants in Lemon Squeezy:

- ORBIT Pro — $5/month
- ORBIT Ultra — $10/month
- ORBIT Server Pro — $10/month
- Neon Atmosphere — one-time
- Aurora Theme — one-time
- Royal Profile Pack — one-time

Then put the generated `/checkout/buy/<VARIANT_ID>` links into `public/store-config.js`:

```js
window.ORBIT_STORE_CONFIG = {
  provider: "lemonsqueezy",
  currency: "USD",
  plans: {
    pro: { checkoutUrl: "https://YOUR-STORE.lemonsqueezy.com/checkout/buy/PRO_VARIANT_ID", label: "ORBIT Pro" },
    ultra: { checkoutUrl: "https://YOUR-STORE.lemonsquee.com/checkout/buy/ULTRA_VARIANT_ID", label: "ORBIT Ultra" },
    server: { checkoutUrl: "https://YOUR-STORE.lemonsquee.com/checkout/buy/SERVER_VARIANT_ID", label: "Server Pro" }
  },
  products: {
    neon: { checkoutUrl: "https://YOUR-STORE.lemonsquee.com/checkout/buy/NEON_VARIANT_ID", label: "Neon Atmosphere" },
    aurora: { checkoutUrl: "https://YOUR-STORE.lemonsquee.com/checkout/buy/AURORA_VARIANT_ID", label: "Aurora Theme" },
    royal: { checkoutUrl: "https://YOUR-STORE.lemonsquee.com/checkout/buy/ROYAL_VARIANT_ID", label: "Royal Profile Pack" }
  },
  referralDays: 7
};
```

## Referral

The store already creates a personal referral URL such as:

`https://YOUR-ORBIT-DOMAIN/store.html?ref=orbit_xxxxxxxx`

The storefront persists the referral identifier locally and appends it to the checkout as custom checkout data. For production rewards, wire the Lemon Squeezy `order_created` / `subscription_created` webhooks to the ORBIT account-entitlement system and award Pro time there.

## Important

Do not put Lemon Squeezy API keys in frontend files. API keys and webhook signing secrets belong in Railway environment variables only.

