# 发布后验证与dev集成（2026-11-04）

## 已完成

- 新发布环境观察为running，网络策略enforced，已启用api.github.com和cdn.playwright.dev。GitHub API实际调用成功，无需新增GitHub凭据。
- [PR #5](https://github.com/baofengbaofeng/BEAA/pull/5) 正确以dev为目标，头提交ab3d999；其 [专属CI 41820903218](https://github.com/baofengbaofeng/BEAA/actions/runs/41820903218) 的依赖安装、Node测试、浏览器测试、报告、打包、artifact上传均成功。
- PR #5随后由仓库方合并，dev合并提交为0e3a10afafe298463b999c2e7f5e29bb2bab22d8。当前记录基于最新dev，未执行master修改或PR合并。
- 本地再次执行npm test：43通过、0失败、0跳过；系统Chromium：12通过、1个file://策略跳过、0失败。对应记录见published-node-results.txt和published-browser-results.txt。CI继续禁止跳过、零测试、flaky及test.only。

## 原生状态

实际native:preflight仍退出2：有Java21.0.12.1，缺少ohpm、hvigor和SDK目录，hdc作为设备工具也未找到。未执行原生编译、签名或真机验证。需要提供匹配HarmonyOS 4的DevEco/SDK版本与安装目录后才能继续，不能以浏览器CI或预检工具测试代替原生构建证据。

## 下载限制与配置保存结果

官方Playwright下载从cdn.playwright.dev经307重定向到storage.googleapis.com，后者被当前策略403拒绝；尚未安装与CI相同的浏览器。GitHub artifact下载还需productionresultssa19.blob.core.windows.net，此目标也被403拒绝，未读取CI原始产物内容。本机交付包由本地打包生成。

尝试追加域名时配置接口返回draft_not_editable；再次读取仍绑定同一草稿，新增设置保存未确认。提案保存在[network-additions.json](../environment/network-additions.json)及[说明](../environment/network-additions.md)，未包含临时签名URL或凭据。若需云环境中的这两项下载，从环境设置打开新的设置聊天应用建议并按产品流程保存/发布；既有GitHub API已生效，不需重新应用之前的配置。
