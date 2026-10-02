import fs from 'node:fs/promises';

const html=(await fs.readFile('client/index.html','utf8')).replace(/<!--[\s\S]*?-->/g,'');
const source=await fs.readFile('client/i18n.js','utf8');
const literal=source.match(/const I18N\s*=\s*(\{[^\r\n]*\})/)?.[1];
if(!literal)throw new Error('Could not find I18N dictionary.');
const dictionary=JSON.parse(literal);
const known=new Set(Object.keys(dictionary));
for(const match of source.matchAll(/'([^']+)':/g)){if(/[\u0600-\u06ff]/.test(match[1]))known.add(match[1]);}
const missing=new Set();
let inSvg=false;
for(const token of html.matchAll(/<\/?svg\b[^>]*>|>([^<>]+)</gi)){
  if(/^<\/?svg\b/i.test(token[0])){inSvg=!/^<\/svg/i.test(token[0]);continue;}
  if(inSvg)continue;
  const text=token[1]?.replace(/\s+/g,' ').trim();
  if(text&&/[\u0600-\u06ff]/.test(text)&&!known.has(text))missing.add(text);
}
if(missing.size){console.error(`Arabic text nodes missing I18N keys:\n${[...missing].join('\n')}`);process.exitCode=1;}
else console.log('All Arabic text nodes in client/index.html have I18N keys.');
