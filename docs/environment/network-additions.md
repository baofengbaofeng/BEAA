# 后续下载域名建议（未保存到环境配置）

当前发布版本已启用api.github.com和cdn.playwright.dev；GitHub API调用成功，PR #5已创建。

新观察到的实际下载链：

- cdn.playwright.dev返回307到storage.googleapis.com的公开Chrome for Testing包；新目标域名被403拒绝。
- GitHub CI产物下载重定向到productionresultssa19.blob.core.windows.net；该目标也被403拒绝。不保存或复用带签名参数的下载URL，只记录所需主机名。该主机用于本次产物，未来运行可能选择其他主机，应按实际需要逐项确认。

network-additions.json是保留现有两个自定义主机后的完整建议列表，已有package_managers预设应保留。配置工具返回draft_not_editable，再次读取仍是同一草稿，因此新增域名保存**未确认**，当前运行策略也没有新增域名。

如需在云环境下载同版本浏览器或该CI产物，可从环境设置打开新的设置聊天并应用此建议，然后按产品流程保存/发布。本建议不影响GitHub托管CI继续执行，也不代替原生SDK工具链。此文件可随源码包转移。
