import {recordAndEnqueue} from './common.js';

export async function collectNgcpUpdates({env,store,archive,queue,fetchImpl=fetch,now=new Date()}){
  const run={id:crypto.randomUUID(),source:'NGCP',started_at:now.toISOString()};await store.startRun(run);
  const sourceUrl=String(env.NGCP_SOURCE_URL||'').trim();
  if(!sourceUrl){const result={finished_at:new Date().toISOString(),status:'NOT_CONNECTED',items_detected:0,items_processed:0,error_message:'NGCP_SOURCE_URL is not configured.'};await store.finishRun(run.id,result);return result;}
  try{
    const response=await fetchImpl(sourceUrl,{headers:{Accept:'text/html,application/json;q=0.9,text/plain;q=0.8','User-Agent':'GridWatch source collector/1.0'}});
    if(!response.ok)throw new Error(`NGCP source returned HTTP ${response.status}.`);
    const content=await response.text(), contentType=response.headers.get('Content-Type')||'text/html';
    const collected=await recordAndEnqueue({publisher:'NGCP',sourceType:'NGCP_HTTP',sourceUrl,content,contentType,filename:contentType.includes('json')?'response.json':'response.html',publishedAt:null,retrievedAt:now},{env,store,archive,queue,now});
    const result={finished_at:new Date().toISOString(),status:collected.status,items_detected:collected.status==='UNCHANGED'?0:1,items_processed:collected.status==='QUEUED'?1:0,error_message:null};await store.finishRun(run.id,result);return result;
  }catch(error){const result={finished_at:new Date().toISOString(),status:'FAILED',items_detected:0,items_processed:0,error_message:error.message};await store.finishRun(run.id,result);return result;}
}
