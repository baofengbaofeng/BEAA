import common from '@ohos.app.ability.common';
import { ReminderDelivery, validateReminderSnapshot } from './ReminderDelivery';
import { NativeReminderStore } from './NativeReminderStore';
import { NativeNotificationPort } from './NativeNotificationPort';

export class NativeReminderServices {
  private enabled: boolean = false;
  private foreground: boolean = true;
  private sourceText: string = '';
  private running: boolean = false;
  private again: boolean = false;
  private pauseNeeded: boolean = false;
  private disposed: boolean = false;
  private timer: number = -1;
  private port: NativeNotificationPort;
  private ready: Promise<ReminderDelivery>;

  constructor(private context: common.UIAbilityContext, private report: (text: string) => void, private requestSource: () => void) {
    this.port = new NativeNotificationPort(() => this.enabled && this.foreground && !this.disposed);
    this.ready = this.initialize();
    this.ready.then(() => { this.requestSource(); this.schedule(); }).catch(() => this.report('提醒存储尚不可用，未确认发送。'));
    this.timer = setInterval(() => { if (this.foreground && this.sourceText === '') this.requestSource(); this.schedule(); }, 1000);
  }
  private async initialize(): Promise<ReminderDelivery> {
    const store = await NativeReminderStore.open(this.context);
    const delivery = new ReminderDelivery(store, { read: async () => {
      if (this.sourceText === '') throw new Error('No committed simulated source'); return this.sourceText;
    } }, this.port, { scopeId: 'web-preview', ownerId: Date.now().toString(16) + '-' + Math.random().toString(16).slice(2), nowMs: () => Date.now(), timeoutMs: 5000 });
    // A previous process may have left a visible notice; no new notice before fresh page data.
    const paused = await delivery.pause(); this.pauseNeeded = paused.status === 'cleanup_pending'; return delivery;
  }
  accept(text: string): void {
    const source = validateReminderSnapshot(text);
    if (source.scopeId !== 'web-preview') throw new Error('Wrong preview scope');
    this.sourceText = text; this.schedule();
  }
  async enable(): Promise<void> {
    try {
      await this.ready;
      if (!await this.port.request(this.context)) { this.report('未获得提醒授权。'); return; }
      this.sourceText = ''; this.enabled = true; this.report('已允许演示提醒，正在核对当前页面。'); this.requestSource(); this.schedule();
    } catch { this.report('提醒服务或授权尚未确认。'); }
  }
  stop(): void { this.enabled = false; this.pause(); }
  pause(): void { this.sourceText = ''; this.pauseNeeded = true; this.schedule(); }
  background(): void { this.foreground = false; this.pause(); }
  resume(): void { this.sourceText = ''; this.foreground = true; this.requestSource(); this.schedule(); }
  private schedule(): void {
    if (this.disposed || this.running || !this.foreground && !this.pauseNeeded) { if (this.running) this.again = true; return; }
    this.running = true; this.again = true;
    this.flush().catch(() => this.report('提醒结果尚未确认，等待重试。'));
  }
  private async flush(): Promise<void> {
    try {
      const delivery = await this.ready;
      while (this.again && !this.disposed) {
        this.again = false;
        if (this.pauseNeeded) {
          const result = await delivery.pause(); this.pauseNeeded = result.status === 'cleanup_pending';
          this.report(this.pauseNeeded ? '旧提醒清理尚未确认，将重试。' : '演示提醒已暂停。');
        } else if (this.foreground && this.sourceText !== '') {
          const result = await delivery.pump();
          if (result.status === 'submitted') this.report('已提交演示提醒，送达仍需设备核验。');
          else if (result.status === 'clock_error') this.report('检测到时间变化，演示提醒已暂停。');
          else if (result.status === 'denied') this.report('演示提醒未授权或已停止。');
          else if (result.status === 'unknown' || result.status === 'unsupported') this.report('提醒权限或服务尚未确认。');
          else if (result.status === 'idle') this.report('当前没有新的演示提醒。');
          else if (result.status === 'busy') this.report('正在核对演示提醒。');
          else if (result.status === 'cancelled') this.report('旧提醒取消请求已确认。');
          else this.report('提醒发送或清理尚未确认，将重试。');
        }
      }
    } finally { this.running = false; }
  }
  dispose(): void {
    this.enabled = false; this.foreground = false; this.disposed = true; clearInterval(this.timer);
    this.ready.then(delivery => delivery.pause()).catch(() => {});
  }
}
