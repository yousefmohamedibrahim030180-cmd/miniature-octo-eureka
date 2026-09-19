const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const ADMIN_KEY = String(process.env.ORBIT_DOWNLOAD_ADMIN_KEY || "").trim();
const DATA_DIR = process.env.ORBIT_DOWNLOAD_DATA_DIR || "/data";
const ZIP_PATH = path.join(DATA_DIR, "ORBIT-Windows.zip");
const META_PATH = path.join(DATA_DIR, "metadata.json");
const PUBLIC_DIR = path.join(__dirname, "public");

fs.mkdirSync(DATA_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: "1h" }));

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY || req.get("x-admin-key") !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

async function getMeta() {
  try {
    const stat = await fsp.stat(ZIP_PATH);
    let metadata = {};
    try { metadata = JSON.parse(await fsp.readFile(META_PATH, "utf8")); } catch {}
    return {
      available: true,
      name: "ORBIT-Windows.zip",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      sha256: metadata.sha256 || null,
      version: metadata.version || "1.1.0",
    };
  } catch {
    return { available: false, name: "ORBIT-Windows.zip" };
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "orbit-download", now: new Date().toISOString() });
});

app.get("/api/status", async (_req, res) => {
  res.json(await getMeta());
});

app.get("/download", async (_req, res) => {
  try {
    await fsp.access(ZIP_PATH, fs.constants.R_OK);
  } catch {
    return res.status(404).send("ORBIT-Windows.zip is not uploaded yet.");
  }

  res.download(
    ZIP_PATH,
    "ORBIT-Windows.zip",
    { acceptRanges: true, cacheControl: false },
    (err) => {
      if (err && !res.headersSent) {
        res.status(500).send("Download failed.");
      }
    }
  );
});

const upload = multer({
  dest: DATA_DIR,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.post("/admin/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  const source = req.file.path;
  try {
    if (req.file.size > 500 * 1024 * 1024) {
      throw new Error("File too large");
    }

    const hash = crypto.createHash("sha256");
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(source);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    await fsp.rm(ZIP_PATH, { force: true });
    await fsp.rename(source, ZIP_PATH);

    await fsp.writeFile(
      META_PATH,
      JSON.stringify({
        sha256: hash.digest("hex"),
        version: "1.1.0",
        uploadedAt: new Date().toISOString(),
      }, null, 2)
    );

    res.json({ ok: true, ...(await getMeta()) });
  } catch (error) {
    await fsp.rm(source, { force: true }).catch(() => {});
    res.status(500).json({ ok: false, error: error.message || "Upload failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[orbit-download] listening on ${PORT}`);
});
