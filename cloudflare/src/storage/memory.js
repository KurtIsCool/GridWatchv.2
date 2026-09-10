export function createMemoryStore(){
  const state={sources:new Map(),candidates:new Map(),events:new Map(),reviews:[],runs:new Map(),usage:new Map(),operational:[]};
  return {
    state,
    async findSourceMatch(source){return [...state.sources.values()].find(item=>item.publisher===source.publisher&&((source.external_id&&item.external_id===source.external_id)||item.source_url===source.source_url||item.content_hash===source.content_hash))||null;},
    async upsertSource(source){
      const existing=await this.findSourceMatch(source);
      if(existing?.content_hash===source.content_hash)return {item:existing,created:false,changed:false,revision:existing.current_revision||1};
      const revision=existing?existing.current_revision+1:1,item={...source,id:existing?.id||source.id,current_revision:revision};state.sources.set(item.id,item);
      return {item,created:!existing,changed:true,revision};
    },
    async getSource(id){return state.sources.get(id)||null;},
    async markSourceStatus(id,status){const item=state.sources.get(id);if(item)item.processing_status=status;},
    async recordCandidate(candidate){if(!state.candidates.has(candidate.id))state.candidates.set(candidate.id,candidate);return candidate;},
    async enqueueReview(entry){if(!state.reviews.some(item=>item.candidate_event_id===entry.candidate_event_id))state.reviews.push(entry);return entry;},
    async publishEvent(event){if(!state.events.has(event.id))state.events.set(event.id,event);await this.markSourceStatus(event.source_item_id,'PUBLISHED');return state.events.get(event.id);},
    async getUsage(date){return state.usage.get(date)||{date,browser_runs:0,browser_seconds:0,ai_calls:0,ai_units:0,queue_operations:0};},
    async incrementUsage(date,delta){const current=await this.getUsage(date),next={...current};for(const [key,value] of Object.entries(delta))next[key]=Number(next[key]||0)+Number(value||0);state.usage.set(date,next);return next;},
    async recordOperationalEvent(event){state.operational.push(event);},
    async startRun(run){state.runs.set(run.id,{...run,status:'RUNNING'});},
    async finishRun(id,result){state.runs.set(id,{...state.runs.get(id),...result});},
    async listPublishedEvents(){return [...state.events.values()].filter(item=>item.status==='PUBLISHED');},
    async getPublishedEvent(id){const item=state.events.get(id);return item?.status==='PUBLISHED'?item:null;},
    async getTargetsForEvent(id){return state.events.get(id)?.targets||[];},
    async getFeedersForEvent(id){return state.events.get(id)?.feeders||[];},
    async getDirectEventsForBarangay(psgc){return [...state.events.values()].filter(item=>item.status==='PUBLISHED'&&item.targets.some(target=>target.barangay_psgc===psgc)).map(item=>({...item,...item.targets.find(target=>target.barangay_psgc===psgc),publisher:item.publisher||'MORE Power',source_url:item.source_url||'manual://fixture'}));},
    async getPublishedFeederEvents(){return [...state.events.values()].filter(item=>item.status==='PUBLISHED').flatMap(event=>event.feeders.map(feeder=>({...event,...feeder,publisher:event.publisher||'MORE Power',source_url:event.source_url||'manual://fixture'})));},
    async getHealth(){return {runs:[...state.runs.values()],pending_review:state.reviews.length,validation_failures:[...state.candidates.values()].filter(item=>item.validation_status==='REJECTED').length,latest_event:[...state.events.values()].at(-1)||null,latest_source:[...state.sources.values()].at(-1)||null,latest_budget_limit:state.operational.filter(item=>item.type==='BUDGET_LIMIT_REACHED').at(-1)||null};}
  };
}
