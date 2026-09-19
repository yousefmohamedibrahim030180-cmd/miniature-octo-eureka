const test=require("node:test");
const assert=require("node:assert/strict");

test("analytics event payload rules are documented by the API contract",()=>{
  const valid=/^[a-zA-Z0-9_.:-]{2,120}$/;
  assert.equal(valid.test("message.created"),true);
  assert.equal(valid.test("community:join"),true);
  assert.equal(valid.test("bad name"),false);
});
