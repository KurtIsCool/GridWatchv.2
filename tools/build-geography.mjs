import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd();
const DATA=path.join(ROOT,'data');
const SOURCE=process.env.CCHAIN_GEOGRAPHY_CSV||path.join(ROOT,'..','..','.sources','cchain-brgy-geography.csv');
const OSM=process.env.OSM_CITY_BOUNDARY_JSON||path.join(ROOT,'..','..','.sources','osm-iloilo-city-relation.json');
const IDENTITY=JSON.parse(fs.readFileSync(path.join(DATA,'psa-iloilo-city-barangays.json'),'utf8'));
const NOW=new Date().toISOString();

function parseCsvLine(line){
  const cells=[];let cell='',quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){cells.push(cell);cell='';}else cell+=ch;}cells.push(cell);return cells;
}
function parseWkt(wkt){
  const type=(wkt.match(/^\s*(POLYGON|MULTIPOLYGON)\s*/i)||[])[1]?.toUpperCase();
  if(!type)throw new Error('Unsupported WKT geometry.');
  const tokens=wkt.slice(type.length).match(/[(),]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)||[];let i=0;
  function group(){if(tokens[i++]!=='(')throw new Error('Malformed WKT group.');const out=[];while(i<tokens.length&&tokens[i]!==')'){if(tokens[i]==='(')out.push(group());else{const x=Number(tokens[i++]),y=Number(tokens[i++]);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid WKT coordinate.');out.push([x,y]);}if(tokens[i]===',')i++;}if(tokens[i++]!==')')throw new Error('Unclosed WKT group.');return out;}
  const coordinates=group();if(i!==tokens.length)throw new Error('Unexpected WKT tail.');return {type:type==='POLYGON'?'Polygon':'MultiPolygon',coordinates};
}
function ringValid(ring){
  if(!Array.isArray(ring)||ring.length<4)return false;const [a,b]=[ring[0],ring.at(-1)];if(a[0]!==b[0]||a[1]!==b[1])return false;
  let area=0;for(let i=0;i<ring.length-1;i++){const p=ring[i],q=ring[i+1];if(!Number.isFinite(p[0])||!Number.isFinite(p[1]))return false;area+=p[0]*q[1]-q[0]*p[1];}return Math.abs(area)>1e-14;
}
function geometryValid(g){if(!g||!['Polygon','MultiPolygon'].includes(g.type))return false;const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;return polys.length>0&&polys.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(ringValid));}
function psgcFromCchain(pcode){const tail=String(pcode||'').replace(/\D/g,'').slice(-3);return tail?`0631000${tail}`:'';}
function key(point){return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;}
function assembleRings(members,role){
  const segments=members.filter(m=>m.type==='way'&&m.role===role&&Array.isArray(m.geometry)).map(m=>m.geometry.map(p=>[p.lon,p.lat]));const rings=[];
  while(segments.length){let ring=segments.pop();let changed=true;while(changed&&key(ring[0])!==key(ring.at(-1))){changed=false;for(let i=0;i<segments.length;i++){const s=segments[i],start=key(ring[0]),end=key(ring.at(-1)),a=key(s[0]),b=key(s.at(-1));if(a===end){ring=ring.concat(s.slice(1));segments.splice(i,1);changed=true;break;}if(b===end){ring=ring.concat(s.slice(0,-1).reverse());segments.splice(i,1);changed=true;break;}if(b===start){ring=s.slice(0,-1).concat(ring);segments.splice(i,1);changed=true;break;}if(a===start){ring=s.slice(1).reverse().concat(ring);segments.splice(i,1);changed=true;break;}}}if(key(ring[0])!==key(ring.at(-1)))throw new Error(`OSM ${role} boundary could not be assembled into a closed ring.`);rings.push(ring);}return rings;
}
function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>point[1])!==(b[1]>point[1]))&&(point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]))inside=!inside;}return inside;}
function cityGeometry(){const doc=JSON.parse(fs.readFileSync(OSM,'utf8'));const rel=doc.elements?.find(e=>e.type==='relation'&&String(e.id)==='3499101');if(!rel)throw new Error('Expected OSM relation 3499101 is missing.');const outers=assembleRings(rel.members,'outer'),inners=assembleRings(rel.members,'inner');const polygons=outers.map(outer=>[outer]);for(const inner of inners){const parent=polygons.find(poly=>pointInRing(inner[0],poly[0]));if(!parent)throw new Error('OSM inner ring is outside every OSM outer ring.');parent.push(inner);}return polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons};}
const rows=fs.readFileSync(SOURCE,'utf8').trim().split(/\r?\n/);const header=parseCsvLine(rows.shift());const ix=Object.fromEntries(header.map((x,i)=>[x,i]));const expected=new Map(IDENTITY.barangays.map(b=>[b.psgc,b]));const seen=new Set();const features=[];
for(const line of rows){const row=parseCsvLine(line),psgc=psgcFromCchain(row[ix.adm4_pcode]);if(!expected.has(psgc))continue;if(seen.has(psgc))throw new Error(`Duplicate CCHAIN geometry for ${psgc}.`);const geometry=parseWkt(row[ix.geometry]);if(!geometryValid(geometry))throw new Error(`Invalid CCHAIN geometry for ${psgc}.`);const official=expected.get(psgc);features.push({type:'Feature',properties:{psgc,name:official.name,source_pcode:row[ix.adm4_pcode],source_area_km2:Number(row[ix.brgy_total_area])},geometry});seen.add(psgc);}
if(features.length!==180||seen.size!==expected.size)throw new Error(`CCHAIN/PSA membership mismatch: ${features.length}/180 matched.`);features.sort((a,b)=>a.properties.psgc.localeCompare(b.properties.psgc));
const boundaryGeometry=cityGeometry();if(!geometryValid(boundaryGeometry))throw new Error('OSM city boundary geometry is invalid.');
const barangayDoc={type:'FeatureCollection',metadata:{status:'VALIDATED',city_psgc:IDENTITY.city_psgc,expected_features:180,source:'Project CCHAIN Iloilo barangay geography (derived from HDX/OCHA COD-AB-PHL)',source_url:'https://data.humdata.org/dataset/project-cchain',retrieved_at:NOW},features};
const boundaryDoc={type:'FeatureCollection',metadata:{status:'VALIDATED',city_psgc:IDENTITY.city_psgc,expected_features:1,source:'OpenStreetMap administrative boundary relation 3499101 (independent source)',source_url:'https://www.openstreetmap.org/relation/3499101',license:'ODbL-1.0',retrieved_at:NOW},features:[{type:'Feature',properties:{psgc:IDENTITY.city_psgc,name:'City of Iloilo',osm_relation:3499101},geometry:boundaryGeometry}]};
const manifest={schema_version:2,status:'VALIDATED',app_target:'GridWatch v2.8',city_psgc:IDENTITY.city_psgc,city_name:IDENTITY.city_name,expected_barangay_count:180,validation_date:NOW,identity_source:IDENTITY.source,geometry_sources:[barangayDoc.metadata,boundaryDoc.metadata],barangays:IDENTITY.barangays};
fs.writeFileSync(path.join(DATA,'iloilo-city-barangays.geojson'),JSON.stringify(barangayDoc));fs.writeFileSync(path.join(DATA,'iloilo-city-boundary.geojson'),JSON.stringify(boundaryDoc));fs.writeFileSync(path.join(DATA,'geography-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await import('./build-runtime-artifacts.mjs');
console.log(`Built ${features.length} validated barangay polygons, retained the independent city reference, and generated synchronized runtime artifacts.`);
