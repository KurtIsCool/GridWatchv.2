import {sha256Hex,stableJson} from '../utils/hash.js';

export async function publishCandidate(store,candidateRecord,validation,{reviewStatus='NOT_REQUIRED'}={}){
  if(validation.validation_status!=='VALIDATED')throw new Error('Publication gate rejected a candidate that is not VALIDATED.');
  if(!['NOT_REQUIRED','APPROVED'].includes(reviewStatus))throw new Error('Publication gate requires completed review when review is applicable.');
  const normalized=validation.normalized;
  const id=`evt_${(await sha256Hex(stableJson({source:normalized.source.source_item_id,revision:candidateRecord.revision,event:validation.event,areas:normalized.areas,feeders:normalized.feeders}))).slice(0,24)}`;
  const event={
    id,source_item_id:normalized.source.source_item_id,candidate_event_id:candidateRecord.id,revision:candidateRecord.revision,
    event_type:validation.event.event_type,status:'PUBLISHED',cause:normalized.document_type,
    start_at:validation.event.start_at,end_at:validation.event.end_at,published_at:normalized.source.published_at,
    retrieved_at:normalized.source.retrieved_at,reviewed_at:reviewStatus==='APPROVED'?new Date().toISOString():null,supersedes:null,
    targets:normalized.areas.filter(item=>item.match_status!=='UNRESOLVED').map(item=>({source_label:item.source_label,barangay_psgc:item.psgc||item.barangay_psgc,canonical_name:item.name||item.canonical_name,coverage:item.coverage,match_status:item.match_status})),
    feeders:normalized.feeders.filter(item=>item.match_status!=='UNRESOLVED')
  };
  return store.publishEvent(event);
}
