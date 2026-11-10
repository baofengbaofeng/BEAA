/** Exact string answer rules shared by browser and trusted v2 grading. */
export function normalizeFractionAnswer(input){
 if(typeof input!=='string'||input.length>48)return null;
 const value=input.trim().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/＋/g,'+').replace(/[－−]/g,'-').replace(/／/g,'/');
 const match=/^([+-]?\d{1,10})\s*\/\s*([+-]?\d{1,10})$/.exec(value);if(!match)return null;
 let n=BigInt(match[1]),d=BigInt(match[2]);if(d===0n||n>1000000000n||n< -1000000000n||d>1000000000n||d< -1000000000n)return null;
 if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return `${n/a}/${d/a}`;
}
function decimalUnits(value){const negative=value.startsWith('-');const [whole,fraction='']=value.replace(/^-/, '').split('.');const units=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));return negative?-units:units;}
export function evaluateScalarResponse(type,answer,response,absoluteTolerance){
 const value=type==='fraction'?normalizeFractionAnswer(response):normalizeNumericAnswer(response);
 if(value===null)return {valid:false,correct:false,value:null};
 let correct=value===answer;if(type==='numeric_tolerance'){const delta=decimalUnits(value)-decimalUnits(answer);correct=(delta<0n?-delta:delta)<=decimalUnits(absoluteTolerance);}
 return {valid:true,correct,value};
}
export function normalizeNumericAnswer(input){
 if(typeof input!=='string'||input.length>48)return null;
 const ascii=input.trim().replace(/[０-９]/g,char=>String.fromCharCode(char.charCodeAt(0)-0xfee0)).replace(/[＋]/g,'+').replace(/[－−]/g,'-').replace(/．/g,'.');
 if(!/^[+-]?(?:\d{1,12}(?:\.\d{0,6})?|\.\d{1,6})$/.test(ascii))return null;
 const negative=ascii[0]==='-';const body=/^[+-]/.test(ascii)?ascii.slice(1):ascii;
 let [integer,fraction='']=body.split('.');integer=(integer||'0').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
 const magnitude=integer+(fraction?'.'+fraction:'');return negative&&magnitude!=='0'?'-'+magnitude:magnitude;
}
export function validatePreviewQuestion(q){
 if(!q||typeof q!=='object'||Array.isArray(q)||typeof q.id!=='string'||q.id.length<1||q.id.length>80||!Number.isInteger(q.grade)||q.grade<1||q.grade>6||!['math','chinese','english'].includes(q.subject)||!['arithmetic','poetry','vocabulary'].includes(q.topic)||typeof q.text!=='string'||!q.text.length||q.text.length>1000||typeof q.explain!=='string'||q.explain.length>2000)return false;
 if(['numeric','fraction','numeric_tolerance'].includes(q.type)){const normalize=q.type==='fraction'?normalizeFractionAnswer:normalizeNumericAnswer;return !Object.hasOwn(q,'options')&&typeof q.answer==='string'&&normalize(q.answer)===q.answer&&(q.type==='numeric_tolerance'?typeof q.absoluteTolerance==='string'&&normalizeNumericAnswer(q.absoluteTolerance)===q.absoluteTolerance&&!q.absoluteTolerance.startsWith('-'):!Object.hasOwn(q,'absoluteTolerance'));}
 if(q.type!==undefined&&!['single_choice','true_false'].includes(q.type))return false;
 if(!Array.isArray(q.options)||Object.keys(q.options).length!==q.options.length||q.options.length<2||q.options.length>8||!q.options.every(option=>typeof option==='string'&&option.length>0&&option.length<=500)||new Set(q.options).size!==q.options.length||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)return false;
 return q.type!=='true_false'||q.options.length===2&&q.options[0]==='正确'&&q.options[1]==='错误';
}
export function evaluatePreviewResponse(question,response){
 const invalid={valid:false,correct:false,value:null};
 if(!validatePreviewQuestion(question))return invalid;
 if(['numeric','fraction','numeric_tolerance'].includes(question.type))return evaluateScalarResponse(question.type,question.answer,response,question.absoluteTolerance);
 if(!Number.isInteger(response)||response<0||response>=question.options.length)return invalid;
 return {valid:true,correct:response===question.answer,value:response};
}
export function previewResponseLabel(question,response){
 const result=evaluatePreviewResponse(question,response);
 return !result.valid?'无效答案':!question.options?result.value:question.options[result.value];
}
