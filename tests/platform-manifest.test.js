const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../platform/manifest");

test("ORBIT platform manifest exposes current capabilities honestly",()=>{
  assert.equal(manifest.product,"ORBIT");
  assert.equal(manifest.capabilities.chat,true);
  assert.equal(manifest.capabilities.voice,true);
  assert.equal(typeof manifest.capabilities.streaming,"boolean");
  assert.equal(typeof manifest.integrations.turn,"boolean");
});
