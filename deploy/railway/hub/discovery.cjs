const crypto=require('node:crypto');
const {fail}=require('./domain.cjs');
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function websiteHost(s){try{return new URL(s).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
const resourceKey=r=>r.platform+':'+r.externalId;
function propose(resources,brands){
  const groups=[];
  for(const r of resources){
    const owner=brands.find(b=>r.integrationId&&b.data.channelIds.includes(r.integrationId));
    const matches=owner?[owner]:brands.filter(b=>normalize(b.data.name)===normalize(r.name)||(websiteHost(r.website)&&websiteHost(r.website)===websiteHost(b.data.website)));
    const match=matches.length===1?matches[0]:null;
    // An explicit Page/Instagram relationship is stronger than a matching name.
    let group=groups.find(g=>r.pageId&&g.resources.some(x=>x.pageId===r.pageId)&&(!match||!g.brandId||g.brandId===match.id));
    if(!group)group=groups.find(g=>match?g.brandId===match.id:!g.brandId&&normalize(g.name)===normalize(r.name));
    if(!group){group={id:resourceKey(r),name:r.name,brandId:match?.id||'',reason:owner?'Già associato':match?'Nome o sito corrispondente':matches.length>1?'Più brand compatibili: scegli tu':'Nuovo brand proposto',resources:[]};groups.push(group);}
    if(match&&!group.brandId){group.brandId=match.id;group.name=match.data.name;group.reason='Collegamento tra Pagina e Instagram';}
    group.resources.push(r);
  }
  return groups;
}
function seal(value,secret,context){const key=crypto.createHash('sha256').update(secret).digest(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');}
function unseal(value,secret,context){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url')),cipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]));}
async function graph(route,token,params={}){
  const url=new URL('https://graph.facebook.com/v25.0/'+route);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const result=await response.json();
  if(!response.ok||result.error)fail(result.error?.code===190?'Accesso Meta scaduto: ricollega Meta.':'Meta non consente il recupero di queste risorse. Controlla le Pagine selezionate e i permessi.',422);
  return result;
}
async function graphList(route,token,params={}){let after,items=[];for(let i=0;i<50;i++){const r=await graph(route,token,{...params,limit:'100',...(after?{after}:{})});items.push(...r.data||[]);if(!r.paging?.next)return items;after=r.paging?.cursors?.after;if(!after)fail('Elenco Meta incompleto. Riprova.',422);}fail('Troppe risorse per una singola importazione.',422);}
async function pagesFromMetaGrant(token,fields,warnings){
  const appId=process.env.FACEBOOK_APP_ID,appSecret=process.env.FACEBOOK_APP_SECRET;
  if(!appId||!appSecret)return [];
  const {data}=await graph('debug_token',appId+'|'+appSecret,{input_token:token});
  if(!data?.is_valid||String(data.app_id)!==appId)return [];

  const targetIds=scope=>new Set((data.granular_scopes||[])
    .filter(grant=>grant.scope===scope)
    .flatMap(grant=>grant.target_ids||[])
    .map(String)
    .filter(id=>/^\d+$/.test(id)));
  const instagramIds=targetIds('instagram_basic');
  const results=await Promise.allSettled([...targetIds('pages_show_list')].map(id=>graph(id,token,{fields})));
  if(results.some(result=>result.status==='rejected'))warnings.push('Alcune Pagine selezionate non sono accessibili con questo consenso.');
  return results.flatMap(result=>{
    if(result.status==='rejected')return [];
    const page=result.value;
    const instagram=page.instagram_business_account;
    return [{...page,instagram_business_account:instagramIds.has(String(instagram?.id))?instagram:undefined}];
  });
}
async function discoverMeta(source){
  const token=source.refreshToken||source.token,resources=[],warnings=[];
  const identity=await graph('me',token,{fields:'id,name'});
  const granted=await graphList('me/permissions',token);const permissions=new Set(granted.filter(p=>p.status==='granted').map(p=>p.permission));
  const pageFields='id,name,about,website,username,access_token'+(permissions.has('instagram_basic')?',instagram_business_account{id,name,username,biography,website}':'');
  const fields=pageFields+',tasks';
  const pages=new Map();const collect=(list,container)=>{for(const p of list){const old=pages.get(p.id);pages.set(p.id,{...old,...p,access_token:p.access_token||old?.access_token,container:container||old?.container||'Pagine accessibili'});}};
  collect(await graphList('me/accounts',token,{fields}));
  if(permissions.has('business_management')){try{const businesses=await graphList('me/businesses',token,{fields:'id,name'});for(const b of businesses){for(const edge of ['owned_pages','client_pages'])try{collect(await graphList(b.id+'/'+edge,token,{fields}),b.name);}catch{warnings.push('Alcune Pagine del portfolio '+b.name+' non sono accessibili.');}}}catch{warnings.push('Portfolio business non recuperabili; mostriamo le Pagine accessibili direttamente.');}}
  // Meta may omit individually authorized Pages from /me/accounts.
  if(!pages.size&&permissions.has('pages_show_list')){
    try{collect(await pagesFromMetaGrant(token,pageFields,warnings));}
    catch{warnings.push('Le Pagine selezionate nel consenso Meta non sono verificabili.');}
  }
  for(const p of pages.values()){
    resources.push({platform:'facebook',externalId:String(p.id),name:p.name,description:p.about||'',website:p.website||'',handle:p.username||'',pageId:String(p.id),container:p.container,canConnect:!!p.access_token&&permissions.has('pages_manage_posts')&&(!p.tasks||p.tasks.includes('CREATE_CONTENT')||p.tasks.includes('MANAGE')),token:p.access_token,refreshToken:token,rootId:identity.id,expiresAt:source.expiresAt});
    const ig=p.instagram_business_account;if(ig)resources.push({platform:'instagram',externalId:String(ig.id),name:ig.name||ig.username,description:ig.biography||'',website:ig.website||'',handle:ig.username||'',pageId:String(p.id),container:p.container,canConnect:permissions.has('instagram_content_publish'),token,refreshToken:token,rootId:identity.id,expiresAt:source.expiresAt});
  }
  return {identity:identity.name,resources,warnings};
}
async function discoverGoogle(source,google){
  const client=new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET);
  client.setCredentials({access_token:source.token,refresh_token:source.refreshToken||undefined,expiry_date:source.expiresAt?Number(source.expiresAt):undefined});
  let items=[],pageToken;do{const r=await google.youtube({version:'v3',auth:client}).channels.list({part:['snippet','brandingSettings'],mine:true,maxResults:50,pageToken},{timeout:20000});items.push(...r.data.items||[]);pageToken=r.data.nextPageToken;}while(pageToken);
  return {identity:source.name||'Google / YouTube',warnings:[],resources:items.map(c=>({platform:'youtube',externalId:c.id,name:c.snippet.title,description:c.snippet.description||'',website:'',handle:c.snippet.customUrl||'',container:'Canale autorizzato con Google',canConnect:true,token:client.credentials.access_token,refreshToken:client.credentials.refresh_token||source.refreshToken,expiresAt:client.credentials.expiry_date,rootId:source.rootId||c.id}))};
}
function publicResource(r){return Object.fromEntries(['platform','externalId','name','description','website','handle','pageId','container','canConnect','integrationId','assignedBrandId','connectionId'].map(k=>[k,r[k]]));}
module.exports={normalize,resourceKey,propose,seal,unseal,discoverMeta,discoverGoogle,publicResource};
