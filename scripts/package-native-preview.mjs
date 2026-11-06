import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),source=new URL('apps/web-preview/index.html',root),target=new URL('apps/harmony/entry/src/main/resources/rawfile/beaa-preview.html',root);
if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('Only --check is supported');
execFileSync(process.execPath,['scripts/embed-preview-domain.mjs','--check'],{cwd:root,stdio:'pipe'});
const bytes=readFileSync(source);
if(process.argv.includes('--check')){
 if(!readFileSync(target).equals(bytes))throw Error('Native offline resource is stale; run npm run build:native-preview');
 console.log('Native offline resource matches browser source; no SDK build performed');
}else{
 mkdirSync(new URL('./',target),{recursive:true});writeFileSync(target,bytes);
 console.log('Native offline resource prepared; no SDK build performed');
}
