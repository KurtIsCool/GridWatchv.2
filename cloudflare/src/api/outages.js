import {jsonResponse} from './respond.js';

async function expand(store,event){return {...event,targets:await store.getTargetsForEvent(event.id),feeders:await store.getFeedersForEvent(event.id)};}

export async function handleOutages(request,env,store,id=null){
  if(id){const event=await store.getPublishedEvent(id);return event?jsonResponse(request,env,await expand(store,event)):jsonResponse(request,env,{error:'OUTAGE_NOT_FOUND'},{status:404});}
  const events=await store.listPublishedEvents();return jsonResponse(request,env,{events:await Promise.all(events.map(event=>expand(store,event)))});
}
