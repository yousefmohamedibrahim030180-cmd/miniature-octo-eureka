# ORBIT Architecture

The existing Node.js + Express + Socket.IO + WebRTC application remains the compatibility runtime. ORBIT is being upgraded incrementally instead of being replaced in one risky rewrite.

The migration adds a normalized PostgreSQL model, versioned API contracts, security middleware, request IDs and production deployment artifacts while preserving the existing chat/call contracts.

Legacy /api endpoints remain available during migration. New domain contracts should use /api/v1. Realtime traffic remains scoped with Socket.IO rooms. WebRTC signaling remains server-mediated and TURN is supplied through /api/realtime-config.

The normalized database is introduced additively. Legacy JSON state is not silently copied into relational tables; data migration is a separate verified step.

## Authentication and realtime scaling

The compatibility token flow remains valid for existing clients. New account sign-in uses `/api/v1/auth` with a short-lived access token, an HttpOnly refresh cookie, rotating refresh tokens, revocable sessions, device metadata and explicit session listing/revocation.

When `REDIS_URL` is configured, ORBIT switches Socket.IO to the Redis adapter so broadcasts can span multiple application instances. Without Redis, the native in-memory adapter remains active and no fake scaling state is shown.
