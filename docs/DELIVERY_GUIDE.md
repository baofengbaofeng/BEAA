# 学知守护阶段性交付与本地运行

本包提供可直接打开的浏览器交互演示、独立规则检查、可导入题库、现有原生工程源码、测试证据与真机操作手册。顶层手册/模板为便携副本；其中的相对文档链接以解压`beaa-source.zip`后的`BEAA/`目录为准。它不是已验收的强制管控产品，也不含HAP安装包。

## 无开发环境体验

1. 解压`beaa-delivery.zip`，打开`web/index.html`。现代浏览器不允许file://访问/安全验证时，换用下面的本机HTTP方式。请勿在邮件预览器内运行。
2. “儿童主页”使用模拟1/10分钟或用满周期按钮；到期后答题，通过后检查模拟休息条件。所有时间/资格只影响本页面，不能限制其他应用。
3. 第一次在“家长设置”设置自己的6–12位数字PIN。可配置规则/筛选题库、导入`question-bank/beaa-starter-bank.browser.json`、分配临时时段、查看操作记录或导出摘要。
4. 临时时段只限制已有正常资格，不能跳过挑战/休息或扩展日上限；到期/耗尽/回拨后由家长处理。
5. 打开`beaa-browser-check.html`可在隔离模拟数据中检查六类规则并下载报告；不改已有学习记录，不证明健康改善或系统管控。

## 本机HTTP预览

在解压目录执行`python3 -m http.server 4173 --bind 127.0.0.1`（Windows可用`py`代替`python3`），打开`http://127.0.0.1:4173/web/`。请只绑定本机，关闭终端/按Ctrl+C停止服务。

克隆代码运行：

```bash
git clone -b dev https://github.com/baofengbaofeng/BEAA.git
cd BEAA
python3 -m http.server 4173 --bind 127.0.0.1
```

打开`http://127.0.0.1:4173/apps/web-preview/`。尚未合并的新增功能需检出相应功能PR分支；本包源码快照与版本信息见manifest.json，不要将dev自动视为未合并分支。

## 开发者验证与重新打包

解压`beaa-source.zip`得到`BEAA/`源码。源码压缩包不含.git；重新构建交付包的源码收集需要Git克隆检出对应提交，不能在解压源码上假造提交历史。

Node20+、Python3.11+、npm；完整SQLite参考测试要求POSIX环境，Windows建议WSL。预览HTTP服务可直接在Windows运行：

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run build:delivery
```

`build:delivery`在临时源码快照内生成产物，输出`dist/beaa-delivery.zip`与目录/校验和，不运行验收测试、不部署。manifest明确标记测试未由打包命令执行，验证结果见源码`docs/testing/NATIVE_SERVICES_REPORT.md`、历史整体报告和对应CI。

源码只收集允许目录内Git已跟踪/已暂存文件的**当前字节**；未跟踪文件不会打入。manifest记录HEAD作为基准、是否有工作区修改以及源码树内容摘要。修改/暂存尚未提交时包会如实标为工作区快照，不能将HEAD当作包内所有文件对应提交。产物时间固定、文件与SHA256排序，源码/规则输入相同时包可复现。

## 原生与真机

打开源码`apps/harmony`，先按`DEVICE_POC.md`核对正式权限/工具链。主入口现为同一离线页面的ArkWeb容器，启用本地存储；窄桥仅接受脱敏摘要、模拟提醒状态与暂停，不含设备控制/凭据API；WebCrypto、存储隔离、导出下载、后台/重启/旋转均须在匹配WebView上实测。浏览器PIN仍为演示级保护，不是已验证原生安全存储。

`npm run native:preflight`退出0也不是构建通过；当前缺SDK/ohpm/hvigor，实际原生构建、签名、HAP安装与跨应用能力均未验收。拿到设备后按手册和`DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md`逐项留证。不要将原生离线资源同步检查当作编译/安装证据。

## 校验与隐私

`SHA256SUMS`覆盖包内每个文件（自身除外），不代表签名或来源认证。学习摘要不含PIN派生摘要/盐；完整浏览器存储、源运行库和设备日志可能含私有数据，请保留在本机。交付包排除运行库、密钥、真实设备日志与个人环境文件。损坏/存储失败恢复步骤见`web/README.md`。

原生候选服务现包含文件选择器保存摘要、提醒RDB加密配置、通知提交/取消与显式授权按钮。OS行为尚未构建/验收，`check:native-core`是纯TS检查。实际摘要保存/演示提醒按N11留证；生产资格后端与真实采样/控制仍待完成，见源码docs/REMAINING_WORK.md。

## iPhone 与 iPad

iOS 后续功能源码集中位于 `apps/ios`，包含默认离线练习和可选 Connected 两套方案及三个扩展。家长安全/恢复、加密备份、复杂题型与统计、应急授权、系统范围管控、通知、家庭云端分享及远程指令均已接线。请阅读源码中的 `apps/ios/README.md` 与 `docs/testing/IOS_COMPLETION_REPORT.md`，按平台/安全/云端指南配置自己的标识。Apple 编译、XCTest、签名和真机验收由用户后续执行；源码包不含 IPA 或开发者签名。

本轮源码还包含 `apps/family-service` 可选家庭服务、共享v2混合题型、鸿蒙原生练习服务、iOS加密迁移，以及 `shared/quiz/curriculum/generated` 中54个待审核分级练习包。网页已离线嵌入这些草稿包。请优先阅读 `docs/testing/CROSS_PLATFORM_COMPLETION_REPORT.md`；旧报告是历史证据，不能替代本轮结果。家庭服务需自行配置HTTPS/Origin/密钥，没有随源码包远端部署。
