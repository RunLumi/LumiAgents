> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Lumi Agents 许可与分发合规

本文件是 Lumi Agents 分支的许可、归属与分发合规单一说明。它记录**实际结果与未决事项**，
不是发布许可：见第 9 节的发布阻塞清单。

---

## 1. 结论摘要

| 项目                 | 状态                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------- | --------------------------------------------------------- |
| 第一方许可证         | **Apache-2.0**，保留上游 `LICENSE` 原文（含 `Copyright 2026 Z.AI Co., Ltd`）                                                             |
| 上游归属与 NOTICE    | 保留；NOTICE 原文段落一字未改，Lumi 说明单独成节                                                                                         |     | §4(b) 修改声明 | 42 个已修改文件内联声明 + 31 个注释/二进制例外（第 4 节） |
| 第三方材料           | 复用上游 `scripts/licenses.mjs` 管线；已重新生成并校验通过                                                                               |
| 第三方材料**完整性** | ✅ 19 项逐条了结（1 项真实版本适用许可正文 + 18 项有据可查的复核结论）；`check --strict` 通过。**18 条结论仍需法务签署**（第 5.1、9 节） |
| 法务材料可访问性     | 桌面端新增离线“开源许可”窗口；Web 输出声明资源 + `<link rel="license">`                                                                  |
| 自动更新             | **默认关闭**；仅在显式配置 Lumi 自有 https 更新源时启用                                                                                  |
| 产品遥测             | **默认关闭**；需 `LUMI_TELEMETRY=1` 且自备端点                                                                                           |
| 上游数据目录 / 协议  | **保留不变**（`ZCode`、`zcode://`、`@zcode/*`、`ZCODE_*`、`zcode` CLI）                                                                  |
| 发布就绪             | ❌ 否 —— 第 9 节列出必须由所有者处理的阻塞项                                                                                             |

### 关于「保留 Apache-2.0」的边界

**本任务的决策**是：继续沿用上游的 Apache-2.0 许可方案，不引入 MIT 重许可、非商业限制、
竞业限制、自定义商业许可或 CLA。

**这不等于** Apache-2.0 要求所有衍生作品都必须继续使用 Apache-2.0。Apache-2.0 第 4 条允许
分发者**为自己的修改**提供附加或不同的许可条款（只要整体仍符合本许可），第 4(d) 条允许在
NOTICE 中追加自己的归属声明。本分支选择不这么做，是**工程与治理上的决定**，不是法律要求。

---

## 2. 已核验的上游来源（完整 SHA）

| 项目                        | 值                                                       |
| --------------------------- | -------------------------------------------------------- |
| 本仓库（`origin`）          | `https://github.com/RunLumi/LumiAgents`（分支 `main`）   |
| 上游（`upstream`）          | `https://github.com/zai-org/ZCode`                       |
| 本分支本次工作的目标提交    | `44bf3cf21df66e51653154be9a8fbe512f890043`（PR #1 合并） |
| 上游基线（`upstream/main`） | `872ad960de7ec172591f7e1952f7849229f94521`               |
| 合并基点（merge base）      | `872ad960de7ec172591f7e1952f7849229f94521`               |

命令：

```bash
git rev-parse HEAD upstream/main
git merge-base HEAD upstream/main
```

注意：`upstream/main` 目前**等于**合并基点，即上游尚无更新。因此本分支是快进式分叉，
不涉及上游合并冲突；`docs/upstream/UPSTREAM-SYNC.md` 只能作为流程验证，不能声称未来合并无冲突。

`LICENSE` 为本仓库第一方许可原文；其附录中的 `Copyright 2026 Z.AI Co., Ltd` 是**上游权利人**，
本分支不作替换，也不主张该代码由 Lumi 创作。

---

## 3. 义务 vs 可选工程措施

**Apache-2.0 强制义务**（不做即不合规）：

