import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import multer from 'multer';
import sharp from 'sharp';
import {v2 as cloudinary} from 'cloudinary';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {pool,q} from './db.js';
import {requireAdmin} from './middleware/auth.js';
import {createPublicCsrfToken,verifyCsrf} from './middleware/security.js';
import {algiersDateOffset,validDateTime} from './booking-time.js';

const app=express();
const PORT=Number(process.env.PORT||3000);
const BOOKING_MAX_DAYS_AHEAD=Number(process.env.BOOKING_MAX_DAYS_AHEAD||365);
if(!Number.isInteger(BOOKING_MAX_DAYS_AHEAD)||BOOKING_MAX_DAYS_AHEAD<1)throw new Error('BOOKING_MAX_DAYS_AHEAD must be a positive integer.');
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw new Error('SESSION_SECRET must be at least 32 characters');
if(process.env.NODE_ENV==='production'&&process.env.SESSION_SECRET==='REPLACE_WITH_64_PLUS_RANDOM_CHARACTERS')throw new Error('Production requires a strong SESSION_SECRET, not the placeholder.');
if(process.env.NODE_ENV==='production'&&/CHANGE_ME/i.test(process.env.DATABASE_URL))throw new Error('Production DATABASE_URL must not contain CHANGE_ME.');
if(process.env.NODE_ENV==='production'&&process.env.TRUST_PROXY!=='1')throw new Error('Production TRUST_PROXY must be 1 behind the configured Nginx reverse proxy; set TRUST_PROXY=1.');
const productionOriginEntries=process.env.CORS_ORIGIN?.split(',').map(value=>value.trim())||[];
const productionOrigins=productionOriginEntries.filter(Boolean);
if(process.env.NODE_ENV==='production'){
  if(!productionOrigins.length||productionOrigins.length!==productionOriginEntries.length||process.env.CORS_ORIGIN==='*')throw new Error('CORS_ORIGIN must list one or more public HTTPS origins, separated by commas, with no empty entries.');
  for(const origin of productionOrigins){
    let parsed;
    try{parsed=new URL(origin);}catch{throw new Error(`Invalid CORS_ORIGIN entry "${origin}". Use an https:// origin without a path or trailing slash.`);}
    if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.pathname!=='/'||parsed.search||parsed.hash||/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(parsed.hostname))throw new Error(`Invalid CORS_ORIGIN entry "${origin}". Production entries must be public https:// origins without a path or trailing slash.`);
  }
}
const SERVER_SRC=path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT=path.resolve(SERVER_SRC,'../..');
const CLIENT_DIST=path.join(PROJECT_ROOT,'client','dist');
const UPLOAD_DIR=path.isAbsolute(process.env.UPLOAD_DIR||'')
  ? process.env.UPLOAD_DIR
  : path.resolve(PROJECT_ROOT,process.env.UPLOAD_DIR||'storage/uploads');
fs.mkdirSync(UPLOAD_DIR,{recursive:true});

const CLOUDINARY_ENABLED=Boolean(process.env.CLOUDINARY_CLOUD_NAME&&process.env.CLOUDINARY_API_KEY&&process.env.CLOUDINARY_API_SECRET);
if(process.env.NODE_ENV==='production' && !CLOUDINARY_ENABLED) throw new Error('Cloudinary credentials are required in production; set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
if(CLOUDINARY_ENABLED) cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});
const CLOUDINARY_FOLDER=(process.env.CLOUDINARY_FOLDER||'model-farm/site-images').replace(/^\/+|\/+$/g,'');
function cloudinaryUpload(buffer,publicId){return new Promise((resolve,reject)=>{const stream=cloudinary.uploader.upload_stream({public_id:publicId,folder:CLOUDINARY_FOLDER,resource_type:'image',overwrite:true,unique_filename:false,use_filename:false,invalidate:true},(err,result)=>err?reject(err):resolve(result));stream.end(buffer);});}
function cloudinaryUrl(publicId,format){return cloudinary.url(publicId,{secure:true,resource_type:'image',format,transformation:[{width:2400,height:2400,crop:'limit',quality:'auto',fetch_format:'auto'}]});}

if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(pinoHttp({redact:{paths:['req.headers.cookie','req.headers.authorization','req.headers["x-csrf-token"]','res.headers["set-cookie"]'],censor:'[redacted]'}}));

