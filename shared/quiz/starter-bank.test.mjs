import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateQuestionBank,selectQuestions} from './bank.mjs';
import {exportBrowserQuestionBank} from './browser-export.mjs';
const input=()=>JSON.parse(readFileSync(new URL('./starter-questions.json',import.meta.url),'utf8'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const answer=q=>q.options.find(o=>o.id===q.correctOptionId).text;
test('all 18 grade/subject groups and their main knowledge point provide five distinct questions',()=>{
 const bank=validateQuestionBank(input());assert.equal(bank.questions.length,90);assert.equal(new Set(bank.questions.map(q=>q.id)).size,90);
 for(let grade=1;grade<=6;grade++)for(const subject of policy.subjects){const selected=selectQuestions(bank,{...policy,grade,subjects:[subject]});assert.equal(selected.length,5);assert(selected.every(q=>q.grade===grade&&q.subject===subject));assert.equal(new Set(selected.map(q=>q.id)).size,5);const tag=selected[0].knowledgePoints[0];assert.equal(selectQuestions(bank,{...policy,grade,subjects:[subject]},{knowledgePoints:[tag]}).length,5);}
});
test('all mathematics answers and distractors are checked using independent exact rational arithmetic',()=>{
 const math=input().questions.filter(q=>q.subject==='math');assert.equal(math.length,30);
 execFileSync('python3',['-c',`
import ast,json,sys
from fractions import Fraction

def calculate(node):
    if isinstance(node,ast.Constant) and type(node.value) in (int,float): return Fraction(str(node.value))
    if isinstance(node,ast.BinOp):
        a,b=calculate(node.left),calculate(node.right)
        if isinstance(node.op,ast.Add): return a+b
        if isinstance(node.op,ast.Sub): return a-b
        if isinstance(node.op,ast.Mult): return a*b
        if isinstance(node.op,ast.Div): return a/b
    raise AssertionError('Unexpected arithmetic form')
for q in json.load(sys.stdin):
    assert q['stem'].endswith(' = ?'),q['id']
    text=q['stem'][:-4].replace('×','*').replace('÷','/')
    expected=calculate(ast.parse(text,mode='eval').body)
    values=[Fraction(o['text']) for o in q['options']]
    assert len(values)==len(set(values)),q['id']+' equivalent numeric options'
    chosen=next(i for i,o in enumerate(q['options']) if o['id']==q['correctOptionId'])
    assert values[chosen]==expected,q['id']+' wrong answer'
`],{input:JSON.stringify(math),stdio:['pipe','pipe','pipe']});
});
test('English prompts and answer keys agree with explicit vocabulary and inflection reference facts',()=>{
 const groups=[['red|红色','blue|蓝色','green|绿色','yellow|黄色','black|黑色'],['cat|猫','dog|狗','bird|鸟','fish|鱼','rabbit|兔子'],['apple|苹果','banana|香蕉','orange|橙子','pear|梨','grape|葡萄'],['ruler|尺子','pencil|铅笔','eraser|橡皮','notebook|笔记本','school|学校'],['child|children','foot|feet','tooth|teeth','mouse|mice','goose|geese'],['go|went','see|saw','eat|ate','write|wrote','take|took']];
 for(let i=0;i<6;i++)for(let j=0;j<5;j++){const [word,value]=groups[i][j].split('|'),q=input().questions.find(q=>q.id===`starter-english-g${i+1}-${String(j+1).padStart(3,'0')}`);assert(q);assert(q.stem.includes('“'+word+'”'));assert.equal(answer(q),value);assert(q.explanation.includes(value));}
});
test('Chinese answers agree with explicit character, idiom, poem and rhetoric reference facts',()=>{
 const expected=[['小','下','少','shān','yú'],['足','兔','牢','蛙','方'],['疑是地上霜','疑是银河落九天','不及汪伦送我情','一行白鹭上青天','二月春风似剪刀'],['宽广','坚决','骄傲','模糊','珍爱'],['比喻','拟人','反问','设问','夸张'],['孟浩然','李白','骆宾王','李绅','杜甫']];
 for(let i=0;i<6;i++)for(let j=0;j<5;j++){const q=input().questions.find(q=>q.id===`starter-chinese-g${i+1}-${String(j+1).padStart(3,'0')}`);assert(q);assert.equal(answer(q),expected[i][j]);assert(q.explanation.includes(expected[i][j]));}
});
test('browser export preserves each question, option order and correct text without mutating its source',()=>{
 const source=input(),before=structuredClone(source),converted=exportBrowserQuestionBank(source);assert.equal(converted.length,90);assert.deepEqual(source,before);
 for(let i=0;i<converted.length;i++){const q=source.questions[i],b=converted[i];assert.equal(b.id,q.id);assert.equal(b.grade,q.grade);assert.equal(b.subject,q.subject);assert.equal(b.text,q.stem);assert.deepEqual(b.options,q.options.map(o=>o.text));assert.equal(b.options[b.answer],answer(q));assert.equal(b.explain,q.explanation);assert.equal(b.topic,{chinese:'poetry',math:'arithmetic',english:'vocabulary'}[q.subject]);}
 converted[0].options[0]='changed';assert.deepEqual(source,before);
});
test('browser-incompatible sizes are refused rather than truncated or silently omitted',()=>{
 const base=input().questions[0];for(const change of [{id:'x'.repeat(81)},{stem:'题'.repeat(1001)},{explanation:'解'.repeat(2001)},{options:[{id:'A',text:'字'.repeat(501)},{id:'B',text:'另一个'}],correctOptionId:'A'}])assert.throws(()=>exportBrowserQuestionBank({version:1,questions:[{...base,...change}]}),e=>e.code==='BROWSER_FORMAT_UNSUPPORTED');
});
test('browser answer conversion uses actual option order with nonalphabetical IDs',()=>{
 const question={...input().questions[0],id:'custom-option-ids',stem:'2 + 2 = ?',options:[{id:'wrong',text:'3'},{id:'correct-value',text:'4'}],correctOptionId:'correct-value',explanation:'2+2=4。'};
 const [converted]=exportBrowserQuestionBank({version:1,questions:[question]});assert.deepEqual(converted.options,['3','4']);assert.equal(converted.answer,1);
});
test('the serialized browser artifact accepts exactly 2000000 code units and rejects one more',()=>{
 const base=input().questions[0];
 const source={version:1,questions:Array.from({length:500},(_,i)=>({...base,id:'size-'+i,stem:'题'.repeat(600),explanation:'解',options:['A','B','C','D'].map(id=>({id,text:'字'.repeat(349)+id})),correctOptionId:'A'}))};
 const serialized=bank=>JSON.stringify(exportBrowserQuestionBank(bank),null,2)+'\n';
 let remaining=2000000-serialized(source).length;assert(remaining>0&&remaining<500*1999);
 for(const q of source.questions){const add=Math.min(remaining,1999);q.explanation+='解'.repeat(add);remaining-=add;}assert.equal(remaining,0);assert.equal(serialized(source).length,2000000);
 source.questions.find(q=>q.explanation.length<2000).explanation+='字';assert.throws(()=>exportBrowserQuestionBank(source),e=>e.code==='BROWSER_FORMAT_UNSUPPORTED');
});
