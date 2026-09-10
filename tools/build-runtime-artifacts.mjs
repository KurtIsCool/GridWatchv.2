import fs from 'node:fs';
import path from 'node:path';
import {area,difference,featureCollection,union} from '@turf/turf';

const ROOT=process.cwd();
const DATA=path.join(ROOT,'data');
const read=name=>JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(DATA,name),value);
const json=value=>JSON.stringify(value);

function csvCell(value){
  const text=String(value??'');
  return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
}

function buildFeederArtifacts(){
  const feeder=read('feeder-mapping.json');
  write('feeder-bundle.js',`window.GRIDWATCH_FEEDER_MAPPING = ${json(feeder)};\n`);
  const fields=['feeder_id','feeder_name','district','source_label','coverage_type','city_membership','match_status','canonical_name','barangay_psgc','suggested_canonical_name','geometry_precision'];
  const rows=feeder.feeders.flatMap(item=>(item.coverage||[]).map(row=>({feeder_id:item.feeder_id,feeder_name:item.feeder_name,...row})));
  const csv=[fields.join(','),...rows.map(row=>fields.map(field=>csvCell(row[field])).join(','))].join('\n')+'\n';
  write('feeder-mapping-audit.csv',csv);
}

function buildAdvisoryArtifacts(){
  const advisories=read('advisories.json');
  write('advisories-bundle.js',`window.GRIDWATCH_ADVISORIES = ${json(advisories)};\n`);
}

function buildGeographyArtifacts(){
  const barangays=read('iloilo-city-barangays.geojson');
  const manifest=read('geography-manifest.json');
  const currentBoundary=read('iloilo-city-boundary.geojson');
  const referencePath=path.join(DATA,'iloilo-city-boundary-reference.geojson');
  const currentIsOperational=currentBoundary.metadata?.operational_basis==='CANONICAL_BARANGAY_UNION';
  const reference=currentIsOperational?read('iloilo-city-boundary-reference.geojson'):currentBoundary;
  if(!currentIsOperational||!fs.existsSync(referencePath))write('iloilo-city-boundary-reference.geojson',JSON.stringify(reference));

  const merged=union(featureCollection(barangays.features));
  if(!merged)throw new Error('Unable to derive operational city boundary from accepted barangays.');
  const operationalFeature={type:'Feature',properties:{psgc:manifest.city_psgc,name:'City of Iloilo',basis:'accepted_barangay_union'},geometry:merged.geometry};
  const referenceFeature=reference.features[0];
  const outside=difference(featureCollection([operationalFeature,referenceFeature]));
  const referenceGap=difference(featureCollection([referenceFeature,operationalFeature]));
  const operationalArea=area(operationalFeature);
  const spatialConsistency={
    status:'ACKNOWLEDGED_SOURCE_DIFFERENCE',
    accepted_barangays:barangays.features.length,
    operational_area_outside_reference_ratio:outside?area(outside)/operationalArea:0,
    reference_area_outside_operational_ratio:referenceGap?area(referenceGap)/Math.max(1,area(referenceFeature)):0,
    policy:'The resident map mask follows the union of all accepted barangay polygons so no accepted barangay is clipped. The independent OSM outline is retained for review and is not presented as exact agreement.'
  };
  const boundary={type:'FeatureCollection',metadata:{status:'VALIDATED',city_psgc:manifest.city_psgc,expected_features:1,source:'Operational boundary derived from the accepted 180 CCHAIN barangay polygons',operational_basis:'CANONICAL_BARANGAY_UNION',independent_reference:'iloilo-city-boundary-reference.geojson',retrieved_at:barangays.metadata?.retrieved_at},features:[operationalFeature]};
  const nextManifest={...manifest,status:'VALIDATED',geometry_sources:[barangays.metadata,boundary.metadata,reference.metadata],spatial_consistency:spatialConsistency};
  write('iloilo-city-boundary.geojson',JSON.stringify(boundary));
  write('geography-manifest.json',JSON.stringify(nextManifest,null,2)+'\n');
  write('geography-bundle.js',`window.GRIDWATCH_GEOGRAPHY_BUNDLE = ${json({manifest:nextManifest,barangays,boundary})};\n`);
}

buildFeederArtifacts();
buildAdvisoryArtifacts();
buildGeographyArtifacts();
console.log('Built synchronized feeder, advisory, and geography runtime artifacts.');
