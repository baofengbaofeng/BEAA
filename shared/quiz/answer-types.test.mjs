import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('./answer-types.mjs').catch(()=>null);
function api(){assert.ok(module,'typed client answer rules must exist');return module;}
const numeric={id:'number-1',grade:3,subject:'math',topic:'arithmetic',type:'numeric',text:'1.5 + 1 = ?',answer:'2.5',explain:'1.5加1等于2.5。'};
test('numeric normalization is exact and accepts full width, signs and equivalent decimal forms',()=>{
 const {normalizeNumericAnswer:n}=api();
 for(const [input,expected] of [['  ＋００２．５００  ','2.5'],['−０．００','0'],['.5','0.5'],['2.','2'],['\uFEFF2\uFEFF','2'],['-00012.0500','-12.05'],['999999999999.999999','999999999999.999999']])assert.equal(n(input),expected);
});
test('numeric normalization rejects ambiguous, hostile and out of contract inputs',()=>{
 const {normalizeNumericAnswer:n}=api();for(const input of ['', ' ','.','+','1e2','NaN','Infinity','1/2','2kg','1,000','1 2','\u00852\u0085','1.1234567','1234567890123',2,null,{},'0'.repeat(49),'<img src=x>'])assert.equal(n(input),null,String(input));
});
test('typed validation retains old choices and pins canonical numeric answer keys',()=>{
 const {validatePreviewQuestion:v}=api();assert.equal(v(numeric),true);
 assert.equal(v({...numeric,answer:'2.50'}),false);assert.equal(v({...numeric,options:[]}),false);
 const legacy={id:'old',grade:3,subject:'math',topic:'arithmetic',text:'1+1=?',options:['2','3'],answer:0,explain:'2'};
 assert.equal(v(legacy),true);assert.equal(v({...legacy,type:'true_false',options:['正确','错误']}),true);assert.equal(v({...legacy,type:'true_false',options:['是','否']}),false);assert.equal(v({...legacy,type:'unknown'}),false);
});
test('grading separates malformed entries from wrong attempts without floating point rounding',()=>{
 const {evaluatePreviewResponse:g,previewResponseLabel:label}=api();
 assert.deepEqual(g(numeric,'２．５００'),{valid:true,correct:true,value:'2.5'});
 assert.deepEqual(g(numeric,'2.500001'),{valid:true,correct:false,value:'2.500001'});
 assert.deepEqual(g(numeric,'2.5元'),{valid:false,correct:false,value:null});assert.equal(label(numeric,'2.500001'),'2.500001');
 const tiny={...numeric,answer:'999999999999.999999'};assert.equal(g(tiny,'999999999999.999998').correct,false);
});

test('mixed practice artifact has valid typed questions and known answer keys',async()=>{
 const {readFile}=await import('node:fs/promises');const questions=JSON.parse(await readFile(new URL('./mixed-browser-questions.json',import.meta.url),'utf8'));
 assert.equal(questions.length,5);assert.ok(questions.every(api().validatePreviewQuestion));assert.equal(questions[0].answer,'32');assert.equal(questions[1].answer,0);assert.equal(questions[2].answer,'2.5');assert.equal(questions[3].answer,1);assert.equal(questions[4].options[questions[4].answer],'苹果');
});
