const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("../platform/session");

test("session manager issues, rotates and revokes sessions",()=>{
  const users=new Map([["u1",{id:"u1",username:"orbit-user",passwordHash:"hash"}]]);
  const sessions=new Map();
  const manager=createSessionManager({jwtSecret:"x".repeat(64),sessions,users});
  const req={ip:"127.0.0.1",headers:{"user-agent":"ORBIT Test"}};
  const issued=manager.issue(users.get("u1"),req);
  assert.ok(issued.accessToken);
  assert.ok(issued.refreshToken);
  assert.equal(manager.verifyAccess(issued.accessToken).user.id,"u1");
  const rotated=manager.refresh(issued.refreshToken,req);
  assert.ok(rotated.accessToken);
  assert.notEqual(rotated.refreshToken,issued.refreshToken);
  assert.equal(manager.list("u1").length,1);
  assert.equal(manager.revoke(rotated.session.id,"u1"),true);
  assert.throws(()=>manager.verifyAccess(rotated.accessToken));
});
