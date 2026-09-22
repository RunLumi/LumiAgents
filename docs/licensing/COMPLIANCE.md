> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Lumi Agents 许可与分发合规

本文件是 Lumi Agents 分支的许可、归属与分发合规单一说明。它记录**实际结果与未决事项**，
不是发布许可：见第 9 节的发布阻塞清单。

---

## 1. 结论摘要

| 项目 | 当前状态 |
| --- | --- |
| 项目维护主体 | **CLOUDJET SOLUTIONS PTE. LTD.**（Singapore UEN **201708398E**）负责 Lumi Agents 分支维护、发布、品牌与路线图；维护身份本身不转移上游版权 |
| Apache 覆盖内容 | 根 `LICENSE` 与上游字节一致，保留 `Copyright 2026 Z.AI Co., Ltd`；Cloudjet/Lumi 第一方内容只在实际拥有权利的范围内主张版权 |
| 第三方内容 | 继续按各自许可分发；`third-party/inventory.json` 当前有 **15** 条人工材料复核记录、`reviewRequired=0`，15 条均仍标记 `legalSignOff: true` |
| NOTICE | Lumi addendum 与上游 NOTICE 正文分离；上游正文保持逐字一致 |
| 打包元数据 | homepage/author/maintainer 已指向 Lumi/Cloudjet，同时保留 ZCode 上游版权事实，不再把 Z.AI/ZCode 产品联系方式伪装成 Lumi 联系方式 |
| DMG 上游背景图 | 两张继承 ZCode 背景图已删除；DMG 使用无图片的 Lumi warm-paper 纯色背景 |
| DCO | legacy cutoff 前 **14** 个 unsigned non-merge commit 以 exact-SHA 冻结为历史例外；PR #20 的 post-enforcement commit `fa48dd3ec9e4cda8363b7bd1e2f819c23afe7493` 被误合入且仍未认证，当前以 same-author retrospective attestation 流程修复，**未签署前 DCO 必须保持红灯** |
| CI strict license gate | PR #20 final head run **#69** 与合并后的 main push run **#73** 均通过 `licensing-docs` 和完整 `license-gates`：依赖安装、policy tests、`check --strict`、§4(b) notices、branding/licensing drift 全绿；main 当前唯一 compliance workflow failure 是 DCO |
| 分支保护 | 当前 GitHub `main` 未启用 required status checks；工作流存在但不能阻止管理员/直接 merge。需按 `docs/governance/GITHUB-RULESET.md` 在 GitHub 设置中启用 |
| 发布就绪 | **尚未自动判定为就绪**：至少需要 CI 全绿、第三方复核的人工法务判断、目标平台签名/公证（如适用），以及商业权利链的私下书面证据 |

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

`LICENSE` 保留本分支继承的 Apache-2.0 许可文本；其中的
`Copyright 2026 Z.AI Co., Ltd` 是上游版权声明，不能因为 Cloudjet 维护或分发本分支而被替换。
同时，这不表示 Z.AI 对本分支后来所有原创内容拥有版权：Cloudjet 仅对其实际创作或经有效转让取得的
Lumi 新增/修改内容持有相应权利，独立贡献者的版权仍归各自权利人，除非另有有效转让。
完整权利映射见 [RIGHTS.md](../../RIGHTS.md)。

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
  - 位图/容器格式（`binary-generated`）：由
    `scripts/build-lumi-brand-assets.mjs` 从 `brand/` 原创 SVG 确定性生成，不含上游字节；
    当前 `NOTICE_EXCEPTIONS` 登记 **28** 个此类生成资产。其余无法内联声明的 JSON/生成清单
    以 `json-no-comments` 机制登记。具体数量以 `scripts/lumi-modified-files.mjs` 为单一事实源。
- 继承的 `packages/desktop/build/dmg_background*.png` 已删除，不再属于声明例外或法务 blocker。

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
的证明。当前 `third-party/inventory.json` 有 **15** 条 `materialReviews`、`reviewRequired=0`；
15 条 review 均仍要求人工 `legalSignOff`。此前风险最高的闭源 `@arms/rum-*` 遥测 SDK 及仅由它
带入的相关生产依赖已被整体移除，不再进入发行物。现存 review 是“有证据的处置记录”，不是机器
替法务宣告风险为零。

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

