import path from 'node:path';
import sharp from 'sharp';
import fs from 'node:fs/promises';

const input=path.resolve('client/images/optimized/hero.webp');
const output=path.resolve('client/public');
const force=process.argv.includes('--force');
async function render(source,destination,resize,format,fit='contain'){
  if(!force){try{await fs.access(destination);return;}catch{}}
  let image=sharp(source).resize({...resize,fit,background:{r:255,g:255,b:255,alpha:0}});
  if(format==='jpeg')image=image.jpeg({quality:84,mozjpeg:true});else image=image.png({compressionLevel:9});
  await image.toFile(destination);
}
await render(input,path.join(output,'og-image.jpg'),{width:1200,height:630},'jpeg','cover');
await render(path.join(output,'favicon.svg'),path.join(output,'favicon.png'),{width:64,height:64},'png');
await render(path.join(output,'favicon.svg'),path.join(output,'apple-touch-icon.png'),{width:180,height:180},'png');
