import web_webview from '@ohos.web.webview';
import common from '@ohos.app.ability.common';
import { nativeReading } from '../services/NativeChineseReading';
import { NativePreviewBridge } from '../services/NativePreviewBridge';
import { NativeLearningState } from '../services/NativeLearning';
import { GuardianService } from '../services/GuardianCore';
import { NativeGuardianSession } from '../services/NativeGuardianSession';
import { NativeGuardianStore } from '../services/NativeGuardianStore';
import { NativeGuardianCrypto } from '../services/NativeGuardianCrypto';
import { NativeDeviceCapabilities } from '../services/NativeDeviceCapabilities';

/** Native parent panel is outside the untrusted preview bridge. Device control remains unavailable. */
@Entry
@Component
struct Index {
  private controller: web_webview.WebviewController = new web_webview.WebviewController();

  private bridge: NativePreviewBridge = new NativePreviewBridge(this.controller);

  private guardian: GuardianService | null = null;
  private parentToken: string = '';
  private practiceTimer: number = -1;
  private practiceBusy: boolean = false;
  private practiceRest: boolean = false;
  private practiceRound: number = 0;
  private practiceQuestion: string = '';
  @State private practiceOpen: boolean = false;
  @State private practiceRunning: boolean = false;
  @State private practicePrompt: string = '';
  @State private practiceAnswer: string = '';
  @State private practiceStatus: string = '原生前台练习：未取得资格';
  private async refreshPractice(): Promise<void> {
    if (!this.guardian) return;
    const s: NativeLearningState = await this.guardian.learningSnapshot();
    this.practiceStatus = '练习日 ' + (s.day + 1) + ' · 已练习 ' + s.used + '秒 / 7200秒 · 资格 ' + s.available + '秒 · 待休息 ' + s.restRemaining + '秒';
    this.practicePrompt = ''; this.practiceQuestion = '';
    if (s.round && !s.round.completed) {
      this.practiceRound = s.round.id;
      for (const q of s.round.questions) { if (q.firstAnswer === null) { this.practiceQuestion=q.id; this.practicePrompt=q.prompt; break; } }
    } else if (s.round && s.round.completed && !s.round.granted) this.practicePrompt = '首答未全部正确，本轮不授予资格。可重新开始。';
    if (this.practiceRunning && ((s.restRemaining > 0) !== this.practiceRest || (!this.practiceRest && s.available === 0))) { this.practiceRunning = false; this.guardian.lock(); }
  }
  private async practiceAction(action: string): Promise<void> {
    if (!this.guardian || this.practiceBusy) return;
    this.practiceBusy = true;
    try {
      if (action === 'round') await this.guardian.beginPracticeRound();
      if (action === 'answer') { const answer=this.practiceAnswer;this.practiceAnswer='';await this.guardian.submitPracticeFirstAnswer(this.practiceRound,this.practiceQuestion,answer); }
      if (action === 'start') {
        const s=await this.guardian.beginForegroundPractice();
        this.practiceRest=s.restRemaining>0;this.practiceRunning=true;
        await this.guardian.sampleForegroundPractice(this.practiceRest);
      }
      if (action === 'stop') { this.practiceRunning=false;this.guardian.lock(); }
      if (action === 'day') await this.guardian.acknowledgePracticeDay(this.parentToken);
      await this.refreshPractice();
    } catch { this.practiceRunning=false;this.guardian.lock();this.practiceStatus='练习操作拒绝；检查首答、资格、休息、家长验证、时钟或存储'; }
    finally { this.practiceBusy=false; }
  }
  private async practiceTick(): Promise<void> {
    if (!this.guardian || !this.practiceRunning || this.practiceBusy) return;
    this.practiceBusy=true;
    try { await this.guardian.sampleForegroundPractice(this.practiceRest);await this.refreshPractice(); }
    catch { this.practiceRunning=false;this.guardian.lock();this.practiceStatus='前台练习已暂停；需手动继续，后台和长时间间隔不计时'; }
    finally { this.practiceBusy=false; }
  }
  @State private parentPin: string = '';
  @State private parentStatus: string = '原生安全存储初始化中';
  @State private parentOpen: boolean = false;
  private async initializeGuardian(): Promise<void> {
    try { this.guardian = new GuardianService(await NativeGuardianStore.open(getContext(this) as common.UIAbilityContext), new NativeGuardianCrypto(), () => Date.now()); NativeGuardianSession.current = this.guardian; await this.refreshPractice(); this.practiceTimer=setInterval(() => { this.practiceTick(); }, 1000); this.parentStatus = '原生PIN：6–12位数字；验证有效期2分钟'; }
    catch { this.guardian = null; this.parentStatus = '安全存储不可用，拒绝家长操作（不清空数据）'; }
  }
  private async parentAction(action: string): Promise<void> {
    const pin = this.parentPin; this.parentPin = '';
    if (this.guardian === null) return;
    try {
      if (action === 'enroll') await this.guardian.enroll(pin);
      if (action === 'auth') this.parentToken = await this.guardian.authenticate(pin);
      if (action === 'change') { await this.guardian.changePin(this.parentToken, pin); this.parentToken = ''; }
      this.parentStatus = action === 'auth' ? '家长已验证（2分钟），设备管控仍不可用' : '原生凭据已保存';
    } catch { this.parentToken = ''; this.parentStatus = '操作拒绝：检查PIN、冷却时间、存储和凭据版本'; }
  }

