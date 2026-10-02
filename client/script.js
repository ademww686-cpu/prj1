import {getPublicImages} from './site-images.js';

let csrfToken='';
const turnstileSiteKey=import.meta.env.VITE_TURNSTILE_SITE_KEY||'';
let turnstileToken='',turnstileWidgetId=null;
async function refreshCsrfToken(){
 const response=await fetch('/api/auth/csrf',{credentials:'same-origin'});
 if(!response.ok)throw new Error('تعذر الاتصال بالخادم.');
 csrfToken=(await response.json()).csrfToken||'';
 if(!csrfToken)throw new Error('تعذر الاتصال بالخادم.');
 return csrfToken;
}

document.addEventListener('DOMContentLoaded',()=>{
 const hamburger=document.getElementById('hamburger'),mobilePanel=document.getElementById('mobilePanel');
 if(hamburger&&mobilePanel){hamburger.addEventListener('click',()=>{const open=mobilePanel.classList.toggle('is-open');hamburger.classList.toggle('is-open',open);hamburger.setAttribute('aria-expanded',String(open));});mobilePanel.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobilePanel.classList.remove('is-open');hamburger.classList.remove('is-open');hamburger.setAttribute('aria-expanded','false')}));}
 const revealEls=document.querySelectorAll('.reveal');if('IntersectionObserver'in window){const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');o.unobserve(e.target)}}),{threshold:.15});revealEls.forEach(e=>o.observe(e));}else revealEls.forEach(e=>e.classList.add('is-visible'));
 loadImages();
 refreshCsrfToken().catch(error=>console.warn(error));
 const form=document.getElementById('bookingForm');if(!form)return;const confirmBox=document.getElementById('confirmBox');
 setupTurnstile(form);
 const rules={fullName:v=>v.trim().length>=2&&v.trim().length<=100,phone:v=>/^[0-9+\s()\-]{8,20}$/.test(v.trim()),email:v=>!v.trim()||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),visitors:v=>Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=1000,bookingType:v=>v.trim().length>0,date:v=>/^\d{4}-\d{2}-\d{2}$/.test(v),time:v=>/^\d{2}:\d{2}$/.test(v)&&Number(v.slice(0,2))<24&&Number(v.slice(3,5))<60};
 const showError=(n,e)=>{const w=form.querySelector(`[data-field="${n}"]`);if(w)w.classList.toggle('has-error',e)};
 const setMinDate=()=>{const d=document.getElementById('date');if(d){const x=new Date();d.min=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}};setMinDate();
 form.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());let valid=true;Object.keys(rules).forEach(k=>{const ok=rules[k](data[k]||'');showError(k,!ok);if(!ok)valid=false});if(!valid){form.querySelector('.has-error input,.has-error select')?.focus();return}
   const btn=form.querySelector('button[type=submit]');if(btn)btn.disabled=true;
   try{
    if(!csrfToken)await refreshCsrfToken();
    if(turnstileSiteKey)data['cf-turnstile-response']=turnstileToken;
    let r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},credentials:'same-origin',body:JSON.stringify(data)});
    let out=await r.json().catch(()=>({}));
    if(r.status===403&&out.error==='Invalid CSRF token'){
     await refreshCsrfToken();
     r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},credentials:'same-origin',body:JSON.stringify(data)});
     out=await r.json().catch(()=>({}));
    }
    if(!r.ok)throw new Error(out.error||'تعذر إرسال طلب الحجز.');confirmBox?.classList.add('is-visible');form.reset();turnstileToken='';if(turnstileWidgetId!==null)window.turnstile?.reset(turnstileWidgetId);Object.keys(rules).forEach(k=>showError(k,false));confirmBox?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>confirmBox?.classList.remove('is-visible'),6000);
   }
   catch(err){
     let n=document.getElementById('bookingErrorToast');if(!n){n=document.createElement('div');n.id='bookingErrorToast';n.setAttribute('role','alert');n.style.cssText='position:fixed;inset-inline:20px;bottom:20px;z-index:9999;max-width:520px;margin:auto;background:#B3432E;color:#fff;padding:14px 18px;border-radius:12px;box-shadow:0 12px 35px rgba(0,0,0,.2);font-weight:700;text-align:center';document.body.appendChild(n)}
     n.textContent=err.message||'تعذر إرسال طلب الحجز.';clearTimeout(window.__bookingToast);window.__bookingToast=setTimeout(()=>n.remove(),5000);if(turnstileWidgetId!==null){turnstileToken='';window.turnstile?.reset(turnstileWidgetId);}
   }finally{if(btn)btn.disabled=false}
 });
 Object.keys(rules).forEach(k=>form.elements[k]?.addEventListener('input',()=>showError(k,false)));
});
function setupTurnstile(form){
 if(!turnstileSiteKey)return;
 const widget=document.createElement('div');widget.id='turnstileWidget';widget.className='turnstile-widget';form.querySelector('button[type="submit"]')?.before(widget);
 window.onTurnstileLoad=()=>{
  if(!window.turnstile||turnstileWidgetId!==null)return;
  turnstileWidgetId=window.turnstile.render(widget,{sitekey:turnstileSiteKey,callback:token=>{turnstileToken=token;},'expired-callback':()=>{turnstileToken='';},'error-callback':()=>{turnstileToken='';}});
 };
 const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';script.async=true;script.defer=true;document.head.appendChild(script);
}
async function loadImages(){
 try{
  const images=await getPublicImages();
  document.querySelectorAll('[data-img-slot]').forEach(target=>{
   const item=images[target.dataset.imgSlot];if(!item)return;
   const webp=typeof item==='string'?item:item.webp;
   const avif=typeof item==='object'?item.avif:null;
   let image;
   if(target instanceof HTMLImageElement){
    image=target;
   }else{
    image=target.querySelector(':scope > picture > img');
    if(!image){
     const picture=document.createElement('picture');
     image=document.createElement('img');
     image.alt='';
     picture.appendChild(image);
     target.appendChild(picture);
    }
    target.classList.add('has-img');
    target.closest('.ph')?.classList.add('has-img');
   }
   let picture=image.parentElement;
   if(picture?.tagName!=='PICTURE'){
    picture=document.createElement('picture');
    image.parentNode.insertBefore(picture,image);
    picture.appendChild(image);
   }
   picture.querySelectorAll('source').forEach(source=>source.remove());
   if(avif){const source=document.createElement('source');source.srcset=avif;source.type='image/avif';picture.insertBefore(source,image);}
   image.src=webp;
   image.loading=target.dataset.imgSlot==='hero'?'eager':'lazy';
   image.decoding='async';
   if(target.dataset.imgSlot==='hero')image.fetchPriority='high';
   image.closest('.ph-inner')?.classList.add('has-img');
   image.closest('.ph')?.classList.add('has-img');
  });
 }catch(e){console.warn(e)}
}
