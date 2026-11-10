import {readFileSync,writeFileSync} from 'node:fs';
const page=new URL('../apps/web-preview/index.html',import.meta.url);
const html=readFileSync(page,'utf8');let generated=html;
for(const [folder,file,label] of [['domain','temporary-access.mjs','TEMPORARY ACCESS'],['domain','quiet-hours.mjs','QUIET HOURS'],['quiz','answer-types.mjs','ANSWER TYPES']]){
 const start='// BEGIN BEAA '+label,end='// END BEAA '+label;
 const body=readFileSync(new URL('../shared/'+folder+'/'+file,import.meta.url),'utf8').replace(/^export /gm,'');
 if(body.includes('</script'))throw Error('Embedded source cannot close a script');
 const block=start+'\n'+body+end;
 if(generated.includes(start)){
  const first=generated.indexOf(start),last=generated.indexOf(end,first);
  if(last<first)throw Error('Missing embedded source boundary');
  generated=generated.slice(0,first)+block+generated.slice(last+end.length);
 }else{
  const anchor='// END BEAA TEMPORARY ACCESS';
  generated=label==='TEMPORARY ACCESS'?generated.replace('"use strict";','"use strict";\n'+block):generated.replace(anchor,()=>anchor+'\n'+block);
 }
}
if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('Only --check is supported');
if(process.argv.includes('--check')){if(html!==generated)throw Error('Embedded preview domain is stale; run npm run sync:preview');}
else writeFileSync(page,generated);
console.log(process.argv.includes('--check')?'Embedded preview domain matches ESM source':'Embedded preview domain updated');
