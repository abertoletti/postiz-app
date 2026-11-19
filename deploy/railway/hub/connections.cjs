const crypto=require('node:crypto');
const {cleanBrand,fail,text}=require('./domain.cjs');
const {resourceKey,propose,seal,unseal,discoverMeta,discoverGoogle,publicResource}=require('./discovery.cjs');
// Page-comment moderation adds a separate Meta dependency (pages_read_user_content).
// This onboarding needs discovery, publishing and insights, not that extra access.
const META_SCOPES=['pages_show_list','business_management','pages_manage_posts','pages_read_engagement','read_insights','instagram_basic','instagram_content_publish','instagram_manage_comments','instagram_manage_insights'];
const GOOGLE_SCOPES=['https://www.googleapis.com/auth/userinfo.profile','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/youtube','https://www.googleapis.com/auth/yt-analytics.readonly'];
function mountConnections({router,db,list,save,wrap,dep}){
 const google=dep('googleapis').google,secret=process.env.JWT_SECRET;
 const origin=new URL(process.env.FRONTEND_URL).origin;
 const callback=p=>origin+'/integrations/social/'+(p==='meta'?'facebook':'youtube');
 const encrypt=(value,org)=>seal(value,secret,org),decrypt=(value,org)=>unseal(value,secret,org);
 const googleClient=()=>new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET,callback('google'));
 const configured=p=>p==='meta'?!!(process.env.FACEBOOK_APP_ID&&process.env.FACEBOOK_APP_SECRET):!!(process.env.YOUTUBE_CLIENT_ID&&process.env.YOUTUBE_CLIENT_SECRET);
 const safeError=(p,e)=>e.status?e.message:(p==='google'?'Google non restituisce un canale utilizzabile. Se il canale esiste, ricollega Google scegliendo quel canale.':'Accesso Meta non disponibile: ricollega le Pagine da recuperare.');
 async function sources(org){
  const stored=await list(org,'connection');
  const existing=await db.integration.findMany({where:{organizationId:org,deletedAt:null,providerIdentifier:{in:['facebook','instagram','youtube']}}});
  const all=stored.map(r=>({...decrypt(r.data.credentials,org),id:r.id,provider:r.data.provider,name:r.data.name}));
  for(const row of existing){const provider=row.providerIdentifier==='youtube'?'google':'meta',token=provider==='meta'?(row.refreshToken||row.token):row.token;
   if(!all.some(s=>s.provider===provider&&(s.refreshToken||s.token)===(row.refreshToken||token)))all.push({id:row.id,provider,name:row.name,token,refreshToken:row.refreshToken,expiresAt:row.tokenExpiration?.getTime(),rootId:row.rootInternalId,existing:true});
  }
  return {all,existing};
 }
 require('./credentials.cjs').mountCredentialRoutes({router,db,list,sources,encrypt,decrypt,wrap,google,configured,safeError});
 router.get('/api/connections',wrap(async(req,res)=>{const {all}=await sources(req.org.id);res.json({connections:all.map(s=>({id:s.id,provider:s.provider,name:s.name,existing:!!s.existing})),configured:{meta:configured('meta'),google:configured('google')}});}));
 router.post('/api/connections/:provider/start',wrap(async(req,res)=>{
  const p=req.params.provider;if(!['meta','google'].includes(p)||!configured(p))fail('Collegamento non configurato.');
  const state='hub_'+crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
  await db.$executeRawUnsafe("DELETE FROM brand_hub.documents WHERE org_id=$1 AND kind IN ('oauth-state','discovery') AND updated_at < now()-interval '1 day'",req.org.id);
  await db.$executeRawUnsafe('INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,$3,$4::jsonb)',req.org.id,state,'oauth-state',JSON.stringify({userId:req.user.id,provider:p,verifier,expiresAt:Date.now()+600000}));
  let url;if(p==='google')url=googleClient().generateAuthUrl({scope:GOOGLE_SCOPES,access_type:'offline',prompt:'consent select_account',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  else {const u=new URL('https://www.facebook.com/v25.0/dialog/oauth');for(const[k,v]of Object.entries({client_id:process.env.FACEBOOK_APP_ID,redirect_uri:callback(p),state,scope:META_SCOPES.join(','),response_type:'code'}))u.searchParams.set(k,v);url=u.href;}
  res.json({url});
 }));
 router.get('/api/oauth/:provider/callback',wrap(async(req,res)=>{
  const p=req.params.provider,state=String(req.query.state||'');if(!/^hub_[a-f0-9]{64}$/.test(state))fail('Richiesta di collegamento non valida.',400);
  const rows=await db.$queryRawUnsafe("DELETE FROM brand_hub.documents WHERE org_id=$1 AND id=$2 AND kind='oauth-state' AND data->>'userId'=$3 AND data->>'provider'=$4 RETURNING data",req.org.id,state,req.user.id,p);
  if(!rows.length||rows[0].data.expiresAt<Date.now())return res.redirect('/hub/?connection=expired#connections');
  if(req.query.error||!req.query.code)return res.redirect('/hub/?connection=cancelled#connections');
  try{
   let credentials,name,identity;
   if(p==='google'){
    const client=googleClient();const {tokens}=await client.getToken({code:String(req.query.code),codeVerifier:rows[0].data.verifier});client.setCredentials(tokens);
    const {data}=await google.oauth2({version:'v2',auth:client}).userinfo.get({},{timeout:20000});identity=data.id;name=data.email||data.name||'Google';credentials={token:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:tokens.expiry_date,rootId:identity};
   }else{
    const exchange=async params=>{const u=new URL('https://graph.facebook.com/v25.0/oauth/access_token');const response=await fetch(u,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.FACEBOOK_APP_ID,client_secret:process.env.FACEBOOK_APP_SECRET,...params}),signal:AbortSignal.timeout(20000)});const d=await response.json();if(!response.ok||!d.access_token)throw Error('Meta exchange failed');return d;};
    const short=await exchange({code:String(req.query.code),redirect_uri:callback(p)}),long=await exchange({grant_type:'fb_exchange_token',fb_exchange_token:short.access_token});
    const response=await fetch('https://graph.facebook.com/v25.0/me?fields=id,name',{headers:{Authorization:'Bearer '+long.access_token},signal:AbortSignal.timeout(20000)});const me=await response.json();if(!response.ok||!me.id)throw Error('Meta identity failed');identity=me.id;name=me.name;credentials={token:long.access_token,refreshToken:long.access_token,rootId:identity,expiresAt:Date.now()+(long.expires_in||5184000)*1000};
   }
   // Google grants are channel-specific: retain separate connections even for one login.
   const id=crypto.randomUUID();await db.$executeRawUnsafe('INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,$3,$4::jsonb)',req.org.id,id,'connection',JSON.stringify({provider:p,name,credentials:encrypt(credentials,req.org.id)}));
   res.redirect('/hub/?connection=success&credential='+encodeURIComponent(id)+'#connections');
  }catch{res.redirect('/hub/?connection=failed#connections');}
 }));
 router.post('/api/connections/discover',wrap(async(req,res)=>{
  const org=req.org.id,{all,existing}=await sources(org),brands=await list(org,'brand'),resources=new Map(),reports=[];
  // Existing integrations remain visible even if a provider is temporarily unavailable.
  for(const c of existing.filter(c=>!c.inBetweenSteps))resources.set(c.providerIdentifier+':'+c.internalId,{platform:c.providerIdentifier,externalId:c.internalId,name:c.customName||c.name,handle:c.profile||'',integrationId:c.id,canConnect:!c.disabled&&!c.refreshNeeded,container:'Già collegato a Postiz',connectionId:c.id});
  for(const source of all){try{
    const result=source.provider==='meta'?await discoverMeta(source):await discoverGoogle(source,google);
    for(const r of result.resources){const key=resourceKey(r),old=resources.get(key),integration=existing.find(c=>!c.inBetweenSteps&&c.providerIdentifier===r.platform&&c.internalId===r.externalId);if(!old||r.canConnect||!old.token)resources.set(key,{...r,connectionId:source.id,integrationId:integration?.id});}
    reports.push({provider:source.provider,name:result.identity,count:result.resources.length,warnings:result.warnings,status:'ok'});
   }catch(e){reports.push({provider:source.provider,name:source.name,count:0,status:'error',warnings:[safeError(source.provider,e)]});}}
  const raw=[...resources.values()];for(const r of raw)r.assignedBrandId=brands.find(b=>r.integrationId&&b.data.channelIds.includes(r.integrationId))?.id||'';
  const id=crypto.randomUUID();await db.$executeRawUnsafe('INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,$3,$4::jsonb)',org,id,'discovery',JSON.stringify({expiresAt:Date.now()+900000,resources:encrypt(raw,org)}));
  res.json({snapshotId:id,groups:propose(raw.map(publicResource),brands),reports,at:new Date().toISOString()});
 }));
 router.post('/api/connections/apply',wrap(async(req,res)=>{
  if(!Array.isArray(req.body.groups)||!req.body.groups.length||req.body.groups.length>100)fail('Seleziona almeno una risorsa.');
  const org=req.org.id;
  const result=await db.$transaction(async tx=>{
   // Serialize imports across replicas; the snapshot is consumed in the same transaction.
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',org);
   const [snapshot]=await tx.$queryRawUnsafe("SELECT data FROM brand_hub.documents WHERE org_id=$1 AND id=$2 AND kind='discovery' FOR UPDATE",org,String(req.body.snapshotId));
   if(!snapshot||snapshot.data.expiresAt<Date.now())fail('Il recupero è scaduto: aggiorna le risorse.',409);
   if(snapshot.data.result)return snapshot.data.result;
   const available=decrypt(snapshot.data.resources,org),brands=await tx.$queryRawUnsafe("SELECT id,version,data FROM brand_hub.documents WHERE org_id=$1 AND kind='brand' FOR UPDATE",org),seen=new Set(),changed=[];
   for(const choice of req.body.groups){
    if(!Array.isArray(choice.resources)||!choice.resources.length||choice.resources.length>40)fail('Selezione non valida.');
    const selected=choice.resources.map(key=>{if(seen.has(key))fail('Una risorsa compare in più gruppi.');seen.add(key);const r=available.find(x=>resourceKey(x)===key);if(!r)fail('Risorsa non disponibile.',403);if(!r.integrationId&&!r.canConnect)fail('Autorizza prima la pubblicazione per '+r.name+'.');return r;});
    let brand=choice.brandId?brands.find(b=>b.id===choice.brandId):null;if(choice.brandId&&!brand)fail('Brand non disponibile.',404);
    if(!brand){const data=cleanBrand({name:text(choice.name,100),description:selected.find(r=>r.description)?.description||'',website:selected.find(r=>/^https?:\/\//.test(r.website||''))?.website||''});brand={id:crypto.randomUUID(),version:1,data};await tx.$executeRawUnsafe('INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,$3,$4::jsonb)',org,brand.id,'brand',JSON.stringify(data));brands.push(brand);}
    const ids=[];
    for(const r of selected){
     let integration=await tx.integration.findFirst({where:{organizationId:org,internalId:r.externalId}});
     if(integration&&(integration.deletedAt||integration.inBetweenSteps||integration.providerIdentifier!==r.platform))fail('Questo account richiede un ricollegamento prima dell’importazione.',409);
     const owner=integration&&brands.find(b=>b.id!==brand.id&&b.data.channelIds.includes(integration.id));if(owner)fail('Il canale '+r.name+' è già assegnato a '+owner.data.name+'.',409);
     if(!integration){if(!r.token)fail('Autorizzazione mancante. Ricollega il social.',409);integration=await tx.integration.create({data:{organizationId:org,internalId:r.externalId,providerIdentifier:r.platform,type:'social',name:r.name,profile:r.handle,token:r.token,refreshToken:r.refreshToken||'',rootInternalId:r.rootId||r.externalId,tokenExpiration:r.expiresAt?new Date(Number(r.expiresAt)):null,inBetweenSteps:false,refreshNeeded:false,additionalSettings:'[]'}});}
     ids.push(integration.id);
    }
    const channelIds=[...new Set([...brand.data.channelIds,...ids])];if(channelIds.length>40)fail('Un brand può contenere al massimo 40 canali.');
    brand.data={...brand.data,channelIds};await tx.$executeRawUnsafe("UPDATE brand_hub.documents SET data=$1::jsonb,version=version+1,updated_at=now() WHERE org_id=$2 AND id=$3 AND kind='brand'",JSON.stringify(brand.data),org,brand.id);changed.push({id:brand.id,name:brand.data.name,channelCount:channelIds.length});
   }
   const result={brands:changed};await tx.$executeRawUnsafe("UPDATE brand_hub.documents SET data=$1::jsonb WHERE org_id=$2 AND id=$3 AND kind='discovery'",JSON.stringify({expiresAt:snapshot.data.expiresAt,result}),org,String(req.body.snapshotId));return result;
  },{timeout:20000});res.json(result);
 }));
}
module.exports={mountConnections};
