const crypto = require("crypto");

function base32Encode(buffer){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits=0,value=0,out="";
  for(const byte of buffer){
    value=(value<<8)|byte; bits+=8;
    while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}
  }
  if(bits>0)out+=alphabet[(value<<(5-bits))&31];
  return out;
}

function base32Decode(input){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean=String(input||"").replace(/=+$/,"").replace(/\s+/g,"").toUpperCase();
  let bits=0,value=0,out=[];
  for(const ch of clean){
    const index=alphabet.indexOf(ch);
    if(index<0)throw new Error("Invalid TOTP secret");
    value=(value<<5)|index;bits+=5;
    if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}
  }
  return Buffer.from(out);
}

function generateSecret(){
  return base32Encode(crypto.randomBytes(20));
}

function totpCode(secret, timestamp=Date.now()){
  const key=base32Decode(secret);
  const counter=Math.floor(Number(timestamp)/1000/30);
  const counterBuffer=Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac("sha1",key).update(counterBuffer).digest();
  const offset=digest[digest.length-1]&15;
  const binary=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
  return String(binary%1000000).padStart(6,"0");
}

function verifyTotp(secret,code,timestamp=Date.now()){
  const clean=String(code||"").replace(/\s+/g,"");
  if(!/^\d{6}$/.test(clean))return false;
  for(let delta=-1;delta<=1;delta++){
    if(totpCode(secret,timestamp+delta*30000)===clean)return true;
  }
  return false;
}

function encryptSecret(secret,keyMaterial){
  const key=crypto.createHash("sha256").update("ORBIT-2FA:"+String(keyMaterial||"")).digest();
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(String(secret),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [iv,ciphertext,tag].map(x=>x.toString("base64url")).join(".");
}

function decryptSecret(encoded,keyMaterial){
  const parts=String(encoded||"").split(".");
  if(parts.length!==3)throw new Error("Invalid encrypted 2FA secret");
  const key=crypto.createHash("sha256").update("ORBIT-2FA:"+String(keyMaterial||"")).digest();
  const iv=Buffer.from(parts[0],"base64url"),ciphertext=Buffer.from(parts[1],"base64url"),tag=Buffer.from(parts[2],"base64url");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8");
}

function makeRecoveryCodes(count=10){
  const out=[];
  for(let i=0;i<count;i++)out.push(crypto.randomBytes(5).toString("hex").toUpperCase());
  return out;
}

function hashRecoveryCode(code){
  return crypto.createHash("sha256").update(String(code||"").replace(/\s+/g,"").toUpperCase()).digest("hex");
}

function consumeRecoveryCode(recoveryCodes,code){
  const hash=hashRecoveryCode(code);
  const index=(recoveryCodes||[]).findIndex(item=>item.hash===hash&&!item.usedAt);
  if(index<0)return false;
  recoveryCodes[index].usedAt=new Date().toISOString();
  return true;
}

function setupUri(secret,username){
  const label=encodeURIComponent("ORBIT:"+String(username||"user"));
  const issuer=encodeURIComponent("ORBIT");
  return "otpauth://totp/"+label+"?secret="+encodeURIComponent(secret)+"&issuer="+issuer+"&algorithm=SHA1&digits=6&period=30";
}

module.exports={generateSecret,totpCode,verifyTotp,encryptSecret,decryptSecret,makeRecoveryCodes,hashRecoveryCode,consumeRecoveryCode,setupUri};
