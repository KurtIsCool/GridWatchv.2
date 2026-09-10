import {COVERAGE_TYPES} from '../constants.js';

export const DOCUMENT_TYPES=Object.freeze(['SCHEDULED_INTERRUPTION','UNSCHEDULED_INTERRUPTION','RESTORATION','GRID_NOTICE','OTHER']);

export const ADVISORY_JSON_SCHEMA=Object.freeze({
  type:'object',
  additionalProperties:false,
  properties:{
    source_type:{type:'string',enum:['MORE_POWER_IMAGE']},
    document_type:{type:'string',enum:DOCUMENT_TYPES},
    date:{type:['string','null']},
    start_time:{type:['string','null']},
    end_time:{type:['string','null']},
    feeders:{type:'array',items:{type:'object',additionalProperties:false,properties:{source_label:{type:'string'}},required:['source_label']}},
    areas:{type:'array',items:{type:'object',additionalProperties:false,properties:{source_label:{type:'string'},district:{type:['string','null']},coverage:{type:'string',enum:COVERAGE_TYPES}},required:['source_label','district','coverage']}},
    institutions:{type:'array',items:{type:'string'}},
    raw_text:{type:'string'},
    extraction_confidence:{type:'number',minimum:0,maximum:1}
  },
  required:['source_type','document_type','date','start_time','end_time','feeders','areas','institutions','raw_text','extraction_confidence']
});

function assertExactKeys(value,allowed,label){
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(`${label} contains forbidden or unknown field ${key}.`);
}

export function assertCandidateExtraction(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Candidate extraction must be an object.');
  const keys=['source_type','document_type','date','start_time','end_time','feeders','areas','institutions','raw_text','extraction_confidence'];
  assertExactKeys(value,keys,'Candidate extraction');
  for(const key of keys)if(!(key in value))throw new Error(`Candidate extraction is missing ${key}.`);
  if(value.source_type!=='MORE_POWER_IMAGE'&&!['NGCP_TEXT','MORE_POWER_TEXT','MANUAL_IMAGE'].includes(value.source_type))throw new Error('Candidate source_type is unsupported.');
  if(!DOCUMENT_TYPES.includes(value.document_type))throw new Error('Candidate document_type is unsupported.');
  for(const key of ['date','start_time','end_time'])if(value[key]!==null&&typeof value[key]!=='string')throw new Error(`${key} must be a string or null.`);
  if(!Array.isArray(value.feeders)||!Array.isArray(value.areas)||!Array.isArray(value.institutions))throw new Error('Candidate lists are malformed.');
  for(const feeder of value.feeders){
    if(!feeder||typeof feeder!=='object'||Array.isArray(feeder))throw new Error('Feeder entry must be an object.');
    assertExactKeys(feeder,['source_label'],'Feeder entry');
    if(typeof feeder.source_label!=='string'||!feeder.source_label.trim())throw new Error('Feeder source_label is required.');
  }
  for(const area of value.areas){
    if(!area||typeof area!=='object'||Array.isArray(area))throw new Error('Area entry must be an object.');
    assertExactKeys(area,['source_label','district','coverage'],'Area entry');
    if(typeof area.source_label!=='string'||!area.source_label.trim())throw new Error('Area source_label is required.');
    if(area.district!==null&&typeof area.district!=='string')throw new Error('Area district must be a string or null.');
    if(!COVERAGE_TYPES.includes(area.coverage))throw new Error('Area coverage is unsupported.');
  }
  if(value.institutions.some(item=>typeof item!=='string'))throw new Error('Institutions must contain strings only.');
  if(typeof value.raw_text!=='string')throw new Error('raw_text must be a string.');
  if(typeof value.extraction_confidence!=='number'||value.extraction_confidence<0||value.extraction_confidence>1)throw new Error('extraction_confidence must be between 0 and 1.');
  return value;
}

export function parseCandidateJson(value){
  const parsed=typeof value==='string'?JSON.parse(value):value;
  return assertCandidateExtraction(parsed);
}
