const { createClient } = require("redis");

function createJobQueue(redisUrl, logger=console) {
  const url=String(redisUrl||"").trim();
  if(!url) return {
    enabled:false,
    reason:"REDIS_URL not configured",
    async enqueue(){ throw new Error("Background jobs require REDIS_URL."); },
    async close(){}
  };

  const client=createClient({url});
  client.on("error",error=>logger.error("[orbit] job queue redis error:",error?.message||error));

  let ready=null;
  async function connect(){
    if(!ready) ready=client.connect().then(()=>true).catch(error=>{ready=null;throw error});
    return ready;
  }
  async function enqueue(name,payload,options={}){
    await connect();
    const item=JSON.stringify({id:"job_"+require("crypto").randomUUID(),name,payload,attempts:0,createdAt:new Date().toISOString()});
    await client.lPush(String(options.queue||"orbit:jobs"),item);
    return JSON.parse(item);
  }
  async function dequeue(queue="orbit:jobs",timeoutSeconds=5){
    await connect();
    const result=await client.brPop(queue,timeoutSeconds);
    return result?.element ? JSON.parse(result.element) : null;
  }
  async function close(){try{await client.quit()}catch{}}
  return {enabled:true,enqueue,dequeue,close,client};
}

module.exports={createJobQueue};
