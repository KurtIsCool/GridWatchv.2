import {rawObjectKey} from '../ingestion/source-item.js';

export function createRawArchive(bucket){
  return {
    connected:Boolean(bucket?.put&&bucket?.get),
    async put(source,body,{filename='original.bin',contentType='application/octet-stream'}={}){
      const key=rawObjectKey(source,filename);
      if(!bucket?.put)return {stored:false,key,reason:'R2_NOT_BOUND'};
      await bucket.put(key,body,{httpMetadata:{contentType},customMetadata:{sourceItemId:source.id,contentHash:source.content_hash}});
      return {stored:true,key};
    },
    async get(key){
      if(!bucket?.get||!key)return null;
      const object=await bucket.get(key);return object?object.arrayBuffer():null;
    }
  };
}