1. §4(a) 向接收者提供许可证副本。
2. §4(b) 被修改文件带显著修改声明。
3. §4(c) 在衍生作品的 Source form 中保留全部版权、专利、商标与归属声明。
4. §4(d) 若作品含 NOTICE 文件，则分发时必须提供其中适用的归属声明。
5. §6 不得暗示获得上游商标授权 —— 因此 Lumi 不得自称官方发行版。

**本分支自行选择、许可不要求的工程措施**：

- 关闭上游自动更新与产品遥测默认值（安全与信任边界，不是许可要求）。
- 品牌资产自研并附带生成管线（品牌要求）。
- 漂移检查与负向测试（可维护性要求）。
- Lumi 自有更新源 / 遥测后端「未配置即不可用」的显式状态（工程诚实性）。

---

## 4. 修改声明约定与例外

完整约定见 [`MODIFICATIONS.md`](./MODIFICATIONS.md)。机器可读清单与校验：

```bash
node scripts/lumi-modified-files.mjs check
```

- 标记字符串：`Modified for Lumi Agents`。
- 语法与位置：`.ts/.tsx/.mjs` 用 `//` 置顶；`.css` 用 `/* */`；`.md` 用 `>` 引用行（渲染可见）；
  `.html` 置于 `<!doctype>` **之后**；`.sh`/`.mjs` 的声明置于 **shebang 之后**（否则脚本不可执行）。
- 例外机制：
  - `package.json` 等 JSON（`json-no-comments`）：新增 `lumi:…` 脚本；声明落在
    `MODIFICATIONS.md` + 根 `NOTICE.md`，并由清单校验存在性。
  - 位图/容器格式（`binary-generated`）：全部由
    `scripts/build-lumi-brand-assets.mjs` 从 `brand/` 原创 SVG 确定性生成，不含上游字节；
    31 个路径逐条登记（30 个二进制 + `third-party/inventory.json`）。
- 待法务复核：`packages/desktop/build/dmg_background(.@2x).png` 仍是上游 DMG 背景图，
  见第 9 节。

**偏差说明**：只为「修改了上游内容」的文件加声明；为 Lumi 新增的独立文件（例如
`licensesWindow.ts`、`lumiDistribution.ts`、`brand/*`）属于 addition，不属于 §4(b) 的
modified file。这一点在 `MODIFICATIONS.md` 第 1 节明确记录。

---

## 5. 第三方材料：证据与分发位置

复用上游既有管线，未新建并行系统：

- 生成：`node scripts/licenses.mjs notices` → `THIRD-PARTY-NOTICES.md` +
  `third-party/inventory.json`（含输入哈希、`noticesSha256`、`reviewRequired`、`materialReviews`）。
- 校验：`node scripts/licenses.mjs check`（标识 + 声明新鲜度）；
  `--strict` 追加「材料完整性」门禁。
- 来源证据：`third-party/inventory.json`、`third-party/copied-components.json`、
  `third-party/embedded-components.json`、`third-party/native-search/sources.json`、
  `third-party/runtime/sources.json`、`third-party/upstream/*.txt`。

各分发形态中的法务文件：

| 分发形态         | 材料与位置                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源码仓库         | `LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`、`third-party/*`                                                                                               |
| 桌面（Electron） | `resources/THIRD-PARTY-NOTICES.md`；Electron/Chromium 的 `LICENSE` + `LICENSES.chromium.html` 由 `stageElectronNotices` 单独落盘；应用自身 `LICENSE` 不与其混同 |
| Web              | Vite 插件输出 `THIRD-PARTY-NOTICES.md` 资源并注入 `<link rel="license">`                                                                                        |
| 原生搜索工具     | `THIRD-PARTY-NOTICES.txt` + `SOURCES.json`（含二进制与来源归档哈希）                                                                                            |

