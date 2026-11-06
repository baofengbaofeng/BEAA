import {readFileSync,writeFileSync} from 'node:fs';
const page=new URL('../apps/web-preview/index.html',import.meta.url),source=new URL('../shared/domain/temporary-access.mjs',import.meta.url);
const start='// BEGIN BEAA TEMPORARY ACCESS',end='// END BEAA TEMPORARY ACCESS';
const body=readFileSync(source,'utf8').replace(/^export /gm,'');
if(body.includes('</script'))throw Error('Embedded source cannot close a script');
const block=start+'\n'+body+end,html=readFileSync(page,'utf8');
let generated;
if(html.includes(start)){
 const first=html.indexOf(start),last=html.indexOf(end,first);
 if(last<first)throw Error('Missing embedded source boundary');
 generated=html.slice(0,first)+block+html.slice(last+end.length);
}else generated=html.replace('"use strict";','"use strict";\n'+block);
if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('Only --check is supported');
if(process.argv.includes('--check')){if(html!==generated)throw Error('Embedded preview domain is stale; run npm run sync:preview');}
else writeFileSync(page,generated);
console.log(process.argv.includes('--check')?'Embedded preview domain matches ESM source':'Embedded preview domain updated');
