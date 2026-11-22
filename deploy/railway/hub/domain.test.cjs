const {test}=require('node:test'),assert=require('node:assert/strict');
const {cleanBrand,youtubeDescription,bannerSvg,mergeBranding,snapshot}=require('./domain.cjs');
test('Brand input remains generic and rejects unsafe values',()=>{
  assert.throws(()=>cleanBrand({name:' '}));
  assert.throws(()=>cleanBrand({name:'Example',website:'javascript:alert(1)'}));
  const b=cleanBrand({name:'  Example ',color:'red"/><script>',channelIds:['a','a'],logoId:'../../etc/passwd'});
  assert.equal(b.name,'Example');assert.equal(b.color,'#315c50');assert.equal(b.logoId,'');assert.deepEqual(b.channelIds,['a']);
});
test('YouTube description respects override and platform limit',()=>{
  assert.equal(youtubeDescription({description:'About',cta:'Discover',website:'https://example.com'}),'About\n\nDiscover\n\nhttps://example.com');
  assert.equal(youtubeDescription({youtubeDescription:'x'.repeat(1200)}).length,1000);
  assert.equal(youtubeDescription({youtubeDescription:'Approved',description:'Changed'}),'Approved');
});
test('Artwork escapes user text instead of executing SVG markup',()=>{
  const svg=bannerSvg(cleanBrand({name:'<script>alert(1)</script>',tagline:'A & B'}));
  assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));assert.ok(svg.includes('A &amp; B'));
  assert.ok(svg.includes('width="2560" height="1440"'));
});
test('YouTube updates preserve unrelated settings and do not mutate fetched data',()=>{
  const old={id:'channel',brandingSettings:{channel:{title:'Existing',country:'IT',keywords:'keep',description:'Old'},image:{bannerExternalUrl:'old'},watch:{textColor:'#fff'}}};
  const before=structuredClone(old),s=snapshot(old);
  const update=mergeBranding(old,'New','https://example.com/banner');
  assert.deepEqual(old,before);assert.equal(update.brandingSettings.channel.title,'Existing');assert.equal(update.brandingSettings.channel.country,'IT');assert.equal(update.brandingSettings.watch.textColor,'#fff');assert.equal(update.brandingSettings.channel.description,'New');assert.notEqual(snapshot(update),s);
  assert.equal(mergeBranding(old,undefined,'new').brandingSettings.channel.description,'Old');
});
