import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import {algiersDateOffset} from '../server/src/booking-time.js';

const base=(process.env.TEST_BASE_URL||'').replace(/\/$/,'');
const enabled=Boolean(base);
let db;
if(enabled)db=await import('../server/src/db.js');
const madeBookingIds=[];
test.after(async()=>{if(db)await db.pool.end();});
const getCookie=(response,name)=>{
  return getSetCookies(response).map(x=>x.split(';')[0]).find(x=>x.startsWith(`${name}=`))||'';
};
const getSetCookies=response=>response.headers.getSetCookie?.()||[response.headers.get('set-cookie')||''];
const ipHeaders=ip=>({'X-Forwarded-For':ip,'X-Forwarded-Proto':'https'});
const randomTestIp=()=>`198.51.${crypto.randomInt(0,256)}.${crypto.randomInt(1,255)}`;
async function publicCsrf(ip){
  const response=await fetch(`${base}/api/auth/csrf`,{headers:ipHeaders(ip)});
  assert.equal(response.status,200);
  const body=await response.json();
  return {token:body.csrfToken,cookie:getCookie(response,'farm.csrf')};
}
async function submitBooking(data,ip){
  const csrf=await publicCsrf(ip);
  return fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders(ip),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:JSON.stringify(data)});
}
function booking(overrides={}){
  return {fullName:'Smoke Test',phone:`055${Math.floor(10000000+Math.random()*89999999)}`,email:'',visitors:2,bookingType:`Test ${Math.random().toString(36).slice(2,8)}`,date:algiersDateOffset(2),time:'12:00',message:'',...overrides};
}
async function body(response){return response.json().catch(()=>({}));}
async function cleanupBookings(){
  if(!db||!madeBookingIds.length)return;
  await db.q('UPDATE bookings SET archived_at=NOW(),updated_at=NOW() WHERE id=ANY($1::uuid[])',[madeBookingIds]);
  madeBookingIds.length=0;
}
async function makeTempAdmin(){
  const username=`smoke-${crypto.randomUUID()}`,password=crypto.randomBytes(30).toString('base64url'),hash=await bcrypt.hash(password,12);
  const result=await db.q('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id',[username,hash]);
  return {id:result.rows[0].id,username,password};
}
async function removeTempAdmin(id){if(id)await db.q('DELETE FROM users WHERE id=$1',[id]);}

test('HTTP errors, sensitive paths, and cache headers follow the hardened contract',{skip:!enabled},async()=>{
  const health=await fetch(`${base}/api/health`);
  assert.deepEqual(await body(health),{ok:true});
  if(process.env.TEST_PRODUCTION==='1')assert.match(health.headers.get('strict-transport-security')||'',/max-age=/i);
  const malformed=await fetch(`${base}/api/bookings`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{' });
  assert.equal(malformed.status,400);
  const malformedAuth=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{' });
  assert.equal(malformedAuth.status,400);assert.equal(malformedAuth.headers.get('cache-control'),'no-store');
  const oversized=await fetch(`${base}/api/bookings`,{method:'POST',headers:{'Content-Type':'application/json'},body:`{"x":"${'a'.repeat(66_000)}"}`});
  assert.equal(oversized.status,413);
  assert.equal((await fetch(`${base}/uploads/not-a-real-upload.webp`)).status,404);
  const unknown=await fetch(`${base}/api/unknown`);
  assert.equal(unknown.status,404);assert.deepEqual(await body(unknown),{error:'Not found'});
  for(const route of ['/.env','/server/src/app.js','/package.json','/database/migrations/001_initial.sql'])assert.equal((await fetch(`${base}${route}`)).status,404,route);
  const images=await fetch(`${base}/api/images`);
  assert.match(images.headers.get('cache-control')||'',/max-age=60/);
  assert.match(images.headers.get('etag')||'',/^W\//);
  const csrf=await fetch(`${base}/api/auth/csrf`);
  assert.equal(csrf.headers.get('cache-control'),'no-store');
  const home=await fetch(`${base}/`);assert.equal(home.status,200);assert.equal(home.headers.get('cache-control'),'no-cache');
  const assetPath=(await home.text()).match(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/)?.[1];
  assert.ok(assetPath,'home page must reference a built hashed asset');
  const asset=await fetch(`${base}${assetPath}`);assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control')||'',/immutable/);
  const adminPage=await fetch(`${base}/admin`);assert.equal(adminPage.status,200);assert.equal(adminPage.headers.get('cache-control'),'no-cache');
  const unknownPage=await fetch(`${base}/this-page-does-not-exist`,{headers:{Accept:'text/html'}});assert.equal(unknownPage.status,404);assert.match(await unknownPage.text(),/الصفحة غير موجودة/);
  assert.equal(unknownPage.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');
});

test('CORS rejects a non-listed booking origin and permits a listed origin',{skip:!enabled},async()=>{
  const listed=(process.env.CORS_ORIGIN||'').split(',').map(value=>value.trim()).filter(Boolean)[0];
  assert.ok(listed,'set CORS_ORIGIN to the allowlisted origin for this integration check');
  const payload={},csrf=await publicCsrf('198.51.100.240');
  const denied=await fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders('198.51.100.240'),Origin:'https://not-listed.invalid','Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(denied.status,403);
  const allowed=await fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders('198.51.100.240'),Origin:listed,Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(allowed.status,400);
  assert.equal(allowed.headers.get('access-control-allow-origin'),listed);
});

test('one hundred cookie-less CSRF requests do not create database sessions',{skip:!enabled},async()=>{
  const before=Number((await db.q('SELECT COUNT(*)::int AS count FROM user_sessions')).rows[0].count);
  const ip=randomTestIp();
  for(let i=0;i<100;i++){
    const response=await fetch(`${base}/api/auth/csrf`,{headers:ipHeaders(ip)});
    assert.equal(response.status,200);
    assert.ok((await response.json()).csrfToken);
  }
  const after=Number((await db.q('SELECT COUNT(*)::int AS count FROM user_sessions')).rows[0].count);
  assert.equal(after,before);
});

test('admin can log in, log out, and log in again without reloading',{skip:!enabled},async()=>{
  const ip='198.51.100.102';
  const admin=await makeTempAdmin();
  async function login(){
    const csrf=await publicCsrf(ip);
    const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{...ipHeaders(ip),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password})});
    assert.equal(response.status,200);
    const result=await response.json();
    if(process.env.TEST_PRODUCTION==='1'){
      const cookie=getSetCookies(response).find(value=>value.startsWith('farm.sid='))||'';
      assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Strict/i);
    }
    const session=getCookie(response,'farm.sid');
    assert.ok(session);
    const dashboard=await fetch(`${base}/api/admin/dashboard`,{headers:{...ipHeaders(ip),Cookie:session}});
    assert.equal(dashboard.status,200);
    assert.equal(dashboard.headers.get('cache-control'),'no-store');
    const logout=await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{...ipHeaders(ip),Cookie:session,'X-CSRF-Token':result.csrfToken}});
    assert.equal(logout.status,200);
  }
  try{await login();await login();}finally{await removeTempAdmin(admin.id);}
});

