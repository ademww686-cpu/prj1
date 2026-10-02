import {getAdminImages,IMAGE_SLOTS} from './site-images.js';

let csrfToken='',searchTerm='',selectedStatus='pending',datePreset='',customDate='',pollTimer=null,refreshing=false;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusClass=s=>({pending:'status-new',confirmed:'status-confirmed',rejected:'status-rejected',completed:'status-confirmed'}[s]||'status-new');
const statusText=s=>({pending:'جديدة',confirmed:'مؤكدة',rejected:'مرفوضة',completed:'مكتملة'}[s]||s);
const fmtDate=v=>v?new Date(v).toLocaleString('ar-DZ',{dateStyle:'medium',timeStyle:'short'}):'—';

async function api(url,opt={}){
  opt.credentials='same-origin';
  opt.headers={...(opt.headers||{}),...(opt.body&&!(opt.body instanceof FormData)?{'Content-Type':'application/json'}:{})};
  if(['POST','PUT','PATCH','DELETE'].includes(opt.method))opt.headers['X-CSRF-Token']=csrfToken;
  let r=await fetch(url,opt),d=await r.json().catch(()=>({}));
  if(r.status===403&&d.error==='Invalid CSRF token'&&['POST','PUT','PATCH','DELETE'].includes(opt.method)){
    csrfToken=await refreshCsrf();opt.headers['X-CSRF-Token']=csrfToken;
    r=await fetch(url,opt);d=await r.json().catch(()=>({}));
  }
  if(!r.ok){
    if((r.status===401||r.status===403)&&url.startsWith('/api/admin/'))showLogin('انتهت الجلسة، يرجى تسجيل الدخول مجددًا');
    throw new Error(d.error||'حدث خطأ في الخادم');
  }
  return d;
}
async function refreshCsrf(){
  const response=await fetch('/api/auth/csrf',{credentials:'same-origin'});
  if(!response.ok)throw new Error('تعذر الاتصال بالخادم');
  const body=await response.json();csrfToken=body.csrfToken||'';
  if(!csrfToken)throw new Error('تعذر الاتصال بالخادم');
  return csrfToken;
}
async function init(){
  try{
    await refreshCsrf();
    const me=await api('/api/auth/me');
    if(me.authenticated)showDashboard();else showLogin();
  }catch(e){showLogin();$('loginError').textContent='تعذر الاتصال بالخادم';$('loginError').classList.add('is-visible');}
}
function showLogin(message=''){stopPolling();$('loginScreen').style.display='flex';$('dashboardScreen').style.display='none';if(message){$('loginError').textContent=message;$('loginError').classList.add('is-visible');}refreshCsrf().catch(()=>{});}
function showDashboard(){ $('loginScreen').style.display='none';$('dashboardScreen').style.display='block';renderBookings(true);startPolling(); }
function startPolling(){stopPolling();pollTimer=setInterval(()=>refreshDashboardSilently(),60000);}
function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
async function refreshDashboardSilently(){
  if(refreshing||document.hidden)return;
  refreshing=true;
  try{
    const before=Number($('statNew').textContent||0);
    const d=await api('/api/admin/dashboard');
    const after=Number(d.stats.pending||0);
    if(after>before)toast('لديك حجز جديد.');
    await renderBookings(false,d);
  }catch(e){console.warn('Dashboard refresh failed',e)}finally{refreshing=false;}
}
function updateStats(stats){
  $('statTotal').textContent=stats.total??0;$('statNew').textContent=stats.pending??0;
  $('statConfirmed').textContent=stats.confirmed??0;$('statRejected').textContent=stats.rejected??0;
  $('statCompleted').textContent=stats.completed??0;$('statUpcoming').textContent=stats.upcoming??0;
  $('countPending').textContent=stats.pending??0;
  $('countConfirmed').textContent=stats.confirmed??0;$('countRejected').textContent=stats.rejected??0;
}
async function renderBookings(initial=false,dashboardData=null){
  try{
    const d=dashboardData||await api('/api/admin/dashboard');updateStats(d.stats);
    const qs=new URLSearchParams({limit:'200'});
    if(searchTerm)qs.set('search',searchTerm);if(selectedStatus)qs.set('status',selectedStatus);
    if(datePreset)qs.set('datePreset',datePreset);if(customDate)qs.set('date',customDate);
    const r=await api('/api/admin/bookings?'+qs.toString());
    const body=$('bookingsBody'),table=$('bookingsTable'),empty=$('emptyState');
    $('searchCount').style.display=(searchTerm||selectedStatus||datePreset||customDate)?'block':'none';
    $('searchCount').textContent=`${r.bookings.length} نتيجة`;
    if(!r.bookings.length){table.style.display='none';empty.style.display='block';return;}
    table.style.display='table';empty.style.display='none';
    body.innerHTML=r.bookings.map(b=>{
      const actions=b.status==='pending'
        ? `<button type="button" class="btn btn-primary btn-sm action-btn" data-action="confirmed" data-id="${esc(b.id)}">تأكيد</button>
           <button type="button" class="btn btn-danger btn-sm action-btn" data-action="rejected" data-id="${esc(b.id)}">رفض</button>`
        : b.status==='confirmed'
        ? `<button type="button" class="btn btn-primary btn-sm action-btn" data-action="completed" data-id="${esc(b.id)}">تم الإنجاز</button>`
        : '—';
      return `<tr>
        <td>${esc(b.customer_name)}</td><td>${esc(b.phone)}</td><td>${esc(b.number_of_people)}</td>
        <td>${esc(b.booking_type)}</td><td>${esc(String(b.booking_date).slice(0,10))}</td>
        <td>${esc(String(b.start_time).slice(0,5))}</td><td>${esc(b.email||'—')}</td>
        <td class="msg-cell">${esc(b.message||'—')}</td><td>${esc(fmtDate(b.created_at))}</td><td>${esc(fmtDate(b.updated_at))}</td>
        <td><span class="status-badge ${statusClass(b.status)}">${esc(statusText(b.status))}</span></td>
        <td class="row-actions">${actions}</td>
      </tr>`;
    }).join('');
    body.querySelectorAll('.action-btn').forEach(btn=>btn.addEventListener('click',()=>openActionModal(btn.dataset.id,btn.dataset.action)));
  }catch(e){
    if(['Authentication required','Forbidden'].includes(e.message))showLogin();else console.error(e);
  }
}
function openActionModal(id,status){
  const labels={confirmed:'تأكيد الحجز',rejected:'رفض الحجز',completed:'تحديد الحجز كمكتمل'};
  $('modalTitle').textContent=labels[status]||'تأكيد الإجراء';
  $('modalText').textContent=`هل أنت متأكد من ${labels[status]?.toLowerCase()||'تنفيذ هذا الإجراء'}؟`;
  $('actionModal').hidden=false;
  $('confirmActionBtn').onclick=async()=>{closeModal();try{await api('/api/admin/bookings/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});toast('تم تحديث حالة الحجز بنجاح.');await renderBookings(true);}catch(e){toast(e.message,true);}};
}
function closeModal(){$('actionModal').hidden=true;$('confirmActionBtn').onclick=null;}
function toast(message,error=false){
  const el=document.createElement('div');el.className='admin-toast'+(error?' is-error':'');el.textContent=message;
  $('toastContainer').appendChild(el);setTimeout(()=>el.remove(),4500);
}
async function renderImagesManager(){
  const c=$('imagesGroups');if(!c)return;
  try{
    const rows=await getAdminImages(),map=Object.fromEntries(rows.map(x=>[x.slot_key,x])),groups=[];
    IMAGE_SLOTS.forEach(s=>{let g=groups.find(x=>x.name===s.group);if(!g){g={name:s.group,slots:[]};groups.push(g)}g.slots.push(s)});
    c.innerHTML=groups.map(g=>`<div class="images-group"><h3>${esc(g.name)}</h3><div class="images-grid">${g.slots.map(s=>{const x=map[s.key];return `<div class="image-card"><div class="image-card-thumb">${x?`<img src="${esc(x.url)}" alt="">`:'<span aria-hidden="true">🖼️</span>'}</div><div class="image-card-body"><b>${esc(s.label)}</b><div class="image-card-actions"><label class="btn btn-primary btn-sm">رفع صورة<input type="file" accept="image/jpeg,image/png,image/webp" data-key="${esc(s.key)}" hidden></label>${x?`<button type="button" class="btn btn-light btn-sm image-reset-btn" data-key="${esc(s.key)}">حذف</button>`:''}</div></div></div>`}).join('')}</div></div>`).join('');
    c.querySelectorAll('input[type=file]').forEach(i=>i.addEventListener('change',async e=>{if(!e.target.files[0])return;const fd=new FormData();fd.append('image',e.target.files[0]);try{await api('/api/admin/images/'+encodeURIComponent(e.target.dataset.key),{method:'POST',body:fd});toast('تم رفع الصورة.');await renderImagesManager()}catch(err){showImagesError(err.message)}}));
    c.querySelectorAll('.image-reset-btn').forEach(b=>b.addEventListener('click',()=>openImageDeleteModal(b.dataset.key)));
  }catch(e){showImagesError(e.message)}
}
function openImageDeleteModal(key){
  $('modalTitle').textContent='حذف الصورة';$('modalText').textContent='هل تريد حذف هذه الصورة المخصصة؟';
  $('actionModal').hidden=false;$('confirmActionBtn').onclick=async()=>{closeModal();try{await api('/api/admin/images/'+encodeURIComponent(key),{method:'DELETE'});toast('تم حذف الصورة.');await renderImagesManager()}catch(e){toast(e.message,true);}};
}
function openResetImagesModal(){
  $('modalTitle').textContent='إعادة كل الصور إلى الوضع الافتراضي';
  $('modalText').textContent='سيتم حذف جميع الصور المخصصة وإرجاع الموقع إلى الصور والعناصر الافتراضية. هل تريد المتابعة؟';
  $('actionModal').hidden=false;
  $('confirmActionBtn').onclick=async()=>{closeModal();try{await api('/api/admin/images',{method:'DELETE'});toast('تمت إعادة الصور إلى الوضع الافتراضي.');await renderImagesManager();}catch(e){toast(e.message,true);}};
}
function showImagesError(m){const e=$('imagesError');if(!e)return;e.textContent=m||'';e.style.display=m?'block':'none';}
function setupAdminTabs(){
  const bb=$('tabBookingsBtn'),ib=$('tabImagesBtn');
  bb?.addEventListener('click',()=>{$('bookingsPanel').style.display='';$('imagesPanel').style.display='none';bb.classList.add('is-active');ib.classList.remove('is-active');bb.setAttribute('aria-selected','true');ib.setAttribute('aria-selected','false');});
  ib?.addEventListener('click',()=>{$('bookingsPanel').style.display='none';$('imagesPanel').classList.remove('is-hidden');$('imagesPanel').style.display='';ib.classList.add('is-active');bb.classList.remove('is-active');ib.setAttribute('aria-selected','true');bb.setAttribute('aria-selected','false');renderImagesManager();});
  $('resetAllImagesBtn')?.addEventListener('click',openResetImagesModal);
  document.querySelectorAll('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));
  document.querySelectorAll('.booking-section-btn').forEach(b=>b.addEventListener('click',()=>{selectedStatus=b.dataset.status||'';document.querySelectorAll('.booking-section-btn').forEach(x=>x.classList.toggle('is-active',x===b));renderBookings();}));
  document.querySelectorAll('.date-filter').forEach(b=>b.addEventListener('click',()=>{datePreset=b.dataset.datePreset||'';customDate='';$('customDate').value='';document.querySelectorAll('.date-filter').forEach(x=>x.classList.toggle('is-active',x===b));renderBookings();}));
  $('customDate')?.addEventListener('change',e=>{customDate=e.target.value||'';datePreset='';document.querySelectorAll('.date-filter').forEach(x=>x.classList.toggle('is-active',!x.dataset.datePreset));renderBookings();});
}
document.addEventListener('DOMContentLoaded',()=>{
  setupAdminTabs();init();
  $('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();$('loginError').classList.remove('is-visible');try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});csrfToken=d.csrfToken;showDashboard();e.target.reset();}catch(err){$('loginError').textContent=err.message;$('loginError').classList.add('is-visible');}});
  $('logoutBtn')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});}finally{showLogin();}});
  let debounce; $('bookingSearch')?.addEventListener('input',e=>{clearTimeout(debounce);searchTerm=e.target.value.slice(0,100);$('searchBar').classList.toggle('has-value',!!searchTerm);debounce=setTimeout(()=>renderBookings(),300);});
  $('clearSearchBtn')?.addEventListener('click',()=>{$('bookingSearch').value='';searchTerm='';$('searchBar').classList.remove('has-value');renderBookings();});
});
window.addEventListener('beforeunload',stopPolling);
