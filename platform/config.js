const env = {
  nodeEnv: String(process.env.NODE_ENV || "development"),
  port: Number(process.env.PORT || 8080),
  appUrl: String(process.env.APP_URL || "").trim(),
  apiUrl: String(process.env.API_URL || "").trim(),
  databaseUrl: String(process.env.DATABASE_URL || "").trim(),
  redisUrl: String(process.env.REDIS_URL || "").trim(),
  autoMigrate: String(process.env.ORBIT_AUTO_MIGRATE || "false").toLowerCase() === "true"
};

function assertProductionBasics() {
  if (env.nodeEnv !== "production") return;
  if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters in production.");
}

module.exports = { env, assertProductionBasics };
