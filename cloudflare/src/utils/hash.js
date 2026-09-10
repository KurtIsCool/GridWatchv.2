export function stableJson(value){
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function bytes(value){
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  return new TextEncoder().encode(typeof value==='string'?value:stableJson(value));
}

export async function sha256Hex(value){
  const digest=await crypto.subtle.digest('SHA-256',bytes(value));
  return [...new Uint8Array(digest)].map(part=>part.toString(16).padStart(2,'0')).join('');
}

export function slug(value='source'){
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'source';
}
