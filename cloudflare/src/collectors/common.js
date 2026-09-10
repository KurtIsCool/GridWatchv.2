import {canEnqueue,recordBudgetLimit,recordUsage} from '../budget/usage.js';
import {createSourceItem} from '../ingestion/source-item.js';

export async function recordAndEnqueue(input,{env,store,archive,queue,now=new Date()}){
  const source=await createSourceItem(input,now), existing=await store.findSourceMatch(source);
  if(existing?.content_hash===source.content_hash)return {status:'UNCHANGED',source_item_id:existing.id,revision:existing.current_revision||1};
  const archived=await archive.put(source,input.content,{filename:input.filename||'original.bin',contentType:input.contentType||'application/octet-stream'});
  source.raw_object_key=archived.stored?archived.key:null;
  const saved=await store.upsertSource(source);
  const budget=await canEnqueue(store,env,now);
  if(!budget.ok){
    await store.markSourceStatus(saved.item.id,'WAITING_FOR_QUEUE_BUDGET');
    await recordBudgetLimit(store,'QUEUE',budget,now);
    return {status:'BUDGET_LIMIT_REACHED',source_item_id:saved.item.id,revision:saved.revision};
  }
  if(!queue?.send){await store.markSourceStatus(saved.item.id,'QUEUE_NOT_CONNECTED');return {status:'NOT_CONNECTED',source_item_id:saved.item.id,revision:saved.revision};}
  await queue.send({sourceId:saved.item.id,revision:saved.revision});
  await recordUsage(store,{queue_operations:3},now);
  await store.markSourceStatus(saved.item.id,'QUEUED');
  return {status:'QUEUED',source_item_id:saved.item.id,revision:saved.revision,archived:archived.stored};
}
