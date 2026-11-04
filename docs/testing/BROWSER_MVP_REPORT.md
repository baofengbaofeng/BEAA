# 浏览器 MVP 阶段验证报告（2026-11-04）

## 验证范围

基于 dev / PR #2 的 374f8b6，功能分支 feature/browser-mvp-hardening。Node v24.22.1，系统 Chromium 155.0.8059.79，Playwright 1.64.1，axe-core/playwright 4.14.0。CI 使用 Node 20 和 Playwright 对应 Chromium，不能把本机执行当作 CI 已通过。

## 实际结果

| 检查 | 结果 | 说明 |
|---|---|---|
| 初始 `npm test` | 14 通过、0 失败 | 包括领域、原生源码存在性、VM 交互 |
| 最终 `npm test` | 30 通过、0 失败 | 领域与浏览器脚本行为；不是原生编译 |
| `BEAA_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` | 三轮合计 33 通过、3 跳过、0 失败 | 每轮 11 通过、1 跳过；实际执行带 `--repeat-each=3`，file:// 因管理员策略拒绝而跳过 |
| `npm ci --cache /workspace/.npm-cache` | 通过 | 依赖锁定，5 个开发依赖包 |
| `npm run demo` | 通过 | 周期 → 挑战 → 休息 → 可用，日累计不清零 |
| `npm run build:demo` | 通过 | 单文件演示包，非原生编译 |
| ZIP 内容与校验和 | 通过 | HTML 与源文件字节一致、SHA256SUMS 对包内每个文件校验成功、重复打包一致 |
| `git diff --check` | 通过 | 无空白错误 |
| DevEco/HAP/真机 | 未运行 | 缺 SDK、工具链、设备与签名条件 |
| GitHub CI | 尚未确认 | API 请求被当前网络代理 403 拒绝；已保存 api.github.com 网络草稿，未发布 |

## 核心行为证据

- 模拟周期触发、错误首次作答导致本轮不通过、成功后提前休息拒绝恢复、日上限拒绝追加时间。
- 已完成休息资格刷新后保持，当前题在 360/768/1024 宽度切换及刷新后不丢失；窄窗口页面无横向溢出。
- PIN 初始化、摘要保存、错误拒绝、冷却、五分钟过期、刷新撤销授权、未授权设置和重置拒绝。
- 实际年级/学科/知识点筛选、题量不足拒绝、重复/无效题库拒绝、导入 HTML 只作文本显示。
- 错题复习、挑战统计刷新恢复、首次正确率与本轮授予相符。
- 部分损坏记录和题库不清空 PIN/有效使用量；配额异常提示保存失败；时间回拨拒绝休息资格。
- 旧题事件不能回答新题，双标签页并行操作不回退用量或撤销 PIN；PIN 派生时打开新标签页不形成不完整凭据。
- 键盘答错可直接重试；主页、结果、PIN、答题、解锁后设置通过所测 axe WCAG A/AA 规则。自动化扫描不等于完整人工无障碍认证。
- HTTP 页面加载后断网，完整答题闭环无需网络。直接 file:// 打开受本云浏览器策略阻断，此项未获通过证据。

## 修复与留存

先运行新增回归确认失败，再修复。独立代码审查发现并修复部分损坏记录清空状态、标签页覆盖用量、PIN 异步状态竞态、错误答案焦点丢失。真实浏览器另发现并修复对比度、进度条语义和过时 storage 事件清空 PIN 输入问题。

首次并发测试曾出现等待超时，随后三轮复现定位为等待 Web Lock 期间重绘清空表单输入；已在事件入口捕获输入并在操作完成前禁用控件，操作完成后恢复键盘焦点。修复后的三轮全套均通过。最初失败输出保留为 `browser-pin-timeout.txt`，不计作通过证据。

原始最终输出保存在同目录 `node-results.txt` / `browser-results.txt`。运行后 `test-results/browser-results.json`、布局截图与失败 trace 会由 CI artifact 收集；本机演示包位于 `dist/beaa-web-demo.zip`。

## 剩余人工条件

1. 在环境设置审阅并保存新增的 api.github.com 网络访问；需要产品生效流程时再发布环境。此任务未发布环境。随后才能重试 GitHub API 建 PR/查询 CI；Git read/write 权限以实际操作结果为准。
2. 执行 CI 后确认绿色，才可关闭 M1 的 CI 门禁；受管理浏览器 file:// 测试在允许该协议的环境补验。
3. 按 `docs/development/NATIVE_INTEGRATION.md` 准备兼容 SDK/DevEco、签名和目标真机，执行构建与 DEVICE_POC/ACCEPTANCE。
4. 内置题库只供流程演示，正式面向儿童使用前需要教学内容审核；PIN/墙钟/localStorage 不提供生产级防篡改保证。

最终演示 ZIP SHA256：`2b35e54d0f3f6fcd3fcac373d26af12cff219c513e1f3ca5c466e7ff06e2496e`。

交付状态：功能提交 `090f7fac08d608e789395c06343a34b82f0094cc` 已推送 `feature/browser-mvp-hardening`，远端 SHA 已用 `git ls-remote` 核对。`gh pr create --base dev --head feature/browser-mvp-hardening` 返回 `Post https://api.github.com/graphql: Forbidden`，PR 尚未创建。PR 说明保存在 [PR_DESCRIPTION.md](../development/PR_DESCRIPTION.md)。不得把分支已推送描述为 PR/CI 已验收。
