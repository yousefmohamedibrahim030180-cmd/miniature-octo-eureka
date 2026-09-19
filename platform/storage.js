const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const ALLOWED_TYPES = new Set([
  "image/jpeg","image/png","image/gif","image/webp","image/avif",
  "video/mp4","video/webm","audio/mpeg","audio/ogg","audio/wav",
  "application/pdf","application/zip","application/x-zip-compressed",
  "text/plain","text/csv",
  "application/json"
]);

function configFromEnv(env = process.env) {
  return {
    endpoint: String(env.STORAGE_ENDPOINT || "").trim(),
    bucket: String(env.STORAGE_BUCKET || "").trim(),
    accessKeyId: String(env.STORAGE_ACCESS_KEY || "").trim(),
    secretAccessKey: String(env.STORAGE_SECRET_KEY || "").trim(),
    region: String(env.STORAGE_REGION || "auto").trim(),
    maxBytes: Math.max(1024, Number(env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024))
  };
}

function createStorage(env = process.env) {
  const config = configFromEnv(env);
  const enabled = Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey);
  if (!enabled) return { enabled:false, reason:"S3-compatible storage is not configured", config };

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: String(env.STORAGE_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  function validateMeta({ filename, contentType, size }) {
    const safeName = String(filename || "file").trim().replace(/[^A-Za-z0-9._ -]/g,"_").slice(0,180) || "file";
    const type = String(contentType || "application/octet-stream").toLowerCase();
    const bytes = Number(size || 0);
    if (!ALLOWED_TYPES.has(type)) throw new Error("Unsupported upload type.");
    if (!Number.isFinite(bytes) || bytes < 1 || bytes > config.maxBytes) throw new Error("Upload exceeds the configured size limit.");
    return { filename:safeName, contentType:type, size:Math.floor(bytes) };
  }

  async function presignUpload(meta, userId) {
    const valid = validateMeta(meta);
    const key = [
      "users",
      String(userId),
      new Date().toISOString().slice(0,10),
      crypto.randomUUID() + "-" + valid.filename
    ].join("/");
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key:key,
      ContentType:valid.contentType,
      ContentLength:valid.size
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 600 });
    return {
      key,
      filename:valid.filename,
      contentType:valid.contentType,
      size:valid.size,
      uploadUrl,
      expiresIn:600
    };
  }

  async function presignDownload(key, expiresIn=600) {
    const safeKey=String(key||"");
    if (!safeKey.startsWith("users/")) throw new Error("Invalid object key.");
    const command=new GetObjectCommand({Bucket:config.bucket,Key:safeKey});
    return getSignedUrl(client,command,{expiresIn:Math.max(60,Math.min(3600,Number(expiresIn)||600))});
  }

  return { enabled:true, config, validateMeta, presignUpload, presignDownload };
}

module.exports = { createStorage, configFromEnv, ALLOWED_TYPES };
