const STATUS_VALUES=new Set(['CONFIRMED','SCHEDULED','GRID_RISK','COMMUNITY','RESTORED','UNKNOWN']);

function apiBase(explicit){return String(explicit??window.GRIDWATCH_CONFIG?.apiBaseUrl??'').trim().replace(/\/$/,'');}
function validPsgc(value){return /^063100\d{4}$/.test(value||'');}

function validateStatus(value,psgc){
  if(!value||typeof value!=='object'||value.barangay_psgc!==psgc||!STATUS_VALUES.has(value.status))throw new Error('Live API returned an invalid status record.');
  if(!Number.isFinite(Date.parse(value.as_of||'')))throw new Error('Live API status is missing a valid as_of timestamp.');
  if(value.official_event){
    if(!value.official_event.id||!value.official_event.source?.publisher||!value.official_event.source?.url)throw new Error('Live API evidence is missing provenance.');
    if(value.evidence_type!=='EXPLICIT_BARANGAY')throw new Error('Live API attempted to attach a local event without explicit barangay evidence.');
  }
  return value;
}

async function requestJson(path,{baseUrl,timeoutMs=3500}={}){
  const base=apiBase(baseUrl);if(!base)return {mode:'NOT_CONFIGURED',data:null,reason:'No live API URL is configured.'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`${base}${path}`,{headers:{Accept:'application/json'},signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error(`Live API returned HTTP ${response.status}.`);
    return {mode:'LIVE',data:await response.json(),reason:null};
  }catch(error){return {mode:'UNAVAILABLE',data:null,reason:error.name==='AbortError'?'Live API request timed out.':error.message};}
  finally{clearTimeout(timer);}
}

export async function getGridWatchStatus(psgc,options={}){
  if(!validPsgc(psgc))return {mode:'INVALID',data:null,reason:'Invalid Iloilo City barangay PSGC.'};
  const result=await requestJson(`/api/status?barangay_psgc=${encodeURIComponent(psgc)}`,options);if(result.mode!=='LIVE')return result;
  try{
    const data=validateStatus(result.data,psgc),age=Date.now()-Date.parse(data.as_of),maxAge=options.maxAgeMs??2*60*60*1000;
    if(age>maxAge||age< -5*60*1000)return {mode:'UNAVAILABLE',data:null,reason:'Live API evidence is stale or has an invalid future timestamp.'};
    return {mode:'LIVE',data,reason:null};
  }catch(error){return {mode:'UNAVAILABLE',data:null,reason:error.message};}
}

export async function getGridWatchHealth(options={}){
  const result=await requestJson('/api/health',options);if(result.mode!=='LIVE')return result;
  if(!result.data||!['LIVE','DEGRADED','NOT_CONNECTED'].includes(result.data.status)||!Number.isFinite(Date.parse(result.data.as_of||'')))return {mode:'UNAVAILABLE',data:null,reason:'Live API returned an invalid health record.'};
  return result;
}
