const crypto=require('node:crypto');
const {fail,cleanBrand,text}=require('./domain.cjs');
const {resourceKey,normalize,discoverMeta,discoverGoogle,publicResource}=require('./discovery.cjs');
function groupSources(all){
 const groups=new Map();
 for(const s of all){const identity=s.rootId||s.id,key=s.provider+':'+identity;let g=groups.get(key);if(!g){g={id:s.id,key,provider:s.provider,name:s.name,identityId:String(identity),sources:[]};groups.set(key,g);}g.sources.push(s);}
 return [...groups.values()];
}
const inventoryId=key=>'inventory:'+crypto.createHash('sha256').update(key).digest('hex');
function mountCredentialRoutes({router,db,list,sources,encrypt,decrypt,wrap,google,configured,safeError}){
 async function find(org,id){const data=await sources(org),group=groupSources(data.all).find(g=>g.id===id||g.sources.some(s=>s.id===id));if(!group)fail('Credenziale non disponibile.',404);return {...data,group};}
 async function inventory(org,g){const rows=await db.$queryRawUnsafe("SELECT data FROM brand_hub.documents WHERE org_id=$1 AND id=$2 AND kind='inventory'",org,inventoryId(g.key));return rows[0]?.data;}
 function visible(raw,existing,brands){return raw.map(r=>{const c=existing.find(c=>!c.inBetweenSteps&&c.providerIdentifier===r.platform&&c.internalId===r.externalId);return {...publicResource(r),stale:!!r.stale,integrationId:c?.id,assignedBrandId:brands.find(b=>c&&b.data.channelIds.includes(c.id))?.id||'',disabled:!!c?.disabled,refreshNeeded:!!c?.refreshNeeded};});}
 router.get('/api/credentials',wrap(async(req,res)=>{
  const org=req.org.id,{all,existing}=await sources(org),brands=await list(org,'brand');const credentials=[];
  for(const g of groupSources(all)){
   const cache=await inventory(org,g);const raw=cache?decrypt(cache.resources,org):[];
   for(const c of existing.filter(c=>!c.inBetweenSteps&&g.sources.some(s=>s.id===c.id||s.rootId&&s.rootId===c.rootInternalId)&&(g.provider==='google'?c.providerIdentifier==='youtube':['facebook','instagram'].includes(c.providerIdentifier))))if(!raw.some(r=>r.platform===c.providerIdentifier&&r.externalId===c.internalId))raw.push({platform:c.providerIdentifier,externalId:c.internalId,name:c.customName||c.name,handle:c.profile||'',canConnect:!c.disabled&&!c.refreshNeeded,existingOnly:true});
   credentials.push({id:g.id,provider:g.provider,name:cache?.identity||g.name,identityId:g.identityId,refreshedAt:cache?.refreshedAt||null,status:cache?.status||'unrefreshed',warnings:cache?.warnings||[],resources:visible(raw,existing,brands)});
  }
  res.json({credentials,configured:{meta:configured('meta'),google:configured('google')}});
 }));
 const refreshing=new Set();
 router.post('/api/credentials/:id/refresh',wrap(async(req,res)=>{
  const org=req.org.id,{group:g}=await find(org,req.params.id),key=org+':'+g.key;if(refreshing.has(key))fail('Aggiornamento già in corso.',409);refreshing.add(key);
  try{
   const old=await inventory(org,g),resources=new Map(),warnings=[],tokens=new Set();let successes=0,identity=g.name;
   // A failed individual grant must not erase its previously retrieved channels.
   const previous=old?decrypt(old.resources,org):[];
   for(const s of g.sources){const token=s.refreshToken||s.token;if(tokens.has(token))continue;tokens.add(token);
    try{const r=g.provider==='meta'?await discoverMeta(s):await discoverGoogle(s,google);successes++;identity=r.identity||identity;warnings.push(...r.warnings);for(const item of r.resources){const k=resourceKey(item),prior=resources.get(k);if(!prior||item.canConnect)resources.set(k,{...item,sourceId:s.id});}}
    catch(e){warnings.push(safeError(g.provider,e));for(const item of previous.filter(r=>r.sourceId===s.id))if(!resources.has(resourceKey(item)))resources.set(resourceKey(item),{...item,stale:true});}
   }
   const data={identity,resources:encrypt(successes?[...resources.values()]:previous,org),refreshedAt:successes?new Date().toISOString():old?.refreshedAt||null,status:successes?(warnings.length?'partial':'ok'):'error',warnings:[...new Set(warnings)]};
   await db.$executeRawUnsafe("INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,'inventory',$3::jsonb) ON CONFLICT(org_id,id) DO UPDATE SET data=EXCLUDED.data,version=brand_hub.documents.version+1,updated_at=now()",org,inventoryId(g.key),JSON.stringify(data));
   res.json({ok:successes>0,count:successes?resources.size:previous.length,status:data.status});
  }finally{refreshing.delete(key);}
 }));
 router.post('/api/credentials/:id/assign',wrap(async(req,res)=>{
  const org=req.org.id,{group:g}=await find(org,req.params.id),cache=await inventory(org,g);
  const raw=cache?decrypt(cache.resources,org):[],resource=raw.find(r=>resourceKey(r)===req.body.resourceKey);
  if(!resource)fail('Aggiorna i canali di questa credenziale prima di associarli.',409);
  const result=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',org);
   const brands=await tx.$queryRawUnsafe("SELECT id,version,data FROM brand_hub.documents WHERE org_id=$1 AND kind='brand' FOR UPDATE",org);
   let integration=await tx.integration.findFirst({where:{organizationId:org,internalId:resource.externalId}});
   if(integration&&(integration.deletedAt||integration.inBetweenSteps||integration.providerIdentifier!==resource.platform))fail('Ricollega questo canale prima di associarlo.',409);
   const owner=brands.find(b=>integration&&b.data.channelIds.includes(integration.id));
   let destination=req.body.brandId?brands.find(b=>b.id===req.body.brandId):null;
   if(req.body.brandId&&!destination)fail('Brand non disponibile.',404);
   const newName=text(req.body.newName,100);
   if(newName&&owner&&normalize(owner.data.name)===normalize(newName))return {brandId:owner.id};
   if((req.body.previousBrandId||'')!==(owner?.id||''))fail('L’associazione è cambiata. Ricarica i collegamenti.',409);
   if(newName){const data=cleanBrand({name:newName,description:resource.description||'',website:resource.website||''});destination={id:crypto.randomUUID(),data};await tx.$executeRawUnsafe("INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,'brand',$3::jsonb)",org,destination.id,JSON.stringify(data));}
   if(destination&&!integration){if(!resource.canConnect||!resource.token||resource.stale)fail('Rinnova il consenso di questa credenziale per abilitare il canale.',422);integration=await tx.integration.create({data:{organizationId:org,internalId:resource.externalId,providerIdentifier:resource.platform,type:'social',name:resource.name,profile:resource.handle,token:resource.token,refreshToken:resource.refreshToken||'',rootInternalId:resource.rootId||resource.externalId,tokenExpiration:resource.expiresAt?new Date(Number(resource.expiresAt)):null,inBetweenSteps:false,refreshNeeded:false,additionalSettings:'[]'}});}
   const write=async b=>tx.$executeRawUnsafe("UPDATE brand_hub.documents SET data=$1::jsonb,version=version+1,updated_at=now() WHERE org_id=$2 AND id=$3 AND kind='brand'",JSON.stringify(b.data),org,b.id);
   if(owner&&owner.id!==destination?.id){owner.data.channelIds=owner.data.channelIds.filter(id=>id!==integration.id);await write(owner);}
   if(destination){destination.data.channelIds=[...new Set([...destination.data.channelIds,integration.id])];if(destination.data.channelIds.length>40)fail('Il brand ha raggiunto il limite di 40 canali.');await write(destination);}
   return {brandId:destination?.id||''};
  },{timeout:20000});res.json(result);
 }));
}
module.exports={groupSources,inventoryId,mountCredentialRoutes};
