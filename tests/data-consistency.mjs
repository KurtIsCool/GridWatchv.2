import fs from 'node:fs';
import vm from 'node:vm';

function parseCsvLine(line){
  const out=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(ch===','&&!quoted){out.push(value);value='';}
    else value+=ch;
  }
  out.push(value);return out;
}

const feeder=JSON.parse(fs.readFileSync('data/feeder-mapping.json','utf8'));
const context={window:{}};vm.runInNewContext(fs.readFileSync('data/feeder-bundle.js','utf8'),context);
if(JSON.stringify(context.window.GRIDWATCH_FEEDER_MAPPING)!==JSON.stringify(feeder))throw new Error('Feeder bundle differs from canonical JSON.');

const lines=fs.readFileSync('data/feeder-mapping-audit.csv','utf8').trim().split(/\r?\n/);
const header=parseCsvLine(lines.shift());
const csv=lines.map(line=>Object.fromEntries(parseCsvLine(line).map((value,index)=>[header[index],value])));
const rows=feeder.feeders.flatMap(item=>(item.coverage||[]).map(row=>({feeder_id:item.feeder_id,feeder_name:item.feeder_name,...row})));
if(csv.length!==rows.length)throw new Error(`Feeder audit CSV row count differs from JSON: ${csv.length}/${rows.length}.`);
const fields=['feeder_id','feeder_name','district','source_label','coverage_type','city_membership','match_status','canonical_name','barangay_psgc','suggested_canonical_name','geometry_precision'];
for(let i=0;i<rows.length;i++)for(const field of fields)if(String(csv[i][field]||'')!==String(rows[i][field]||''))throw new Error(`Feeder audit CSV differs at row ${i+1} field ${field}.`);

const advisories=JSON.parse(fs.readFileSync('data/advisories.json','utf8'));
if(advisories.schema_version!=='1.0.0'||!Array.isArray(advisories.events))throw new Error('Advisory dataset schema is invalid.');
const ids=new Set();
for(const event of advisories.events){
  if(!event.id||ids.has(event.id))throw new Error(`Duplicate/missing advisory id: ${event.id||'(missing)'}`);ids.add(event.id);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!/^\d{2}:\d{2}$/.test(event.start)||!/^\d{2}:\d{2}$/.test(event.end))throw new Error(`Invalid advisory time fields: ${event.id}`);
  if(!['PUBLISHED','ARCHIVED','REVOKED'].includes(event.status))throw new Error(`Invalid advisory status: ${event.id}`);
  if(!event.source?.publisher||!event.source?.url||!event.source?.publishedAt)throw new Error(`Missing advisory provenance: ${event.id}`);
}

console.log(`PASS: feeder JSON/bundle/CSV agree and ${ids.size} versioned advisories have valid provenance.`);