**边界**：npm 包元数据的 SPDX 标识、根许可证、或生成出的通知文件都不构成「所有组件已澄清」
的证明。上游遗留的 19 项未补齐条目已在本分支逐条了结：`@arms/rum-*` 3 项与经其传递引入的
`keyv@4.5.4`、rrweb 家族共 5 项随**闭源遥测 SDK 的整体移除**（见下）不再进入发行物；
`keyv` 一项曾取得**真实且版本适用**的许可正文后随组件移除而删除登记；其余 13 项属于
「权利人从未提供声明」——证据不存在，按第 5.1 节的复核模型记录为**有据可查的结论**，
而不是宣称找到了原始声明。

### 5.1 材料复核模型（materialReview）

上游把两种完全不同的情况写成同一句 `reviewRequired`：材料存在但未登记，以及**权利人从未提供
声明**。前者可以补证据，后者永远补不出来，只能由人作出书面结论。本分支把后者建模为结构化的
`materialReview`（判定规则集中在 `scripts/lumi-license-review.mjs`，逐字段口径见
[`third-party/README.md`](../../third-party/README.md)）：

- 每条记录必须写明依据（`basis`）、复核日期、权利人声明的 SPDX 标识、**实际留存的许可正文**
  （`retainedTexts`，文件缺失或为空即失败）、实际检索过的证据（`searched`）、残余不确定性
  （`residualUncertainty`），并标记 `legalSignOff`。
- 判定会**实际读取留存正文**，确认其中含有该许可的条款标记；声明 MIT 却留一份不含 MIT 条款的
  文本会被拒绝 —— 「写一句结论」拿不到通过。
- `materialReview` **不是白名单**：它不改变「哪些条目需要材料」的推导。新出现的、没人复核过的
  缺口仍然进入 `reviewRequired`，`--strict` 仍然失败（负向用例见
  `packages/ui/test/lumiLicenseReview.test.ts`）。

**证据基础（逐项可复核）**：对 15 个 npm 包，用 registry 发布记录逐一核对归档哈希、发布时点、
`gitHead` 与许可文件的提交历史。结论是 14 个包在其**发布版本对应的时点**根本没有许可文件：
`boolbase`、`quickjs-wasi`、`react-remove-scroll-bar` 的 LICENSE 是在发布**之后**才补上的
（`quickjs-wasi` 的补交提交本身就写着 "fix: include the wrapper's MIT license notice"），
`unsafe-pointer`、`strict-event-emitter`、`lazy-val`、`semaphore`、`is-node-process`、
`ansi-to-react` 在任何 revision 都没有许可文件。`rust-standard-library` 原先登记的 revision
在 `rust-lang/rust` 中**不存在**（全局 commit 搜索亦为 0 条），是不可验证的出处声明，已删除并
改为与同组条目一致的真实许可正文。QuickJS-NG 的 WASI libc 出处已通过上游固定工具链建立：
`quickjs-wasi@2.2.0` 的 Makefile 要求 WASI SDK 32 → wasi-libc revision
`2fc32bc81b9f07f8d9525edea59bfbaf760c06d6`。

**风险最高、最需要法务确认的类别**（不是「已知可忽略」）：

1. **Skia** —— 预编译二进制没有记录构建开关，无法从产物反推每个平台实际链接了哪些 `third_party`
   库。已知组件都有留存声明，但无法证明没有遗漏。

**已移除的最高风险组件**（原第 1 类，2026-09-21 随遥测替换整体删除）：

- **`@arms/rum-browser@0.1.8` / `rum-core@0.1.4` / `rum-electron@0.0.3`** —— 闭源商业厂商 SDK，
  没有发布的仓库或许可文件，包元数据中的 SPDX 标识曾是**唯一**凭据。Lumi 以应用自有遥测实现
  `packages/desktop/src/main/lumiTelemetry.ts` 取代之（见第 6.4 节），三者及仅由其传递引入的
  `@babel/runtime`、`keyv@4.5.4` 与 rrweb 家族（`rrweb`、`rrdom`、`rrweb-snapshot`、
  `@rrweb/types`、`@rrweb/utils`、`web-vitals` 等）一并离开生产依赖图与许可登记。原先「需厂商
  书面确认或移除」的两难已经通过移除解决。

