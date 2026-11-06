export interface SummaryRecord { at:number; correct:number; total:number; passed:boolean; }
export interface LearningSummary {
 schemaVersion:number; generatedAt:number; simulated:boolean; deviceControlValidated:boolean; day:string;
 dailyUsedMinutes:number; dailyUsedSeconds:number; recordWindow:number; records:SummaryRecord[]; wrongAnswerCount:number;
}
export interface SummaryFilePort {
 choose():Promise<string[]>;
 open(uri:string):Promise<number>;
 encode(text:string):Uint8Array;
 write(fd:number,bytes:ArrayBuffer,offset:number):Promise<number>;
 sync(fd:number):Promise<void>;
 close(fd:number):Promise<void>;
}
function requireSummary(ok:boolean):void { if(!ok)throw new Error('Invalid learning summary'); }
function exactFields(value:Object,keys:string[]):void {
 requireSummary(value!==null&&typeof value==='object'&&!Array.isArray(value));
 const actual=Object.keys(value);requireSummary(actual.length===keys.length&&actual.every(key=>keys.includes(key)));
}
function integer(value:number,max:number):boolean { return Number.isSafeInteger(value)&&value>=0&&value<=max; }
export function validateSummary(text:string):string {
 requireSummary(typeof text==='string'&&text.length<=64000);
 const s:LearningSummary=JSON.parse(text);
 exactFields(s,['schemaVersion','generatedAt','simulated','deviceControlValidated','day','dailyUsedMinutes','dailyUsedSeconds','recordWindow','records','wrongAnswerCount']);
 requireSummary(s.schemaVersion===1&&s.simulated===true&&s.deviceControlValidated===false&&integer(s.generatedAt,8640000000000000));
 requireSummary(typeof s.day==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(s.day)&&new Date(s.day+'T12:00:00Z').toISOString().slice(0,10)===s.day);
 requireSummary(integer(s.dailyUsedSeconds,36000)&&s.dailyUsedMinutes===s.dailyUsedSeconds/60&&s.recordWindow===200&&integer(s.wrongAnswerCount,200));
 requireSummary(Array.isArray(s.records)&&s.records.length<=200);
 s.records.forEach(record=>{exactFields(record,['at','correct','total','passed']);requireSummary(integer(record.at,s.generatedAt)&&integer(record.total,20)&&record.total>0&&integer(record.correct,record.total)&&typeof record.passed==='boolean');});
 return JSON.stringify(s);
}
export async function writeAllUtf8(port:SummaryFilePort,fd:number,text:string):Promise<void> {
 const bytes=port.encode(text);let offset=0;
 while(offset<bytes.byteLength){
  const rest=bytes.slice(offset),written=await port.write(fd,rest.buffer as ArrayBuffer,offset);
  if(!Number.isSafeInteger(written)||written<=0||written>rest.byteLength)throw new Error('Incomplete summary write');offset+=written;
 }
}
export class NativeSummaryService {
 private busy:boolean=false;
 constructor(private port:SummaryFilePort){}
 async exportSummary(text:string):Promise<string>{
  if(this.busy)return 'busy';let canonical:string;
  try{canonical=validateSummary(text);}catch{return 'invalid_summary';}
  this.busy=true;let fd=-1,result='failed';
  try{
   const chosen=await this.port.choose();
   if(chosen.length===0)result='cancelled';
   else if(chosen.length===1&&typeof chosen[0]==='string'&&chosen[0].length>0){
    fd=await this.port.open(chosen[0]);if(!Number.isSafeInteger(fd)||fd<0)throw new Error('Invalid file handle');
    await writeAllUtf8(this.port,fd,canonical);await this.port.sync(fd);result='saved';
   }
  }catch{result='failed';}
  finally{if(fd>=0){try{await this.port.close(fd);}catch{result='failed';}}this.busy=false;}
  return result;
 }
}
