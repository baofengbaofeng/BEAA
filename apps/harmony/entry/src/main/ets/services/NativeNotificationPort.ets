import notificationManager from '@ohos.notificationManager';
import common from '@ohos.app.ability.common';
import { nativeReading } from './NativeChineseReading';
import { ReminderNotificationPort } from './ReminderDelivery';

/** Only simulated preview reminders. Public API references do not prove device support. */
export class NativeNotificationPort implements ReminderNotificationPort {
  private lastPublishMs: number = 0;
  constructor(private allowed: () => boolean) {}
  async authorization(): Promise<string> {
    if (!this.allowed()) return 'denied';
    try { return await notificationManager.isNotificationEnabled() ? 'authorized' : 'denied'; }
    catch { return 'unknown'; }
  }
  async request(context: common.UIAbilityContext): Promise<boolean> {
    await notificationManager.requestEnableNotification(context);
    return notificationManager.isNotificationEnabled();
  }
  async publish(id: number, kind: string, limitingRule: string): Promise<void> {
    if (await this.authorization() !== 'authorized') throw new Error('Notification permission unavailable');
    if (Date.now() - this.lastPublishMs < 10000) throw new Error('Notification rate limited');
    this.lastPublishMs = Date.now();
    const title = kind === 'time_up' ? '演示使用时间已到' : '演示使用时间将尽';
    const text = (limitingRule === 'daily_limit' ? '今日演示额度提醒。' : '本轮演示使用提醒。') + '模拟数据，请以页面当前状态为准，准备学习与休息。';
    await notificationManager.publish({ id: id, label: 'beaa-preview-reminder', isAlertOnce: true,
      tapDismissed: true, autoDeletedTime: Date.now() + 60000,
      content: { contentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT, normal: { title: nativeReading(title), text: nativeReading(text) } }
    });
  }
  cancel(id: number): Promise<void> { return notificationManager.cancel(id, 'beaa-preview-reminder'); }
}