**未从仓库 Apache 许可推断的权利**：不推断托管服务访问权、模型使用授权或再分发授权。
Lumi 没有自有的模型网关或更新后端，因此相关入口在默认配置下不可用。

---

## 6. RETAINED-UPSTREAM-REFERENCES（刻意保留的上游引用）

保留原因分三类；**只有第 1 类与品牌有关**。

### 6.1 必须保留：兼容性敏感标识（改动会破坏数据或生态）

| 标识                                                 | 原因                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `@zcode/*` 包名                                      | workspace 依赖解析、发布名与锁文件身份                                   |
| `ZCODE_*` 环境变量                                   | 用户与 CI 已配置的运行时契约                                             |
| `zcode://` 协议 scheme                               | 系统已注册的深链接；改动会打断既有回调                                   |
| `zcode` CLI 命令名                                   | 公开命令行契约                                                           |
| Electron `userData` 目录名 `ZCode`                   | **已有用户的 localStorage / session / cache**；改名会孤立既有用户数据    |
| 协议字段、IPC 通道、持久化 schema key                | 与宿主/CLI/远端运行时互通                                                |
| `zcodeEndpoint` 常量名与 `https://zcode.z.ai` 字面量 | 上游默认端点的**代码事实**；仅在显式配置时才被使用，不在默认路径上被调用 |

### 6.2 必须保留：法律与第三方事实

| 位置                                               | 原因                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `LICENSE` 的 `Copyright 2026 Z.AI Co., Ltd`        | 上游著作权归属，§4(c) 要求保留                             |
| `NOTICE.md` 第二～五节（功能/上传/数据/第三方）    | 上游 NOTICE 原文，§4(d) 要求提供；这些**不是** Lumi 的政策 |
| `THIRD-PARTY-NOTICES.md` 与 `third-party/*`        | 第三方原始版权与许可文本                                   |
| Provider / Model 名称、`logo-zai.svg` 等供应商标识 | 真实第三方身份，不能改写成 Lumi                            |
| `@arms/rum-*` 等依赖名                             | 依赖事实                                                   |

### 6.3 刻意保留（可改但选择不改，以最小化上游差异）

| 位置                                                     | 原因                                                 |
| -------------------------------------------------------- | ---------------------------------------------------- |
| 仓库名 / monorepo `name: "zcode"`                        | 改名不影响用户可见品牌，但会造成大范围上游差异       |
| `packages/ui/src/assets/provider-icons/*` 中的供应商图标 | 如需 Lumi 品牌图形请替换**产品**图形，而非供应商身份 |

**改为 Lumi 的产品面**（完整清单见 `docs/upstream/FORK-DIFFERENCES.md`）：应用显示名、
bundle id、About/许可文案、侧栏与欢迎页 logo、i18n 产品名覆盖层、web 标题、README、
平台图标与 DMG/安装器图标源、打包版权串。

### 6.4 依赖替换：闭源遥测 SDK → 应用自有实现（2026-09-21）

**替换了什么**：上游用 `@arms/rum-electron`（连同 `@arms/rum-browser`、`@arms/rum-core`）
采集稳定性/资源/启动遥测并发往 ARMS 后端。这三个包闭源、无仓库、无许可文本，是第三方材料
复核里凭据最弱的条目。本分支以应用自有实现整体替换：

- 新增 `packages/shared/src/telemetrySourceRuntime.ts`：启用与端点解析的**唯一来源**
  （`resolveTelemetryDelivery`；`LUMI_TELEMETRY_ENDPOINT` 优先、上游变量其次、都必须 https），
  事件载荷沿用既有线上格式。
- 新增 `packages/desktop/src/main/lumiTelemetry.ts`：与原 SDK 相同的 API 面
  （`init`/`setConfig`/`getConfig`/`sendCustom`/`sendEvent`/`client.useReporter`），
  内置批量 https 传输（尽力而为、不落盘、失败即丢弃）。`beforeReport` 过滤/富化/脱敏管线、
  启动遥测送达确认（`wrapStartupReporterRequest`）逐行保留。
