import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from '../db.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(here,'../../../database/migrations');
const lock=await pool.connect();
const ADVISORY_LOCK=728391204;

try{
  await lock.query('SELECT pg_advisory_lock($1)',[ADVISORY_LOCK]);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  const files=(await fs.readdir(dir))
    .filter(f=>/^\d+_[A-Za-z0-9._-]+\.sql$/.test(f))
    .sort();

  for(const file of files){
    const exists=await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1',[file]);
    if(exists.rowCount) continue;

    const sql=await fs.readFile(path.join(dir,file),'utf8');
    const client=await pool.connect();
    try{
      console.log(`Applying ${file}...`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    }catch(err){
      await client.query('ROLLBACK').catch(()=>{});
      throw err;
    }finally{client.release();}
  }
  console.log('Database migrations complete.');
}finally{
  await lock.query('SELECT pg_advisory_unlock($1)',[ADVISORY_LOCK]).catch(()=>{});
  lock.release();
  await pool.end();
}
