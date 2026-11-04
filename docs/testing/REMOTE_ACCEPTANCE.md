# M1 远程验收补全

**最新结论：M1浏览器功能验收完成；de1d10b严格CI为Success。PR #3已合并到master，当前新增修复需另建至dev的PR，API403仍阻止自动创建。下文保留诊断过程中的历史失败，不代表最终结果。**

2026-11-04 通过 GitHub 公开网页核对，未使用不可用的 API，也未读取需要登录的日志。

## 已确认的远程事实

- 功能提交 090f7fa：分支 CI [41809688518](https://github.com/baofengbaofeng/BEAA/actions/runs/41809688518) 和 PR CI [41809869382](https://github.com/baofengbaofeng/BEAA/actions/runs/41809869382) 均为 Success。
- PR #3 已存在，但 base 是 master，未符合要求的 dev。不得合并到 master；当前 API 返回403，需在网页改base或使GitHub API网络访问生效后自动修改。
- 文档提交06e7bdf已成功补推，已用git ls-remote核对远端。之前的远端500错误已恢复。

## 本轮增强与本地证据

- CI 下file://测试若遇管理员策略禁止会失败，不再允许跳过；本地仍准确区分策略阻断，不修改管理员策略。
- CI 禁止 test.only，防止只执行部分用例而得出绿色结论。
- 新增ZIP消费端验收：源码/README字节一致、样例题有合法答案、SHA256清单校验、完整文件集合和重复打包字节一致。
- `npm test`：31/31，通过；原始输出见acceptance-node-results.txt。
- 本地Chromium：11通过/1策略跳过，0失败；输出见acceptance-browser-results.txt。
- 在本地模拟CI模式运行file://单项，因同一管理员策略得到预期失败而非跳过，证实新增门禁生效。这是负向门禁验证，不计作应用通过证据。

新提交的严格CI结果需另行核对后，才可关闭独立文件验收门禁。旧运行成功不替代新运行证据。

## 新运行失败与诊断

后续06e7bdf的PR运行41810220502在浏览器步骤失败（同提交的分支运行成功），a9b6328的运行41810562943也失败。公开摘要只提供退出码1，不能推断原因或宣称已修复。新增标准JSON报告的公开GitHub步骤摘要和错误注释，保留原测试退出状态，并在CI报告缺失、零测试、跳过或flaky时明确失败；后续根据具体错误处理。

产物校验审查发现的重复清单文件名与同两秒窗口可复现性漏洞已收紧：清单必须覆盖唯一完整集合，两次打包跨越ZIP两秒时间戳粒度。

## 已定位并修复的失败

诊断提交364a1e1的 [CI 41811017257](https://github.com/baofengbaofeng/BEAA/actions/runs/41811017257) 通过公开错误注释明确指出：旋转/刷新用例在异步状态锁尚未处理答案时刷新。现在先等待第二题显示（答案已被确认并保存），再进行旋转与刷新；新增实际WebLock排队用例，检查等待时不提前确认、处理后进度可恢复。

进一步本地重复验证复现另一应用竞态：主页面保存完整PIN后，新页面初始化的自动保存会回写无PIN的旧快照。写入跟踪定位到启动回调；还以VM确定性复现初始化两次读取可能导致状态与版本不配对。现在restore只解析传入的同一原始快照，已有数据的新页面启动只读，仅首次创建或用户操作保存。回归同时验证内存状态、持久快照及后续导航。

修复后本地结果：Node 36/36；PIN高风险并发场景20/20；浏览器全套三轮合计36通过、3本地策略跳过、0失败。报告器不再向stdout输出原始错误Markdown，工作流命令注入回归通过。原始最终输出见acceptance-node-results.txt及acceptance-browser-results.txt。

网络补充：为本地安装与CI相同的浏览器，官方cdn.playwright.dev下载被403拒绝；已在配置草稿保留api.github.com并新增cdn.playwright.dev，未应用或发布。系统Chromium本地检查仍可运行，下载失败不代表同版本浏览器已安装。


## 最终远程证据

- 修复提交：de1d10bbcfb6f77652a77906dab268e67f5f407c。
- 严格CI：[41812445236](https://github.com/baofengbaofeng/BEAA/actions/runs/41812445236)，公开摘要Status=Success，总耗时48秒。确认页面提交与修复SHA一致。
- CI报告器对缺报告、零通过、任何跳过、flaky和失败均返回非零，且禁止test.only。因此该成功包含独立HTML打开验收；本机系统Chromium的file://策略跳过不能替代该证据。
- CI产物beaa-browser-evidence存在，公开摘要显示171 KB，artifact摘要sha256:93ef2216ae272e71e8ad9b627424883bd455ff5f02d2e8e57a0089bc1c8c6dd5。未读取需要登录的原始CI日志/产物；该artifact摘要不是演示ZIP单独的校验和。
- 本地npm test 36/36，PIN并发定向20/20，浏览器全套三轮36通过/3策略跳过/0失败，demo与打包命令成功。ZIP消费端校验通过，使用说明包含完整仓库与解压包两种HTTP目录。

## 当前集成与人工条件

PR #3网页状态为MERGED、baseBranch=master、head为06e7bdf；master已由仓库方更新至cf7db8b，dev仍为374f8b6。本轮未执行任何master修改或PR合并，也不回滚仓库方操作。后续提交仍在feature/browser-mvp-hardening；需[新建至dev的PR](https://github.com/baofengbaofeng/BEAA/compare/dev...feature/browser-mvp-hardening?expand=1)。gh pr edit/create使用的api.github.com仍403，旧PR已合并后不能再靠修改base完成这一步。

需要环境设置中的api.github.com、cdn.playwright.dev草稿生效时，由用户审核保存并按产品流程发布；此任务未发布环境。原生阶段仍需兼容SDK/DevEco、签名和真机；见NATIVE_INTEGRATION.md。M1功能验收关闭后停止新增演示功能。