- 10 个上游主进程遥测调用点改指向 shim；渲染进程浏览器自动采集（`autoInject`）与
  preload `arms:rum-bridge` 转发随 SDK 一并移除（无 SDK 注入后是死代码）；
  pnpm patch `patches/@arms__rum-electron@0.0.3.patch` 删除。
- **兼容标识保留**：`ZCODE_TELEMETRY_ENABLED` / `ZCODE_ARMS_RUM_ENDPOINT` 变量名继续被读取
  （作为上游兼容入口，端点语义不变）；`zcode:report-arms-custom-event` 等 IPC 通道名、
  `ArmsEnv` 类型、E2E 探针 `__zcodeFinalArmsCustomEventsE2E`、`mapZCodeEnvToArmsRumEnv`
  等标识不改（协议契约，见 6.1）。
- **未实现（诚实披露）**：ARMS 控制台专用 PV/WebVitals 浏览器自动采集、崩溃 dump 归集、
  tracing 采样、事件重试与本地持久化。部署方开启遥测后得到的是应用自有 custom/event
  事件流；默认（`LUMI_TELEMETRY` 未设置）完全不出网。
- 验证：`licenses check --strict` 通过（缺省项随组件消失）；负向测试
  `packages/ui/test/lumiTelemetryShim.test.ts` 证明 @arms 从依赖、补丁、接线、preload
  任一方向回归都会失败；打包产物 asar 内 `@arms` 文件与字符串为 0。

---

## 7. 迁移 / 网络 / 更新 / 签名决策

### 7.1 身份与用户数据（**未做迁移，刻意共存**）

- 打包身份：生产 `app.lumi.agents` / `Lumi Agents`；预览 `app.lumi.agents.preview` /
  `Lumi Agents Preview`。
- **`runtimeUserDataDirName` 保持 `ZCode`**，`zcode://` 保持注册。因此 Lumi 与上游 ZCode
  共享数据目录与 URL scheme。这是**共存决策，不是迁移**：
  - 优点：既有用户不丢 localStorage / session / cache；不需要迁移脚本。
  - 风险：同一台机器上若同时安装 ZCode 与 Lumi，会共享配置与登录态；两者对同一
    `setting.json` 的写入可能互相覆盖。
  - **未做**：没有导入、复制或迁移任何凭据或浏览器登录态；没有自动改名。
  - 若要拆分为独立数据目录 / 独立 scheme，需要**单独评估**并配可回滚、幂等的迁移；
    本次不实施（改动会孤立既有用户数据）。

### 7.2 网络与上游产品服务

- **自动更新默认关闭**：`packages/shared/src/lumiDistribution.ts` 的
  `resolveLumiAutoUpdateEnabled` 要求显式 `LUMI_UPDATE_FEED_URL`（必须 https）。
  未配置时桌面端呈现「更新服务未配置」的不可用状态。
  - 打包态**只**接受 `LUMI_UPDATE_FEED_URL`；上游的开发态覆盖入口
    （`ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url`）仍按上游行为仅在非打包态生效。
  - 因此 Lumi **不会**从 ZCode 更新源安装更新，也不会因继承了上游默认值而指向
    `https://zcode.z.ai`。
- **产品遥测默认关闭且不再依赖闭源 SDK**：`ZCODE_TELEMETRY_ENABLED` 由硬编码 `true` 改为
  `resolveLumiTelemetryEnabled(process.env)`（默认 false）。采集由应用自有 shim 承载
  （见 6.4），端点解析收口于 `resolveTelemetryDelivery`：部署方显式设置 `LUMI_TELEMETRY=1`
  并自备 `LUMI_TELEMETRY_ENDPOINT`（优先）或兼容的 `ZCODE_ARMS_RUM_ENDPOINT`，且都必须是
  https。仓库本身不内嵌任何端点，未配置即不出网、不排队。
