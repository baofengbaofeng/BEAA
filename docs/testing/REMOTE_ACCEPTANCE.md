# M1 远程验收补全

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
