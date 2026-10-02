import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=path.resolve('client/images');
const output=path.join(root,'optimized');
const images=[['hero.jpg',1600],['garden.jpg',900],['pool.jpg',900],['sports.jpg',1000]];
await fs.mkdir(output,{recursive:true});

for(const [name,width] of images){
  const input=path.join(root,name);
  const pipeline=sharp(input,{failOn:'error'}).rotate().resize({width,height:1600,fit:'inside',withoutEnlargement:true});
  await Promise.all([
    pipeline.clone().webp({quality:80,effort:5}).toFile(path.join(output,name.replace(/\.jpg$/i,'.webp'))),
    pipeline.clone().avif({quality:55,effort:5}).toFile(path.join(output,name.replace(/\.jpg$/i,'.avif')))
  ]);
  console.log(`Optimized ${name}`);
}
