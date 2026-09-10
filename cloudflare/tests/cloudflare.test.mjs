import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {handleStatus,getStatusPayload} from '../src/api/status.js';
import {getHealthPayload} from '../src/api/health.js';
import {canUseAI,canUseBrowser,canEnqueue} from '../src/budget/usage.js';
import {recordAndEnqueue} from '../src/collectors/common.js';
import {collectNgcpUpdates} from '../src/collectors/ngcp.js';
import {collectMoreUpdates} from '../src/collectors/more.js';
import {parseCandidateJson} from '../src/ingestion/candidate-schema.js';
import {rawObjectKey} from '../src/ingestion/source-item.js';
import {normalizeCandidate} from '../src/ingestion/normalize.js';
import {parseNgcpText} from '../src/ingestion/parser.js';
import {publishCandidate} from '../src/ingestion/publisher.js';
import {validateCandidate} from '../src/ingestion/validator.js';
import {processSourceMessage} from '../src/queue/consumer.js';
import {createMemoryStore} from '../src/storage/memory.js';
import {sha256Hex} from '../src/utils/hash.js';

const fixtures=new URL('../fixtures/',import.meta.url);
const load=name=>JSON.parse(fs.readFileSync(new URL(name,fixtures),'utf8'));
const now=new Date('2026-09-10T08:00:00Z');
const source=async(overrides={})=>({id:'src_test',publisher:'MORE Power',source_type:'MORE_POWER_IMAGE',source_url:'https://example.test/advisory',content_hash:await sha256Hex('fixture'),published_at:'2026-09-10T08:00:00+08:00',retrieved_at:'2026-09-10T08:01:00+08:00',processing_status:'COLLECTED',current_revision:1,...overrides});
const validate=async fixture=>validateCandidate(normalizeCandidate(fixture,await source()));

test('generated PSA registry resolves an exact target',async()=>{
  const result=await validate(load('partial-barangay.json'));assert.equal(result.validation_status,'VALIDATED');assert.equal(result.normalized.areas[0].psgc,'0631000009');
});

test('unresolved official target is retained for review',async()=>{
  const result=await validate(load('unresolved-barangay.json'));assert.equal(result.validation_status,'REVIEW_REQUIRED');assert.match(result.review_reasons.join(),/UNRESOLVED_TARGET:Dungon C/);assert.equal(result.normalized.areas[0].source_label,'Dungon C');
});

test('known feeder receives its stable ID and unknown feeder requires review',async()=>{
  const known=await validate(load('partial-barangay.json')),unknown=await validate(load('unknown-feeder.json'));assert.equal(known.normalized.feeders[0].feeder_id,'MORE-ILO-DIVERSION-F02');assert.equal(unknown.validation_status,'REVIEW_REQUIRED');assert.match(unknown.review_reasons.join(),/UNKNOWN_FEEDER/);
});

test('PORTION and WHOLE coverage remain distinct',async()=>{
  const partial=await validate(load('partial-barangay.json')),whole=await validate(load('whole-barangay.json'));assert.equal(partial.normalized.areas[0].coverage,'PORTION');assert.equal(whole.normalized.areas[0].coverage,'WHOLE');
});

test('grid notice never becomes a confirmed local interruption',async()=>{
  const raw=fs.readFileSync(new URL('ngcp-grid-notice.txt',fixtures),'utf8'),extraction=parseNgcpText(raw),result=await validateCandidate(normalizeCandidate(extraction,await source({publisher:'NGCP',source_type:'NGCP_HTTP'})));assert.equal(result.event.event_type,'GRID_RISK');assert.equal(result.normalized.areas.length,0);
});

test('only an explicit restoration source becomes RESTORED',async()=>{
  const scheduled=await validate(load('more-scheduled-image-extraction.json')),restored=await validate(load('restoration-notice.json'));assert.equal(scheduled.event.event_type,'SCHEDULED');assert.equal(restored.event.event_type,'RESTORED');assert.equal(scheduled.event.overnight,true);
});