app.use(helmet({
  contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],baseUri:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],
    scriptSrc:["'self'",...(process.env.TURNSTILE_SECRET_KEY?['https://challenges.cloudflare.com']:[])],styleSrc:["'self'","https://fonts.googleapis.com"],
    fontSrc:["'self'","https://fonts.gstatic.com"],imgSrc:["'self'","data:","https://res.cloudinary.com"],
    frameSrc:["https://www.google.com",...(process.env.TURNSTILE_SECRET_KEY?['https://challenges.cloudflare.com']:[])],connectSrc:["'self'",...(process.env.TURNSTILE_SECRET_KEY?['https://challenges.cloudflare.com']:[])],formAction:["'self'"],
    upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null
  }},
  referrerPolicy:{policy:'strict-origin-when-cross-origin'},
  frameguard:{action:'deny'},
  crossOriginEmbedderPolicy:false,
  hsts:process.env.NODE_ENV==='production'?undefined:false
}));
app.use((req,res,next)=>{res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');next();});

const allowedOrigins=new Set([
  ...(process.env.NODE_ENV==='production'?productionOrigins:[process.env.CORS_ORIGIN]),
  ...(process.env.NODE_ENV==='production'?[]:['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3000','http://127.0.0.1:3000'])
].filter(Boolean));
app.use(['/api/admin','/api/auth'],(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use(cors({origin:(o,cb)=>!o||allowedOrigins.has(o)?cb(null,true):cb(new Error('CORS blocked')),credentials:true}));
const bookingAttemptLimiter=rateLimit({windowMs:10*60*1000,max:30,standardHeaders:true,legacyHeaders:false,message:{error:'Too many booking requests. Try again later.'}});
app.use('/api/bookings',(req,res,next)=>req.method==='POST'?bookingAttemptLimiter(req,res,next):next());
app.use(express.json({limit:'64kb'}));
app.use(express.urlencoded({extended:false,limit:'32kb'}));

const PgStore=pgSession(session);
app.use(session({
  name:'farm.sid',
  store:new PgStore({pool,tableName:'user_sessions',createTableIfMissing:true,pruneSessionInterval:15*60}),
  secret:process.env.SESSION_SECRET,
  resave:false,saveUninitialized:false,rolling:true,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:30*60*1000,path:'/'}
}));

const authLimiter=rateLimit({windowMs:15*60*1000,max:8,skipSuccessfulRequests:true,standardHeaders:true,legacyHeaders:false,message:{error:'Too many login attempts. Try again later.'}});
const bookingSuccessLimiter=rateLimit({windowMs:60*60*1000,max:5,skipFailedRequests:true,standardHeaders:true,legacyHeaders:false,message:{error:'Booking limit reached. Please try again later.'}});
const adminLimiter=rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false});
const publicApiLimiter=rateLimit({windowMs:60*1000,max:120,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests. Please try again later.'}});
app.use('/api',publicApiLimiter);
app.use('/api/admin',adminLimiter);

const bookingSchema=z.object({
 fullName:z.string().trim().min(2).max(100),
 phone:z.string().trim().regex(/^[0-9+\s()\-]{8,20}$/),
 email:z.string().trim().email().max(254).optional().or(z.literal('')),
 visitors:z.coerce.number().int().min(1).max(1000),
 bookingType:z.string().trim().min(1).max(80),
 date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 time:z.string().regex(/^\d{2}:\d{2}$/),
 message:z.string().trim().max(1000).optional().default(''),
 companyWebsite:z.string().max(200).optional().default(''),
 'cf-turnstile-response':z.string().optional().default('')
});
const statusSchema=z.object({status:z.enum(['pending','confirmed','rejected','completed'])});

const DUMMY_HASH=bcrypt.hashSync(`dummy-password-${crypto.randomUUID()}`,12);
async function ensureConfiguredAdmin(){
  const username=(process.env.ADMIN_USERNAME||'').trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD||'';
  if(!username&&!password)return;
  if(!/^[a-zA-Z0-9._-]{3,190}$/.test(username)||password.length<12)throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured with a valid username and a password of at least 12 characters.');
  const passwordHash=await bcrypt.hash(password,12);
  await q(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,'admin','active')
    ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin',status='active',updated_at=NOW()`,[username,passwordHash]);
  console.log(`Configured admin account '${username}' is ready.`);
}
async function audit(req,action,targetId=null,metadata=null){
  try{await q('INSERT INTO audit_logs(user_id,action,target_id,metadata) VALUES($1,$2,$3,$4)',[req.session?.userId||null,action,targetId,metadata]);}
  catch(e){req.log.error(e,'audit log failed');}
}

app.get('/api/health',async(req,res)=>{
  try{await q('SELECT 1');res.status(200).json({ok:true});}
  catch(e){req.log.error({err:e},'database health check failed');res.status(503).json({ok:false,error:'Database unavailable'});}
});
app.get('/api/auth/csrf',(req,res)=>{
  if(req.session?.userId){
    if(!req.session.csrfToken) req.session.csrfToken=crypto.randomBytes(32).toString('hex');
    return res.json({csrfToken:req.session.csrfToken});
  }
  const token=createPublicCsrfToken();
  res.cookie('farm.csrf',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:2*60*60*1000});
  res.json({csrfToken:token});
});
app.get('/api/images',async(req,res,next)=>{
  try{const r=await q('SELECT slot_key,storage_name,storage_provider,storage_url FROM site_images');const payload={images:Object.fromEntries(r.rows.map(x=>x.storage_provider==='cloudinary'&&x.storage_name?[x.slot_key,{webp:cloudinaryUrl(x.storage_name,'webp'),avif:cloudinaryUrl(x.storage_name,'avif')}]:[x.slot_key,{webp:`/uploads/${encodeURIComponent(x.storage_name)}`}]))};res.set('Cache-Control','public, max-age=60, stale-while-revalidate=300');res.set('ETag',`W/"${crypto.createHash('sha1').update(JSON.stringify(payload)).digest('base64url')}"`);res.json(payload);}
  catch(e){next(e);}
});
app.get('/api/auth/me',async(req,res,next)=>{
  try{
    if(!req.session?.userId) return res.json({authenticated:false});
    const r=await q('SELECT id,username,role,status FROM users WHERE id=$1',[req.session.userId]);
    if(!r.rowCount||r.rows[0].status!=='active'){req.session.destroy(()=>{});return res.json({authenticated:false});}
    res.json({authenticated:true,user:r.rows[0]});
  }catch(e){next(e);}
});

app.post('/api/auth/login',authLimiter,verifyCsrf,async(req,res,next)=>{
  try{
    const parsed=z.object({username:z.string().trim().min(3).max(190),password:z.string().min(1).max(200)}).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({error:'Invalid credentials'});
    const username=parsed.data.username.toLowerCase();
    const r=await q('SELECT id,username,password_hash,role,status FROM users WHERE username=$1',[username]);
    const user=r.rows[0];
    const valid=await bcrypt.compare(parsed.data.password,user?.password_hash||DUMMY_HASH);
    if(!user||user.status!=='active'||!valid){
      await audit(req,'login_failed',null,{username:username.slice(0,190)});
      return res.status(401).json({error:'Invalid credentials'});
    }
    await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
    req.session.userId=user.id;req.session.role=user.role;req.session.createdAt=Date.now();req.session.csrfToken=crypto.randomBytes(32).toString('hex');
    await q('UPDATE users SET last_login=NOW() WHERE id=$1',[user.id]);
    await audit(req,'login_success',String(user.id));
    res.json({authenticated:true,user:{id:user.id,username:user.username,role:user.role},csrfToken:req.session.csrfToken});
  }catch(e){next(e);}
});
app.post('/api/auth/logout',verifyCsrf,(req,res,next)=>req.session.destroy(e=>{if(e)return next(e);res.clearCookie('farm.sid',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'});res.clearCookie('farm.csrf',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'});res.json({ok:true});}));

app.post('/api/bookings',bookingSuccessLimiter,verifyCsrf,async(req,res,next)=>{
  if(typeof req.body?.companyWebsite==='string'&&req.body.companyWebsite.trim())return res.status(201).json({ok:true});
  const parsed=bookingSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Please check the booking details.'});
  const b=parsed.data;
  if(!validDateTime(b.date,b.time)) return res.status(400).json({error:'Invalid date or time.'});
  const today=algiersDateOffset();
  if(b.date<today) return res.status(400).json({error:'Booking date must be today or later.'});
  if(b.date>algiersDateOffset(BOOKING_MAX_DAYS_AHEAD)) return res.status(400).json({error:'Booking date is too far in the future.'});
  if(process.env.TURNSTILE_SECRET_KEY){
    const token=b['cf-turnstile-response'];
    if(!token)return res.status(400).json({error:'Please complete the security check.'});
    try{
      const body=new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:token});
      if(req.ip)body.set('remoteip',req.ip);
      const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      const result=await verification.json();
      if(!verification.ok||!result.success)return res.status(400).json({error:'Security check failed. Please try again.'});
    }catch(e){req.log.warn({err:e},'Turnstile verification failed');return res.status(503).json({error:'Security check is temporarily unavailable.'});}
  }

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    // Serialize matching service slots and phone limits while allowing other booking types at the same time.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${b.date}|${b.time}|${b.bookingType}`]);
    const conflict=await client.query(
      `SELECT 1 FROM bookings WHERE booking_date=$1 AND start_time=$2 AND booking_type=$3 AND status IN ('pending','confirmed') AND archived_at IS NULL LIMIT 1`,
      [b.date,b.time,b.bookingType]
    );
    if(conflict.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This time slot is already requested. Please choose another time.'});}
    const normalizedPhone=b.phone.replace(/\D/g,'');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`booking-phone|${normalizedPhone}`]);
    const phoneCount=await client.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE regexp_replace(phone,'[^0-9]','','g')=$1 AND status IN ('pending','confirmed') AND archived_at IS NULL`,[normalizedPhone]);
    if(phoneCount.rows[0].count>=3){await client.query('ROLLBACK');return res.status(429).json({error:'This phone number already has 3 active bookings.'});}
    const id=crypto.randomUUID();
    await client.query(
      `INSERT INTO bookings(id,customer_name,phone,email,booking_type,booking_date,start_time,number_of_people,message)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,b.fullName,b.phone,b.email||null,b.bookingType,b.date,b.time,b.visitors,b.message||null]
    );
    await client.query('COMMIT');
    res.status(201).json({ok:true,id});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}
});

