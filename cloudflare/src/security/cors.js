function allowedOrigins(env){
  return String(env.ALLOWED_ORIGIN||'').split(',').map(value=>value.trim()).filter(Boolean);
}

export function isAllowedOrigin(origin,env){
  if(!origin)return true;
  if(allowedOrigins(env).includes(origin))return true;
  if(env.GRIDWATCH_ENV!=='production')return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return false;
}

export function corsHeaders(request,env){
  const origin=request.headers.get('Origin');
  const headers=new Headers({'Vary':'Origin','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  if(origin&&isAllowedOrigin(origin,env))headers.set('Access-Control-Allow-Origin',origin);
  return headers;
}

export function handlePreflight(request,env){
  const origin=request.headers.get('Origin');
  if(!isAllowedOrigin(origin,env))return new Response(null,{status:403});
  return new Response(null,{status:204,headers:corsHeaders(request,env)});
}