test('wrong-password timing is similar for existing and unknown usernames',{skip:!enabled},async()=>{
  const admin=await makeTempAdmin();
  try{
    const csrf=await publicCsrf('198.51.100.103');
    async function elapsed(username){
      const start=performance.now();
      const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{...ipHeaders('198.51.100.103'),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:JSON.stringify({username,password:'Wrong-password-for-smoke'})});
      assert.equal(response.status,401);return performance.now()-start;
    }
    const existing=await elapsed(admin.username),unknown=await elapsed(`missing-${Date.now()}@example.invalid`);
    assert.ok(existing>=150&&unknown>=150,`expected bcrypt timing >=150ms, got ${existing.toFixed(0)}ms/${unknown.toFixed(0)}ms`);
    assert.ok(Math.max(existing,unknown)/Math.max(1,Math.min(existing,unknown))<5,`timing varied too much: ${existing.toFixed(0)}ms/${unknown.toFixed(0)}ms`);
  }finally{await removeTempAdmin(admin.id);}
});

test('booking accepts all hours, enforces capacity, type-scoped slots, and date horizon',{skip:!enabled},async t=>{
  try{
    const sharedPhone='05555000123',date=algiersDateOffset(2),type='Smoke time coverage';
    for(const time of ['00:30','12:00','23:59']){
      const response=await submitBooking(booking({phone:sharedPhone,date,time,bookingType:`${type} ${time}`}),randomTestIp());
      assert.equal(response.status,201);madeBookingIds.push((await body(response)).id);
    }
    const fourth=await submitBooking(booking({phone:sharedPhone,date,time:'16:00',bookingType:'Smoke fourth'}),randomTestIp());
    assert.equal(fourth.status,429);

    const duplicateDate=algiersDateOffset(3),sameSlot={date:duplicateDate,time:'14:00',phone:'05555000124',bookingType:'Smoke slot A'};
    const first=await submitBooking(booking(sameSlot),randomTestIp());assert.equal(first.status,201);madeBookingIds.push((await body(first)).id);
    const differentType=await submitBooking(booking({...sameSlot,bookingType:'نشاط رياضي',phone:'05555000125'}),randomTestIp());assert.equal(differentType.status,201);madeBookingIds.push((await body(differentType)).id);
    const hotel=await submitBooking(booking({...sameSlot,bookingType:'حجز فندق',phone:'05555000127'}),randomTestIp());assert.equal(hotel.status,201);madeBookingIds.push((await body(hotel)).id);
    const duplicate=await submitBooking(booking(sameSlot),randomTestIp());assert.equal(duplicate.status,409);

    const tooFar=new Date(`${algiersDateOffset(730)}T12:00:00Z`).toISOString().slice(0,10);
    const future=await submitBooking(booking({date:tooFar,phone:'05555000126'}),randomTestIp());assert.equal(future.status,400);
    const trap=await submitBooking({companyWebsite:'filled by bot'},randomTestIp());assert.equal(trap.status,201);
  }finally{await cleanupBookings();}
});

test('only five successful bookings per IP per hour are accepted',{skip:!enabled},async()=>{
  const ip=randomTestIp();
  try{
    for(let i=0;i<5;i++){
      const response=await submitBooking(booking({date:algiersDateOffset(10+i),time:'01:30'}),ip);
      assert.equal(response.status,201);madeBookingIds.push((await body(response)).id);
    }
    const sixth=await submitBooking(booking({date:algiersDateOffset(20),time:'02:30'}),ip);
    assert.equal(sixth.status,429);
  }finally{await cleanupBookings();}
});

test('booking endpoint caps total attempts at thirty per ten minutes',{skip:!enabled},async()=>{
  const ip=randomTestIp(),csrf=await publicCsrf(ip);
  const malformed=await fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders(ip),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:'{' });
  assert.equal(malformed.status,400);
  for(let i=0;i<29;i++){
    const response=await fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders(ip),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,400);
  }
  const thirtyFirst=await fetch(`${base}/api/bookings`,{method:'POST',headers:{...ipHeaders(ip),Cookie:csrf.cookie,'X-CSRF-Token':csrf.token,'Content-Type':'application/json'},body:'{}'});
  assert.equal(thirtyFirst.status,429);
});