- 用户自选的模型 Provider 流量（BYOK）不受影响，属正常功能。

### 7.3 签名与发布

- 打包版权串改为 `Copyright © 2026 Z.AI Co., Ltd — Lumi Agents independent fork`，
  不再从 `extraMetadata.author.name` 推导出上游 `ZCode`。
- macOS 签名/公证**未执行**（本机无 Developer ID Application 身份）。签名门禁
  `pnpm verify:macos-release-signing` 在未签名构建上**已知失败**（fail-closed），
  这是预期行为，不是回归。
- `app.lumi.agents` 的 OAuth 回调、深链接注册、更新源、公证凭据都需要外部配置；
  本次**没有**重定向或发明任何服务。

---

## 8. 验证：实际执行的命令与结果

| 命令                                                                                                              | 结果                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `node scripts/check-workspace-freshness.mjs`                                                                      | ✅ 通过（main 与 origin/main 同步，ahead 0 / behind 0）                             |
| `pnpm architecture:check -- --changed`                                                                            | ✅ `architecture: OK`，violations 0 / new 0                                         |
| `pnpm typecheck`                                                                                                  | ✅ 通过（无输出）                                                                   |
| `pnpm lint`                                                                                                       | ✅ **0 errors**，70 warnings（与改动前基线一致，均为存量告警）                      |
| `pnpm fmt:check`                                                                                                  | ⚠ 仅 `DESIGN.md` 未格式化（**改动前即失败的本地未提交工作**，刻意保留）             |
| `node scripts/licenses.mjs check`                                                                                 | ✅ 通过（1734 个实装包；重新生成声明后新鲜度校验通过）                              |
| `node scripts/licenses.mjs check --strict`                                                                        | ✅ 通过：19 项逐条了结，`reviewRequired` 为空（18 条结论待法务签署，见第 5.1/9 节） |
| `node scripts/lumi-modified-files.mjs check`                                                                      | ✅ 通过（42 个已修改文件 + 35 个登记例外）                                          |
| `node scripts/check-lumi-branding-drift.mjs`                                                                      | ✅ 通过（23 项集成点 + §4(b) 声明）                                                 |
| `node scripts/check-lumi-branding-drift.mjs --against-upstream`                                                   | ✅ 通过（无「改了上游文件却没登记」的漏网）                                         |
| `node --import tsx --test packages/ui/test/{lumiCompliance,lumiLicenseReview,lumiBranding}.test.ts`               | ✅ 35/35 通过（含漂移检查与复核判定的负向用例）                                     |
| `node scripts/build-lumi-brand-assets.mjs`                                                                        | ✅ 生成 9 个 PNG 尺寸 + `.icns`(11) + `.ico`(7)                                     |
| `pnpm --filter @zcode/desktop build:no-runtime-assets`                                                            | ✅ 通过（tsup + vite）                                                              |
| `ZCODE_ENV=production node packages/desktop/scripts/bundle.mjs --skip-prepare --skip-build --os mac --arch arm64` | ✅ 通过（bundle-size audit 167.8 MiB / 500 MiB）                                    |

### 8.1 打包产物实际检查（macOS arm64 `.app` 与 `.dmg`/`.zip`）

对**重新打包**的 `packages/desktop/dist/mac-arm64/Lumi Agents.app` 逐项检查：