test('AI extraction schema rejects invented stable identity fields',()=>{
  const invalid={...load('partial-barangay.json'),areas:[{source_label:'Bakhaw',district:'Mandurriao',coverage:'PORTION',barangay_psgc:'0631000009'}]};assert.throws(()=>parseCandidateJson(invalid),/forbidden or unknown field/);
});

test('collector deduplicates unchanged content and enqueues new content once',async()=>{
  const store=createMemoryStore(),messages=[],archive={put:async()=>({stored:false,key:'local'})},queue={send:async body=>messages.push(body)},env={QUEUE_DAILY_SOFT_LIMIT:'7000'};
  const input={publisher:'NGCP',sourceType:'NGCP_HTTP',sourceUrl:'https://example.test/ngcp',content:'notice',contentType:'text/plain'};
  const first=await recordAndEnqueue(input,{env,store,archive,queue,now}),second=await recordAndEnqueue(input,{env,store,archive,queue,now});assert.equal(first.status,'QUEUED');assert.equal(second.status,'UNCHANGED');assert.equal(messages.length,1);assert.equal(store.state.sources.size,1);
});

test('raw archive keys preserve distinct source revisions',()=>{
  const base={id:'src_revision',publisher:'MORE Power',retrieved_at:'2026-09-10T00:00:00Z'};
  assert.notEqual(rawObjectKey({...base,content_hash:'a'.repeat(64)},'original.jpg'),rawObjectKey({...base,content_hash:'b'.repeat(64)},'original.jpg'));
});

test('NGCP collector stays NOT_CONNECTED without an invented endpoint',async()=>{
  const store=createMemoryStore(),result=await collectNgcpUpdates({env:{},store,archive:{put:async()=>({stored:false})},queue:{send:async()=>{}},now});assert.equal(result.status,'NOT_CONNECTED');
});

test('browser, AI, and queue soft budgets fail closed',async()=>{
  const store=createMemoryStore(),day='2026-09-10';await store.incrementUsage(day,{browser_seconds:480,ai_units:8000,queue_operations:7000});
  assert.equal((await canUseBrowser(store,{},1,now)).ok,false);assert.equal((await canUseAI(store,{},now)).ok,false);assert.equal((await canEnqueue(store,{},now)).ok,false);
});

test('budget exhaustion skips browser and queue work safely',async()=>{
  const store=createMemoryStore(),day='2026-09-10';await store.incrementUsage(day,{browser_seconds:480,queue_operations:7000});let browserCalled=false,queueCalled=false;
  const browser=await collectMoreUpdates({env:{},store,archive:{},queue:{},adapter:{collect:async()=>{browserCalled=true;return {status:'COMPLETED',updates:[]};}},now});
  const queued=await recordAndEnqueue({publisher:'NGCP',sourceType:'NGCP_HTTP',sourceUrl:'https://example.test/new',content:'new'},{env:{},store,archive:{put:async()=>({stored:false})},queue:{send:async()=>{queueCalled=true;}},now});
  assert.equal(browser.status,'BUDGET_LIMIT_REACHED');assert.equal(browserCalled,false);assert.equal(queued.status,'BUDGET_LIMIT_REACHED');assert.equal(queueCalled,false);
});

test('AI exhaustion leaves an image source unpublished and waiting',async()=>{
  const store=createMemoryStore(),day='2026-09-10',src=await source({source_type:'MORE_POWER_IMAGE',raw_object_key:'fixture.svg'});await store.incrementUsage(day,{ai_units:8000});store.state.sources.set(src.id,src);
  const result=await processSourceMessage({sourceId:src.id,revision:1},{env:{AI:{run:async()=>{throw new Error('must not run');}}},store,archive:{get:async()=>new TextEncoder().encode('<svg/>').buffer},now});
  assert.equal(result.validation_status,'REVIEW_REQUIRED');assert.equal(store.state.events.size,0);assert.equal(store.state.sources.get(src.id).processing_status,'WAITING_FOR_AI_BUDGET');
});

