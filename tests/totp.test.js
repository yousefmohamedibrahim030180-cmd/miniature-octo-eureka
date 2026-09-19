const test=require("node:test");
const assert=require("node:assert/strict");
const t=require("../platform/totp");

test("TOTP secret round-trips and verifies",()=>{
  const secret=t.generateSecret();
  const code=t.totpCode(secret,1700000000000);
  assert.match(secret,/^[A-Z2-7]+$/);
  assert.equal(t.verifyTotp(secret,code,1700000000000),true);
  assert.equal(t.verifyTotp(secret,"000000",1700000000000),false);
});
test("encrypted TOTP secret decrypts only with same key material",()=>{
  const secret=t.generateSecret();
  const encrypted=t.encryptSecret(secret,"unit-test-key");
  assert.equal(t.decryptSecret(encrypted,"unit-test-key"),secret);
  assert.throws(()=>t.decryptSecret(encrypted,"wrong-key"));
});
test("recovery codes are one-time",()=>{
  const codes=t.makeRecoveryCodes(3);
  const stored=codes.map(code=>({hash:t.hashRecoveryCode(code),usedAt:null}));
  assert.equal(t.consumeRecoveryCode(stored,codes[0]),true);
  assert.equal(t.consumeRecoveryCode(stored,codes[0]),false);
});
