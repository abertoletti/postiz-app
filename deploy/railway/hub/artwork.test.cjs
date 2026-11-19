const assert=require('node:assert/strict');
const sharp=require(require('node:module').createRequire('/app/package.json').resolve('sharp'));
const {bannerSvg,cleanBrand}=require('./domain.cjs');
(async()=>{
 const svg=bannerSvg(cleanBrand({name:'Example Brand',tagline:'A clear identity on every channel'}));
 const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let count=0,minX=2560,maxX=0,minY=1440,maxY=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const offset=(y*info.width+x)*4;if(data[offset]>245&&data[offset+1]>245&&data[offset+2]>245){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
 assert.ok(count>4000,'Text did not render: check installed fonts');
 assert.ok(maxX-minX>350,'Text rendered at an unreadable width');
 assert.ok(minX>=508&&maxX<=2052&&minY>=509&&maxY<=931,'Brand title must remain in YouTube safe area');
 console.log('Banner raster test passed: readable title, correct safe area and installed font.');
})().catch(error=>{console.error(error);process.exitCode=1;});
