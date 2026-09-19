# ORBIT Database

The current service can run with its compatibility persistence sidecar. The normalized schema is additive and can be enabled when DATABASE_URL is configured.

Run npm run db:migrate after configuring DATABASE_URL. The migration is idempotent and includes users, sessions, communities, members, roles, channels, messages, reactions, files, social graph, notifications, moderation, calls, streams, events, posts, creators, bots, webhooks, developer applications, subscriptions, analytics and feature flags.

The migration does not copy legacy JSON records automatically. This avoids duplicate users or communities during the transition.