const activeClause=`archived_at IS NULL`;
app.get('/api/admin/dashboard',requireAdmin,async(req,res,next)=>{
  try{
    const r=await q(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER(WHERE status='pending')::int pending,
      COUNT(*) FILTER(WHERE status='confirmed')::int confirmed,
      COUNT(*) FILTER(WHERE status='rejected')::int rejected,
      COUNT(*) FILTER(WHERE status='completed')::int completed,
      COUNT(*) FILTER(WHERE booking_date>=(NOW() AT TIME ZONE 'Africa/Algiers')::date AND status IN ('pending','confirmed'))::int upcoming
      FROM bookings WHERE ${activeClause}`);
    const recent=await q(`SELECT id,customer_name,phone,email,booking_type,booking_date,start_time,end_time,number_of_people,message,status,created_at,updated_at
      FROM bookings WHERE ${activeClause} ORDER BY created_at DESC LIMIT 20`);
    res.json({stats:r.rows[0],recent:recent.rows});
  }catch(e){next(e);}
});
app.get('/api/admin/bookings',requireAdmin,async(req,res,next)=>{
  try{
    const limit=Math.min(Math.max(Number(req.query.limit)||200,1),200);
    const search=String(req.query.search||'').trim().slice(0,100);
    const status=['pending','confirmed','rejected','completed'].includes(req.query.status)?req.query.status:null;
    const datePreset=['today','tomorrow','week'].includes(req.query.datePreset)?req.query.datePreset:null;
    const customDate=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date||''))?String(req.query.date):null;
    const params=[];const where=[activeClause];
    if(search){params.push(`%${search}%`);where.push(`(customer_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length} OR booking_type ILIKE $${params.length})`);}
    if(status){params.push(status);where.push(`status=$${params.length}`);}
    if(datePreset==='today')where.push(`booking_date=(NOW() AT TIME ZONE 'Africa/Algiers')::date`);
    if(datePreset==='tomorrow')where.push(`booking_date=(NOW() AT TIME ZONE 'Africa/Algiers')::date+1`);
    if(datePreset==='week')where.push(`booking_date BETWEEN (NOW() AT TIME ZONE 'Africa/Algiers')::date AND (NOW() AT TIME ZONE 'Africa/Algiers')::date+6`);
    if(customDate){params.push(customDate);where.push(`booking_date=$${params.length}`);}
    params.push(limit);
    const r=await q(`SELECT id,customer_name,phone,email,booking_type,booking_date,start_time,end_time,number_of_people,message,status,created_at,updated_at
      FROM bookings WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,params);
    res.json({bookings:r.rows});
  }catch(e){next(e);}
});
app.patch('/api/admin/bookings/:id',requireAdmin,verifyCsrf,async(req,res,next)=>{
  const parsed=statusSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid status'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=await client.query('SELECT id,status,booking_date,start_time,booking_type FROM bookings WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[req.params.id]);
    if(!current.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Booking not found'});}
    const from=current.rows[0].status,to=parsed.data.status;
    const allowed=(from==='pending'&&['confirmed','rejected'].includes(to))||(from==='confirmed'&&to==='completed')||(from===to);
    if(!allowed){await client.query('ROLLBACK');return res.status(409).json({error:'This booking status transition is not allowed.'});}
    if(from===to){await client.query('COMMIT');return res.json({id:current.rows[0].id,status:from});}
    if(to==='confirmed'){
      const conflict=await client.query(`SELECT 1 FROM bookings WHERE booking_date=$1 AND start_time=$2 AND booking_type=$3 AND status='confirmed' AND archived_at IS NULL AND id<>$4 LIMIT 1`,[current.rows[0].booking_date,current.rows[0].start_time,current.rows[0].booking_type,req.params.id]);
      if(conflict.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Another confirmed booking already uses this time slot.'});}
    }
    const r=await client.query('UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status',[to,req.params.id]);
    await client.query('COMMIT');
    await audit(req,'booking_status_updated',req.params.id,{from,to});
    res.json(r.rows[0]);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}
});
app.delete('/api/admin/bookings/:id',requireAdmin,verifyCsrf,async(req,res,next)=>{
  try{
    const r=await q(`UPDATE bookings SET archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND archived_at IS NULL RETURNING id`,[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'Booking not found'});
    await audit(req,'booking_archived',req.params.id);res.json({ok:true});
  }catch(e){next(e);}
});

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||8)*1024*1024,files:1},
  fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});