**证据基础（逐项可复核）**：对 npm、vendored 与预编译材料按各自可获得的 registry/archive/
revision 证据核对发布时点、哈希、`gitHead` 与许可文件历史。部分 npm 条目在其**发布版本对应的时点**
没有许可文件，例如：
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
| `NOTICE.md` 从“本声明适用于……”开始的 inherited body | 上游 NOTICE 正文，§4(d) 要求提供；这些**不是** Lumi 的政策 |
| `THIRD-PARTY-NOTICES.md` 与 `third-party/*`        | 第三方原始版权与许可文本                                   |
| Provider / Model 名称、`logo-zai.svg` 等供应商标识 | 真实第三方身份，不能改写成 Lumi                            |
| 已移除依赖在历史/迁移文档中的名称（如 `@arms/rum-*`） | 仅作为历史事实保留；它们已不在当前生产依赖图中             |

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

- 打包版权/归属串在本修复中改为
  `ZCode portions © 2026 Z.AI Co., Ltd; Lumi Agents developed and maintained by CLOUDJET SOLUTIONS PTE. LTD.`。
  该字段保留上游版权事实，同时不把 Lumi Agents 呈现为 Z.AI 官方发行版，也不虚构 Cloudjet
  对全部 fork 代码的版权转让。
- macOS 签名/公证**未执行**（本机无 Developer ID Application 身份）。签名门禁
  `pnpm verify:macos-release-signing` 在未签名构建上**已知失败**（fail-closed），
  这是预期行为，不是回归。
- `app.lumi.agents` 的 OAuth 回调、深链接注册、更新源、公证凭据都需要外部配置；
  本次**没有**重定向或发明任何服务。

---

## 8. 验证：当前证据状态

本节只记录当前可追溯的 CI / Git 事实。

### 8.1 PR #20 最终 head

PR #20 最终 head：`fa48dd3ec9e4cda8363b7bd1e2f819c23afe7493`。

GitHub Actions run **#69**：

- `licensing-docs` ✅
- `license-gates` ✅
  - attribution/dependency-graph regression tests ✅
  - `pnpm install --frozen-lockfile` ✅
  - licensing-policy tests ✅
  - `node scripts/licenses.mjs check --strict` ✅
  - `node scripts/lumi-modified-files.mjs check` ✅
  - branding/licensing drift ✅
- `dco` ❌：唯一失败是 `fa48dd3ec9` 缺少原作者 `Signed-off-by`。

### 8.2 合并后的 main

PR #20 被 merge 为 main commit
`d8371367ae06eba03759dad7d14293b799f37f0e`。Push workflow run **#73** 再次得到：

- `licensing-docs` ✅
- 完整 `license-gates` ✅
- `dco` ❌，且日志只报告一个 post-cutoff unsigned commit：
  `fa48dd3ec9e4cda8363b7bd1e2f819c23afe7493`。

因此当前事实不是“许可门禁失败”，而是：

> **软件/第三方许可自动门禁全绿；贡献 provenance 的 DCO 人证仍缺一份。**

### 8.3 不变量复核

- root `LICENSE` Git blob 仍为
  `550d8df4cfc74878663a511caa97852f15fd9592`，与 upstream 完全一致；
- 从“本声明适用于……”开始，`NOTICE.md` inherited body 与 upstream 逐字一致；
- `packages/desktop/build/dmg_background*.png` 不存在，DMG 不引用它们；
- packaged metadata 不以 `zcode.z.ai` / `dev@zcode.z.ai` / `ZCode <...>`
  作为 Lumi homepage/author/maintainer；
- `third-party/inventory.json` 与 `THIRD-PARTY-NOTICES.md` 已按声明的
  OS/CPU/libc build matrix 对齐；unsupported musl/Android/ARM32/RISC-V native variants
  不再伪装成当前分发 package entries。

### 8.4 DCO remediation 的完成标准

已 merge 的 `fa48…` 不通过扩大 legacy cutoff 来掩盖，也不 force-rewrite 公共 main。
`docs/licensing/dco-attestations.json` 提供 exact-target remediation：

