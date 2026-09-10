import {CITY_PSGC} from '../constants.js';
import {resolveBarangay,resolveFeeder} from '../data/indexes.js';
import {assertCandidateExtraction} from './candidate-schema.js';

export function normalizeCandidate(extraction,source){
  assertCandidateExtraction(extraction);
  if(!source)throw new Error('Source metadata is required for normalization.');
  return {
    city_psgc:CITY_PSGC,
    source:{
      source_item_id:source.id||source.source_item_id,
      publisher:source.publisher,
      source_url:source.source_url,
      published_at:source.published_at||null,
      retrieved_at:source.retrieved_at,
      content_hash:source.content_hash
    },
    source_type:extraction.source_type,
    document_type:extraction.document_type,
    date:extraction.date,
    start_time:extraction.start_time,
    end_time:extraction.end_time,
    feeders:extraction.feeders.map(item=>resolveFeeder(item.source_label)),
    areas:extraction.areas.map(item=>({...resolveBarangay(item.source_label),district:item.district,coverage:item.coverage})),
    institutions:[...extraction.institutions],
    raw_text:extraction.raw_text,
    extraction_confidence:extraction.extraction_confidence
  };
}
