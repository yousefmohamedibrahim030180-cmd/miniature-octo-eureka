const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

async function configureRedisAdapter(io, redisUrl, logger = console) {
  const url = String(redisUrl || "").trim();
  if (!url) return { enabled: false, reason: "REDIS_URL not configured" };

  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();

  const report = (name) => (error) => logger.error("[orbit] redis " + name + " error:", error?.message || error);
  pubClient.on("error", report("publisher"));
  subClient.on("error", report("subscriber"));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    return { enabled: true, pubClient, subClient };
  } catch (error) {
    try { await pubClient.quit(); } catch {}
    try { await subClient.quit(); } catch {}
    logger.error("[orbit] Redis adapter unavailable; keeping the local Socket.IO adapter:", error.message);
    return { enabled: false, reason: error.message };
  }
}

async function closeRedisAdapter(state) {
  if (!state?.enabled) return;
  try { await state.pubClient.quit(); } catch {}
  try { await state.subClient.quit(); } catch {}
}

module.exports = { configureRedisAdapter, closeRedisAdapter };
