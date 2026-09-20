module.exports = {
  version: "1.1.0",
  product: "ORBIT",
  capabilities: {
    communities: true, chat: true, threads: true, directMessages: true, friends: true, presence: true,
    voice: true, video: true, screenShare: true, events: true, projects: true, moderation: true, search: true,
    notifications: true, profiles: true, uploads: true, streaming: false, payments: false, bots: false, developerApi: true
  },
  integrations: {
    database: Boolean(process.env.DATABASE_URL),
    redis: Boolean(process.env.REDIS_URL),
    storage: Boolean(process.env.STORAGE_ENDPOINT && process.env.STORAGE_BUCKET),
    oauthGoogle: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    payments: Boolean(process.env.PAYMENT_PROVIDER_KEY),
    turn: Boolean(process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL)
  }
};
