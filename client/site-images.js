/* Server-backed image slots. No localStorage is used for images. */
export const IMAGE_SLOTS=[
{key:'hero',label:'الصورة الرئيسية',group:'الصفحة الرئيسية'},
{key:'about',label:'صورة "من نحن"',group:'من نحن'},
{key:'service-nature',label:'جلسات في طبيعة',group:'خدماتنا'},
{key:'service-restaurant',label:'مطعم',group:'خدماتنا'},
{key:'service-hotel',label:'فندق',group:'خدماتنا'},
{key:'service-zoo',label:'حديقة الحيوانات',group:'خدماتنا'},
{key:'service-sports',label:'ملاعب رياضية',group:'خدماتنا'},
{key:'service-pool',label:'مسبح',group:'خدماتنا'},
{key:'activities-1',label:'صورة الأنشطة 1',group:'الأنشطة'},
{key:'activities-2',label:'صورة الأنشطة 2',group:'الأنشطة'},
{key:'activities-3',label:'صورة الأنشطة 3',group:'الأنشطة'},
{key:'activities-4',label:'صورة الأنشطة 4',group:'الأنشطة'},
{key:'gallery-1',label:'صورة المعرض 1',group:'معرض الصور'},
{key:'gallery-2',label:'صورة المعرض 2',group:'معرض الصور'},
{key:'gallery-3',label:'صورة المعرض 3',group:'معرض الصور'},
{key:'gallery-4',label:'صورة المعرض 4',group:'معرض الصور'},
{key:'gallery-5',label:'صورة المعرض 5',group:'معرض الصور'},
{key:'gallery-6',label:'صورة المعرض 6',group:'معرض الصور'}];
export async function getPublicImages(){const r=await fetch('/api/images',{credentials:'same-origin'});if(!r.ok)throw new Error('Image service unavailable');return (await r.json()).images||{};}
export async function getAdminImages(){const r=await fetch('/api/admin/images',{credentials:'same-origin'});if(!r.ok)throw new Error('Authentication required');return (await r.json()).images||[];}
