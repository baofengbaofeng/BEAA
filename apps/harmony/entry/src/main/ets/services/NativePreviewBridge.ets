import web_webview from '@ohos.web.webview';
import common from '@ohos.app.ability.common';
import { validateReminderSnapshot } from './ReminderDelivery';
import { NativeReminderServices } from './NativeReminderServices';
import { NativeSummaryService } from './NativeSummary';
import { NativeSummaryFilePort } from './NativeSummaryFilePort';

/** This proxy has no credential, usage-grant, arbitrary path or device-control method. */
export class NativePreviewBridge {
  private summary: NativeSummaryService = new NativeSummaryService(new NativeSummaryFilePort());
  private reminders: NativeReminderServices | null = null;
  private disposed: boolean = false;
  private static active: NativePreviewBridge | null = null;
  constructor(private controller: web_webview.WebviewController) { NativePreviewBridge.active = this; }
  configure(context: common.UIAbilityContext, report: (text: string) => void): void {
    if (this.reminders !== null) return;
    this.reminders = new NativeReminderServices(context, text => { if (!this.disposed) report(text); }, () => {
      if (!this.disposed) this.controller.runJavaScript('if(typeof window.onNativeReminderReady==="function")window.onNativeReminderReady()').catch(() => {});
    });
  }
  updateReminderState(text: string): string {
    if (this.disposed || this.reminders === null) return 'unavailable';
    try { const state = validateReminderSnapshot(text); if (state.scopeId !== 'web-preview') throw new Error('Invalid scope'); this.reminders.accept(text); return 'accepted'; }
    catch { this.reminders.pause(); return 'invalid_source'; }
  }
  pauseReminders(): string { if (this.disposed || this.reminders === null) return 'unavailable'; this.reminders.pause(); return 'accepted'; }
  enableReminders(): void { if (this.reminders !== null) this.reminders.enable(); }
  stopReminders(): void { if (this.reminders !== null) this.reminders.stop(); }
  static background(): void { if (NativePreviewBridge.active?.reminders) NativePreviewBridge.active.reminders.background(); }
  static foreground(): void { if (NativePreviewBridge.active?.reminders) NativePreviewBridge.active.reminders.resume(); }
  dispose(): void { this.disposed = true; this.reminders?.dispose(); if (NativePreviewBridge.active === this) NativePreviewBridge.active = null; }


  exportLearningSummary(requestId: string, text: string): string {
    if (this.disposed) return 'unavailable';
    if (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId) ||
      typeof text !== 'string' || text.length > 64000) return 'invalid_request';
    this.summary.exportSummary(text).then((status: string) => {
      if (this.disposed) return;
      const script = 'if(typeof window.onNativeExportCompleted==="function")window.onNativeExportCompleted(' +
        JSON.stringify(requestId) + ',' + JSON.stringify(status) + ')';
      // No path or backend exception is sent to the page; a lost callback is not a saved receipt.
      this.controller.runJavaScript(script).catch(() => {});
    }).catch(() => {});
    return 'accepted';
  }
}
