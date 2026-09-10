import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const must=[
  'index.html','ops.html','manifest.webmanifest','sw.js','.nojekyll',
  'data/feeder-mapping.json','data/feeder-bundle.js','data/geography-bundle.js',
  'data/geography-manifest.json','data/iloilo-city-barangays.geojson','data/iloilo-city-boundary.geojson',
  'assets/brand/gridwatch-icon-192.png','assets/brand/gridwatch-icon-512.png'
];
for(const f of must){if(!fs.existsSync(path.join(root,f)))throw new Error(`Missing deploy file: ${f}`)}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/geography-manifest.json'),'utf8'));
if(manifest.status!=='VALIDATED')throw new Error('Production deployment is blocked until geography is VALIDATED.');
if(manifest.city_psgc!=='0631000000'||manifest.barangays?.length!==180)throw new Error('PSA identity manifest must contain exactly 180 Iloilo City barangays.');
const codes=new Set(manifest.barangays.map(b=>String(b.psgc)));
if(codes.size!==180)throw new Error('PSA identity manifest has duplicate PSGC codes.');
const feeder=JSON.parse(fs.readFileSync(path.join(root,'data/feeder-mapping.json'),'utf8'));
if(feeder.city_psgc!=='0631000000'||!Array.isArray(feeder.feeders)||!feeder.feeders.length)throw new Error('Feeder dataset is unavailable or for the wrong city.');
const ids=new Set();
for(const f of feeder.feeders){
  if(!f.feeder_id||ids.has(f.feeder_id))throw new Error(`Duplicate/missing feeder id: ${f.feeder_id}`); ids.add(f.feeder_id);
  for(const r of f.coverage||[]){
    if(!['WHOLE','PORTION'].includes(r.coverage_type))throw new Error(`Invalid feeder coverage type: ${r.coverage_type}`);
    if(r.city_membership==='ILOILO_CITY'&&!codes.has(String(r.barangay_psgc)))throw new Error(`Unknown Iloilo barangay PSGC in feeder data: ${r.barangay_psgc}`);
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const rel of ['./manifest.webmanifest','./ops.html','./data/geography-bundle.js','./data/feeder-bundle.js']){
  if(!html.includes(rel))throw new Error(`index.html is missing required reference ${rel}`);
}
if(!html.includes("navigator.serviceWorker.register('./sw.js')"))throw new Error('PWA service worker registration is not enabled.');
console.log(`PASS: deploy shell valid · ${manifest.barangays.length} PSA barangays · ${feeder.feeders.length} feeder cards.`);
