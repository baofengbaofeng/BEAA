import web_webview from '@ohos.web.webview';
import { NativeSummaryService } from './NativeSummary';
import { NativeSummaryFilePort } from './NativeSummaryFilePort';

/** This proxy has no credential, usage-grant, arbitrary path or device-control method. */
export class NativePreviewBridge {
  private summary: NativeSummaryService = new NativeSummaryService(new NativeSummaryFilePort());
  constructor(private controller: web_webview.WebviewController) {}

  exportLearningSummary(requestId: string, text: string): string {
    if (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/.test(requestId) ||
      typeof text !== 'string' || text.length > 64000) return 'invalid_request';
    this.summary.exportSummary(text).then((status: string) => {
      const script = 'if(typeof window.onNativeExportCompleted==="function")window.onNativeExportCompleted(' +
        JSON.stringify(requestId) + ',' + JSON.stringify(status) + ')';
      // No path or backend exception is sent to the page; a lost callback is not a saved receipt.
      this.controller.runJavaScript(script).catch(() => {});
    }).catch(() => {});
    return 'accepted';
  }
}
