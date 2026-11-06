# 原生宿主与持久提醒验证

2026-11-06；基于dev4e913f2（PR34已合并），分支feature/native-services-and-reminder-delivery。按用户要求继续推进剩余任务，未修改/合并master或发布环境。

## 本轮实际开发

1. `NativeSummary.ts`严格摘要校验、UTF8短写/同步/关闭、忙碌/取消/失败状态；DocumentPicker/fs候选适配、窄桥及网页请求ID/回执/超时接入。
2. `ReminderDelivery.ts`同源持久队列控制器：稳定不复用ID、CAS、租约、重试/独立取消退避、前后来源/权限核对、迟到/不确定结果清理、回放/回拨拒绝与空闲不反复写盘。
3. 第四种独立格式的真实私有SQLite参考队列，重开、竞争、丢回执和热日志恢复；其他三库在自动恢复前拒绝错误队列文件，正确队列可恢复已提交状态。
4. 原生加密RDB配置/事务、通知API、显式授权按钮与生命周期候选源码；只接受已提交的明确模拟快照。网页stateRevision/cycleSequence持久递增，家长演示重置不重用通知周期。

这些是代码/参考实现，不是完整原生生产后端。原生OS适配未编译；TypeScript检查只覆盖纯服务，不能替代ArkTS、资源、链接、签名或HAP安装。

## 已取得的证据

- 基线Node345/345；Task1 Node351/351，新原生服务6项（包括实际文件短写和多字节边界）、网页宿主3项通过。
- 提醒控制器与SQLite针对测试先取得29/29；覆盖实际文件/CAS/重开/丢回执/正确库热日志恢复与四库格式隔离。通知端口是记录型替身，没有发送真实通知。
- 首轮完整Node及浏览器回归通过；浏览器完整50项，本地48通过/2项file://策略跳过。CI仍严格要求零跳过。
- 独立整分支审查指出两项Important，无Critical：发布可能已生效却回执拒绝时不能退回“从未发布”的pending；CAS冲突后的新读必须再检查退避。三项失败回归已实际复现；修复保留sending/待确认语义并在源变化/撤权/暂停时取消，发布/取消截止分别处理；每次竞争重读后检查retryAtMs。
- 最终针对控制器/SQLite33/33；完整Node388/388，无失败/跳过。浏览器完整50项，本地48通过/2本地文件策略跳过。
- 一项取消/失败测试曾在导出事件还未取得状态锁时读取请求ID而失败；已等待本次请求确实到达后才回执，保持原失败/取消断言。导出组重复三轮9/9，随后完整浏览器回归如上通过。
- `check:native-core`严格检查并实际执行同源纯TS；`demo:notifications`通过，使用真实SQLite与记录型通知替身，不发送系统通知。原生预检实际退出2，缺SDK/ohpm/hvigor，hdc也不可用；buildAttempted/signingVerified/deviceVerified均false。
- 原生SDK/签名/安装/设备状态仍未验收；远程CI以对应提交的检查结果为准。

原始输出：[Node全量](native-services-node-results.txt)、[浏览器](native-services-browser-results.txt)、[导出重复](native-services-export-repeat.txt)、[审查失败重现](native-services-review-red.txt)、[审查回归通过](native-services-review-green.txt)、[队列演示](native-services-demo.txt)、[原生预检](native-services-preflight.txt)。

## 关键边界与判断

- submitted只代表适配器API回执；不保证显示/已读或恰好送达一次。超时/丢回执保留不确定状态，稳定ID用于重试和清理。
- 来源修订回退停止发布并保留队列，不能臆造新来源；来源不可读时可能需人工恢复，OS自动清理配置仍待设备验证。
- 暂停取消已尝试/已发布项，保留真正未发布的pending，待新的有效来源和授权后重核。它不是使用资格或额外额度。
- 超时的旧ID保留在途墓碑；迟到清理尽力在存储不可用时也取消，但不能误删新工作者仍有效的同ID通知。所有未确认项均有界保留，满时明确拒绝，不复用ID。
- 原生RDB只存提醒元数据，申请加密配置不等于保护已验证，更不等于使用资格/凭据库已实现；不会自动删除坏库或降级明文。

## 原生与人工剩余项

[当前剩余清单](../REMAINING_WORK.md)逐项区分已测试逻辑、候选源码和未实现/阻塞。目标SDK/证书、原生安全凭据/资格原子后端、真实用时/休息/日期源与正式跨应用动作仍缺；教师审核和健康试用仍需人工。

[设备手册](../DEVICE_POC.md)新增N11，模板共21项均未执行。候选API来源及接口限制见[宿主说明](../../apps/harmony/NATIVE_SERVICES.md)，不能用桌面浏览器或Node端口替身改写真机状态。
