import {q} from '../db.js';

export function requireAuth(req,res,next){
  if(!req.session?.userId) return res.status(401).json({error:'Authentication required'});
  next();
}

export async function requireAdmin(req,res,next){
  try{
    if(!req.session?.userId) return res.status(401).json({error:'Authentication required'});
    if(!req.session.createdAt||Date.now()-Number(req.session.createdAt)>8*60*60*1000){
      req.session.destroy(()=>{});
      return res.status(401).json({error:'Session expired'});
    }
    const r=await q('SELECT id,username,role,status FROM users WHERE id=$1',[req.session.userId]);
    const user=r.rows[0];
    if(!user || user.status!=='active' || user.role!=='admin'){
      req.session.destroy(()=>{});
      return res.status(403).json({error:'Forbidden'});
    }
    req.user=user;
    next();
  }catch(err){next(err);}
}
