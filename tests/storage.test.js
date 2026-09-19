const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorage, configFromEnv, ALLOWED_TYPES } = require("../platform/storage");

test("storage remains disabled without S3 configuration",()=>{
  const storage=createStorage({});
  assert.equal(storage.enabled,false);
  assert.match(storage.reason,/not configured/i);
});

test("storage config normalizes max upload size",()=>{
  const config=configFromEnv({STORAGE_ENDPOINT:"https://storage.example",STORAGE_BUCKET:"orbit",STORAGE_ACCESS_KEY:"a",STORAGE_SECRET_KEY:"b",UPLOAD_MAX_BYTES:"1000"});
  assert.equal(config.maxBytes,1000);
  assert.equal(ALLOWED_TYPES.has("image/png"),true);
});
