import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCurriculum,validateCurriculum,buildPracticePack,createReviewRequest,releaseCurriculum} from '../shared/quiz/curriculum/index.mjs';
const args=process.argv.slice(2);const value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
const allowed=new Set(['--out','--release','--review','--trusted-reviewers']);
for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw new Error(`Unknown argument: ${args[i]}`);if(args[i]!=='--release'){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing value: ${args[i]}`);i++;}}
const c=buildCurriculum();validateCurriculum(c);const out=resolve(value('--out')??'shared/quiz/curriculum/generated');
let release=null;
if(args.includes('--release')){if(!value('--review')||!value('--trusted-reviewers'))throw new Error('Production release requires --review and --trusted-reviewers files');release=releaseCurriculum(c,JSON.parse(await readFile(value('--review'),'utf8')),JSON.parse(await readFile(value('--trusted-reviewers'),'utf8')));}
await mkdir(out,{recursive:true});const write=(name,data)=>writeFile(resolve(out,name),JSON.stringify(data,null,2)+'\n');
await write('curriculum.draft.json',c);await write('review-request.json',createReviewRequest(c));
for(let grade=1;grade<=6;grade++)for(const subject of ['math','chinese','english'])for(const stage of ['foundation','developing','consolidation'])await write(`${subject}-g${grade}-${stage}.draft.json`,buildPracticePack(c,{grade,subject,stage}));
if(release)await write('curriculum.released.json',release);
console.log(JSON.stringify({status:release?'teacher-reviewed':'draft',units:c.units.length,questions:c.units.reduce((n,u)=>n+u.questions.length,0),practicePacks:54,output:out}));
