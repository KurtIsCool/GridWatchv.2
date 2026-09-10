import {sha256Hex,slug} from '../utils/hash.js';

export async function sourceIdentity({publisher,externalId,sourceUrl}){
  const stable=`${publisher}\n${externalId||sourceUrl}`;
  return `src_${(await sha256Hex(stable)).slice(0,24)}`;
}

export async function createSourceItem(input,now=new Date()){
  if(!input.publisher||!input.sourceType||!input.sourceUrl)throw new Error('Source item requires publisher, source type, and source reference.');
  const contentHash=input.contentHash||await sha256Hex(input.content||'');
  return {
    id:input.id||await sourceIdentity(input),
    publisher:input.publisher,
    source_type:input.sourceType,
    source_url:input.sourceUrl,
    external_id:input.externalId||null,
    content_hash:contentHash,
    published_at:input.publishedAt||null,
    retrieved_at:(input.retrievedAt||now).toISOString?.()||String(input.retrievedAt),
    raw_object_key:input.rawObjectKey||null,
    inline_content:typeof input.content==='string'&&input.content.length<=131072?input.content:null,
    processing_status:'COLLECTED',
    created_at:now.toISOString()
  };
}

export function rawObjectKey(source,filename='original.bin'){
  const date=new Date(source.published_at||source.retrieved_at);
  const safeDate=Number.isFinite(date.getTime())?date:new Date();
  const revisionKey=String(source.content_hash||'unhashed').slice(0,16);
  return `sources/${slug(source.publisher)}/${safeDate.getUTCFullYear()}/${String(safeDate.getUTCMonth()+1).padStart(2,'0')}/${source.id}/${revisionKey}-${slug(filename.replace(/\.[^.]+$/,''))}${filename.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase()||'.bin'}`;
}
