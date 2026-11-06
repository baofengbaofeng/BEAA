import web_webview from '@ohos.web.webview';
import { NativePreviewBridge } from '../services/NativePreviewBridge';

/** Offline preview host. No device-control bridge, native usage sampling or native auth. */
@Entry
@Component
struct Index {
  private controller: web_webview.WebviewController = new web_webview.WebviewController();

  private bridge: NativePreviewBridge = new NativePreviewBridge(this.controller);

  build() {
    Column({ space: 8 }) {
      Text('学知守护 · 离线交互预览')
        .fontSize(18).fontColor('#174B53').padding(8)
      Text('本地演示数据，不具备跨应用计时或限制能力')
        .fontSize(13).fontColor('#52757C')
      Web({ src: $rawfile('beaa-preview.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .javaScriptProxy({ object: this.bridge, name: 'beaaNative', methodList: ['exportLearningSummary'], controller: this.controller })
        .width('100%')
        .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#EEF8F5')
  }
}