  @State private reminderStatus: string = '演示提醒尚未启用';
  aboutToAppear(): void { this.bridge.configure(getContext(this) as common.UIAbilityContext, text => { this.reminderStatus = text; }); this.initializeGuardian(); }
  onPageHide(): void { this.practiceRunning=false; this.guardian?.lock(); this.parentToken = ''; this.parentPin = ''; }
  aboutToDisappear(): void { this.practiceRunning=false; if(this.practiceTimer>=0)clearInterval(this.practiceTimer); this.guardian?.lock(); NativeGuardianSession.current = null; this.parentToken = ''; this.parentPin = ''; this.bridge.dispose(); }

  build() {
    Column({ space: 8 }) {
      Text(nativeReading('学知守护 · 离线交互预览'))
        .fontSize(18).fontColor('#174B53').padding(8)
      Text(nativeReading('本地演示数据，不具备跨应用计时或限制能力'))
        .fontSize(13).fontColor('#52757C')
      Scroll() {
        Column({ space: 8 }) {
      Row({ space: 8 }) {
        Button(nativeReading('启用演示提醒')).fontSize(14).height(64).onClick(() => this.bridge.enableReminders())
        Button(nativeReading('停止提醒')).fontSize(14).height(64).onClick(() => this.bridge.stopReminders())
      }
      Button(nativeReading('原生家长安全设置')).height(64).onClick(() => { this.parentOpen = !this.parentOpen; this.guardian?.lock(); this.parentToken = ''; this.parentPin = ''; })
      if (this.parentOpen) {
        Column({ space: 6 }) {
          Text(nativeReading(this.parentStatus)).fontSize(12)
          Text(nativeReading('原生家长PIN')).fontSize(11)
          TextInput({ placeholder: nativeReading('原生家长PIN'), text: this.parentPin }).type(InputType.Password).maxLength(12).onChange((text: string) => { this.parentPin = text; })
          Row({ space: 6 }) {
            Button(nativeReading('首次设置')).height(64).onClick(() => this.parentAction('enroll'))
            Button(nativeReading('验证')).height(64).onClick(() => this.parentAction('auth'))
            Button(nativeReading('更换PIN')).height(64).onClick(() => this.parentAction('change'))
          }
          Text(nativeReading(new NativeDeviceCapabilities().health().provenance)).fontSize(11)
          Text(nativeReading('跨应用使用、可信休息、限制及解除未获授权；不能分配真实使用资格')).fontSize(12)
        }
      }
      Button(nativeReading(this.practiceOpen ? '收起原生练习' : '打开原生练习')).height(64).onClick(() => { this.practiceOpen=!this.practiceOpen; if(!this.practiceOpen){this.practiceRunning=false;this.guardian?.lock();this.parentToken='';} })
      if (this.practiceOpen) {
      Column({ space: 4 }) {
        Text(nativeReading('原生前台练习（非跨应用使用资格）')).fontSize(14)
        Text(nativeReading('3道算术首答全对得30分钟；每30分钟须前台练习休息10分钟；每练习日120分钟。仅连续可见回调计时，后台不计。')).fontSize(11)
        Text(nativeReading(this.practiceStatus)).fontSize(11)
        Text(nativeReading(this.practicePrompt)).fontSize(14)
        if (this.practiceQuestion !== '') {
          Text(nativeReading('不可更改的首次答案')).fontSize(11)
          TextInput({ placeholder: nativeReading('不可更改的首次答案'), text: this.practiceAnswer }).maxLength(32).onChange((text: string) => { this.practiceAnswer=text; })
          Button(nativeReading('提交首答')).height(64).onClick(() => this.practiceAction('answer'))
        }
        Row({ space: 4 }) {
          Button(nativeReading('开始答题')).fontSize(12).height(64).onClick(() => this.practiceAction('round'))
          Button(nativeReading(this.practiceRunning ? '暂停练习' : '继续练习/休息')).fontSize(12).height(64).onClick(() => this.practiceAction(this.practiceRunning ? 'stop' : 'start'))
        }
        if (this.parentOpen) { Button(nativeReading('家长确认下一练习日（须完成当日）')).fontSize(11).width('100%').height(76).onClick(() => this.practiceAction('day')) }
      }
      }
      Text(nativeReading(this.reminderStatus)).fontSize(12).fontColor('#52757C')
        }.width('100%').padding(8)
      }.width('100%').layoutWeight(1)
      Web({ src: $rawfile('beaa-preview.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .javaScriptProxy({ object: this.bridge, name: 'beaaNative', methodList: ['exportLearningSummary', 'updateReminderState', 'pauseReminders'], controller: this.controller })
        .width('100%')
        .height('45%')
        .constraintSize({ minHeight: 160, maxHeight: 480 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#EEF8F5')
  }
}
