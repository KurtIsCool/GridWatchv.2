import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSourceItem} from '../cloudflare/src/ingestion/source-item.js';
import {parseCandidateJson} from '../cloudflare/src/ingestion/candidate-schema.js';
import {normalizeCandidate} from '../cloudflare/src/ingestion/normalize.js';
import {validateCandidate} from '../cloudflare/src/ingestion/validator.js';
import {sha256Hex} from '../cloudflare/src/utils/hash.js';

function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;}
const imageArg=process.argv[2];
if(!imageArg||imageArg.startsWith('--')){
  console.error('Usage: npm run ingest:image -- path/to/image --extraction path/to/mock-or-reviewed-extraction.json [--source-url URL] [--published-at ISO]');process.exit(1);
}
const imagePath=path.resolve(imageArg);
if(!fs.existsSync(imagePath)||!fs.statSync(imagePath).isFile()){console.error(`Image file not found: ${imagePath}`);process.exit(1);}
const bytes=fs.readFileSync(imagePath),hash=await sha256Hex(bytes),now=new Date();
const archiveRoot=path.resolve(option('--archive-dir')||'.gridwatch-local/raw');
const source=await createSourceItem({publisher:option('--publisher')||'MORE Power',sourceType:'MANUAL_IMAGE',sourceUrl:option('--source-url')||pathToFileURL(imagePath).href,content:bytes,contentHash:hash,publishedAt:option('--published-at'),retrievedAt:now},now);
const targetDir=path.join(archiveRoot,now.toISOString().slice(0,10),source.id);fs.mkdirSync(targetDir,{recursive:true});
fs.copyFileSync(imagePath,path.join(targetDir,`original${path.extname(imagePath)||'.bin'}`));
fs.writeFileSync(path.join(targetDir,'metadata.json'),JSON.stringify({source,archived_at:now.toISOString()},null,2)+'\n');
const extractionPath=option('--extraction');
if(!extractionPath){
  const waiting={status:'WAITING_FOR_AI_CONNECTION',source_item_id:source.id,content_hash:hash,archive:targetDir,message:'Image archived locally. Supply --extraction with reviewed/mock JSON, or use the configured Worker AI pipeline later. Nothing was published.'};
  fs.writeFileSync(path.join(targetDir,'review.json'),JSON.stringify(waiting,null,2)+'\n');console.log(JSON.stringify(waiting,null,2));process.exit(0);
}
const extraction=parseCandidateJson(fs.readFileSync(path.resolve(extractionPath),'utf8'));
const validation=validateCandidate(normalizeCandidate(extraction,source));
const result={status:validation.validation_status,source_item_id:source.id,content_hash:hash,archive:targetDir,source_text:extraction.raw_text,resolved_barangays:validation.normalized.areas.filter(item=>item.match_status!=='UNRESOLVED'),resolved_feeders:validation.normalized.feeders.filter(item=>item.match_status!=='UNRESOLVED'),unresolved_labels:[...validation.normalized.areas,...validation.normalized.feeders].filter(item=>item.match_status==='UNRESOLVED').map(item=>item.source_label),validation_errors:validation.validation_errors,review_reasons:validation.review_reasons,published:false};
fs.writeFileSync(path.join(targetDir,'review.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
