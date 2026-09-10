import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync('data/geography-manifest.json','utf8'));
const barangays=JSON.parse(fs.readFileSync('data/iloilo-city-barangays.geojson','utf8'));
const boundary=JSON.parse(fs.readFileSync('data/iloilo-city-boundary.geojson','utf8'));
if(manifest.status!=='VALIDATED')throw new Error('Geography manifest is not VALIDATED.');
if(manifest.city_psgc!=='0631000000'||manifest.barangays?.length!==180)throw new Error('Invalid City of Iloilo identity manifest.');
if(barangays.type!=='FeatureCollection'||barangays.features?.length!==180)throw new Error('Barangay GeoJSON must contain exactly 180 features.');
if(boundary.type!=='FeatureCollection'||boundary.features?.length!==1)throw new Error('City boundary GeoJSON must contain exactly one feature.');
const expected=new Set(manifest.barangays.map(b=>String(b.psgc)));
const seen=new Set();
for(const f of barangays.features){
  if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))throw new Error('Invalid barangay geometry type.');
  const p=String(f.properties?.psgc||f.properties?.psgc_code||f.properties?.adm4_psgc||f.properties?.barangay_psgc||'');
  if(!expected.has(p)||seen.has(p))throw new Error(`Invalid or duplicate barangay PSGC ${p}`); seen.add(p);
}
if(!['Polygon','MultiPolygon'].includes(boundary.features[0]?.geometry?.type))throw new Error('Invalid city boundary geometry type.');
console.log('PASS: geography is VALIDATED and contains exactly 180 PSA-matched barangays plus one city boundary.');
