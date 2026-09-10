import {canUseBrowser,recordBudgetLimit,recordUsage} from '../budget/usage.js';
import {recordAndEnqueue} from './common.js';

export function createMoreBrowserRunAdapter(env){
  return {
    name:'CLOUDFLARE_BROWSER_RUN',
    async collect(){
      if(!env.BROWSER||!String(env.MORE_SOURCE_URL||'').trim())return {status:'NOT_CONNECTED',updates:[]};
      return {status:'REVIEW_REQUIRED',updates:[],reason:'Browser binding is ready, but a site-specific accessible source selector has not been approved. Manual image ingestion remains available.'};
    }
  };
}

export async function collectMoreUpdates({env,store,archive,queue,adapter=createMoreBrowserRunAdapter(env),now=new Date()}){
  const run={id:crypto.randomUUID(),source:'MORE_POWER',started_at:now.toISOString()};await store.startRun(run);
  const budget=await canUseBrowser(store,env,1,now);
  if(!budget.ok){await recordBudgetLimit(store,'BROWSER',budget,now);const result={finished_at:new Date().toISOString(),status:'BUDGET_LIMIT_REACHED',items_detected:0,items_processed:0,error_message:null};await store.finishRun(run.id,result);return result;}
  const started=Date.now(), result=await adapter.collect();
  if(result.status==='NOT_CONNECTED'||result.status==='REVIEW_REQUIRED'){const finished={finished_at:new Date().toISOString(),status:result.status,items_detected:0,items_processed:0,error_message:result.reason||null};await store.finishRun(run.id,finished);return finished;}
  const updates=Array.isArray(result.updates)?result.updates:[];let processed=0;
  for(const update of updates){
    const body=update.imageBytes||JSON.stringify({url:update.url,image_url:update.imageUrl,caption:update.caption,published_at:update.publishedAt});
    const collected=await recordAndEnqueue({publisher:'MORE Power',sourceType:update.imageBytes?'MORE_POWER_IMAGE':'MORE_POWER_TEXT',sourceUrl:update.url||update.imageUrl,externalId:update.externalId,content:body,contentType:update.mimeType||(update.imageBytes?'image/jpeg':'application/json'),filename:update.imageBytes?'original.jpg':'metadata.json',publishedAt:update.publishedAt,retrievedAt:now},{env,store,archive,queue,now});
    if(collected.status==='QUEUED')processed++;
  }
  const seconds=Math.max(1,Math.ceil((Date.now()-started)/1000));await recordUsage(store,{browser_runs:1,browser_seconds:seconds},now);
  const finished={finished_at:new Date().toISOString(),status:'COMPLETED',items_detected:updates.length,items_processed:processed,error_message:null};await store.finishRun(run.id,finished);return finished;
}
