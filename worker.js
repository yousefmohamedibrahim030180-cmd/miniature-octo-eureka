const { createJobQueue } = require("./platform/jobs");

const queueName=String(process.env.ORBIT_JOB_QUEUE||"orbit:jobs");
const queue=createJobQueue(process.env.REDIS_URL,console);
const handlers=new Map();

handlers.set("analytics.record",async job=>{
  console.log("[orbit-worker] analytics.record",JSON.stringify(job.payload||{}));
});

handlers.set("notification.deliver",async job=>{
  console.log("[orbit-worker] notification.deliver",JSON.stringify(job.payload||{}));
});

async function run(){
  if(!queue.enabled){
    console.log("[orbit-worker] REDIS_URL not configured; worker is dormant by design.");
    return;
  }
  console.log("[orbit-worker] listening on",queueName);
  while(true){
    const job=await queue.dequeue(queueName,10);
    if(!job)continue;
    const handler=handlers.get(job.name);
    if(!handler){
      console.warn("[orbit-worker] no handler for",job.name);
      continue;
    }
    try{await handler(job)}
    catch(error){console.error("[orbit-worker] job failed",job.id,error.message)}
  }
}

async function shutdown(signal){
  console.log("[orbit-worker] shutdown",signal);
  await queue.close();
  process.exit(0);
}
process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
run().catch(error=>{console.error("[orbit-worker] fatal",error);process.exit(1)});
