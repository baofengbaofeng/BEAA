import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QuizError,validateQuestionBank,selectQuestions } from './bank.mjs';
const sample=JSON.parse(readFileSync(new URL('./sample-questions.json',import.meta.url),'utf8'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const query=(count=5,extra={})=>({...policy,questionCount:count,requiredCorrect:count,...extra});
const rejected=(operation,code='INVALID_BANK')=>assert.throws(operation,e=>e instanceof QuizError && e.code===code);

test('shared sample assembles the default five distinct questions across subjects',()=>{
 const questions=selectQuestions(sample,policy);
 assert.equal(questions.length,5);assert.equal(new Set(questions.map(q=>q.id)).size,5);
 assert.deepEqual(new Set(questions.slice(0,3).map(q=>q.subject)),new Set(policy.subjects));
 assert.ok(questions.every(q=>q.grade===3));
});

test('selection applies actual grade, subject and knowledge-point union filters',()=>{
 const grade1={id:'grade1-math-001',grade:1,subject:'math',type:'single_choice',stem:'1 + 1 = ?',options:[{id:'A',text:'2'},{id:'B',text:'3'}],correctOptionId:'A',explanation:'1+1=2。',knowledgePoints:['addition']};
 const bank={version:1,questions:[...sample.questions,grade1]};
 assert.deepEqual(selectQuestions(bank,query(1,{grade:1,subjects:['math']})).map(q=>q.id),[grade1.id]);
 const math=selectQuestions(sample,query(2,{subjects:['math']}),{knowledgePoints:['multiplication','addition']});
 assert.deepEqual(new Set(math.map(q=>q.id)),new Set(['math-g3-002','math-g3-003']));
 rejected(()=>selectQuestions(sample,query(1),{knowledgePoints:['missing-topic']}),'INSUFFICIENT_QUESTIONS');
});

test('insufficient pools are refused without repeating questions or relabeling grades',()=>{
 assert.throws(()=>selectQuestions(sample,policy,{knowledgePoints:['vocabulary']}),e=>e.code==='INSUFFICIENT_QUESTIONS' && e.available===1 && e.required===5);
 rejected(()=>selectQuestions(sample,query(1,{grade:6})),'INSUFFICIENT_QUESTIONS');
});

test('legacy questions without knowledge-point tags remain valid and selection is isolated',()=>{
 const legacy=structuredClone(sample);for(const q of legacy.questions)delete q.knowledgePoints;
 assert.ok(validateQuestionBank(legacy).questions.every(q=>q.knowledgePoints.length===0));
 const original=structuredClone(sample);const selected=selectQuestions(sample,policy);
 selected[0].options[0].text='changed';selected[0].knowledgePoints.push('other');assert.deepEqual(sample,original);
});

test('bank rejects duplicate IDs, invalid answer references, sparse data and ambiguous choices',()=>{
 const q=sample.questions[0];
 const invalid=[
  null,{version:2,questions:[q]},{version:1,questions:[]},{version:1,questions:new Array(1)},
  {version:1,questions:[q,q]}, {version:1,questions:[{...q,grade:0}]},
  {version:1,questions:[{...q,subject:'physics'}]}, {version:1,questions:[{...q,type:'unknown'}]},
  {version:1,questions:[{...q,correctOptionId:'missing'}]},
  {version:1,questions:[{...q,options:[q.options[0],q.options[0]]}]},
  {version:1,questions:[{...q,options:[{id:'A',text:'same'},{id:'B',text:' same '}]}]},
  {version:1,questions:[{...q,options:new Array(2)}]},
  {version:1,questions:[{...q,knowledgePoints:['x','x']}]},
  {version:1,questions:[{...q,knowledgePoints:new Array(1)}]},
  {version:1,questions:[{...q,explanation:''}]},
  {version:1,questions:[{...q,expected:'A'}]}, {version:1,questions:[q],extra:true}
 ];
 for(const bank of invalid)rejected(()=>validateQuestionBank(bank));
});

test('invalid query fields and topic lists are rejected rather than ignored',()=>{
 for(const options of [null,{other:true},{knowledgePoints:['x','x']},{knowledgePoints:new Array(1)},{knowledgePoints:[' ']}]){
  rejected(()=>selectQuestions(sample,policy,options),'INVALID_SELECTION');
 }
 rejected(()=>selectQuestions(sample,{...policy,subjects:['physics']}),'INVALID_SELECTION');
});

test('curated sample answer keys match the documented arithmetic, poem and vocabulary',()=>{
 const expected={'math-g3-001':'16','math-g3-002':'48','math-g3-003':'32','chinese-g3-001':'处处闻啼鸟','english-g3-001':'苹果'};
 for(const [id,text] of Object.entries(expected)){
  const q=sample.questions.find(q=>q.id===id);assert.ok(q,id);assert.equal(q.options.find(o=>o.id===q.correctOptionId).text,text);
 }
});
