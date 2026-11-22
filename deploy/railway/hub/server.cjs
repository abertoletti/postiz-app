const path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const dep=createRequire('/app/package.json');
const express=dep('express'), sharp=dep('sharp'), multer=dep('multer');
const {cleanBrand,youtubeDescription,bannerSvg,snapshot,mergeBranding,fail,text,platforms}=require('./domain.cjs');
const base='/app/apps/backend/dist';
const uploadDir='/uploads/.brand-hub';
const uuid=()=>crypto.randomUUID();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
async function mountHub(app) {
  const {AuthMiddleware}=require(base+'/apps/backend/src/services/auth/auth.middleware.js');
  const {PrismaService}=require(base+'/libraries/nestjs-libraries/src/database/prisma/prisma.service.js');
  const auth=app.get(AuthMiddleware,{strict:false}),db=app.get(PrismaService,{strict:false});
  // Separate schema: upstream Prisma db push manages public only.
  await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS brand_hub');
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS brand_hub.documents (org_id text NOT NULL,id text NOT NULL,kind text NOT NULL,version integer NOT NULL DEFAULT 1,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,id))`);
  await fs.mkdir(uploadDir,{recursive:true});
  async function list(org,kind) { return db.$queryRawUnsafe('SELECT id,version,data FROM brand_hub.documents WHERE org_id=$1 AND kind=$2 ORDER BY updated_at DESC',org,kind); }
  async function get(org,id,kind) { const rows=await db.$queryRawUnsafe('SELECT id,version,data FROM brand_hub.documents WHERE org_id=$1 AND id=$2 AND kind=$3',org,id,kind); if(!rows.length) fail('Elemento non trovato.',404); return rows[0]; }
  async function save(org,id,kind,data,version) {
    if(!id) {id=uuid(); await db.$executeRawUnsafe('INSERT INTO brand_hub.documents(org_id,id,kind,data) VALUES($1,$2,$3,$4::jsonb)',org,id,kind,JSON.stringify(data));}
    else {if(!Number.isInteger(version))fail('Versione mancante. Ricarica la pagina.',409);const count=await db.$executeRawUnsafe('UPDATE brand_hub.documents SET data=$1::jsonb,version=version+1,updated_at=now() WHERE org_id=$2 AND id=$3 AND kind=$4 AND version=$5',JSON.stringify(data),org,id,kind,version);if(!count)fail('Questo elemento è stato modificato. Ricarica prima di salvare.',409);}
    return get(org,id,kind);
  }
  async function asset(org,id) { const row=await get(org,id,'asset');return {...row,file:path.join(uploadDir,row.id+'.png')}; }
  async function artwork(org,brand,kind) {
    if(kind==='avatar') {if(!brand.logoId)fail('Carica e scegli un logo prima di esportare l’avatar.');const logo=await asset(org,brand.logoId);return sharp(logo.file).resize(800,800,{fit:'contain',background:'#ffffff'}).png().toBuffer();}
    let image=sharp(Buffer.from(bannerSvg(brand)));
    if(brand.logoId){const logo=await asset(org,brand.logoId);const buffer=await sharp(logo.file).resize(280,280,{fit:'contain',background:'#ffffff00'}).png().toBuffer();image=image.composite([{input:buffer,left:650,top:580}]);}
    return image.png().toBuffer();
  }
  const router=express.Router();
  router.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');next();});
  router.use('/static',express.static(path.join(__dirname,'public'),{index:false}));
  router.use(dep('cookie-parser')());
  router.use(wrap(async(req,res,next)=>{try {await auth.use(req,res,next);}catch {if(req.method==='GET'&&!req.path.startsWith('/api'))res.redirect('/auth/login');else res.status(401).json({error:'Accedi a Brand Hub per continuare.'});}}));
  router.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)){const expected=new URL(process.env.FRONTEND_URL).origin;if(req.headers.origin!==expected)return res.status(403).json({error:'Origine della richiesta non valida.'});const membership=req.org?.users?.[0];if(!membership||membership.disabled)return res.status(403).json({error:'Accesso al workspace non consentito.'});}next();});
  router.use(express.json({limit:'1mb'}));
  router.get('/',(req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://yt3.ggpht.com https://yt3.googleusercontent.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");res.sendFile(path.join(__dirname,'public/index.html'));});
  router.get('/api/state',wrap(async(req,res)=>{const org=req.org.id;const [brands,assets,contents,channels]=await Promise.all([list(org,'brand'),list(org,'asset'),list(org,'content'),db.integration.findMany({where:{organizationId:org,deletedAt:null,inBetweenSteps:false},select:{id:true,name:true,customName:true,providerIdentifier:true,internalId:true,disabled:true,refreshNeeded:true}})]);res.json({user:{name:req.user.name,email:req.user.email},brands,assets,contents,channels});}));
  router.post('/api/brands',wrap(async(req,res)=>res.json(await save(req.org.id,null,'brand',cleanBrand(req.body)))));
  router.put('/api/brands/:id',wrap(async(req,res)=>{
    const existing=await get(req.org.id,req.params.id,'brand'),data=cleanBrand(req.body.data);
    if(data.logoId){const logo=await get(req.org.id,data.logoId,'asset');if(logo.data.brandId!==existing.id)fail('Il logo deve appartenere a questo brand.');}
    const channels=await db.integration.findMany({where:{id:{in:data.channelIds},organizationId:req.org.id,deletedAt:null,inBetweenSteps:false},select:{id:true}});
    if(channels.length!==data.channelIds.length)fail('Un canale selezionato non è disponibile.');
    const others=await list(req.org.id,'brand');if(others.some(b=>b.id!==existing.id&&b.data.channelIds.some(id=>data.channelIds.includes(id))))fail('Questo canale è già assegnato a un altro brand.');
    res.json(await save(req.org.id,existing.id,'brand',data,req.body.version));
  }));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
  router.post('/api/brands/:id/assets',upload.single('file'),wrap(async(req,res)=>{
    await get(req.org.id,req.params.id,'brand');if(!req.file)fail('Scegli un’immagine PNG, JPEG o WebP.');
    if(!['image/png','image/jpeg','image/webp'].includes(req.file.mimetype))fail('Sono supportate immagini PNG, JPEG e WebP.');
    const image=sharp(req.file.buffer,{limitInputPixels:25000000}),info=await image.metadata();if(!['png','jpeg','webp'].includes(info.format))fail('Formato immagine non valido.');
    const png=await image.rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    const row=await save(req.org.id,null,'asset',{brandId:req.params.id,name:text(req.file.originalname,150),role:['logo','photo','cover'].includes(req.body.role)?req.body.role:'photo',width:info.width,height:info.height});
    await fs.writeFile(path.join(uploadDir,row.id+'.png'),png,{flag:'wx'});res.json(row);
  }));
  router.get('/api/assets/:id',wrap(async(req,res)=>{const a=await asset(req.org.id,req.params.id);res.type('png').sendFile(a.file,{dotfiles:'allow'});}));
  router.get('/api/brands/:id/artwork/:kind',wrap(async(req,res)=>{if(!['avatar','banner'].includes(req.params.kind))fail('Formato non disponibile.',404);const {data}=await get(req.org.id,req.params.id,'brand');if(req.query.download)res.attachment(req.params.kind+'.png');res.type('png').send(await artwork(req.org.id,data,req.params.kind));}));
  router.post('/api/contents',wrap(async(req,res)=>{
    await get(req.org.id,req.body.brandId,'brand');const title=text(req.body.title,150);if(!title)fail('Inserisci un titolo.');
    const variants={};for(const platform of platforms)if(req.body.variants?.[platform])variants[platform]={title:text(req.body.variants[platform].title,150),text:text(req.body.variants[platform].text,5000)};
    const data={brandId:req.body.brandId,title,body:text(req.body.body,5000),variants};
    if(req.body.id){const old=await get(req.org.id,req.body.id,'content');if(old.data.brandId!==data.brandId)fail('Brand non valido.');}
    res.json(await save(req.org.id,req.body.id,'content',data,req.body.version));
  }));
  async function youtube(req) {
    const brand=await get(req.org.id,req.params.id,'brand');const channelId=req.body.channelId||req.query.channelId;
    if(!brand.data.channelIds.includes(channelId))fail('Associa prima il canale YouTube al brand.');
    const integration=await db.integration.findFirst({where:{id:channelId,organizationId:req.org.id,providerIdentifier:'youtube',deletedAt:null,inBetweenSteps:false,disabled:false}});
    if(!integration)fail('Canale YouTube non disponibile.');
    const {google}=dep('googleapis');const auth=new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET);
    auth.setCredentials({access_token:integration.token,refresh_token:integration.refreshToken||undefined,expiry_date:integration.tokenExpiration?.getTime()});
    const api=google.youtube({version:'v3',auth});
    const response=await api.channels.list({part:['snippet','brandingSettings'],mine:true});
    const channel=response.data.items?.find(item=>item.id===integration.internalId);
    if(!channel)fail('Il canale autorizzato non corrisponde a quello selezionato. Ricollega YouTube.',409);
    return {brand,api,channel,integration};
  }
  router.get('/api/brands/:id/youtube',wrap(async(req,res)=>{const {brand,channel}=await youtube(req);res.json({id:channel.id,title:channel.snippet.title,description:channel.brandingSettings?.channel?.description||channel.snippet.description||'',snapshot:snapshot(channel),proposedDescription:youtubeDescription(brand.data),brandVersion:brand.version});}));
  require('./connections.cjs').mountConnections({router,db,list,save,wrap,dep});
  const applying=new Set();
  router.post('/api/brands/:id/youtube/apply',wrap(async(req,res)=>{
    if(req.body.confirm!==true)fail('Conferma esplicita richiesta.');const key=req.org.id+':'+req.params.id;if(applying.has(key))fail('Aggiornamento già in corso.',409);applying.add(key);
    try{
      const {brand,api,channel}=await youtube(req);
      if(req.body.brandVersion!==brand.version||req.body.snapshot!==snapshot(channel))fail('Il brand o il canale è cambiato. Ricarica il confronto prima di applicare.',409);
      if(!req.body.description&&!req.body.banner)fail('Seleziona almeno un elemento.');
      let bannerUrl;
      if(req.body.banner){const buffer=await artwork(req.org.id,brand.data,'banner');const uploaded=await api.channelBanners.insert({media:{mimeType:'image/png',body:require('node:stream').Readable.from(buffer)}});bannerUrl=uploaded.data.url;if(!bannerUrl)fail('YouTube non ha restituito il banner. Riprova.',502);}
      const body=mergeBranding(channel,req.body.description?youtubeDescription(brand.data):undefined,bannerUrl);
      await api.channels.update({part:['brandingSettings'],requestBody:body});
      await save(req.org.id,null,'event',{brandId:brand.id,channelId:channel.id,action:'youtube-branding',fields:[req.body.description?'description':null,req.body.banner?'banner':null].filter(Boolean),at:new Date().toISOString()});
      res.json({ok:true,url:'https://www.youtube.com/channel/'+channel.id});
    }finally{applying.delete(key);}
  }));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const googleStatus=error.response?.status;const message=error.status?error.message:error.code==='LIMIT_FILE_SIZE'?'Immagine troppo grande: massimo 10 MB.':googleStatus===403?'YouTube non autorizza questa modifica. Controlla i permessi e ricollega il canale.':googleStatus===401?'Autorizzazione YouTube scaduta. Ricollega il canale.':'Operazione non riuscita. Riprova; i dati già salvati restano disponibili.';console.error('[Brand Hub]',error.status||googleStatus||500,error.code||error.name);res.status(error.status||([401,403].includes(googleStatus)?422:500)).json({error:message});});
  app.use('/hub',router);
  console.log('Brand Hub mounted at /hub/');
}
module.exports={mountHub};
