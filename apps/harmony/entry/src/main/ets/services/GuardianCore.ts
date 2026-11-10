import { NativeLearningState, NativeRound, initialLearning, validateLearning, startRound, answerOnce, practiceQuantum } from './NativeLearning';
/** Portable native backend. No WebView caller can access this service. Reservations are not OS grants. */
export interface Credential { version: number; salt: string; hash: string }
export interface GuardianState { learning: NativeLearningState; revision: number; credential: Credential | null; failures: number; lockedUntil: number; lastTime: number; remainingSeconds: number; reservedSeconds: number }
export interface GuardianStorage { read(): Promise<GuardianState>; compareAndSwap(revision: number, next: GuardianState): Promise<boolean> }
export interface GuardianCrypto { salt(): Promise<string>; derive(pin: string, salt: string): Promise<string>; token(): Promise<string> }
export function initialGuardian(): GuardianState { return {learning:initialLearning(),revision:0,credential:null,failures:0,lockedUntil:0,lastTime:0,remainingSeconds:0,reservedSeconds:0}; }
export function validateGuardian(s: GuardianState): GuardianState {
  if (!s || ![s.revision,s.failures,s.lockedUntil,s.lastTime,s.remainingSeconds,s.reservedSeconds].every(n=>Number.isSafeInteger(n)&&n>=0) || s.remainingSeconds>s.reservedSeconds || s.reservedSeconds>7200 || s.failures>5 || (s.credential!==null && (!Number.isSafeInteger(s.credential.version)||s.credential.version<1||typeof s.credential.salt!=='string'||!s.credential.salt||typeof s.credential.hash!=='string'||!s.credential.hash))) throw Error('Invalid guardian state');
  validateLearning(s.learning);
  return s;
}
interface Authorization { token: string; version: number; expires: number }
export class GuardianService {
  private authorization: Authorization | null = null;
  private authenticationEpoch: number = 0;
  private checkAuthentication(epoch: number): void { if(epoch!==this.authenticationEpoch)throw Error('Authentication cancelled'); }
  constructor(private storage: GuardianStorage, private crypto: GuardianCrypto, private clock: ()=>number) {}
  private async read(): Promise<GuardianState> { return validateGuardian(await this.storage.read()); }
  private observedTime: number = 0;
  private time(s: GuardianState): number { const now=this.clock(); if(!Number.isSafeInteger(now)||now<Math.max(s.lastTime,this.observedTime)) {this.lock();throw Error('Untrusted clock');} this.observedTime=now;return now; }
  private pin(pin: string): void { if(!/^\d{6,12}$/.test(pin))throw Error('PIN requires 6–12 digits'); }
  private async save(s: GuardianState,now: number): Promise<void> { const revision=s.revision;s.revision++;s.lastTime=now;validateGuardian(s);if(!await this.storage.compareAndSwap(revision,s)){this.lock();throw Error('Concurrent guardian conflict');} }
  async enroll(pin: string): Promise<void> {this.pin(pin);const s=await this.read(),now=this.time(s);if(s.credential)throw Error('Already enrolled');const salt=await this.crypto.salt();s.credential={version:1,salt,hash:await this.crypto.derive(pin,salt)};await this.save(s,now);}
  async authenticate(pin: string): Promise<string> {
    const epoch=++this.authenticationEpoch;this.authorization=null; const s=await this.read();this.checkAuthentication(epoch);const now=this.time(s); if(!s.credential)throw Error('Not enrolled');if(now<s.lockedUntil)throw Error('PIN locked');
    const hash=/^\d{6,12}$/.test(pin) ? await this.crypto.derive(pin,s.credential.salt) : '';
    if(!constantEqual(hash,s.credential.hash)){s.failures=Math.min(5,s.failures+1);if(s.failures===5)s.lockedUntil=now+300000;await this.save(s,now);throw Error('Invalid PIN');}
    this.checkAuthentication(epoch);
    const token=await this.crypto.token();this.checkAuthentication(epoch);
    const expires=now+120000,committedAt=this.time(s);if(committedAt>=expires)throw Error('Authentication expired');
    s.failures=0;s.lockedUntil=0;await this.save(s,committedAt);this.checkAuthentication(epoch);
    if(this.time(s)>=expires)throw Error('Authentication expired');
    this.authorization={token,version:s.credential.version,expires};return token;
  }
  private authorize(s: GuardianState,token: string,now: number): void {const a=this.authorization;if(!a||!s.credential||!constantEqual(a.token,token)||a.version!==s.credential.version||now>=a.expires)throw Error('Parent authorization required');}
  async changePin(token: string,pin: string): Promise<void> {
    this.pin(pin);const epoch=this.authenticationEpoch,s=await this.read(),now=this.time(s);
    this.checkAuthentication(epoch);this.authorize(s,token,now);
    const salt=await this.crypto.salt();this.checkAuthentication(epoch);
    const hash=await this.crypto.derive(pin,salt);this.checkAuthentication(epoch);
    const committedAt=this.time(s);this.authorize(s,token,committedAt);
    s.credential={version:s.credential!.version+1,salt,hash};
    await this.save(s,committedAt);this.authorization=null;
  }
  async allocate(token: string,minutes: number): Promise<void> {const s=await this.read(),now=this.time(s);this.authorize(s,token,now);if(!Number.isInteger(minutes)||minutes<1||minutes>30||s.reservedSeconds+minutes*60>7200)throw Error('Budget exceeded');s.remainingSeconds+=minutes*60;s.reservedSeconds+=minutes*60;await this.save(s,now);}
  async learningSnapshot(): Promise<NativeLearningState> { const s=await this.read();this.time(s);return JSON.parse(JSON.stringify(s.learning)) as NativeLearningState; }
  async beginPracticeRound(): Promise<NativeRound> { const s=await this.read(),now=this.time(s);const round=startRound(s.learning);await this.save(s,now);return JSON.parse(JSON.stringify(round)) as NativeRound; }
  async submitPracticeFirstAnswer(roundId: number, questionId: string, answer: string): Promise<void> { const s=await this.read(),now=this.time(s);answerOnce(s.learning,roundId,questionId,answer);await this.save(s,now); }
  private practiceEpoch: number = 0;
  private foregroundEnabled: boolean = false;
  /** Epoch spans the asynchronous read so lifecycle suspension cannot be undone by a late start. */
  async beginForegroundPractice(): Promise<NativeLearningState> {
    const epoch=++this.practiceEpoch;this.foregroundEnabled=false;this.foregroundAt=null;this.foregroundCallbackAt=null;
    const s=await this.read();
    if(epoch!==this.practiceEpoch)throw Error('Foreground practice paused');
    this.time(s);
    if(s.learning.available===0&&s.learning.restRemaining===0)throw Error('Practice qualification required');
    this.foregroundEnabled=true;
    return JSON.parse(JSON.stringify(s.learning)) as NativeLearningState;
  }
  private foregroundAt: number | null = null;
  private foregroundCallbackAt: number | null = null;
  /** Call only from the native visible page. First callback establishes a baseline. */
  async sampleForegroundPractice(rest: boolean): Promise<void> {
    if(!this.foregroundEnabled)throw Error('Foreground practice paused');
    const epoch=this.practiceEpoch;const s=await this.read();
    if(!this.foregroundEnabled||epoch!==this.practiceEpoch)throw Error('Foreground practice paused');
    const now=this.time(s),previous=this.foregroundAt,callback=this.foregroundCallbackAt;this.foregroundAt=null;this.foregroundCallbackAt=null;
    if(previous===null){await this.save(s,now);if(this.foregroundEnabled&&epoch===this.practiceEpoch){this.foregroundAt=now;this.foregroundCallbackAt=now;}return;}
    const elapsed=now-previous;
    if(callback===null||now-callback>3000){await this.save(s,now);if(this.foregroundEnabled&&epoch===this.practiceEpoch){this.foregroundAt=now;this.foregroundCallbackAt=now;}return;}
    if(elapsed<1000){if(this.foregroundEnabled&&epoch===this.practiceEpoch){this.foregroundAt=previous;this.foregroundCallbackAt=now;}return;}
    const seconds=Math.floor(elapsed/1000);
    practiceQuantum(s.learning,seconds,rest);await this.save(s,now);
    if(this.foregroundEnabled&&epoch===this.practiceEpoch){this.foregroundAt=previous+seconds*1000;this.foregroundCallbackAt=now;}
  }
  /** A parent acknowledges the next local practice day; clock/date alone never resets limits. */
  async acknowledgePracticeDay(token: string): Promise<void> {
    const s=await this.read(),now=this.time(s);this.authorize(s,token,now);
    if(s.learning.used!==7200||s.learning.available!==0||s.learning.restRemaining!==0)throw Error('Finish exact practice day progress first');
    const day=s.learning.day,nextRound=s.learning.nextRound;s.learning=initialLearning();s.learning.day=day+1;s.learning.nextRound=nextRound;await this.save(s,now);this.foregroundAt=null;this.foregroundCallbackAt=null;
  }
  lock(): void {this.authenticationEpoch++;this.practiceEpoch++;this.authorization=null;this.foregroundAt=null;this.foregroundCallbackAt=null;this.foregroundEnabled=false;}
}
function constantEqual(a: string,b: string): boolean {let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
