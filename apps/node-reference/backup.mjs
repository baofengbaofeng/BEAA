import { openSqliteLifecycleStore,inspectSqliteLifecycleBackup,SqliteStoreError } from './sqlite-store.mjs';

class ArgumentError extends Error {
  constructor(){super('Use backup --source PATH --target NEW_PATH, or inspect --source PATH');this.code='INVALID_ARGUMENTS';}
}
function argumentsFor(argv){
  const [mode,...args]=argv,allowed=mode==='backup'?['--source','--target']:mode==='inspect'?['--source']:null;
  if(!allowed || args.length!==allowed.length*2)throw new ArgumentError();
  const flags=new Map();
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!allowed.includes(key) || flags.has(key) || !value || !value.trim() || value.startsWith('--'))throw new ArgumentError();
    flags.set(key,value);
  }
  if(!allowed.every(key=>flags.has(key)))throw new ArgumentError();
  return {mode,source:flags.get('--source'),target:flags.get('--target')};
}
try{
  const request=argumentsFor(process.argv.slice(2));
  const result=request.mode==='inspect'?await inspectSqliteLifecycleBackup(request.source):await (await openSqliteLifecycleStore(request.source)).backup(request.target);
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  const known=error instanceof ArgumentError || error instanceof SqliteStoreError;
  process.stderr.write(JSON.stringify({code:known?error.code:'OPERATION_FAILED',message:known?error.message:'Backup operation failed'})+'\n');
  process.exitCode=error instanceof ArgumentError?2:1;
}