1. target SHA / author email / subject 必须与 Git 实际提交一致；
2. 首次引入该 target SHA 的 commit 必须晚于 target、是 non-merge、由同一 normalized author 提交；
3. introducing commit 必须带该作者自己的有效 `Signed-off-by`；
4. checker 会验证 ancestry、author identity 与完整 DCO trailer；
5. 在该 commit 被原作者真实签署前，CI **必须失败**。

这份 attestation 只是 DCO 1.1 provenance certification，不是 copyright assignment。

---

## 9. 发布阻塞项与所有者行动

以下只保留真实的人类/治理 blocker；机器侧许可门禁已在 PR #20 run #69 与 main run #73
重复通过。

| # | 阻塞项 | 当前事实 | 完成条件 | 所有者 |
| --- | --- | --- | --- | --- |
| 1 | Post-enforcement DCO 人证 | `fa48dd3ec9e4cda8363b7bd1e2f819c23afe7493` 已误合入 main 且无 `Signed-off-by`；DCO push gate 正确保持失败 | 原作者审核本次 remediation 后，对**引入 exact-SHA attestation 的单一 commit**执行真实 `git commit --amend -s`（或等价签署）再 push；CI 验证 same-author/ancestry/exact-SHA 后才接受 `fa48…` | 原提交作者 |
| 2 | GitHub merge governance | `main` 当前仍显示 `protected: false`；因此红色 DCO 曾能被 merge | 按 `docs/governance/GITHUB-RULESET.md` 启用 PR + required `dco` / `licensing-docs` / `license-gates` + block force-push/delete，并验证普通 maintainer 无法 merge failing PR | Repo admin |
| 3 | 第三方材料的人工法律判断 | 当前 **15** 条 `materialReviews` 均有工程证据且 `reviewRequired=0`，但仍标记 `legalSignOff: true` | 对 15 条 evidence/residual uncertainty 作真实法律判断并把签署证据存于私有法务档案；不把机器 green 当法律意见 | 法务/所有者 |
| 4 | 商业权利链 | README/package author/steward 字段不是版权转让证据 | 私下保存 founder/employee/contractor/brand work 的适用雇佣/IP 条款、assignment 与公司授权；融资/客户尽调以这些文件为准 | Cloudjet/法务 |
| 5 | 目标 release 的平台信任 | Source compliance green 不等于某个 installer 已签名/公证并可安全发布 | 对具体 macOS/Windows/Linux release 执行相应 signing/notarization/installer smoke verification；只对实际验证过的 artifact 作发布声明 | 发布工程 |

### 已解决或非 blocker

- **Strict third-party / notice / drift gates**：PR #20 final head 与 main push 均已全绿。
- **上游 DMG 背景图**：已删除；使用 Lumi 纯色 DMG。
- **自动更新/遥测**：默认关闭是安全状态；只有启用相应 Lumi 服务时需要额外发布/隐私审查。
- **Geist 字体**：当前未随包分发，使用系统 fallback；未来若内嵌再核对字体许可。
- **ZCode 数据目录、`zcode://`、`@zcode/*`、`ZCODE_*`**：兼容性标识，不属于产品归属错误。
- **Interim brand mark**：是否换最终视觉是品牌决定；版权/trademark 边界见 `TRADEMARKS.md`。

**停止条件：** 第 1–2 项未完成前，不能说 repository governance 已 fail-closed；
第 3–4 项未完成前，不能把机器检查描述为商业/法律尽调完成；正式 installer 还需满足第 5 项。

---

## 10. 所有权与尽职调查清单（ownership/diligence）

**这是给所有者与法务的工作清单，不是权利声明。** 本仓库不因这份清单而产生任何新的
所有权推定：GitHub 账号归属、package.json 的 author 字段、界面上的版权字符串、
贡献者的雇佣关系，都**不构成**著作权转让或归属证明。若某项权利对商业路线重要，
必须取得书面证据后才可在公开材料中声明。

### 10.1 权利分层现状

