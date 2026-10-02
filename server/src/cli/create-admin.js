import 'dotenv/config';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {stdin as input,stdout as output} from 'node:process';
import bcrypt from 'bcryptjs';
import {pool,q} from '../db.js';

const hiddenOutput=new Writable({write(_chunk,_encoding,callback){callback();}});
const weakPasswords=new Set(['password','password123','123456789012','qwerty123456','admin123456','letmein123456']);
const ask=async(prompt,muted=false)=>{
  const promptRl=readline.createInterface({input,output:muted?hiddenOutput:output,terminal:Boolean(input.isTTY)});
  try{return await promptRl.question(prompt);}finally{promptRl.close();}
};
const confirm=async prompt=>(await ask(prompt)).trim().toLowerCase()==='y';
const readSecret=async prompt=>{
  output.write(prompt);
  return ask('',true);
};

try{
  const username=(await ask('Admin username/email: ')).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)&&!/^[a-zA-Z0-9._-]{3,190}$/.test(username))throw new Error('Invalid username');
  const password=await readSecret('Admin password (min 12 characters): ');
  const confirmation=await readSecret('Confirm admin password: ');
  if(password!==confirmation)throw new Error('Passwords do not match');
  if(password.length<12)throw new Error('Password must be at least 12 characters');
  if(weakPasswords.has(password.toLowerCase()))throw new Error('Choose a less common password');

  const existing=await q('SELECT id,status FROM users WHERE username=$1',[username]);
  let status='active';
  if(existing.rowCount){
    if(!(await confirm('This account exists. Overwrite its password? (y/N): ')))throw new Error('Admin update cancelled');
    if(existing.rows[0].status==='disabled'&&!(await confirm('This account is disabled. Explicitly reactivate it? (y/N): ')))throw new Error('Disabled account remains disabled');
  }
  const hash=await bcrypt.hash(password,12);
  await q(`INSERT INTO users(username,password_hash,status) VALUES($1,$2,$3)
    ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,status=EXCLUDED.status,updated_at=NOW()`,[username,hash,status]);
  console.log('Admin created/updated successfully.');
}finally{
  await pool.end();
}
