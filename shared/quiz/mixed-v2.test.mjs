import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFractionAnswer,evaluatePreviewResponse,validatePreviewQuestion} from './answer-types.mjs';
import {validateQuestionBank} from './bank.mjs';
import {exportBrowserQuestionBank} from './browser-export.mjs';
const base={id:'f',grade:3,subject:'math',type:'fraction',stem:'Half?',correctAnswer:'1/2',explanation:'Half'};
test('fractions reduce exactly and reject zero/oversized denominators',()=>{assert.equal(normalizeFractionAnswer(' −２ / −４ '),'1/2');assert.equal(normalizeFractionAnswer('1/0'),null);assert.equal(normalizeFractionAnswer('1000000001/2'),null);});
test('v2 mixed banks export scalar keys while v1 remains strict',()=>{const bank={version:2,questions:[base,{...base,id:'n',type:'numeric_tolerance',correctAnswer:'999999999999.9',absoluteTolerance:'0.1'}]};assert.equal(validateQuestionBank(bank).version,2);assert.throws(()=>validateQuestionBank({...bank,version:1}));const out=exportBrowserQuestionBank(bank);assert.ok(out.every(validatePreviewQuestion));assert.equal(evaluatePreviewResponse(out[0],'2/4').correct,true);assert.equal(evaluatePreviewResponse(out[1],'999999999999.999999').correct,true);assert.equal(evaluatePreviewResponse(out[1],'999999999999.799999').correct,false);assert.equal(validatePreviewQuestion({...out[1],absoluteTolerance:'-0.1'}),false);});
test('mixed v2 rejects noncanonical keys and implicit tolerances',()=>{
 for(const question of [{...base,correctAnswer:'2/4'},{...base,type:'numeric',correctAnswer:2.5},{...base,type:'numeric_tolerance',correctAnswer:'2.5'},{...base,type:'numeric_tolerance',correctAnswer:'2.5',absoluteTolerance:'0.10'},{...base,type:'numeric_tolerance',correctAnswer:'2.5',absoluteTolerance:'-0.1'},{...base,options:[]}])assert.throws(()=>validateQuestionBank({version:2,questions:[question]}));
});
