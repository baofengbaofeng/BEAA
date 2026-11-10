/** Weekly local-clock quiet hours; does not authenticate time or control other apps. */
export class QuietHoursError extends Error {
 constructor(){super('Invalid quiet hours configuration');this.name='QuietHoursError';this.code='INVALID_SCHEDULE';}
}
export function validateQuietWindows(input){
 const check=ok=>{if(!ok)throw new QuietHoursError();};
 const dense=value=>Array.isArray(value)&&Object.keys(value).length===value.length;
 check(dense(input)&&input.length<=14);
 return input.map(window=>{
  check(window!==null&&typeof window==='object'&&!Array.isArray(window)&&Object.keys(window).length===3&&['days','startMinute','endMinute'].every(key=>Object.hasOwn(window,key)));
  check(dense(window.days)&&window.days.length>=1&&window.days.length<=7&&window.days.every(day=>Number.isInteger(day)&&day>=1&&day<=7)&&new Set(window.days).size===window.days.length);
  check([window.startMinute,window.endMinute].every(minute=>Number.isInteger(minute)&&minute>=0&&minute<1440)&&window.startMinute!==window.endMinute);
  return {days:[...window.days],startMinute:window.startMinute,endMinute:window.endMinute};
 });
}
export function evaluateQuietHours(input,sample){
 const windows=validateQuietWindows(input);
 const valid=sample!==null&&typeof sample==='object'&&!Array.isArray(sample)&&Number.isInteger(sample.weekday)&&sample.weekday>=1&&sample.weekday<=7&&Number.isInteger(sample.minute)&&sample.minute>=0&&sample.minute<1440;
 if(!valid)return {blocked:windows.length>0,invalidTime:true,matchingIndexes:[]};
 const previous=sample.weekday===1?7:sample.weekday-1;
 const matchingIndexes=[];
 windows.forEach((window,index)=>{
  const active=window.startMinute<window.endMinute
   ?window.days.includes(sample.weekday)&&sample.minute>=window.startMinute&&sample.minute<window.endMinute
   :window.days.includes(sample.weekday)&&sample.minute>=window.startMinute||window.days.includes(previous)&&sample.minute<window.endMinute;
  if(active)matchingIndexes.push(index);
 });
 return {blocked:matchingIndexes.length>0,invalidTime:false,matchingIndexes};
}
/** Count eligible wall-clock rest only; cap both earned credit and work over very old snapshots. */
export function allowedQuietHoursElapsed(input,fromMs,toMs,limitMs){
 const windows=validateQuietWindows(input);
 if(![fromMs,toMs,limitMs].every(Number.isSafeInteger)||fromMs<0||toMs<fromMs||limitMs<0||limitMs>3600000||!Number.isFinite(new Date(fromMs).getTime())||!Number.isFinite(new Date(toMs).getTime()))return 0;
 if(!windows.length)return Math.min(toMs-fromMs,limitMs);
 const mask=new Uint8Array(7*1440);
 for(const window of windows)for(const day of window.days){
  const start=(day-1)*1440+window.startMinute;
  const duration=(window.endMinute-window.startMinute+1440)%1440;
  for(let offset=0;offset<duration;offset++)mask[(start+offset)%mask.length]=1;
 }
 if(mask.every(value=>value===1))return 0;
 let cursor=fromMs,credit=0;
 // At least one eligible local minute exists each week. Extra weeks cover DST gaps.
 const maxMinutes=(Math.ceil(limitMs/60000)+2)*7*1440;
 for(let checked=0;cursor<toMs&&credit<limitMs&&checked<maxMinutes;checked++){
  const date=new Date(cursor),minute=((date.getDay()+6)%7)*1440+date.getHours()*60+date.getMinutes();
  const next=Math.min(toMs,cursor+60000-date.getSeconds()*1000-date.getMilliseconds());
  if(next<=cursor)return credit;
  if(!mask[minute])credit+=Math.min(next-cursor,limitMs-credit);
  cursor=next;
 }
 return credit;
}
