import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=await fs.realpath(process.env.CHECK_DIST_ROOT?path.resolve(process.env.CHECK_DIST_ROOT):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client/dist'));
const files=(await fs.readdir(root)).filter(name=>name.endsWith('.html'));
const failures=[];
for(const file of files){
  const html=await fs.readFile(path.join(root,file),'utf8');
  const inlineScript=/\btype\s*=\s*(["'])application\/ld\+json\1/i;
  if(/<style\b|\sstyle\s*=|\son[a-z]+\s*=/i.test(html)||[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].some(match=>!/\bsrc\s*=/i.test(match[1])&&!inlineScript.test(match[1])))failures.push(`${file}: inline styles, scripts, or event handlers are not allowed`);
  const refs=[];
  for(const match of html.matchAll(/\b(src|href|srcset)\s*=\s*["']([^"']*)["']/gi)){
    const attr=match[1].toLowerCase();
    if(attr==='srcset')for(const item of match[2].split(','))refs.push(item.trim().split(/\s+/,1)[0]);
    else refs.push(match[2]);
  }
  for(const ref of refs){
    if(!ref||ref.startsWith('#')||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref))continue;
    const pathname=decodeURIComponent(ref.split(/[?#]/,1)[0]);
    const target=path.resolve(root,pathname.startsWith('/')?`.${pathname}`:path.join(path.dirname(file),pathname));
    const relative=path.relative(root,target);
    if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)){failures.push(`${file}: unsafe local path ${ref}`);continue;}
    try{
      const stat=await fs.stat(target);
      const resolved=stat.isDirectory()?path.join(target,'index.html'):target;
      const resolvedStat=await fs.stat(resolved);
      const real=await fs.realpath(resolved);
      const realRelative=path.relative(root,real);
      if(realRelative==='..'||realRelative.startsWith(`..${path.sep}`)||path.isAbsolute(realRelative))failures.push(`${file}: unsafe local path ${ref}`);
      else if(!resolvedStat.isFile())failures.push(`${file}: missing ${ref}`);
    }catch{failures.push(`${file}: missing ${ref}`);}
  }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Checked local HTML links in ${files.length} built pages.`);
