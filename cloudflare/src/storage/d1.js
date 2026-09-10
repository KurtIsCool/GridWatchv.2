function json(value){return value==null?null:JSON.stringify(value);}
function parse(value,fallback=null){try{return value==null?fallback:JSON.parse(value);}catch{return fallback;}}
function rowResult(result){return result?.results||[];}

export function createD1Store(db){
  if(!db?.prepare)throw new Error('D1 binding DB is not available.');
  return {
    async findSourceMatch(source){
      const statement=db.prepare(`SELECT * FROM source_items WHERE publisher=?1 AND ((?2 IS NOT NULL AND external_id=?2) OR source_url=?3 OR content_hash=?4) ORDER BY created_at LIMIT 1`);
      return statement.bind(source.publisher,source.external_id,source.source_url,source.content_hash).first();
    },
    async upsertSource(source){
      const existing=await this.findSourceMatch(source);
      if(existing&&existing.content_hash===source.content_hash)return {item:existing,created:false,changed:false,revision:existing.current_revision||1};
      if(existing){
        const revision=Number(existing.current_revision||1)+1;
        await db.batch([
          db.prepare(`UPDATE source_items SET content_hash=?1,published_at=?2,retrieved_at=?3,raw_object_key=?4,inline_content=?5,processing_status='COLLECTED',current_revision=?6 WHERE id=?7`).bind(source.content_hash,source.published_at,source.retrieved_at,source.raw_object_key,source.inline_content,revision,existing.id),
          db.prepare(`INSERT INTO source_revisions(id,source_item_id,revision_number,content_hash,retrieved_at,raw_object_key) VALUES(?1,?2,?3,?4,?5,?6)`).bind(`${existing.id}:r${revision}`,existing.id,revision,source.content_hash,source.retrieved_at,source.raw_object_key)
        ]);
        return {item:{...source,id:existing.id,current_revision:revision},created:false,changed:true,revision};
      }
      await db.batch([
        db.prepare(`INSERT INTO source_items(id,publisher,source_type,source_url,external_id,content_hash,published_at,retrieved_at,raw_object_key,inline_content,processing_status,current_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12)`).bind(source.id,source.publisher,source.source_type,source.source_url,source.external_id,source.content_hash,source.published_at,source.retrieved_at,source.raw_object_key,source.inline_content,source.processing_status,source.created_at),
        db.prepare(`INSERT INTO source_revisions(id,source_item_id,revision_number,content_hash,retrieved_at,raw_object_key) VALUES(?1,?2,1,?3,?4,?5)`).bind(`${source.id}:r1`,source.id,source.content_hash,source.retrieved_at,source.raw_object_key)
      ]);
      return {item:{...source,current_revision:1},created:true,changed:true,revision:1};
    },
    getSource(id){return db.prepare('SELECT * FROM source_items WHERE id=?1').bind(id).first();},
    markSourceStatus(id,status){return db.prepare('UPDATE source_items SET processing_status=?1 WHERE id=?2').bind(status,id).run();},
    async recordCandidate(candidate){
      await db.prepare(`INSERT OR IGNORE INTO candidate_events(id,source_item_id,source_revision,parser_version,ai_model,extraction_json,confidence,validation_status,validation_errors,review_reasons,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(candidate.id,candidate.source_item_id,candidate.revision,candidate.parser_version,candidate.ai_model,json(candidate.extraction),candidate.confidence,candidate.validation_status,json(candidate.validation_errors),json(candidate.review_reasons),candidate.created_at).run();
      return candidate;
    },
    async enqueueReview(entry){
      await db.prepare(`INSERT OR IGNORE INTO review_queue(id,source_item_id,candidate_event_id,reason,status,created_at) VALUES(?1,?2,?3,?4,'PENDING',?5)`).bind(entry.id,entry.source_item_id,entry.candidate_event_id,entry.reason,entry.created_at).run();
      return entry;
    },
    async publishEvent(event){
      const statements=[db.prepare(`INSERT OR IGNORE INTO events(id,source_item_id,candidate_event_id,revision,event_type,status,cause,start_at,end_at,published_at,retrieved_at,reviewed_at,supersedes,created_at) VALUES(?1,?2,?3,?4,?5,'PUBLISHED',?6,?7,?8,?9,?10,?11,?12,?13)`).bind(event.id,event.source_item_id,event.candidate_event_id,event.revision,event.event_type,event.cause,event.start_at,event.end_at,event.published_at,event.retrieved_at,event.reviewed_at,event.supersedes,new Date().toISOString())];
      for(const target of event.targets)statements.push(db.prepare(`INSERT OR IGNORE INTO event_targets(id,event_id,source_label,barangay_psgc,canonical_name,coverage,match_status) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(`${event.id}:t:${target.barangay_psgc}:${target.source_label}`,event.id,target.source_label,target.barangay_psgc,target.canonical_name,target.coverage,target.match_status));
      for(const feeder of event.feeders)statements.push(db.prepare(`INSERT OR IGNORE INTO event_feeders(id,event_id,source_label,feeder_id,match_status) VALUES(?1,?2,?3,?4,?5)`).bind(`${event.id}:f:${feeder.feeder_id}`,event.id,feeder.source_label,feeder.feeder_id,feeder.match_status));
      await db.batch(statements);await this.markSourceStatus(event.source_item_id,'PUBLISHED');return event;
    },
    async getUsage(date){return (await db.prepare('SELECT * FROM usage_daily WHERE date=?1').bind(date).first())||{date,browser_runs:0,browser_seconds:0,ai_calls:0,ai_units:0,queue_operations:0};},
    async incrementUsage(date,delta){
      await db.prepare(`INSERT INTO usage_daily(date,browser_runs,browser_seconds,ai_calls,ai_units,queue_operations) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(date) DO UPDATE SET browser_runs=browser_runs+excluded.browser_runs,browser_seconds=browser_seconds+excluded.browser_seconds,ai_calls=ai_calls+excluded.ai_calls,ai_units=ai_units+excluded.ai_units,queue_operations=queue_operations+excluded.queue_operations`).bind(date,delta.browser_runs||0,delta.browser_seconds||0,delta.ai_calls||0,delta.ai_units||0,delta.queue_operations||0).run();
      return this.getUsage(date);
    },
    recordOperationalEvent(event){return db.prepare(`INSERT INTO operational_events(id,type,resource,detail,created_at) VALUES(?1,?2,?3,?4,?5)`).bind(event.id||crypto.randomUUID(),event.type,event.resource||null,event.detail||null,event.created_at).run();},
    startRun(run){return db.prepare(`INSERT INTO ingestion_runs(id,source,started_at,status,items_detected,items_processed) VALUES(?1,?2,?3,'RUNNING',0,0)`).bind(run.id,run.source,run.started_at).run();},
    finishRun(id,result){return db.prepare(`UPDATE ingestion_runs SET finished_at=?1,status=?2,items_detected=?3,items_processed=?4,error_message=?5 WHERE id=?6`).bind(result.finished_at,result.status,result.items_detected||0,result.items_processed||0,result.error_message||null,id).run();},
    async listPublishedEvents(){
      const result=await db.prepare(`SELECT e.*,s.publisher,s.source_url,s.content_hash FROM events e JOIN source_items s ON s.id=e.source_item_id JOIN candidate_events c ON c.id=e.candidate_event_id WHERE e.status='PUBLISHED' AND c.validation_status='VALIDATED' ORDER BY COALESCE(e.start_at,e.published_at) DESC`).all();
      return rowResult(result);
    },
    async getPublishedEvent(id){return db.prepare(`SELECT e.*,s.publisher,s.source_url,s.content_hash FROM events e JOIN source_items s ON s.id=e.source_item_id JOIN candidate_events c ON c.id=e.candidate_event_id WHERE e.id=?1 AND e.status='PUBLISHED' AND c.validation_status='VALIDATED'`).bind(id).first();},
    async getTargetsForEvent(id){return rowResult(await db.prepare('SELECT source_label,barangay_psgc,canonical_name,coverage,match_status FROM event_targets WHERE event_id=?1').bind(id).all());},
    async getFeedersForEvent(id){return rowResult(await db.prepare('SELECT source_label,feeder_id,match_status FROM event_feeders WHERE event_id=?1').bind(id).all());},
    async getDirectEventsForBarangay(psgc){
      const result=await db.prepare(`SELECT e.*,s.publisher,s.source_url,t.coverage,t.source_label AS target_source_label FROM events e JOIN event_targets t ON t.event_id=e.id JOIN source_items s ON s.id=e.source_item_id JOIN candidate_events c ON c.id=e.candidate_event_id WHERE t.barangay_psgc=?1 AND e.status='PUBLISHED' AND c.validation_status='VALIDATED' ORDER BY COALESCE(e.start_at,e.published_at) DESC`).bind(psgc).all();
      return rowResult(result);
    },
    async getPublishedFeederEvents(){
      const result=await db.prepare(`SELECT e.*,s.publisher,s.source_url,f.feeder_id,f.source_label AS feeder_source_label FROM events e JOIN event_feeders f ON f.event_id=e.id JOIN source_items s ON s.id=e.source_item_id JOIN candidate_events c ON c.id=e.candidate_event_id WHERE e.status='PUBLISHED' AND c.validation_status='VALIDATED' ORDER BY COALESCE(e.start_at,e.published_at) DESC`).all();
      return rowResult(result);
    },
    async getHealth(){
      const [runs,reviews,latestEvent,latestSource,failures,budgets]=await Promise.all([
        db.prepare('SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20').all(),
        db.prepare(`SELECT COUNT(*) AS count FROM review_queue WHERE status='PENDING'`).first(),
        db.prepare(`SELECT id,event_type,published_at,created_at FROM events WHERE status='PUBLISHED' ORDER BY created_at DESC LIMIT 1`).first(),
        db.prepare('SELECT publisher,retrieved_at,processing_status FROM source_items ORDER BY retrieved_at DESC LIMIT 1').first(),
        db.prepare(`SELECT COUNT(*) AS count FROM candidate_events WHERE validation_status='REJECTED'`).first(),
        db.prepare(`SELECT * FROM operational_events WHERE type='BUDGET_LIMIT_REACHED' ORDER BY created_at DESC LIMIT 1`).first()
      ]);
      return {runs:rowResult(runs),pending_review:Number(reviews?.count||0),validation_failures:Number(failures?.count||0),latest_event:latestEvent||null,latest_source:latestSource||null,latest_budget_limit:budgets||null};
    }
  };
}