test('publication rejects review candidates and is idempotent for validated input',async()=>{
  const store=createMemoryStore(),src=await source(),validation=await validate(load('partial-barangay.json')),candidate={id:'cand_1',revision:1};
  await assert.rejects(()=>publishCandidate(store,candidate,{...validation,validation_status:'REVIEW_REQUIRED'}),/not VALIDATED/);
  const first=await publishCandidate(store,candidate,validation),second=await publishCandidate(store,candidate,validation);assert.equal(first.id,second.id);assert.equal(store.state.events.size,1);
});

test('processing the same source twice creates one logical event',async()=>{
  const store=createMemoryStore(),src=await source({source_type:'MORE_POWER_TEXT',inline_content:'fixture',extraction_json:load('partial-barangay.json')});store.state.sources.set(src.id,src);
  const archive={get:async()=>null},env={};await processSourceMessage({sourceId:src.id,revision:1},{env,store,archive,now});await processSourceMessage({sourceId:src.id,revision:1},{env,store,archive,now});assert.equal(store.state.events.size,1);
});

test('public status returns UNKNOWN when no validated event exists',async()=>{
  const payload=await getStatusPayload(createMemoryStore(),'0631000025',now);assert.equal(payload.status,'UNKNOWN');assert.equal(payload.evidence_type,'NO_MATCHING_VALIDATED_EVENT');assert.equal('power_on' in payload,false);
});

test('explicit validated barangay target is returned as evidence',async()=>{
  const store=createMemoryStore(),validation=await validate(load('whole-barangay.json'));await publishCandidate(store,{id:'cand_status',revision:1},validation);
  const payload=await getStatusPayload(store,'0631000025',new Date('2026-09-12T02:00:00Z'));assert.equal(payload.status,'CONFIRMED');assert.equal(payload.evidence_type,'EXPLICIT_BARANGAY');
});

test('an elapsed schedule becomes UNKNOWN, never inferred RESTORED',async()=>{
  const store=createMemoryStore(),validation=await validate(load('more-scheduled-image-extraction.json'));await publishCandidate(store,{id:'cand_elapsed',revision:1},validation);
  const payload=await getStatusPayload(store,'0631000025',new Date('2026-09-13T00:00:00Z'));assert.equal(payload.status,'UNKNOWN');assert.notEqual(payload.status,'RESTORED');
});

test('feeder association alone never confirms a barangay outage',async()=>{
  const store=createMemoryStore();store.state.events.set('evt_feeder',{id:'evt_feeder',status:'PUBLISHED',event_type:'CONFIRMED',start_at:'2026-09-10T00:00:00Z',end_at:null,published_at:'2026-09-10T00:00:00Z',targets:[],feeders:[{source_label:'Diversion Feeder 2',feeder_id:'MORE-ILO-DIVERSION-F02',match_status:'EXACT'}]});
  const payload=await getStatusPayload(store,'0631000025',now);assert.equal(payload.status,'UNKNOWN');assert.equal(payload.evidence_type,'FEEDER_ASSOCIATION_ONLY');assert.equal(payload.feeder_context.relationship,'PORTION');
});

test('invalid PSGC gets a safe 400 response',async()=>{
  const request=new Request('https://api.example.test/api/status?barangay_psgc=123');const response=await handleStatus(request,{ALLOWED_ORIGIN:'https://app.example.test'},createMemoryStore());assert.equal(response.status,400);
});

test('DRAFT and REVIEW_REQUIRED records cannot enter public evidence',async()=>{
  const store=createMemoryStore();store.state.events.set('draft',{id:'draft',status:'DRAFT',event_type:'CONFIRMED',targets:[{barangay_psgc:'0631000025'}],feeders:[]});assert.equal((await store.listPublishedEvents()).length,0);assert.equal((await getStatusPayload(store,'0631000025',now)).status,'UNKNOWN');
});

test('health reports source disconnection as delayed ingestion',async()=>{
  const store=createMemoryStore(),payload=await getHealthPayload({},store,{connected:true},now);assert.equal(payload.status,'NOT_CONNECTED');assert.equal(payload.ingestion_delayed,true);
});
