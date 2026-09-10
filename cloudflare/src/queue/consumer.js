import {normalizeCandidate} from '../ingestion/normalize.js';
import {parseSource} from '../ingestion/parser.js';
import {publishCandidate} from '../ingestion/publisher.js';
import {validateCandidate} from '../ingestion/validator.js';
import {sha256Hex,stableJson} from '../utils/hash.js';

async function reviewSource(store,source,revision,reason,now){
  const candidateId=`cand_${(await sha256Hex(`${source.id}:${revision}:${reason}`)).slice(0,24)}`;
  const record={id:candidateId,source_item_id:source.id,revision,parser_version:'1.0.0',ai_model:null,extraction:null,confidence:0,validation_status:'REVIEW_REQUIRED',validation_errors:[],review_reasons:[reason],created_at:now.toISOString()};
  await store.recordCandidate(record);await store.enqueueReview({id:`review_${candidateId}`,source_item_id:source.id,candidate_event_id:candidateId,reason,status:'PENDING',created_at:now.toISOString()});await store.markSourceStatus(source.id,reason==='AI_BUDGET_LIMIT_REACHED'?'WAITING_FOR_AI_BUDGET':'REVIEW_REQUIRED');
  return record;
}

export async function processSourceMessage(body,{env,store,archive,now=new Date()}){
  const source=await store.getSource(body.sourceId);if(!source)throw new Error(`Source item ${body.sourceId} does not exist.`);
  if(['PUBLISHED','REVIEW_REQUIRED'].includes(source.processing_status))return {status:'UNCHANGED'};
  let raw=source.inline_content;
  if(!raw&&source.raw_object_key)raw=await archive.get(source.raw_object_key);
  if(!raw)return reviewSource(store,source,body.revision,'RAW_EVIDENCE_UNAVAILABLE',now);
  let extraction;
  try{extraction=await parseSource(source,raw,{env,store,now});}
  catch(error){if(['AI_BUDGET_LIMIT_REACHED','AI_NOT_CONNECTED'].includes(error.code))return reviewSource(store,source,body.revision,error.code,now);throw error;}
  if(!extraction)return reviewSource(store,source,body.revision,'DETERMINISTIC_PARSER_UNRESOLVED',now);
  const normalized=normalizeCandidate(extraction,source), validation=validateCandidate(normalized);
  const candidateId=`cand_${(await sha256Hex(stableJson({source:source.id,revision:body.revision,extraction}))).slice(0,24)}`;
  const record={id:candidateId,source_item_id:source.id,revision:body.revision,parser_version:'1.0.0',ai_model:source.source_type.includes('IMAGE')?(env.VISION_MODEL||null):null,extraction,confidence:extraction.extraction_confidence,validation_status:validation.validation_status,validation_errors:validation.validation_errors,review_reasons:validation.review_reasons,created_at:now.toISOString()};
  await store.recordCandidate(record);
  if(validation.validation_status==='VALIDATED')return {status:'PUBLISHED',event:await publishCandidate(store,record,validation)};
  await store.enqueueReview({id:`review_${candidateId}`,source_item_id:source.id,candidate_event_id:candidateId,reason:[...validation.validation_errors,...validation.review_reasons].join('; '),status:'PENDING',created_at:now.toISOString()});await store.markSourceStatus(source.id,'REVIEW_REQUIRED');return {status:'REVIEW_REQUIRED',candidate:record};
}

export async function consumeQueue(batch,context){
  for(const message of batch.messages){
    try{await processSourceMessage(message.body,context);message.ack();}
    catch(error){console.error('GridWatch queue processing failed.',{messageId:message.id,error:error.message});message.retry({delaySeconds:60});}
  }
}
