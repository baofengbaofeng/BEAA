# 业务规则原型（Node.js）

这是纯 JavaScript 领域逻辑与单元测试，不是已经可安装的HarmonyOS应用，也不具备系统锁定权限。运行：仓库根目录执行 `npm test` 或 `npm run demo`（Node.js 20+）。

## 规则引擎

支持使用周期、每日硬上限、按题序判定、通过阈值、待生效资格与休息要求。计时事件、标准答案、日期和已验证休息秒数由可信设备/题库服务提供。

`rollDay`只清零日累计，保留当前周期、答案和休息约束；每日锁解除后仍按保留状态恢复挑战/休息，日切换不代表休息已完成。日期采用真实公历YYYY-MM-DD（0001–9999），相同/回退日期被拒绝。

`recordUsage`接收已核实秒数，单次跨周期事件可先触发挑战或日上限；平台适配器应按事件边界采样并及时执行限制。

## 版本化规则快照

`snapshot.mjs`提供SDK无关的数据契约：

```js
import { encodeSession, decodeSession, SnapshotError } from './snapshot.mjs';
// session来自engine.mjs；revision由持久化适配器管理。
const text = encodeSession(session, 7);
const recovered = decodeSession(text);
// recovered: { schemaVersion: 1, revision: 7, session: 独立深拷贝 }
```

- `validateSession(session)`检查已知字段、规则、日/周期计数、日期、题序和通过条件，返回独立副本。
- `encodeSession(session, revision=0)`产生JSON文本；`decodeSession(text)`校验版本与内容后返回封装。revision必须为非负安全整数。
- 格式为`{schemaVersion:1, revision, session}`。策略仅允许引擎使用的七个字段及可选的`version:1`；拒绝额外字段，避免将不属于规则契约的数据写入快照。
- `pendingGrant`仅允许与完整通过的`REST_REQUIRED`共存。每日上限、阶段和计数必须一致；每日锁可保存被覆盖的挑战进度，跨日后重新核对休息证据。
- 损坏、未知版本或矛盾状态抛`SnapshotError`，不会创建替代会话、归零累计或夹取非法计数。错误码：`INVALID_SNAPSHOT`、`UNSUPPORTED_VERSION`、`INVALID_SESSION`、`SNAPSHOT_TOO_LARGE`。文本最多1,000,000个UTF-16码元。

快照只验证数据一致性，不证明答案、时间或存储内容的真实性。认证/防篡改、修订号比较与CAS/原子写入、旧快照回放防护由平台存储适配器负责；revision字段本身不提供这些能力。上层遇到解码错误应保留原始记录并进入恢复流程，不能以新建会话代替失败恢复。

`npm run demo`实际使用临时文件保存/读取答题及休息快照，然后继续引擎流程并清理文件；时长和答案仍为演示输入。该模块尚未接入浏览器单文件原型或原生Preferences，也不能直接作为ArkTS模块使用；原生移植、可信休息证据及权限状态核对仍需匹配SDK和平台实现。
