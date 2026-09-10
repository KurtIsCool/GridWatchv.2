import {corsHeaders} from '../security/cors.js';

export function jsonResponse(request,env,value,{status=200,headers={}}={}){
  const output=corsHeaders(request,env);output.set('Content-Type','application/json; charset=utf-8');output.set('Cache-Control',status===200?'public, max-age=30':'no-store');
  for(const [key,val] of Object.entries(headers))output.set(key,val);
  return new Response(JSON.stringify(value),{status,headers:output});
}
