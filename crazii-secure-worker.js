// CRAZII Secure Data Proxy — Cloudflare Worker
// Bind secrets in Cloudflare: TWELVE_DATA_API_KEY, ACCESS_TEAM_DOMAIN, ACCESS_AUD
// Set variable APP_ORIGIN to the exact deployed app origin, e.g. https://crazii.example.com
// Protect this origin with a Cloudflare Access application.

const ALLOWED_INTERVALS = new Set(["1min","5min","15min","30min","45min","1h","2h","4h","8h","1day"]);
const MAX_OUTPUTSIZE = 500;
let jwksCache = { expiresAt: 0, keys: null };

function json(data, status=200, origin="") {
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","vary":"Origin"};
  if(origin){headers["access-control-allow-origin"]=origin;headers["access-control-allow-methods"]="GET, OPTIONS";headers["access-control-allow-headers"]="Content-Type";headers["access-control-max-age"]="600";}
  return new Response(JSON.stringify(data),{status,headers});
}
function decodeBase64Url(value){const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);const binary=atob(padded);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
function decodeJsonPart(value){return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));}
async function getJwks(teamDomain){
  const now=Date.now();if(jwksCache.keys&&jwksCache.expiresAt>now)return jwksCache.keys;
  const response=await fetch(`${teamDomain.replace(/\/$/,"")}/cdn-cgi/access/certs`);
  if(!response.ok)throw new Error("Unable to retrieve Access signing keys");
  const body=await response.json();if(!Array.isArray(body.keys))throw new Error("Invalid Access signing keys");
  jwksCache={keys:body.keys,expiresAt:now+600000};return body.keys;
}
async function verifyAccessJwt(request,env){
  const token=request.headers.get("Cf-Access-Jwt-Assertion");
  if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return false;
  try{
    const parts=token.split(".");if(parts.length!==3)return false;
    const header=decodeJsonPart(parts[0]),claims=decodeJsonPart(parts[1]);
    if(header.alg!=="RS256"||!header.kid)return false;
    const issuer=env.ACCESS_TEAM_DOMAIN.replace(/\/$/,""),now=Math.floor(Date.now()/1000);
    if(claims.iss!==issuer)return false;
    if(!(Array.isArray(claims.aud)?claims.aud.includes(env.ACCESS_AUD):claims.aud===env.ACCESS_AUD))return false;
    if(typeof claims.exp!=="number"||claims.exp<=now)return false;
    if(typeof claims.nbf==="number"&&claims.nbf>now+60)return false;
    const jwk=(await getJwks(issuer)).find(k=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)return false;
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decodeBase64Url(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  }catch{return false;}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get("Origin")||"";
  const appOrigin=env.APP_ORIGIN||"";
  // Same-origin requests are allowed without an Origin header; cross-origin requests must match exactly.
  const sameOrigin=url.origin===appOrigin;
  if(request.method==="OPTIONS"){
    if(!appOrigin||origin!==appOrigin)return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{"access-control-allow-origin":appOrigin,"access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"Content-Type","access-control-max-age":"600","vary":"Origin"}});
  }
  if(request.method!=="GET")return json({error:"Method not allowed"},405);
  if(!appOrigin||(!sameOrigin&&origin!==appOrigin))return json({error:"Origin not allowed"},403);
  if(!(await verifyAccessJwt(request,env)))return json({error:"Authentication required"},401,origin===appOrigin?appOrigin:"");
  if(!env.TWELVE_DATA_API_KEY)return json({error:"Server data provider is not configured"},503,origin===appOrigin?appOrigin:"");
  if(url.pathname==="/api/health")return json({ok:true,service:"CRAZII data proxy",symbol:"XAU/USD"},200,origin===appOrigin?appOrigin:"");
  let upstreamUrl;
  if(url.pathname==="/api/candles"){
    const interval=url.searchParams.get("interval")||"15min",outputsize=Number(url.searchParams.get("outputsize")||"200");
    if(!ALLOWED_INTERVALS.has(interval))return json({error:"Unsupported interval"},400,origin===appOrigin?appOrigin:"");
    if(!Number.isInteger(outputsize)||outputsize<1||outputsize>MAX_OUTPUTSIZE)return json({error:`outputsize must be between 1 and ${MAX_OUTPUTSIZE}`},400,origin===appOrigin?appOrigin:"");
    upstreamUrl=new URL("https://api.twelvedata.com/time_series");upstreamUrl.searchParams.set("symbol","XAU/USD");upstreamUrl.searchParams.set("interval",interval);upstreamUrl.searchParams.set("outputsize",String(outputsize));upstreamUrl.searchParams.set("timezone","UTC");
  }else if(url.pathname==="/api/price"){upstreamUrl=new URL("https://api.twelvedata.com/price");upstreamUrl.searchParams.set("symbol","XAU/USD");}
  else return json({error:"Not found"},404,origin===appOrigin?appOrigin:"");
  try{
    const upstream=await fetch(upstreamUrl,{headers:{"Authorization":`apikey ${env.TWELVE_DATA_API_KEY}`,"accept":"application/json"}});
    const body=await upstream.json();
    if(!upstream.ok||body.status==="error"||body.code)return json({error:"Market data provider error",provider_status:upstream.status,details:body.message||body.code||"Request failed"},upstream.status>=400?upstream.status:502,origin===appOrigin?appOrigin:"");
    return json(body,200,origin===appOrigin?appOrigin:"");
  }catch{return json({error:"Unable to reach market data provider"},502,origin===appOrigin?appOrigin:"");}
 }
};
