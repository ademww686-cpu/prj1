import 'dotenv/config';
import pg from 'pg';
const {Pool}=pg;

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const ssl=process.env.DATABASE_SSL==='true'
  ? {rejectUnauthorized:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED!=='false'}
  : undefined;

export const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  max:Number(process.env.DB_POOL_MAX||10),
  idleTimeoutMillis:30000,
  connectionTimeoutMillis:5000,
  ssl
});

pool.on('error',err=>console.error('Unexpected PostgreSQL pool error',err));
export const q=(text,params=[])=>pool.query(text,params);
