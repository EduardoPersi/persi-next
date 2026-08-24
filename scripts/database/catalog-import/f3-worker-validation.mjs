import crypto from "node:crypto";
import postgres from "postgres";
import { claimSignals, enqueueSignal, finishSignal } from "./incremental-core.mjs";
if(!process.argv.includes("--local"))throw new Error("Exige --local.");
const sql=postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres",{max:4,prepare:false}),prefix=`f3-${crypto.randomUUID()}`;
try{
  for(let i=0;i<40;i+=1)await enqueueSignal(sql,{eventType:"product.updated",externalEventId:`${prefix}-${i}`,entityType:"product",externalEntityId:String(900000+i)});
  const claimed=[];async function worker(id){for(;;){const rows=await claimSignals(sql,id,3);if(!rows.length)return;for(const row of rows){claimed.push(row.id);await finishSignal(sql,row,{ok:true,result:"noop",durationMs:1});}}}await Promise.all([worker("f3-worker-a"),worker("f3-worker-b")]);
  await enqueueSignal(sql,{eventType:"product.updated",externalEventId:`${prefix}-crash`,entityType:"product",externalEntityId:"999999"});const [crashed]=await claimSignals(sql,"f3-crashed",1);await sql`update integration_inbox set locked_at=now()-interval '6 minutes' where id=${crashed.id}`;const recovered=await claimSignals(sql,"f3-recovery",1);if(recovered[0])await finishSignal(sql,recovered[0],{ok:true,result:"noop",durationMs:1});
  const [result]=await sql`select count(*) filter(where status='processed')::int processed,count(*) filter(where status='dead_letter')::int dead,count(*) filter(where status in('pending','retry','processing'))::int pending,count(*) filter(where external_event_id=${`${prefix}-crash`} and attempts=2 and status='processed')::int recovered from integration_inbox where external_event_id like ${`${prefix}%`}`;
  const duplicates=claimed.length-new Set(claimed).size;console.log(JSON.stringify({...result,claimed:claimed.length,duplicates,multiWorker:duplicates===0&&result.processed===41,crashRecovery:result.recovered===1},null,2));if(duplicates||result.processed!==41||result.recovered!==1||result.dead||result.pending)process.exitCode=1;
}finally{await sql`delete from integration_inbox where external_event_id like ${`${prefix}%`}`;await sql.end({timeout:5});}
