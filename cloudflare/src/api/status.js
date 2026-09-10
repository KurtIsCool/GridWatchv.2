import {barangayByPsgc,feederRelationshipsForBarangay} from '../data/indexes.js';
import {jsonResponse} from './respond.js';

function relevant(event,now){
  const instant=now.getTime(),start=Date.parse(event.start_at||''),end=Date.parse(event.end_at||'');
  if(event.event_type==='RESTORED')return !Number.isFinite(start)||start<=instant;
  if(Number.isFinite(end)&&end<=instant)return false;
  return !Number.isFinite(start)||start<=instant||event.event_type==='SCHEDULED';
}

function directPayload(identity,event,now){
  return {
    barangay_psgc:identity.psgc,barangay_name:identity.name,status:event.event_type,
    coverage:event.coverage==='PORTION'?'PARTIAL':event.coverage,as_of:now.toISOString(),
    official_event:{id:event.id,start_at:event.start_at,end_at:event.end_at,source:{publisher:event.publisher,published_at:event.published_at,url:event.source_url}},
    evidence_type:'EXPLICIT_BARANGAY',feeders:[]
  };
}

function chooseDirect(events,now){
  const instant=now.getTime(),time=event=>Date.parse(event.start_at||event.published_at||0),priority={RESTORED:4,CONFIRMED:3,COMMUNITY:2,SCHEDULED:1,GRID_RISK:0,UNKNOWN:0};
  const current=events.filter(event=>{const start=time(event),end=Date.parse(event.end_at||'');return (!Number.isFinite(start)||start<=instant)&&(!Number.isFinite(end)||end>instant);})
    .sort((a,b)=>time(b)-time(a)||(priority[b.event_type]||0)-(priority[a.event_type]||0));
  if(current.length)return current[0];
  return events.filter(event=>event.event_type==='SCHEDULED'&&time(event)>instant).sort((a,b)=>time(a)-time(b))[0]||null;
}

export async function getStatusPayload(store,psgc,now=new Date()){
  const identity=barangayByPsgc.get(psgc);if(!identity)return null;
  const direct=chooseDirect((await store.getDirectEventsForBarangay(psgc)).filter(event=>relevant(event,now)),now);
  if(direct)return directPayload(identity,direct,now);
  const relationships=feederRelationshipsForBarangay(psgc), relatedIds=new Set(relationships.map(item=>item.feeder_id));
  const feederEvent=(await store.getPublishedFeederEvents()).find(event=>relatedIds.has(event.feeder_id)&&relevant(event,now));
  if(feederEvent){
    const relationship=relationships.find(item=>item.feeder_id===feederEvent.feeder_id);
    return {barangay_psgc:identity.psgc,barangay_name:identity.name,status:'UNKNOWN',coverage:'UNKNOWN',as_of:now.toISOString(),official_event:null,evidence_type:'FEEDER_ASSOCIATION_ONLY',feeders:[],feeder_context:{affected_feeder:feederEvent.feeder_id,relationship:relationship.coverage,message:'An affected feeder may serve this barangay, but the advisory does not explicitly confirm this barangay.'}};
  }
  return {barangay_psgc:identity.psgc,barangay_name:identity.name,status:'UNKNOWN',coverage:'UNKNOWN',as_of:now.toISOString(),official_event:null,evidence_type:'NO_MATCHING_VALIDATED_EVENT',feeders:[]};
}

export async function handleStatus(request,env,store){
  const psgc=new URL(request.url).searchParams.get('barangay_psgc')||'';
  if(!/^063100\d{4}$/.test(psgc))return jsonResponse(request,env,{error:'INVALID_BARANGAY_PSGC'},{status:400});
  const payload=await getStatusPayload(store,psgc);return payload?jsonResponse(request,env,payload):jsonResponse(request,env,{error:'BARANGAY_NOT_FOUND'},{status:404});
}
