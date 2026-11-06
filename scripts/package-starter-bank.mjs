import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateQuestionBank,selectQuestions} from '../shared/quiz/bank.mjs';
import {exportBrowserQuestionBank} from '../shared/quiz/browser-export.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDefault=new URL('../shared/quiz/starter-questions.json',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
/** All validation precedes filesystem output. Named build artifacts may be regenerated. */
export function buildStarterBank({sourcePath=sourceDefault,outputDirectory=join(root,'dist/beaa-starter-bank')}={}){
 const sourceBytes=readFileSync(sourcePath);let input;
 try{input=JSON.parse(sourceBytes.toString('utf8'));}catch{throw new Error('Source question bank is not valid JSON');}
 const bank=validateQuestionBank(input),browser=exportBrowserQuestionBank(bank),groups=[];
 const subjects=['chinese','math','english'];
 for(let grade=1;grade<=6;grade++)for(const subject of subjects){
  const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade,subjects:[subject]};
  const selected=selectQuestions(bank,policy),point=selected[0].knowledgePoints[0];
  if(!point)throw new Error('Every starter group requires a main knowledge point');
  selectQuestions(bank,policy,{knowledgePoints:[point]});
  groups.push({grade,subject,available:bank.questions.filter(q=>q.grade===grade&&q.subject===subject).length,selected:selected.length,mainKnowledgePoint:point});
 }
 const shared=json(bank),report={schemaVersion:1,sourceSha256:hash(sourceBytes),sharedSha256:hash(shared),questionCount:bank.questions.length,minimumPerGroup:5,groups,coverageStatus:'passed',educatorReview:'pending',curriculumAlignmentVerified:false};
 const files={'beaa-starter-bank.shared.json':shared,'beaa-starter-bank.browser.json':json(browser),'beaa-starter-bank.coverage.json':json(report),'BEAA_STARTER_BANK_README.md':readFileSync(new URL('../shared/quiz/STARTER_BANK.md',import.meta.url))};
 files.STARTER_BANK_SHA256SUMS=Buffer.from(Object.keys(files).sort().map(name=>`${hash(files[name])}  ${name}\n`).join(''),'utf8');
 const target=resolve(outputDirectory);mkdirSync(target,{recursive:true});
 for(const name of Object.keys(files).sort())writeFileSync(join(target,name),files[name]);
 return {outputDirectory:target,questionCount:bank.questions.length,groupCount:groups.length,files:Object.keys(files).sort()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options={},args=process.argv.slice(2),flags={'--source':'sourcePath','--output-dir':'outputDirectory'};
  for(let i=0;i<args.length;i+=2){const key=Object.hasOwn(flags,args[i])?flags[args[i]]:null;if(!key||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(options,key))throw new Error('Use --source PATH and/or --output-dir PATH');options[key]=args[i+1];}
  const result=buildStarterBank(options);console.log(`Built ${result.questionCount} starter questions across ${result.groupCount} grade/subject groups: ${result.outputDirectory}`);
 }catch(error){console.error(`Starter bank build failed: ${error.message}`);process.exitCode=1;}
}