const imageUploadLimiter=rateLimit({windowMs:60*60*1000,max:30,standardHeaders:true,legacyHeaders:false,message:{error:'Too many image uploads. Please try again later.'}});
const slotKeys=new Set(['hero','about','service-nature','service-restaurant','service-hotel','service-zoo','service-sports','service-pool','activities-1','activities-2','activities-3','activities-4','gallery-1','gallery-2','gallery-3','gallery-4','gallery-5','gallery-6']);
app.get('/api/admin/images',requireAdmin,async(req,res,next)=>{
  try{const r=await q('SELECT slot_key,storage_name,storage_provider,storage_url,mime_type,width,height,size_bytes FROM site_images ORDER BY slot_key');res.json({images:r.rows.map(x=>({...x,url:x.storage_provider==='cloudinary'?cloudinaryUrl(x.storage_name,'webp'):`/uploads/${encodeURIComponent(x.storage_name)}`}))});}catch(e){next(e);}
});
app.delete('/api/admin/images',requireAdmin,verifyCsrf,async(req,res,next)=>{
  try{
    const client=await pool.connect();
    let rows;
    try{
      await client.query('BEGIN');
      rows=await client.query('DELETE FROM site_images RETURNING storage_name,storage_provider');
      await client.query('COMMIT');
    }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
    finally{client.release();}
    for(const image of rows.rows){
      if(image.storage_provider==='cloudinary'&&image.storage_name){
        try{await cloudinary.uploader.destroy(image.storage_name,{resource_type:'image',invalidate:true});}
        catch(e){req.log.warn({err:e},'Cloudinary image cleanup failed during reset');}
      }else if(image.storage_name){
        try{await fs.promises.unlink(path.join(UPLOAD_DIR,image.storage_name));}catch{}
      }
    }
    await audit(req,'images_reset',null,{count:rows.rowCount});
    res.json({ok:true});
  }catch(e){next(e);}
});
app.post('/api/admin/images/:slot',requireAdmin,verifyCsrf,imageUploadLimiter,upload.single('image'),async(req,res,next)=>{
  const slot=req.params.slot;
  if(!slotKeys.has(slot))return res.status(400).json({error:'Invalid image slot'});
  if(!req.file)return res.status(400).json({error:'Only JPEG, PNG and WebP images are allowed.'});
  let uploadedAsset=null,storedName=null;
  const publicId=`${slot}-${crypto.randomUUID()}`;
  try{
    const meta=await sharp(req.file.buffer,{failOn:'error'}).metadata();
    const pixels=Number(meta.width||0)*Number(meta.height||0);
    if(!meta.width||!meta.height||meta.width>8000||meta.height>8000||pixels>40000000)return res.status(400).json({error:'Invalid or oversized image.'});
    const processed=sharp(req.file.buffer,{failOn:'error'}).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true});
    const output=await processed.webp({quality:82}).toBuffer({resolveWithObject:true});
    const outMeta=await sharp(output.data,{failOn:'error'}).metadata();
    const uploaded=CLOUDINARY_ENABLED
      ? await cloudinaryUpload(output.data,publicId)
      : null;
    const storageName=CLOUDINARY_ENABLED?`${CLOUDINARY_FOLDER}/${publicId}`:`${publicId}.webp`;
    uploadedAsset=uploaded;storedName=storageName;
    if(!CLOUDINARY_ENABLED) await fs.promises.writeFile(path.join(UPLOAD_DIR,storageName),output.data,{flag:'wx'});
    const old=await q('SELECT storage_name,storage_provider FROM site_images WHERE slot_key=$1',[slot]);
    await q(`INSERT INTO site_images(slot_key,original_name,storage_name,storage_provider,storage_url,mime_type,width,height,size_bytes)
      VALUES($1,$2,$3,$4,$5,'image/webp',$6,$7,$8)
      ON CONFLICT(slot_key) DO UPDATE SET original_name=EXCLUDED.original_name,storage_name=EXCLUDED.storage_name,storage_provider=EXCLUDED.storage_provider,storage_url=EXCLUDED.storage_url,mime_type='image/webp',width=EXCLUDED.width,height=EXCLUDED.height,size_bytes=EXCLUDED.size_bytes,updated_at=NOW()`,
      [slot,req.file.originalname.slice(0,255),storageName,CLOUDINARY_ENABLED?'cloudinary':'local',uploaded?.secure_url||null,outMeta.width||meta.width,outMeta.height||meta.height,output.info.size||output.data.length]);
    if(old.rowCount&&old.rows[0].storage_provider==='cloudinary'&&old.rows[0].storage_name){try{await cloudinary.uploader.destroy(old.rows[0].storage_name,{resource_type:'image',invalidate:true});}catch(e){req.log.warn({err:e},'old Cloudinary image cleanup failed');}}
    if(old.rowCount&&old.rows[0].storage_provider==='local'&&old.rows[0].storage_name){try{await fs.promises.unlink(path.join(UPLOAD_DIR,old.rows[0].storage_name));}catch{}}
    await audit(req,'image_uploaded',slot,{provider:CLOUDINARY_ENABLED?'cloudinary':'local',storageName});
    const imageUrl=CLOUDINARY_ENABLED?cloudinaryUrl(storageName,'webp'):`/uploads/${encodeURIComponent(storageName)}`;
    res.status(201).json({ok:true,url:imageUrl,...(CLOUDINARY_ENABLED?{avifUrl:cloudinaryUrl(storageName,'avif')}:{})});
  }catch(e){
    if(uploadedAsset&&CLOUDINARY_ENABLED){try{await cloudinary.uploader.destroy(`${CLOUDINARY_FOLDER}/${publicId}`,{resource_type:'image',invalidate:true});}catch(cleanupError){req.log.warn({err:cleanupError},'orphaned Cloudinary image cleanup failed');}}
    else if(storedName){try{await fs.promises.unlink(path.join(UPLOAD_DIR,storedName));}catch(cleanupError){if(cleanupError.code!=='ENOENT')req.log.warn({err:cleanupError},'orphaned local image cleanup failed');}}
    next(e);
  }
});
app.delete('/api/admin/images/:slot',requireAdmin,verifyCsrf,async(req,res,next)=>{
  if(!slotKeys.has(req.params.slot))return res.status(400).json({error:'Invalid image slot'});
  try{
    const r=await q('DELETE FROM site_images WHERE slot_key=$1 RETURNING storage_name,storage_provider',[req.params.slot]);
    if(!r.rowCount)return res.json({ok:true});
    if(r.rows[0].storage_provider==='cloudinary'&&r.rows[0].storage_name){try{await cloudinary.uploader.destroy(r.rows[0].storage_name,{resource_type:'image',invalidate:true});}catch(e){req.log.warn({err:e},'Cloudinary image deletion failed');}}
    else if(r.rows[0].storage_name){try{await fs.promises.unlink(path.join(UPLOAD_DIR,r.rows[0].storage_name));}catch{} try{await fs.promises.unlink(path.join(UPLOAD_DIR,r.rows[0].storage_name.replace(/\.webp$/i,'.avif')));}catch{}}
    await audit(req,'image_deleted',req.params.slot);res.json({ok:true});
  }catch(e){next(e);}
});
app.use('/uploads',express.static(UPLOAD_DIR,{fallthrough:false,maxAge:'30d',index:false,setHeaders:(res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public,max-age=2592000');}}));
app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));
app.use((req,res,next)=>{
  let pathname=req.path;
  try{pathname=decodeURIComponent(pathname);}catch{return res.status(404).type('text').send('Not found');}
  const segments=pathname.split('/').filter(Boolean);
  const protectedRoots=new Set(['server','database','node_modules','storage']);
  if(segments.some(s=>s.startsWith('.'))||protectedRoots.has(segments[0]))return res.status(404).type('text').send('Not found');
  if(/\.(?:env|sql|bak|log|conf|ini|ya?ml|map)$/i.test(pathname)){
    const candidate=path.resolve(CLIENT_DIST,`.${pathname}`);
    if(!candidate.startsWith(`${CLIENT_DIST}${path.sep}`)||!fs.existsSync(candidate))return res.status(404).type('text').send('Not found');
  }
  next();
});
app.use(express.static(CLIENT_DIST,{index:'index.html',extensions:['html'],setHeaders:(res,filePath)=>{if(/\.html$/i.test(filePath)){res.setHeader('Cache-Control','no-cache');}else if(/\/assets\/[^/]+-[\w-]+\.(?:js|css|svg|woff2|webp|avif)$/i.test(filePath.replaceAll('\\','/'))){res.setHeader('Cache-Control','public,max-age=2592000,immutable');}}}));
app.get(['/','/index.html'],(req,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(path.join(CLIENT_DIST,'index.html'));});
app.get(['/admin','/admin.html'],(req,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(path.join(CLIENT_DIST,'admin.html'));});
app.get('/{*splat}',(req,res,next)=>{
  const acceptsHtml=(req.get('accept')||'').split(',').some(value=>value.split(';',1)[0].trim().toLowerCase()==='text/html');
  if(!acceptsHtml||(path.extname(req.path)&&!req.path.toLowerCase().endsWith('.html')))return next();
  res.status(404).sendFile(path.join(CLIENT_DIST,'404.html'));
});
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=Number(err.status||err.statusCode);
  if(err.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON'});
  if(err.type==='entity.too.large')return res.status(413).json({error:'Payload too large'});
  if(err.status===404||err.statusCode===404)return res.status(404).json({error:'Not found'});
  if(err instanceof multer.MulterError)return res.status(400).json({error:'Upload rejected.'});
  if(status>=400&&status<500)return res.status(status).json({error:'Request rejected.'});
  if(err.message==='CORS blocked')return res.status(403).json({error:'CORS blocked'});
  req.log?.error({err},'request failed');
  res.status(500).json({error:'Internal server error'});
});
const server=app.listen(PORT,()=>console.log(`Farm site running on http://localhost:${PORT}`));
ensureConfiguredAdmin().catch(error=>console.error('Configured admin account could not be initialized:',error.message));

function shutdown(signal){
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(()=>pool.end().then(()=>process.exit(0)).catch(()=>process.exit(1)));
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
