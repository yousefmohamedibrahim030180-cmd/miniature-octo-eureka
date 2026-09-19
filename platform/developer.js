const crypto = require("crypto");

const API_KEY_SCOPES = Object.freeze([
  "profile.read",
  "communities.read",
  "channels.read",
  "messages.read",
  "messages.write",
  "community.manage",
  "events.read",
  "events.write",
  "moderation.read",
  "webhooks.manage"
]);

function hashSecret(value){
  return crypto.createHash("sha256").update(String(value||"")).digest("hex");
}
function safeCredentialName(value){
  return String(value||"Credential").trim().replace(/[^\w .:@-]/g,"").slice(0,100) || "Credential";
}
function makeApiKeySecret(){
  return "orb_live_" + crypto.randomBytes(32).toString("base64url");
}
function makeClientId(){
  return "orb_app_" + crypto.randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9_-]/g,"");
}
function makeClientSecret(){
  return "orb_secret_" + crypto.randomBytes(40).toString("base64url");
}
function validScopes(scopes){
  const input=Array.isArray(scopes)?scopes:[];
  return [...new Set(input.map(x=>String(x)).filter(x=>API_KEY_SCOPES.includes(x)))];
}
module.exports={API_KEY_SCOPES,hashSecret,safeCredentialName,makeApiKeySecret,makeClientId,makeClientSecret,validScopes};
