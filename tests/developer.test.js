const test=require("node:test");
const assert=require("node:assert/strict");
const d=require("../platform/developer");

test("developer scopes are allowlisted and unique",()=>{
  assert.deepEqual(d.validScopes(["profile.read","profile.read","not-a-scope"]),["profile.read"]);
  assert.equal(d.API_KEY_SCOPES.includes("messages.write"),true);
});
test("developer secrets are high entropy and hash one-way",()=>{
  const key=d.makeApiKeySecret(), client=d.makeClientSecret();
  assert.match(key,/^orb_live_/);
  assert.match(client,/^orb_secret_/);
  assert.notEqual(key,d.hashSecret(key));
  assert.notEqual(client,d.hashSecret(client));
});
test("developer application IDs are non-empty and distinct",()=>{
  assert.notEqual(d.makeClientId(),d.makeClientId());
});
