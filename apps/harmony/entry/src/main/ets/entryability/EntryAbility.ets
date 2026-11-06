import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';
import { NativePreviewBridge } from '../services/NativePreviewBridge';

export default class EntryAbility extends UIAbility {
  onBackground(): void { NativePreviewBridge.background(); }
  onForeground(): void { NativePreviewBridge.foreground(); }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) {
        console.error('BEAA failed to load page: ' + JSON.stringify(error));
      }
    });
  }
}
