const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {rewriteFrontend,installPublicIcons}=require('./brand-hub-native-ui.cjs');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function navigation(source){const marker='{name:"Brand Hub",icon:',start=source.indexOf(marker);if(start<0)return source;assert.equal(source.split(marker).length-1,1);const tail='path:"/hub/",onClick:()=>{window.location.assign("/hub/")}}',end=source.indexOf(tail,start)+tail.length;assert.ok(end>start);const brand=source.slice(start,end),calendarPath=source.lastIndexOf('path:"/launches"',start),calendarStart=source.lastIndexOf('{name:',calendarPath),calendarEnd=source.indexOf('}',calendarPath)+1;assert.equal(calendarEnd+1,start,'Expected adjacent Calendar and Hub items');const calendar=source.slice(calendarStart,calendarEnd).replace(/name:[\s\S]*?,icon:/,'name:"Calendario globale",icon:');const jsx=brand.match(/icon:\(0,([\w$]+)\.jsx\)/)[1];const icon=d=>'icon:(0,'+jsx+'.jsx)("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",children:(0,'+jsx+'.jsx)("path",{d:'+JSON.stringify(d)+',stroke:"currentColor",strokeWidth:1.7,strokeLinecap:"round",strokeLinejoin:"round"})}),path:';const brands=brand.replace('name:"Brand Hub"','name:"I tuoi brand"').replace(/icon:[\s\S]+?,path:/,icon('M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'));const connections=brands.replace(/icon:[\s\S]+?,path:/,icon('M9 7H6a5 5 0 0 0 0 10h3m6-10h3a5 5 0 0 1 0 10h-3M8 12h8')).replace('name:"I tuoi brand"','name:"Collegamenti"').replaceAll('/hub/','/hub/#connections');return source.slice(0,calendarStart)+brands+','+connections+','+calendar+source.slice(end);}
function controls(source){
 // Keep the pinned React handlers; change only the element and its accessible name.
 for(const [marker,label] of [['hidden mobile:flex text-btnText','Chiudi canali'],['group-[.sidebar]:rotate-[180deg]','Espandi o riduci canali'],['cursor-pointer h-[44px] px-[12px] bg-btnSimple text-btnText rounded-[8px] flex items-center gap-[8px] select-none','Mostra canali'],['hidden mobile:flex shrink-0 w-[44px] h-[44px] rounded-[8px] bg-btnSimple justify-center items-center cursor-pointer','Seleziona canali'],['hidden mobile:flex shrink-0 w-[32px] h-[44px] justify-end items-center cursor-pointer text-[#A3A3A3]','Impostazioni contenuto'],['hidden mobile:flex shrink-0 w-[32px] h-[44px] justify-end items-center cursor-pointer"','Anteprima contenuto']]){
  const i=source.indexOf(marker);if(i<0)continue;
  const start=source.lastIndexOf(')("div",{',i);assert.ok(start>=0&&i-start<350,'Channel control marker drift');
  source=source.slice(0,start)+source.slice(start).replace(')("div",{',')("button",{type:"button","aria-label":'+JSON.stringify(label)+',"data-hub-channel-control":true,');
 }
 const marker='cursor-pointer border-[2px] relative rounded-full flex justify-center items-center bg-fifth filter transition-all duration-500',i=source.indexOf(marker);
 if(i>=0){const start=source.lastIndexOf(')("div",{onClick:',i),segment=source.slice(start,i+700),click=segment.match(/onClick:[\w$]+\(([\w$]+)\)/),selected=segment.match(/-1===([\w$]+)\.findIndex/);assert.ok(start>=0&&i-start<160&&click&&selected,'Composer channel marker drift');const account=click[1],list=selected[1];source=source.slice(0,start)+source.slice(start).replace(')("div",{',')("button",{type:"button","data-hub-publish-target":true,"aria-label":'+account+'.name+" · "+'+account+'.identifier,"aria-pressed":'+list+'.some(p=>p.integration.id==='+account+'.id),');}
 return source.replaceAll('"Check the circles above"','"Seleziona almeno un canale"');
}
async function install(root='/app/apps/frontend/.next',themeFile=path.join(__dirname,'hub/public/postiz-theme.css')){
 const files=walk(root),renamed=[];let nav=0,cssCount=0,channelControls=0,publishTargets=0;
 const branding={authPanels:0,wordmarks:0};
 for(const file of files){if(!/\.(js|css)$/.test(file))continue;let source=fs.readFileSync(file,'utf8'),changed=false;
  if(file.endsWith('.js')&&source.includes('{name:"Brand Hub",icon:')){source=navigation(source);nav++;changed=true;}
  if(file.endsWith('.js')){const next=controls(source);if(next!==source){source=next;changed=true;channelControls+=Number(source.includes('"data-hub-channel-control":true'));publishTargets+=Number(source.includes('"data-hub-publish-target":true'));}}
  if(file.endsWith('.js')){const next=rewriteFrontend(source,branding);if(next!==source){source=next;changed=true;}}
  if(file.endsWith('.css')&&source.includes('--new-btn-primary:')){source+='\n'+fs.readFileSync(themeFile,'utf8');cssCount++;changed=true;}
  if(!changed)continue;fs.writeFileSync(file,source);if(file.startsWith(path.join(root,'static')+path.sep)){const name=path.basename(file),hash=crypto.createHash('sha256').update(source).digest('hex').slice(0,12),next=name.replace(/\.(js|css)$/,'.brandhub-'+hash+'.$1');fs.renameSync(file,path.join(path.dirname(file),next));renamed.push([name,next]);}
 }
 assert.equal(nav,2,'Expected matching SSR and browser menu copies');assert.ok(cssCount>=1&&cssCount<=4,'Global theme entry changed');
 assert.ok(channelControls>=2&&publishTargets>=2,'Expected SSR and browser channel controls');
 assert.equal(branding.authPanels,1,'Expected the shared authentication layout promotion');
 assert.ok(branding.wordmarks>=2,'Expected SSR and browser wordmarks');
 for(const file of walk(root)){if(!/\.(js|json|html|rsc|txt|meta)$/.test(file))continue;const old=fs.readFileSync(file,'utf8');let source=old;for(const [a,b]of renamed)source=source.replaceAll(a,b);if(old!==source)fs.writeFileSync(file,source);}
 assert.ok(renamed.some(([name])=>name.endsWith('.css')));
 await installPublicIcons(path.dirname(root),path.join(path.dirname(themeFile),'logo.svg'));
 console.log('Installed Brand Hub UI:',nav,'navigation copies;',cssCount,'stylesheets;',branding.wordmarks,'wordmarks.');
}
module.exports={navigation,controls,install};if(require.main===module)install().catch(error=>{console.error(error);process.exitCode=1;});
