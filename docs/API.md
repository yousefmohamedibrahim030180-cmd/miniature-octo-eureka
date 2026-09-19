# ORBIT API v1

The public developer contract is versioned under `/api/v1`.

## Authentication

Use a scoped API key in either:
`Authorization: Bearer <orb_live_...>`
or
`X-ORBIT-API-Key: <orb_live_...>`

The Developer Portal creates keys with explicit scopes. Secrets are returned once.

## SDK endpoints

- `GET /api/v1/sdk/me` — `profile.read`
- `GET /api/v1/sdk/communities` — `communities.read`
- `GET /api/v1/sdk/communities/:id/channels` — `channels.read`
- `POST /api/v1/sdk/channels/:id/messages` — `messages.write`

The server checks the API key scope and the user's actual ORBIT community permissions. Client-side UI state is never treated as an authorization boundary.

Unsupported integrations remain disabled/configuration-driven; no endpoint fabricates third-party provider behavior.

