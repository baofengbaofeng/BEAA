import ts from 'typescript';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
/** Compile and execute the actual platform-independent native source; not an ArkTS/HAP build. */
export function loadNativeCore(names){
 const root=fileURLToPath(new URL('../apps/harmony/entry/src/main/ets/services/',import.meta.url)),out=mkdtempSync(join(tmpdir(),'beaa-native-core-'));
 try{
  const program=ts.createProgram(names.map(name=>join(root,name+'.ts')),{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,strict:true,outDir:out,rootDir:root,skipLibCheck:true,types:[],lib:['lib.es2020.d.ts','lib.dom.d.ts']});
  const diagnostics=ts.getPreEmitDiagnostics(program);if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
  const emitted=program.emit();if(emitted.emitSkipped)throw Error('Native core TypeScript emit failed');
  writeFileSync(join(out,'package.json'),'{"type":"commonjs"}');const require=createRequire(join(out,'entry.cjs'));
  return Object.assign({},...names.map(name=>require(join(out,name+'.js'))));
 }finally{rmSync(out,{recursive:true,force:true});}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 loadNativeCore(['NativeSummary','ReminderDelivery']);console.log('Portable native service TypeScript checked; no SDK/HAP build performed');
}
