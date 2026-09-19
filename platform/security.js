const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

function requestId(req, res, next) {
  const incoming = String(req.get("x-request-id") || "").trim();
  const value = incoming && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("x-request-id", value);
  req.orbitRequestId = value;
  next();
}

function createApiLimiter() {
  const windowMs = Math.max(60000, Number(process.env.RATE_LIMIT_WINDOW_MS || 900000));
  const max = Math.max(100, Number(process.env.RATE_LIMIT_MAX || 1200));
  return rateLimit({ windowMs, limit: max, standardHeaders: "draft-7", legacyHeaders: false, handler: (_req,res)=>res.status(429).json({error:"Too many requests. Please try again shortly."}) });
}

function applySecurity(app) {
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false, referrerPolicy:{policy:"strict-origin-when-cross-origin"}, frameguard:{action:"sameorigin"} }));
}

module.exports = { applySecurity, createApiLimiter };
