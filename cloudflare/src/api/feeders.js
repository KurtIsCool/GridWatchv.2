import {feederById,FEEDER_REGISTRY} from '../data/indexes.js';
import {jsonResponse} from './respond.js';

export function handleFeeders(request,env,id=null){
  if(id){const feeder=feederById.get(id);return feeder?jsonResponse(request,env,feeder):jsonResponse(request,env,{error:'FEEDER_NOT_FOUND'},{status:404});}
  return jsonResponse(request,env,{city_psgc:FEEDER_REGISTRY.city_psgc,source:FEEDER_REGISTRY.source,feeders:FEEDER_REGISTRY.feeders});
}
