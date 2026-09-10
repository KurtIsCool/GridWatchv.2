import {budgetSnapshot} from '../budget/usage.js';
import {utcDay} from '../utils/time.js';
import {jsonResponse} from './respond.js';

function latestRun(runs,source){return runs.find(run=>run.source===source)||null;}

export async function getHealthPayload(env,store,archive,now=new Date()){
  const [health,usage]=await Promise.all([store.getHealth(),store.getUsage(utcDay(now))]);
  const sourceNotConnected=!String(env.NGCP_SOURCE_URL||'').trim();
  const delayed=sourceNotConnected||Boolean(health.latest_budget_limit)||health.runs.some(run=>['FAILED','BUDGET_LIMIT_REACHED'].includes(run.status));
  return {
    status:sourceNotConnected?'NOT_CONNECTED':delayed?'DEGRADED':'LIVE',as_of:now.toISOString(),api:'LIVE',
    last_ngcp_check:latestRun(health.runs,'NGCP'),last_more_check:latestRun(health.runs,'MORE_POWER'),
    last_successful_ingestion:health.runs.find(run=>['COMPLETED','QUEUED','PUBLISHED'].includes(run.status))||null,
    pending_review_count:health.pending_review,validation_failures:health.validation_failures,
    budgets:budgetSnapshot(usage,env),latest_published_event:health.latest_event,latest_source:health.latest_source,
    ingestion_delayed:delayed,d1_status:'CONNECTED',r2_status:archive.connected?'CONNECTED':'NOT_CONNECTED'
  };
}

export async function handleHealth(request,env,store,archive){return jsonResponse(request,env,await getHealthPayload(env,store,archive));}