| 检查项                                                        | 实测值                                                                                                                                | 结论                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `CFBundleIdentifier`                                          | `app.lumi.agents`                                                                                                                     | ✅                     |
| `CFBundleName` / `CFBundleDisplayName` / `CFBundleExecutable` | `Lumi Agents`                                                                                                                         | ✅                     |
| `NSHumanReadableCopyright`                                    | `Copyright © 2026 Z.AI Co., Ltd — Lumi Agents independent fork`                                                                       | ✅ 保留上游权利人      |
| `CFBundleURLSchemes`                                          | `zcode`（仅显示名改为 Lumi Agents）                                                                                                   | ✅ 兼容性保留          |
| 应用图标                                                      | `Resources/icon.icns`、`icon.png` 与 `packages/desktop/build/` **字节完全相同**（sha256 一致）                                        | ✅ 已是 Lumi 原创资产  |
| 第一方许可证                                                  | `Resources/LICENSE`，第 190 行为 `Copyright 2026 Z.AI Co., Ltd`                                                                       | ✅                     |
| NOTICE                                                        | `Resources/NOTICE.md`（含 Lumi 分支说明，上游正文保留）                                                                               | ✅                     |
| 第三方声明                                                    | `Resources/THIRD-PARTY-NOTICES.md`（2,032,497 B），本次重打包后与仓库内源文件 **字节完全相同**（`cmp` 一致），并含第 5.1 节的复核结论 | ✅                     |
| 依赖专属条款                                                  | `Resources/licenses/electron/{LICENSE,LICENSES.chromium.html,SOURCES.json}`，与应用自身 `LICENSE` **分开存放**                        | ✅                     |
| 更新元数据                                                    | 包内 `app-update.yml` → `provider: generic, url: http://localhost:8081`；**不含 `zcode.z.ai`**（`grep -c` = 0）                       | ✅ 未指向上游          |
| 签名                                                          | `Signature=adhoc`，`TeamIdentifier=not set`                                                                                           | ⚠ 未签名（第 9 节 #7） |

**产物检查发现并修复的真实缺陷**：首次打包后 `Resources/` 里**只有** `THIRD-PARTY-NOTICES.md`，
没有第一方 `LICENSE` 与 `NOTICE.md`（CLI/SEA 发行包同样缺失）。这意味着 About「开源许可」窗口只能显示
不可用状态，且不满足 §4(a)/§4(d)。已在 `packages/desktop/electron-builder.config.js`（extraResources）与
`scripts/build-zcode.mjs`（CLI/SEA 包根）补齐，并对 Web 构建插件（`third-party-notices.mjs` 的 vite 插件）
一并输出 `LICENSE` 与 `NOTICE.md`，随后重新打包验证通过（见上表）。

**回归对照**：改动前基线为 lint 0 errors / 70 warnings、typecheck 通过、fmt 仅 `DESIGN.md`
失败。本次工作后三项均与基线一致。**发现并修复的自身回归**：修改声明插入到
`bundle.mjs` / `doctor-macos-release-app.sh` 的 shebang 之前会导致脚本不可执行；已改为
shebang 之后插入，并加了 `place` 约束与行内说明。

**未执行**（环境或凭据不可用，不做任何通过声明）：

- macOS 签名 / 公证（无 Developer ID 身份与公证凭据）。
- Windows / Linux 打包与签名（本机为 macOS arm64）。
- 应用启动与 GUI 交互冒烟（未启动 Electron）。因此 About「开源许可」窗口与折叠 L 标记的
  渲染效果是**静态核对**（读已打包文件与源码），不是界面截图验证；Web 输出同样未在浏览器中打开。
- E2E 交互覆盖（本 checkout 未接入统一 E2E 入口）。
- 桌面/Web 小屏与窄视口截图对比。
- **法务审查**：第 5.1 节的 18 条复核结论是工程侧的证据记录，不构成法律意见；签署前不应视为合规完成。
- 注：重打包时系统卷空间耗尽（`ENOSPC`），`asar` 解包需要临时空间，已将 `TMPDIR` 指向
  仓库内被忽略的 `.tmp/` 后成功；该临时目录已删除。
- 注：`tsconfig.main.json`（`src/main`）**不在** `pnpm typecheck` 的命令范围内；单独用 tsc 跑该配置
  会报 83 个**存量**错误（与本次改动无关的浏览器/遥测类型），本次改动的 main 进程文件（`about.ts`、
  `aboutWindow.ts`、`licensesWindow.ts`、`autoUpdater.ts`）不在错误列表中。语法层面由 `pnpm lint` 覆盖。

---

## 9. 发布阻塞项与所有者行动

