# third-party：材料口径与复核模型

本目录是 Lumi Agents 三方许可**材料**（不是许可标识汇总）的单一数据源。声明文件
`THIRD-PARTY-NOTICES.md` 与清单 `third-party/inventory.json` 都由
`node scripts/licenses.mjs notices` 从这里的输入生成；门禁是
`node scripts/licenses.mjs check`（发布前再加 `--strict`）。

```
third-party/
├── inventory.json            生成物：输入哈希、包清单、复核记录、未了结条目
├── npm-overrides.json        npm 包的补充/替代许可材料（含逐包复核记录）
├── copied-components.json    复制进仓库的上游源码与资产
├── embedded-components.json  被父包静态链接/内嵌的原生与 WASM 组件
├── native-search/sources.json 原生检索工具（ripgrep/bfs/ugrep 等）的归档与通知
├── upstream/                 逐份材料的**内容寻址**快照（<sha256>.txt）
└── runtime/                  Node 运行时许可证快照
```

## 证据分类

每条材料只属于下面三类之一，任何一类都不允许「靠标识符了事」：

1. **权利人提供的完整许可文件** —— 从包的发布版本或**发布时点适用**的上游 revision 取得，
   存成 `upstream/<sha256>.txt` 并在清单里登记 `file` + `sha256`。
2. **权利人只提供了标识符 / README 片段** —— 逐包快照保留权利人原文，并附标准许可全文，
   快照开头会写明「这不是上游 LICENSE 文件」。
3. **权利人从未提供任何声明** —— 见下节的复核模型。

## materialReview：把「补不出证据」变成有据可查的结论

上游把两类完全不同的情况都写成同一句 `reviewRequired`：材料其实存在、只是没登记；
以及**权利人从未提供声明**，证据永远补不出来。第二种只能由人作出书面结论，因此建模为
结构化的 `materialReview`，字段与判定规则集中在 `scripts/lumi-license-review.mjs`：

| 字段                  | 含义                                                            |
| --------------------- | --------------------------------------------------------------- |
| `status`              | 只有 `closed` 才算已了结；其它值仍会让 `--strict` 失败          |
| `basis`               | 只接受已登记的两种依据（见 `MATERIAL_REVIEW_BASES`）            |
| `reviewedOn`          | 复核日期（`YYYY-MM-DD`）                                        |
| `declaredLicense`     | 权利人在其发布元数据中声明的 SPDX 标识                          |
| `retainedTexts`       | **必须**留存的许可正文路径；文件缺失/为空即失败                 |
| `searched`            | 实际检索过的证据（归档哈希、发布日期、revision、许可文件历史…） |
| `residualUncertainty` | 残余不确定性；没有就写 `none`，不允许留空                       |
| `legalSignOff`        | 是否仍需法务签署（当前全部为 `true`）                           |

两类依据：

- `publisher-supplied-notice-absent` —— 权利人只声明了标识符。判定会**实际读取留存正文**，
  确认其中含有该许可的条款标记。声明 MIT 却留一份不含 MIT 条款的文本会被拒绝。
- `component-license-retained-provenance-residual` —— 许可正文已留存，但上游没有记录精确的
  构建/链接出处（例如预编译二进制没有记录构建开关）。残余不确定性必须写在记录里。

`materialReview` **不是白名单**：它不改变「哪些条目需要材料」的推导。新出现的、没人复核过的
缺口仍然会进入 `reviewRequired`，从而继续让 `--strict` 失败（负向用例见
`packages/ui/test/lumiLicenseReview.test.ts`）。

## 发布前必须做的事

```bash
node scripts/licenses.mjs notices        # 重新生成声明与清单
node scripts/licenses.mjs check --strict # 材料义务必须全部了结
pnpm lumi:notice                         # Apache-2.0 §4(b) 修改声明完整
pnpm lumi:drift -- --against-upstream    # 集成缝与清单一致性
```

尚需人工处理的事项集中在 `docs/licensing/COMPLIANCE.md`。**基础检查通过不等于合规完成**：
逐包复核记录中的 `legalSignOff: true` 项在发布前需要法务签署，其中风险最高的是
Skia（预编译二进制的构建开关未记录，因而无法确知每个平台链接了哪些 third_party 库）。
