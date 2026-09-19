const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function migrate() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is required to run ORBIT migrations.");
  const pool = new Pool({connectionString:url,max:3,connectionTimeoutMillis:10000,ssl:process.env.DATABASE_SSL === "disable" ? false : {rejectUnauthorized:false}});
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO orbit_migrations(version) VALUES($1) ON CONFLICT(version) DO NOTHING",["platform-v1-20260920"]);
    await client.query("COMMIT");
    console.log("[orbit] platform-v1 migration applied.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
module.exports = { migrate };

if (require.main === module) migrate().catch(error=>{console.error("[orbit] migration failed:",error.message);process.exit(1)});
