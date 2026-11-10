import {createHash} from 'node:crypto';
import {chinese,english} from './language.mjs';
import {math} from './math.mjs';
import {validateQuestionBank} from '../bank.mjs';
const subjects={math,chinese,english};
const stages=['foundation','developing','consolidation'];
const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
export const contentDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function buildCurriculum(){
 const units=[];
 for(let grade=1;grade<=6;grade++)for(const [subject,rows] of Object.entries(subjects))rows[grade-1].forEach(([title,goal,...items],i)=>{
  const id=`${subject}-g${grade}-u${i+1}`;
  const questions=(subject==='math'?Array.from({length:4},(_,n)=>{const q=items[0](n);return [q.stem,String(q.answer),String(q.answer+1),q.explanation,String(q.answer+2)];}):items).map(([stem,answer,wrong,explanation,extra],j)=>{
   const texts=extra?[answer,wrong,extra]:[answer,wrong];
   // Rotate correct positions deterministically; do not teach “always choose A”.
   const shift=(i+j+grade)%texts.length;const rotated=texts.slice(shift).concat(texts.slice(0,shift));
   return {id:`${id}-q${j+1}`,grade,subject,type:'single_choice',stem,options:rotated.map((text,k)=>({id:String.fromCharCode(65+k),text})),correctOptionId:String.fromCharCode(65+rotated.indexOf(answer)),explanation,knowledgePoints:[id]};
  });
  units.push({id,grade,subject,title,learningGoals:[goal],recommendedOrder:i+1,stage:stages[Math.floor(i/2)],prerequisiteUnitIds:i?[`${subject}-g${grade}-u${i}`]:[],reviewStatus:'pending-teacher-review',answerInvariant:subject==='math'?'Recompute from deterministic numeric family; unique numeric answer.':'Original curated answer plus explicit explanation; teacher must check linguistic ambiguity and suitability.',questions});
 });
 return {schemaVersion:1,id:'beaa-original-primary-survey-1',status:'draft',reviewStatus:'pending-teacher-review',scope:'六个年级、三个学科的原创练习覆盖图；不是教材对齐或教师审定的完整课程。',units};
}
export function validateCurriculum(c){
 ensure(c?.schemaVersion===1&&c.status==='draft'&&c.reviewStatus==='pending-teacher-review','Draft curriculum metadata required');
 ensure(Array.isArray(c.units)&&c.units.length===108,'108 units required');
 const reference=buildCurriculum();const ids=new Set();
 for(const u of c.units){ensure(!ids.has(u.id),'Duplicate unit');ids.add(u.id);const expected=reference.units.find(r=>r.id===u.id);ensure(expected,'Unknown unit');ensure(contentDigest(u)===contentDigest(expected),`Content invariant failed: ${u.id}`);validateQuestionBank({version:1,questions:u.questions});for(const q of u.questions)ensure(new Set(q.options.map(o=>o.text)).size===q.options.length,'Duplicate choice text');}
 ensure(ids.size===reference.units.length,'Coverage gap');return true;
}
export function buildPracticePack(c,{grade,subject,stage}){
 validateCurriculum(c);ensure(Number.isInteger(grade)&&grade>=1&&grade<=6&&subjects[subject]&&stages.includes(stage),'Invalid practice selection');
 const units=c.units.filter(u=>u.grade===grade&&u.subject===subject&&u.stage===stage);
 return {version:1,questions:units.flatMap(u=>u.questions),reviewStatus:'pending-teacher-review',label:'DRAFT · 待教师逐题审核',curriculumId:c.id,unitIds:units.map(u=>u.id)};
}
export function createReviewRequest(c){validateCurriculum(c);return {schemaVersion:1,curriculumDigest:contentDigest(c),reviewerId:null,reviewedAt:null,entries:c.units.flatMap(u=>[{id:u.id,digest:contentDigest(u),kind:'unit'},...u.questions.map(q=>({id:q.id,digest:contentDigest(q),kind:'question'}))])};}
export function releaseCurriculum(c,manifest,trustedReviewerIds){
 const request=createReviewRequest(c);
 ensure(manifest?.schemaVersion===1&&manifest.curriculumDigest===request.curriculumDigest,'Missing or stale teacher review manifest');
 ensure(Array.isArray(trustedReviewerIds)&&trustedReviewerIds.includes(manifest.reviewerId)&&typeof manifest.reviewerId==='string'&&manifest.reviewerId.trim().length>0,'Reviewer is not in externally maintained trusted registry');
 ensure(typeof manifest.reviewedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedAt)&&Number.isFinite(Date.parse(manifest.reviewedAt))&&new Date(manifest.reviewedAt).toISOString().slice(0,10)===manifest.reviewedAt,'Review date required');
 ensure(Array.isArray(manifest.decisions)&&manifest.decisions.length===request.entries.length,'Every unit and question needs a review decision');
 const decisions=new Map(manifest.decisions.map(d=>[d.id,d]));ensure(decisions.size===request.entries.length,'Duplicate review decisions');
 for(const entry of request.entries){const d=decisions.get(entry.id);ensure(d&&d.digest===entry.digest&&d.kind===entry.kind&&d.status==='approved',`Missing, changed, or unapproved review: ${entry.id}`);}
 return {schemaVersion:1,status:'teacher-reviewed',curriculumDigest:request.curriculumDigest,reviewerId:manifest.reviewerId,reviewedAt:manifest.reviewedAt,bank:{version:1,questions:c.units.flatMap(u=>u.questions)}};
}
