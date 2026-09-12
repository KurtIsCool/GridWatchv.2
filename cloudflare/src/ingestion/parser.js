import {parseCandidateJson} from './candidate-schema.js';
import {extractAdvisoryFromImage} from './image-extractor.js';

function dateFromText(text){
  const iso=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  return iso||null;
}

export function parseNgcpText(text){
  const raw=String(text||''), lowered=raw.toLowerCase();
  const isGridNotice=/\b(yellow|red) alert\b|grid alert|grid condition/.test(lowered);
  if(!isGridNotice)return null;

  return parseCandidateJson({
    source_type:'NGCP_TEXT',
    document_type:'GRID_NOTICE',
    date:dateFromText(raw),
    start_time:null,
    end_time:null,
    feeders:[],
    areas:[],
    institutions:[],
    raw_text:raw,
    extraction_confidence:1
  });
}

export async function parseSource(source,raw,{env,store,now=new Date()}={}){
  if([
    'MORE_POWER_IMAGE',
    'MANUAL_IMAGE',
    'MORE_POWER_FACEBOOK_IMAGE'
  ].includes(source.source_type)){
    return extractAdvisoryFromImage(
      raw,
      {
        env,
        store,
        now,
        mimeType:source.content_type
      }
    );
  }

  if(source.source_type==='NGCP_HTTP'){
    return parseNgcpText(raw);
  }

  if(
    source.source_type==='MORE_POWER_TEXT' &&
    source.extraction_json
  ){
    return parseCandidateJson(
      source.extraction_json
    );
  }

  return null;
}
