const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../platform/permissions");

test("role permissions are centralized and deterministic",()=>{
  assert.equal(p.hasPermission("owner",p.PERMISSIONS.MANAGE_COMMUNITY),true);
  assert.equal(p.hasPermission("member",p.PERMISSIONS.MANAGE_COMMUNITY),false);
  assert.equal(p.hasPermission("moderator",p.PERMISSIONS.MANAGE_MESSAGES),true);
  assert.equal(p.CHANNEL_TYPES.includes("forum"),true);
  assert.equal(p.CHANNEL_TYPES.includes("stage"),true);
  assert.equal(p.channelAllowsText("forum"),true);
  assert.equal(p.channelAllowsRealtime("video"),true);
});
