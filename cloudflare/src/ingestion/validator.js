import {CITY_PSGC,PUBLISHABLE_EVENT_TYPES} from '../constants.js';
import {barangayByPsgc,feederById} from '../data/indexes.js';
import {eventWindow,validDate,validTime} from '../utils/time.js';

const EVENT_TYPE_BY_DOCUMENT=Object.freeze({
  SCHEDULED_INTERRUPTION:'SCHEDULED',
  UNSCHEDULED_INTERRUPTION:'CONFIRMED',
  RESTORATION:'RESTORED',
  GRID_NOTICE:'GRID_RISK',
  OTHER:'UNKNOWN'
});

function provenanceErrors(source){
  const errors=[];
  if(!source?.source_item_id)errors.push('SOURCE_ITEM_ID_MISSING');
  if(!source?.publisher)errors.push('PUBLISHER_MISSING');
  if(!source?.source_url)errors.push('SOURCE_REFERENCE_MISSING');
  if(!source?.retrieved_at||!Number.isFinite(Date.parse(source.retrieved_at)))errors.push('RETRIEVED_AT_INVALID');
  if(!/^[a-f0-9]{64}$/i.test(source?.content_hash||''))errors.push('SOURCE_HASH_INVALID');
  return errors;
}

export function validateCandidate(candidate){
  const errors=provenanceErrors(candidate?.source), review=[];
  if(candidate?.city_psgc!==CITY_PSGC)errors.push('CITY_PSGC_INVALID');
  const eventType=EVENT_TYPE_BY_DOCUMENT[candidate?.document_type]||'UNKNOWN';
  if(!PUBLISHABLE_EVENT_TYPES.includes(eventType))errors.push('EVENT_TYPE_INVALID');
  if(!validDate(candidate?.date))review.push('DATE_UNRESOLVED');
  if(candidate?.start_time!==null&&!validTime(candidate.start_time))errors.push('START_TIME_INVALID');
  if(candidate?.end_time!==null&&!validTime(candidate.end_time))errors.push('END_TIME_INVALID');
  if(['SCHEDULED','CONFIRMED','RESTORED'].includes(eventType)&&!validTime(candidate?.start_time))review.push('START_TIME_UNRESOLVED');
  if(eventType==='SCHEDULED'&&!validTime(candidate?.end_time))review.push('END_TIME_UNRESOLVED');

  for(const area of candidate?.areas||[]){
    if(area.match_status==='UNRESOLVED'){review.push(`UNRESOLVED_TARGET:${area.source_label}`);continue;}
    const official=barangayByPsgc.get(area.psgc||area.barangay_psgc);
    if(!official){errors.push(`BARANGAY_PSGC_INVALID:${area.source_label}`);continue;}
    if(official.name!==(area.name||area.canonical_name))errors.push(`BARANGAY_NAME_MISMATCH:${area.source_label}`);
    if(area.coverage==='UNKNOWN')review.push(`COVERAGE_UNRESOLVED:${area.source_label}`);
  }
  for(const feeder of candidate?.feeders||[]){
    if(feeder.match_status==='UNRESOLVED'){review.push(`UNKNOWN_FEEDER:${feeder.source_label}`);continue;}
    if(!feederById.has(feeder.feeder_id))errors.push(`FEEDER_ID_INVALID:${feeder.source_label}`);
  }
  if(!(candidate?.areas?.length||candidate?.feeders?.length||eventType==='GRID_RISK'))review.push('NO_LOCAL_OR_GRID_TARGETS');
  if(eventType==='UNKNOWN')review.push('DOCUMENT_TYPE_OTHER');

  let window={startAt:null,endAt:null,overnight:false};
  if(validDate(candidate?.date)&&validTime(candidate?.start_time))window=eventWindow(candidate.date,candidate.start_time,candidate.end_time);
  if(window.invalidEnd)errors.push('END_TIME_INVALID');
  const validationStatus=errors.length?'REJECTED':review.length?'REVIEW_REQUIRED':'VALIDATED';
  return {
    validation_status:validationStatus,
    validation_errors:errors,
    review_reasons:[...new Set(review)],
    normalized:candidate,
    event:{event_type:eventType,start_at:window.startAt,end_at:window.endAt,overnight:window.overnight}
  };
}
