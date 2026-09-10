import fs from 'node:fs';

const data=JSON.parse(fs.readFileSync('data/feeder-mapping.json','utf8'));
const psa=JSON.parse(fs.readFileSync('data/psa-iloilo-city-barangays.json','utf8'));
const official=new Set(psa.barangays.map(x=>String(x.psgc)));
const ids=new Set(), relationKeys=new Set();
for(const feeder of data.feeders||[]){
  if(!/^MORE-ILO-[A-Z0-9-]+-F\d{2}$/.test(feeder.feeder_id||''))throw new Error(`Invalid stable feeder ID: ${feeder.feeder_id||'(missing)'}`);
  if(ids.has(feeder.feeder_id))throw new Error(`Duplicate feeder ID: ${feeder.feeder_id}`);ids.add(feeder.feeder_id);
  for(const row of feeder.coverage||[]){
    if(!['WHOLE','PORTION','AREA','FACILITY'].includes(row.coverage_type))throw new Error(`Unsupported coverage type in ${feeder.feeder_id}`);
    if(!row.district||!row.source||!row.source_date||!row.confidence)throw new Error(`Missing relationship provenance in ${feeder.feeder_id}`);
    if(row.city_membership==='ILOILO_CITY'){
      if(!official.has(String(row.barangay_psgc)))throw new Error(`Non-PSA city barangay reference ${row.barangay_psgc||'(missing)'}`);
      const key=`${feeder.feeder_id}:${row.barangay_psgc}:${row.coverage_type}`;if(relationKeys.has(key))throw new Error(`Duplicate feeder relationship ${key}`);relationKeys.add(key);
    }
  }
}
for(const review of data.review_required||[]){if(review.barangay_psgc||review.match_status==='EXACT_PSA')throw new Error('Unresolved aliases must fail closed.');}
console.log(`PASS: ${ids.size} feeder cards, ${relationKeys.size} city relationships, aliases fail closed.`);
