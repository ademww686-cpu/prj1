import crypto from 'node:crypto';

const csrfSecret=()=>process.env.SESSION_SECRET||'';
export function createPublicCsrfToken(){
  const nonce=crypto.randomBytes(24).toString('base64url');
  const expires=Math.floor(Date.now()/1000)+2*60*60;
  const payload=`${nonce}.${expires}`;
  const signature=crypto.createHmac('sha256',csrfSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function safeEqual(a,b){
  const left=Buffer.from(a||''),right=Buffer.from(b||'');
  return left.length===right.length&&left.length>0&&crypto.timingSafeEqual(left,right);
}
function cookieValue(req,name){
  const raw=req.headers.cookie||'';
  const entry=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));
  return entry?entry.slice(name.length+1):'';
}
function validPublicToken(token){
  const parts=String(token||'').split('.');
  if(parts.length!==3)return false;
  const [nonce,expiresText,signature]=parts;
  const expires=Number(expiresText);
  if(!/^[A-Za-z0-9_-]{20,}$/.test(nonce)||!Number.isInteger(expires)||expires<Math.floor(Date.now()/1000))return false;
  const expected=crypto.createHmac('sha256',csrfSecret()).update(`${nonce}.${expiresText}`).digest('base64url');
  return safeEqual(signature,expected);
}

export function csrfToken(req,res,next){
  if(!req.session.csrfToken) req.session.csrfToken=crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken=req.session.csrfToken;
  next();
}
export function verifyCsrf(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const supplied=req.get('x-csrf-token');
  if(req.session?.userId){
    if(!safeEqual(supplied,req.session.csrfToken)) return res.status(403).json({error:'Invalid CSRF token'});
    return next();
  }
  const cookie=cookieValue(req,'farm.csrf');
  if(!safeEqual(supplied,cookie)||!validPublicToken(supplied)) return res.status(403).json({error:'Invalid CSRF token'});
  next();
}
