import {DEFAULT_BUDGETS,DEFAULT_VISION_MODEL} from '../constants.js';
import {canUseAI,recordBudgetLimit,recordUsage} from '../budget/usage.js';
import {ADVISORY_JSON_SCHEMA,parseCandidateJson} from './candidate-schema.js';
import {IMAGE_EXTRACTION_SYSTEM_PROMPT} from './image-extraction-prompt.js';

function dataUri(bytes,mimeType){
  const value=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  let binary='';for(let index=0;index<value.length;index+=8192)binary+=String.fromCharCode(...value.subarray(index,index+8192));
  return `data:${mimeType||'image/jpeg'};base64,${btoa(binary)}`;
}

export async function extractAdvisoryFromImage(image,{env,store,now=new Date(),mimeType='image/jpeg'}={}){
  if(!env?.AI?.run)throw Object.assign(new Error('Workers AI is not connected.'),{code:'AI_NOT_CONNECTED'});
  const allowed=await canUseAI(store,env,now);
  if(!allowed.ok){await recordBudgetLimit(store,'AI',allowed,now);throw Object.assign(new Error('AI daily soft limit reached.'),{code:'AI_BUDGET_LIMIT_REACHED'});}
  const model=env.VISION_MODEL||DEFAULT_VISION_MODEL;
  const response=await env.AI.run(model,{
    messages:[{role:'system',content:IMAGE_EXTRACTION_SYSTEM_PROMPT},{role:'user',content:'Extract this advisory image.'}],
    image:dataUri(image,mimeType),
    response_format:{type:'json_schema',json_schema:ADVISORY_JSON_SCHEMA},
    temperature:0,
    max_tokens:1200
  });
  const estimated=Number(env.AI_ESTIMATED_UNITS_PER_CALL||DEFAULT_BUDGETS.aiPerCall);
  await recordUsage(store,{ai_calls:1,ai_units:Number.isFinite(estimated)?estimated:DEFAULT_BUDGETS.aiPerCall},now);
  return parseCandidateJson(response?.response??response);
}
