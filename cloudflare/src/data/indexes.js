import {CITY_PSGC,EXPECTED_BARANGAY_COUNT} from '../constants.js';
import {APPROVED_BARANGAY_ALIASES,PSA_REGISTRY} from './generated/psa.generated.js';
import {FEEDER_REGISTRY} from './generated/feeders.generated.js';

export function normalizeLabel(value=''){
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/&/g,' and ').replace(/\b(brgy|barangay)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
    .replace(/^sta\b/,'santa').replace(/^sto\b/,'santo').replace(/\blapaz\b/g,'la paz');
}

if(PSA_REGISTRY.city_psgc!==CITY_PSGC||PSA_REGISTRY.barangays.length!==EXPECTED_BARANGAY_COUNT){
  throw new Error('Generated PSA registry is not the exact Iloilo City registry.');
}

export const barangayByPsgc=new Map(PSA_REGISTRY.barangays.map(item=>[item.psgc,item]));
export const barangayByName=new Map(PSA_REGISTRY.barangays.map(item=>[normalizeLabel(item.name),item]));
export const feederById=new Map(FEEDER_REGISTRY.feeders.map(item=>[item.feeder_id,item]));
export const feederByLabel=new Map(FEEDER_REGISTRY.feeders.map(item=>[normalizeLabel(item.feeder_name),item]));

export function resolveBarangay(sourceLabel){
  const normalized=normalizeLabel(sourceLabel), exact=barangayByName.get(normalized);
  if(exact)return {...exact,source_label:sourceLabel,match_status:'EXACT_PSA'};
  const aliasPsgc=APPROVED_BARANGAY_ALIASES[normalized], alias=aliasPsgc&&barangayByPsgc.get(aliasPsgc);
  return alias?{...alias,source_label:sourceLabel,match_status:'APPROVED_ALIAS'}:{source_label:sourceLabel,barangay_psgc:null,canonical_name:null,match_status:'UNRESOLVED'};
}

export function resolveFeeder(sourceLabel){
  const feeder=feederByLabel.get(normalizeLabel(sourceLabel));
  return feeder?{source_label:sourceLabel,feeder_id:feeder.feeder_id,canonical_name:feeder.feeder_name,match_status:'EXACT'}:{source_label:sourceLabel,feeder_id:null,canonical_name:null,match_status:'UNRESOLVED'};
}

export function feederRelationshipsForBarangay(psgc){
  return FEEDER_REGISTRY.feeders.flatMap(feeder=>(feeder.coverage||[])
    .filter(row=>row.city_membership==='ILOILO_CITY'&&row.barangay_psgc===psgc)
    .map(row=>({feeder_id:feeder.feeder_id,feeder_name:feeder.feeder_name,coverage:row.coverage_type})));
}

export {FEEDER_REGISTRY,PSA_REGISTRY};
