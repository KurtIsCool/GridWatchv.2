import {DEFAULT_BUDGETS} from '../constants.js';
import {utcDay} from '../utils/time.js';

function limit(env,key,fallback){
  const value=Number(env?.[key]);return Number.isFinite(value)&&value>=0?value:fallback;
}

async function canUse(store,column,amount,maximum,now){
  const usage=await store.getUsage(utcDay(now));
  const used=Number(usage?.[column]||0);
  return {ok:used+amount<=maximum,used,requested:amount,limit:maximum,remaining:Math.max(0,maximum-used)};
}

export function canUseBrowser(store,env,seconds=1,now=new Date()){
  return canUse(store,'browser_seconds',seconds,limit(env,'BROWSER_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.browser),now);
}

export function canUseAI(store,env,now=new Date()){
  const units=limit(env,'AI_ESTIMATED_UNITS_PER_CALL',DEFAULT_BUDGETS.aiPerCall);
  return canUse(store,'ai_units',units,limit(env,'AI_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.ai),now);
}

export function canEnqueue(store,env,now=new Date()){
  return canUse(store,'queue_operations',3,limit(env,'QUEUE_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.queue),now);
}

export function recordUsage(store,delta,now=new Date()){
  return store.incrementUsage(utcDay(now),delta);
}

export function recordBudgetLimit(store,resource,result,now=new Date()){
  return store.recordOperationalEvent({
    type:'BUDGET_LIMIT_REACHED',resource,detail:JSON.stringify({used:result.used,limit:result.limit,requested:result.requested}),created_at:now.toISOString()
  });
}

export function budgetSnapshot(usage,env){
  return {
    browser:{used:Number(usage?.browser_seconds||0),limit:limit(env,'BROWSER_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.browser),unit:'seconds'},
    ai:{used:Number(usage?.ai_units||0),calls:Number(usage?.ai_calls||0),limit:limit(env,'AI_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.ai),unit:'internal estimated units'},
    queue:{used:Number(usage?.queue_operations||0),limit:limit(env,'QUEUE_DAILY_SOFT_LIMIT',DEFAULT_BUDGETS.queue),unit:'estimated operations'}
  };
}
