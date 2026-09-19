const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function cookieMap(req) {
  const header = String(req.headers.cookie || "");
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0,index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setRefreshCookie(res, token, secure, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const flags = [
    "Path=/api/v1/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + Math.max(60, Math.floor(maxAgeSeconds))
  ];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", "orbit_refresh=" + encodeURIComponent(token) + "; " + flags.join("; "));
}

function clearRefreshCookie(res, secure) {
  const flags = ["Path=/api/v1/auth","HttpOnly","SameSite=Lax","Max-Age=0"];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", "orbit_refresh=; " + flags.join("; "));
}

function createSessionManager({ jwtSecret, sessions, users }) {
  function issue(user, req, previousSession = null) {
    const refreshToken = crypto.randomBytes(48).toString("base64url");
    const sessionId = previousSession?.id || ("sess_" + crypto.randomUUID());
    const createdAt = previousSession?.createdAt || new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const record = {
      id: sessionId,
      userId: String(user.id),
      refreshHash: hashToken(refreshToken),
      createdAt,
      lastSeenAt: new Date().toISOString(),
      expiresAt,
      revokedAt: null,
      ip: String(req.ip || req.headers["x-forwarded-for"] || "").slice(0,120),
      userAgent: String(req.headers["user-agent"] || "Unknown device").slice(0,300)
    };
    sessions.set(sessionId, record);
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, account: true, sessionId },
      jwtSecret,
      { expiresIn: "15m" }
    );
    return { accessToken, refreshToken, session: record };
  }

  function sessionFromAccess(payload) {
    const session = payload?.sessionId ? sessions.get(String(payload.sessionId)) : null;
    if (!session) return null;
    if (session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return null;
    return session;
  }

  function verifyAccess(token) {
    const payload = jwt.verify(String(token || ""), jwtSecret);
    const session = sessionFromAccess(payload);
    if (!session) throw new Error("Session revoked or expired");
    const user = users.get(String(payload.id));
    if (!user || user.suspended) throw new Error("Account unavailable");
    session.lastSeenAt = new Date().toISOString();
    return { payload, session, user };
  }

  function refresh(refreshToken, req) {
    const hash = hashToken(refreshToken);
    let found = null;
    for (const session of sessions.values()) {
      if (session.refreshHash === hash && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now()) {
        found = session;
        break;
      }
    }
    if (!found) throw new Error("Refresh session is invalid or expired");
    const user = users.get(String(found.userId));
    if (!user || user.suspended) throw new Error("Account unavailable");
    const result = issue(user, req, found);
    return result;
  }

  function revoke(idValue, userId) {
    const session = sessions.get(String(idValue));
    if (!session || String(session.userId) !== String(userId)) return false;
    session.revokedAt = new Date().toISOString();
    return true;
  }

  function revokeAllExcept(idValue, userId) {
    let count = 0;
    for (const session of sessions.values()) {
      if (String(session.userId) === String(userId) && String(session.id) !== String(idValue) && !session.revokedAt) {
        session.revokedAt = new Date().toISOString();
        count++;
      }
    }
    return count;
  }

  function list(userId) {
    return [...sessions.values()]
      .filter(s => String(s.userId) === String(userId) && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now())
      .sort((a,b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
      .map(s => ({
        id: s.id,
        device: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt
      }));
  }

  function sessionIdFromToken(token) {
    try {
      return jwt.verify(String(token || ""), jwtSecret)?.sessionId || null;
    } catch {
      return null;
    }
  }

  return { issue, verifyAccess, refresh, revoke, revokeAllExcept, list, sessionIdFromToken, cookieMap, setRefreshCookie, clearRefreshCookie };
}

module.exports = { createSessionManager, cookieMap, hashToken, setRefreshCookie, clearRefreshCookie };
