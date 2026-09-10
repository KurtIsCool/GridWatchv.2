import fs from 'node:fs';
import {area,difference,featureCollection,union} from '@turf/turf';
const manifest=JSON.parse(fs.readFileSync('data/geography-manifest.json','utf8'));
const psa=JSON.parse(fs.readFileSync('data/psa-iloilo-city-barangays.json','utf8'));
const barangays=JSON.parse(fs.readFileSync('data/iloilo-city-barangays.geojson','utf8'));
const boundary=JSON.parse(fs.readFileSync('data/iloilo-city-boundary.geojson','utf8'));
const referenceBoundary=JSON.parse(fs.readFileSync('data/iloilo-city-boundary-reference.geojson','utf8'));
const fail=message=>{throw new Error(`GEOGRAPHY INTEGRITY: ${message}`)};
const eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(a,b,p)=>Math.min(a[0],b[0])<=p[0]&&p[0]<=Math.max(a[0],b[0])&&Math.min(a[1],b[1])<=p[1]&&p[1]<=Math.max(a[1],b[1]);
const intersects=(a,b,c,d)=>{const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);if(ab1===0&&on(a,b,c))return true;if(ab2===0&&on(a,b,d))return true;if(cd1===0&&on(c,d,a))return true;if(cd2===0&&on(c,d,b))return true;return (ab1>0)!==(ab2>0)&&(cd1>0)!==(cd2>0)};
function ringValid(ring,label){if(!Array.isArray(ring)||ring.length<4)fail(`${label} has an undersized ring`);if(!eq(ring[0],ring.at(-1)))fail(`${label} ring is not closed`);let area=0;for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];if(!Array.isArray(a)||a.length<2||!Number.isFinite(a[0])||!Number.isFinite(a[1]))fail(`${label} has a null/non-finite coordinate`);area+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(area)<1e-14)fail(`${label} has zero area`);for(let i=0;i<ring.length-1;i++)for(let j=i+1;j<ring.length-1;j++){if(Math.abs(i-j)<=1||(i===0&&j===ring.length-2))continue;if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))fail(`${label} self-intersects`);}}
function geometryValid(geometry,label){if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))fail(`${label} geometry is missing or not Polygon/MultiPolygon`);const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;if(!polygons.length)fail(`${label} has no polygons`);polygons.forEach((polygon,i)=>{if(!Array.isArray(polygon)||!polygon.length)fail(`${label} polygon ${i} has no rings`);polygon.forEach((ring,j)=>ringValid(ring,`${label} polygon ${i} ring ${j}`));});}
if(manifest.status!=='VALIDATED')fail('manifest is not VALIDATED');
if(manifest.city_psgc!=='0631000000'||manifest.barangays?.length!==180)fail('manifest does not declare 180 Iloilo City barangays');
if(psa.city_psgc!=='0631000000'||psa.barangays?.length!==180)fail('bundled PSA roster is invalid');
const official=new Set(psa.barangays.map(b=>String(b.psgc)));if(official.size!==180)fail('PSA roster has duplicate PSGC codes');
const manifestCodes=new Set(manifest.barangays.map(b=>String(b.psgc)));if(manifestCodes.size!==180||[...official].some(code=>!manifestCodes.has(code)))fail('manifest PSGC membership differs from PSA');
if(barangays.type!=='FeatureCollection'||barangays.features?.length!==180)fail('barangay GeoJSON does not contain exactly 180 features');
const seen=new Set();for(const feature of barangays.features){const code=String(feature.properties?.psgc||'');if(!official.has(code))fail(`non-PSA barangay feature ${code||'(missing)'}`);if(seen.has(code))fail(`duplicate barangay feature ${code}`);seen.add(code);geometryValid(feature.geometry,`barangay ${code}`);}if(seen.size!==180||[...official].some(code=>!seen.has(code)))fail('barangay GeoJSON membership differs from PSA');
if(boundary.type!=='FeatureCollection'||boundary.features?.length!==1)fail('city boundary is unavailable or does not have exactly one feature');
if(String(boundary.features[0].properties?.psgc||boundary.features[0].properties?.city_psgc||'')!=='0631000000')fail('city boundary PSGC mismatch');geometryValid(boundary.features[0].geometry,'Iloilo City boundary');
if(boundary.metadata?.operational_basis!=='CANONICAL_BARANGAY_UNION')fail('operational boundary is not derived from all accepted barangays');
if(referenceBoundary.type!=='FeatureCollection'||referenceBoundary.features?.length!==1)fail('independent city reference boundary is unavailable');
geometryValid(referenceBoundary.features[0].geometry,'independent Iloilo City reference boundary');
const merged=union(featureCollection(barangays.features));if(!merged)fail('accepted barangays cannot be unioned');
const mismatch=difference(featureCollection([merged,boundary.features[0]]));
if(mismatch&&area(mismatch)>1)fail(`operational boundary omits ${area(mismatch).toFixed(2)} square metres of accepted barangay geometry`);
for(const feature of barangays.features){const outside=difference(featureCollection([feature,boundary.features[0]]));if(outside&&area(outside)>1)fail(`operational boundary clips accepted barangay ${feature.properties.psgc}`);}
if(manifest.spatial_consistency?.status!=='ACKNOWLEDGED_SOURCE_DIFFERENCE')fail('independent-boundary discrepancy is not recorded in the manifest');
console.log('PASS: 180 exact PSA members, valid unique polygons, a non-clipping operational union, and an independently retained city reference.');
