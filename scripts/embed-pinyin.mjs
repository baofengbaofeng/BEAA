import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const library=readFileSync(new URL('node_modules/pinyin-pro/dist/index.js',root),'utf8');
const license=readFileSync(new URL('node_modules/pinyin-pro/LICENSE',root),'utf8');
const helper=readFileSync(new URL('shared/ui/pinyin-ui.js',root),'utf8');
const block='// BEGIN BEAA PINYIN\n/* pinyin-pro 3.29.5\n'+license+'*/\n'+library+'\n'+helper+'\n// END BEAA PINYIN';
for(const path of ['apps/web-preview/index.html','apps/browser-check/index.html']){
 const url=new URL(path,root),source=readFileSync(url,'utf8');
 const result=source.includes('// BEGIN BEAA PINYIN')?source.replace(/\/\/ BEGIN BEAA PINYIN[\s\S]*?\/\/ END BEAA PINYIN/,()=>block):source.replace('<script>','<script>\n'+block+'\n');
 if(process.argv.includes('--check')){if(result!==source)throw Error(path+' pinyin resource is stale');}else writeFileSync(url,result);
}
console.log('Offline pinyin resources '+(process.argv.includes('--check')?'match':'embedded'));