| 层                              | 内容                               | 权利状态                                                                                            |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| 上游（ZCode/Z.AI 及其贡献者）   | Apache-2.0 导入的全部代码          | **已核验**：Apache-2.0 授权随分发持续有效（LICENSE 原文保留）；上游不提供 Lumi 的合同承诺           |
| 社区/项目贡献                  | 按 DCO + Apache-2.0 接受的新公共代码 | DCO 门禁已就绪；pre-cutoff unsigned history 仅以 frozen exact-SHA legacy exceptions 记录；post-cutoff `fa48…` 必须由同一作者作 signed retrospective attestation，不扩大 legacy cutoff |
| Fork 工程（本分支已完成的工作） | 品牌/遥测替换/打包/合规脚本等      | 截至 legacy cutoff 有 19 个非 merge fork 提交：Git 记录中 14 个作者为 `j <hong@cloudjetkpi.com>`、5 个为 `Stream Entry <978862+streamentry@users.noreply.github.com>`；其中 14 个无 DCO。**Git 作者字段不等于 Cloudjet 权利链证据** |
| 品牌资产                        | `brand/` 折叠 L 过渡标记           | 项目自产；**未注册商标**，无排他权利声明（TRADEMARKS.md）                                           |
| 商业层（未建）                  | 托管/企业功能                      | **不存在**；必须独立私有仓库 + 独立权利链，本仓库无任何代码被划走                                   |

### 10.2 未决项（所有者/法务行动清单）

| #   | 事项                                                             | 现状                                             | 需要的证据/行动                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| O1  | Fork 工程与品牌资产的 Cloudjet 权利链 | **公开仓库无法核实**；项目 steward/author metadata 不是 assignment | 私下保存适用的 founder/employee IP 条款、contractor assignment 与品牌资产权利证据；确认无冲突的前雇主/第三方权利 |
| O2  | RunLumi / Lumi / CLOUDJET SOLUTIONS PTE. LTD. 与本项目的法律关系 | README/RIGHTS 已声明 Cloudjet 是项目 steward，但不据此推导所有版权 | 私下保存董事/公司授权、域名/品牌控制与签约授权证据；融资/客户尽调时提供官方公司资料和实际权利文件 |
| O3  | 商标注册                                                         | 未注册、未申请                                   | 若需品牌保护，由权利人在目标辖区申请；文档不制造权利                                              |
| O4  | 创始人/员工/承包商协议存档                                       | 不在仓库（也不应在公开仓库）                     | 签署并存档于私人法务存档；公开仓库只记录"已存档"状态                                              |
| O5  | 未来商业模块的权利链                                             | 未开始                                           | 独立私有仓库 + 独立提交者协议（不得沿用本仓库 DCO 流程作商业再许可依据）                          |
| O6  | 客户数据/生成输出的权利                                          | 无合同                                           | 由未来服务条款处理；本仓库不承诺排他所有权                                                        |
| O7  | DCO 历史与未来贡献 | **14 个 legacy unsigned commit** 精确冻结于 `docs/licensing/dco-legacy-exceptions.json`；post-cutoff `fa48…` 另走 `dco-attestations.json` same-author remediation | 不后移 legacy cutoff、不伪造签名；完成 `fa48…` 的真实作者 attestation；之后所有新提交继续直接 DCO sign-off |

### 10.3 与既成文档的衔接

- 开放/商业边界与用户侧问答：[`LICENSING.md`](../../LICENSING.md)（根目录）。
- 贡献流程与 DCO：[`CONTRIBUTING.md`](../../CONTRIBUTING.md)。
- 品牌使用边界：[`TRADEMARKS.md`](../../TRADEMARKS.md)。
- 政策决策记录：[`../specs/lumi-agents/adr/0001-licensing-and-contribution-model.md`](../specs/lumi-agents/adr/0001-licensing-and-contribution-model.md)。

---

## 11. 相关文档

- [`MODIFICATIONS.md`](./MODIFICATIONS.md) —— §4(b) 声明机制与逐文件例外
- [`../upstream/FORK-DIFFERENCES.md`](../upstream/FORK-DIFFERENCES.md) —— 与上游的差异清单
- [`../upstream/UPSTREAM-SYNC.md`](../upstream/UPSTREAM-SYNC.md) —— 上游同步 runbook
- [`../upstream/MACOS-SIGNING-AND-NOTARIZATION.md`](../upstream/MACOS-SIGNING-AND-NOTARIZATION.md) —— 签名与公证
- [`../specs/lumi-agents/01-brand-identity-and-theme.md`](../specs/lumi-agents/01-brand-identity-and-theme.md) —— 品牌与主题 spec
