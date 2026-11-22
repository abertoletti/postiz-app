const crypto = require('node:crypto');
const platforms = ['youtube','instagram','facebook','tiktok','linkedin','x'];
function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
function text(value, max=4000) { return String(value ?? '').trim().slice(0,max); }
function cleanBrand(input) {
  const name=text(input.name,100); if(!name) fail('Inserisci il nome del brand.');
  const website=text(input.website,500);
  if(website && !/^https?:\/\//.test(website)) fail('Il sito deve iniziare con https:// o http://.');
  if(website) { try { new URL(website); } catch { fail('Indirizzo del sito non valido.'); } }
  const result={name,website};
  for(const key of ['tagline','description','audience','tone','cta','keywords','youtubeDescription']) result[key]=text(input[key],key==='youtubeDescription'?1000:4000);
  for(const [key,fallback] of [['color','#315c50'],['accent','#d8f36a']]) result[key]=/^#[0-9a-f]{6}$/i.test(input[key]||'')?input[key]:fallback;
  result.logoId=/^[a-f0-9-]{36}$/.test(input.logoId||'')?input.logoId:'';
  result.channelIds=Array.isArray(input.channelIds)?[...new Set(input.channelIds.filter(x=>typeof x==='string'))].slice(0,40):[];
  return result;
}
function youtubeDescription(brand) { return (brand.youtubeDescription || [brand.description,brand.cta,brand.website].filter(Boolean).join('\n\n')).slice(0,1000); }
function escapeXml(s) { return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function bannerSvg(brand) {
  // 2560x1440, critical elements inside the central 1544x422 safe rectangle.
  const name=escapeXml(brand.name),tag=escapeXml(brand.tagline.slice(0,70));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440"><rect width="2560" height="1440" fill="${brand.color}"/><circle cx="2360" cy="200" r="650" fill="${brand.accent}" opacity=".16"/><circle cx="160" cy="1440" r="560" fill="${brand.accent}" opacity=".1"/><path d="M0 1180 Q1280 800 2560 1200" stroke="${brand.accent}" stroke-width="2" fill="none" opacity=".3"/><text x="${brand.logoId?1030:1280}" y="710" text-anchor="${brand.logoId?'start':'middle'}" fill="white" font-family="DejaVu Sans,sans-serif" font-weight="bold" font-size="${Math.min(72,Math.floor((brand.logoId?1000:1450)/Math.max(1,brand.name.length)/.7))}">${name.slice(0,150)}</text><text x="${brand.logoId?1030:1280}" y="795" text-anchor="${brand.logoId?'start':'middle'}" fill="${brand.accent}" font-family="DejaVu Sans,sans-serif" font-size="${Math.min(30,Math.floor((brand.logoId?1000:1450)/Math.max(1,brand.tagline.slice(0,70).length)/.6))}">${tag}</text></svg>`;
}
function snapshot(channel) { return crypto.createHash('sha256').update(JSON.stringify(channel.brandingSettings||{})).digest('hex'); }
function mergeBranding(channel,description,bannerUrl) {
  const settings=structuredClone(channel.brandingSettings||{});
  if(description!==undefined) settings.channel={...settings.channel,description};
  if(bannerUrl) settings.image={...settings.image,bannerExternalUrl:bannerUrl};
  return {id:channel.id,brandingSettings:settings};
}
module.exports={platforms,fail,text,cleanBrand,youtubeDescription,bannerSvg,snapshot,mergeBranding};
