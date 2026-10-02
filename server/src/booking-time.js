export function validDateTime(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return false;
  const [year,month,day]=date.split('-').map(Number);
  const [hour,minute]=time.split(':').map(Number);
  if(year<1||month<1||month>12||hour>23||minute>59)return false;
  const calendarYear=year<100?year+400:year;
  const daysInMonth=new Date(Date.UTC(calendarYear,month,0)).getUTCDate();
  return day>=1&&day<=daysInMonth;
}

export function algiersDateOffset(days=0,now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const date=new Date(Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)+days));
  return date.toISOString().slice(0,10);
}
