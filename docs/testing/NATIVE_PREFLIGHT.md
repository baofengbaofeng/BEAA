# 原生构建前置项预检（2026-11-04）

## 实际执行结果

在当前云环境运行 `npm run native:preflight`，退出码 **2**（缺少前置项）。原始机器可读输出见 [native-environment.json](native-environment.json)。

| 项目 | 观察结果 |
|---|---|
| Java | PATH中可执行，版本21.0.12.1；尚未核对与项目工具链的兼容性 |
| ohpm | 未找到可执行命令 |
| hvigor | 未找到可执行命令 |
| SDK | 未设置可用的SDK绑定目录 |
| hdc | 未找到；属于后续设备验证的可选工具 |
| 构建/HAP | 未执行构建，未生成HAP |
| 签名/设备权限 | 未验证 |

源码保留原有SDK/API和Hvigor配置，不以全局Java存在推断原生构建可用。SDK安装与工具版本必须使用匹配的DevEco正式工具链核对；检查到一个目录不代表SDK内容完整或版本正确。

## 自动化证据

`npm test`：**43通过、0失败、0跳过**，原始输出见 [native-preflight-node-results.txt](native-preflight-node-results.txt)。新增预检用例覆盖缺命令、失效目录、多个SDK绑定选择、显式路径不回退、可选hdc、CLI退出码0/1/2，以及前置项检测不冒充编译成功。子进程测试使用临时模拟版本命令，不能当作本机安装了SDK的证据。

预检脚本只提取工具版本号及变量绑定名称和状态，不输出变量值或任意CLI原文，不读取证书内容；版本查询有10秒超时。实际构建、版本兼容、签名与真机验收仍为独立步骤。

## 后续条件

1. 在可用DevEco开发终端提供ohpm/hvigor命令和匹配的SDK目录，运行预检并核对实际版本。支持 `npm run native:preflight -- --sdk /path/to/sdk`。
2. 使用匹配模板校对现有工程配置后执行真实构建，保存命令、工具版本、退出状态与产物；当前未通过这一门禁。
3. 按DEVICE_POC.md及ACCEPTANCE.md准备目标设备与正式权限验证。没有真机前，不将模拟使用分钟描述为跨应用实际统计。

环境发布后，GitHub API已可用，PR #5已合并到dev；本机SDK/ohpm/hvigor缺项仍未解除。额外下载域名的建议保存失败（draft_not_editable），已保留于docs/environment/network-additions.json，详见PUBLISHED_ENVIRONMENT.md。
