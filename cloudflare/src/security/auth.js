export function requireOperator(request,env){
  if(env.GRIDWATCH_ENV!=='development')return new Response('Not found',{status:404});
  const configured=env.OPERATOR_DEV_TOKEN;
  if(!configured)return new Response('Operator endpoint disabled',{status:503});
  const supplied=request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  return supplied===configured?null:new Response('Unauthorized',{status:401});
}
