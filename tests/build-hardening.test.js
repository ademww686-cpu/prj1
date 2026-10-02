import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checker=path.join(project,'scripts/check-dist-links.mjs');

test('404 page uses external CSS and no inline styles',async()=>{
  const html=await fs.readFile(path.join(project,'client/404.html'),'utf8');
  assert.match(html,/<link[^>]+href="404\.css"/);
  assert.match(html,/<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html,/<style\b|\sstyle\s*=/i);
});

test('built HTML link checker accepts root directories and rejects missing or inline content',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'farm-dist-check-'));
  try{
    await fs.mkdir(path.join(root,'nested'));
    await fs.writeFile(path.join(root,'index.html'),'<main>home</main>');
    const page=path.join(root,'page.html');
    await fs.writeFile(page,'<a href="/">home</a>');
    const run=()=>spawnSync(process.execPath,[checker],{encoding:'utf8',env:{...process.env,CHECK_DIST_ROOT:root}});
    assert.equal(run().status,0);
    await fs.writeFile(page,'<a href="/nope.png">broken</a>');
    assert.notEqual(run().status,0);
    await fs.writeFile(page,'<a href="/../outside.png">outside</a>');
    assert.notEqual(run().status,0);
    await fs.writeFile(page,'<style>body{color:red}</style>');
    assert.notEqual(run().status,0);
    await fs.writeFile(page,'<script>bad()</script>');
    assert.notEqual(run().status,0);
    await fs.writeFile(page,'<script type="application/ld+json">{}</script>');
    assert.equal(run().status,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
