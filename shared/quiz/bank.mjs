import { validatePolicy } from '../domain/engine.mjs';

export class QuizError extends Error {
  constructor(code,message,details={}){super(message);this.name='QuizError';this.code=code;Object.assign(this,details);}
}
function check(condition,message,code='INVALID_BANK') {if(!condition)throw new QuizError(code,message);}
function fields(value,allowed,required=allowed,code='INVALID_BANK') {
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected quiz data object',code);
  check(required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>allowed.includes(key)),'Missing or unknown quiz fields',code);
}
function dense(value){return Array.isArray(value) && Object.keys(value).length===value.length;}
function text(value,max){return typeof value==='string' && value.trim().length>0 && value.length<=max;}
function id(value,max=128){return text(value,max) && value.trim()===value;}
function points(value,code='INVALID_BANK') {
  check(dense(value) && value.length<=32 && Array.from(value).every(p=>id(p,80)) && new Set(value).size===value.length,'Invalid knowledge-point tags',code);
}

/** Validate data consistency, not curriculum quality or authenticity. */
export function validateQuestionBank(input) {
  fields(input,['version','questions']);check(input.version===1,'Unsupported question-bank version');
  check(dense(input.questions) && input.questions.length>0 && input.questions.length<=2000,'Invalid question-bank size');
  const seen=new Set();
  const required=['id','grade','subject','type','stem','options','correctOptionId','explanation'];
  for(const q of input.questions){
    fields(q,[...required,'knowledgePoints'],required);
    check(id(q.id) && !seen.has(q.id),'Invalid or duplicate question identifier');seen.add(q.id);
    check(Number.isInteger(q.grade) && q.grade>=1 && q.grade<=6 && ['chinese','math','english'].includes(q.subject),'Invalid question grade or subject');
    check(q.type==='single_choice' && text(q.stem,2000) && text(q.explanation,4000),'Unsupported or incomplete question');
    check(dense(q.options) && q.options.length>=2 && q.options.length<=8,'Invalid question options');
    for(const option of q.options){fields(option,['id','text']);check(id(option.id,64) && text(option.text,1000),'Invalid option');}
    check(new Set(q.options.map(o=>o.id)).size===q.options.length && new Set(q.options.map(o=>o.text.trim())).size===q.options.length,'Duplicate or ambiguous options');
    check(id(q.correctOptionId,64) && q.options.some(o=>o.id===q.correctOptionId),'Answer key is not an offered option');
    if(Object.hasOwn(q,'knowledgePoints'))points(q.knowledgePoints);
  }
  const bank=structuredClone(input);
  for(const q of bank.questions)if(!Object.hasOwn(q,'knowledgePoints'))q.knowledgePoints=[];
  return bank;
}

/** Stable round-robin over nonempty subject pools; requested topics form a union. */
export function selectQuestions(input,policy,options={}) {
  const bank=validateQuestionBank(input);let p;
  try{p=validatePolicy(policy);}catch{throw new QuizError('INVALID_SELECTION','Invalid quiz policy');}
  fields(options,['knowledgePoints'],[],'INVALID_SELECTION');
  const selectedPoints=Object.hasOwn(options,'knowledgePoints')?options.knowledgePoints:[];
  points(selectedPoints,'INVALID_SELECTION');
  const eligible=bank.questions.filter(q=>q.grade===p.grade && p.subjects.includes(q.subject) && (!selectedPoints.length || q.knowledgePoints.some(point=>selectedPoints.includes(point))));
  if(eligible.length<p.questionCount)throw new QuizError('INSUFFICIENT_QUESTIONS','Not enough matching questions',{available:eligible.length,required:p.questionCount});
  const groups=p.subjects.map(subject=>eligible.filter(q=>q.subject===subject)).filter(group=>group.length);
  const selected=[];
  for(let cursor=0;selected.length<p.questionCount;cursor++){
    for(const group of groups){if(group[cursor])selected.push(group[cursor]);if(selected.length===p.questionCount)break;}
  }
  return selected;
}