以下项目**必须由所有者处理**，本次不代为决定。它们全部是「发布前必办」，不是「已知可忽略」。

| #   | 阻塞项                                                                                                      | 现状                                                   | 需要的行动                                                                         | 所有者          |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------- |
| 1   | 剩余 12 条第三方材料复核结论需**法务签署**（`@arms/rum-*` 已随遥测替换移除；Skia 构建开关不可查的风险最高） | `check --strict` 已通过，结论标注 `legalSignOff: true` | 确认「权利人只声明标识符、无版权声明」的处置可接受；对应组件已移除即无需处置       | 法务            |
| 2   | `dmg_background.png` / `@2x` 仍是上游 DMG 背景图                                                            | 未替换                                                 | 由设计按 DMG 窗口尺寸产出 DESIGN.md 合规替换图                                     | 设计 + 法务     |
| 3   | 品牌资产为**过渡原创标记**（`brand/*`，非官方品牌）                                                         | 已生成全平台图标，非最终品牌                           | 取得官方 folded-L 原图后替换 `brand/` 并重跑 `scripts/build-lumi-brand-assets.mjs` | 品牌            |
| 4   | Geist / Geist Mono **字体未随包**                                                                           | 已声明字体栈，回退系统字体                             | 取得字体授权并内嵌，或确认回退可接受                                               | 品牌 + 法务     |
| 5   | 自动更新未配置                                                                                              | 默认关闭（安全）                                       | 提供 Lumi 自有 https 更新源与产物；在此之前保持关闭                                | 发布工程        |
| 6   | 遥测未配置                                                                                                  | 默认关闭（安全）                                       | 若需上报，配置 `LUMI_TELEMETRY=1` 与自备端点；否则保持关闭                         | 发布工程 + 隐私 |
| 7   | macOS 签名 / 公证未执行                                                                                     | 无 Developer ID 身份与公证凭据                         | 按 `docs/upstream/MACOS-SIGNING-AND-NOTARIZATION.md` 配置后执行门禁                | 发布工程        |
| 8   | Lumi 与 ZCode 共享数据目录与 `zcode://` scheme                                                              | 刻意共存，未迁移                                       | 决定是否拆分；若拆分需幂等、可回滚、备好备份的迁移                                 | 产品 + 工程     |
| 9   | OAuth 回调 / 深链接 / 平台注册仍指向既有标识                                                                | 未改动、未重定向                                       | 若 Lumi 需要独立账号体系，需单独注册与迁移决策                                     | 产品 + 发布     |
| 10  | 翻译长尾中的产品名（未落入覆盖层保护名单的少数文案）                                                        | 覆盖层已处理主体                                       | 与译者复核；不要用全局替换解决                                                     | 本地化          |

**不得**把「界面显示 Lumi Agents」等同于「分支已可分发」。第 1 项（复核结论的法务签署）、
第 2 项（DMG 背景图）、第 7 项（签名/公证）、第 9 项（账号与深链）未解决前，不应对外发布安装包。
第 1 项的**工程侧工作已完成**（`check --strict` 通过、复核记录可核），剩下的只有人的判断，
因此它仍然是阻塞项：不能用「检查通过」代替法务签署。

---

## 10. 相关文档

- [`MODIFICATIONS.md`](./MODIFICATIONS.md) —— §4(b) 声明机制与逐文件例外
- [`../upstream/FORK-DIFFERENCES.md`](../upstream/FORK-DIFFERENCES.md) —— 与上游的差异清单
- [`../upstream/UPSTREAM-SYNC.md`](../upstream/UPSTREAM-SYNC.md) —— 上游同步 runbook
- [`../upstream/MACOS-SIGNING-AND-NOTARIZATION.md`](../upstream/MACOS-SIGNING-AND-NOTARIZATION.md) —— 签名与公证
- [`../specs/lumi-agents/01-brand-identity-and-theme.md`](../specs/lumi-agents/01-brand-identity-and-theme.md) —— 品牌与主题 spec
