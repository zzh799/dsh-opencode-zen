# 交接文档：设置面板模型勾选功能

> 本文档是设计阶段（经完整需求拷问）的最终产物，供执行 agent 实施。**所有决策已与用户确认，不要重新设计**。若实施中发现决策之间冲突或不可行，停下来向用户报告，不要自行变通。

## 1. 功能概述

在插件设置页的模型列表中，为每个模型增加**勾选框**，构成一个白名单：只有被勾选的模型才会出现在（会话内的）模型选择器中。

**白名单的执行点（关键约束）**：勾选**仅过滤模型选择器的列表**。配置里写死的模型 id（如 headless patch、agent 默认模型）、正在运行的会话、任何显式引用模型 id 的路径**都不受影响**，不做硬拦截。过滤发生在"下次打开选模型处"。

## 2. 代码地图（实施必读）

项目是 DSH（DeepSeek Harness）双面插件（Host 半 + 浏览器 client 半），React 18 + Cordis 注入 + 快照存储模式。

| 文件 | 职责 |
|---|---|
| `src/config.ts:76-93` | Host 端配置 schema（Schemastery `z.*`），新增字段加在这里 |
| `src/index.ts:146-164` | `enabled: false` 时从所有选择器撤下 provider（`registration.replace`）；`:165-170` 显示开关触发选择器刷新的先例 |
| `src/adapter.ts:153-166` | `listModels` 返回 `LlmModelInfo`；`:158-159` 是现有弃用模型过滤的位置，**勾选过滤加在这里** |
| `src/client/section-controller.ts:48-69` | 客户端设置字段定义 `OpencodeZenSettings` |
| `src/client/section-controller.ts:186-202` | StagedForm 的 FieldSpec 列表（暂存字段） |
| `src/client/section-controller.ts:276-295` | `setEnabled` / `setShowDeprecatedModels` 两个**即时写**方法（本功能要迁入暂存） |
| `src/client/staged-form.ts` | 通用暂存表单机制（dirty/invalid/save/discard，`:254` dirty 派生，`:294-299` discard，`:311-326` save） |
| `src/client/Section.tsx:341` | `<ModelEditor>` 挂载点（常驻可见，不在 `<details>` 内；`:288-313` 的 details 只包 API key 段） |
| `src/client/Section.tsx:346-354` | 页脚 Save/Discard 按钮 |
| `src/client/ModelEditor.tsx` | 模型列表控件：`:30` 取列表、`:37-42` 筛选 chips（all/new/custom/deprecated + 计数）、`:47-50` 徽标（NEW/弃用）、`:56-59` chips 行、`:62-69` 行按钮（`aria-pressed` 选中态，纯 `<button>`，**需改为"勾选框 + 行按钮"容器**）、`:21-42` 搜索 query |
| `src/client/locales.ts` | en/zh 文案字典，**en 是 key 真源，两套 key 必须镜像**，类型 `OpencodeZenKey`（`:157`） |
| `src/client/Section.module.css` | 样式（CSS modules，`--dsw-*` 设计令牌） |
| `src/models-contract.ts:4-11` | `ZenModel` 契约：`{id, name?, contextWindow?, maxTokens?, deprecated?, releaseDate?}`，**无 provider 字段**（整个列表就是 provider `opencode-zen`），**无 unavailable 字段** |
| `src/catalog.ts:151-164,198` | host 端 unavailable 模型：原因被拼进 name 字符串 `id (metadata unavailable: reason)` |
| `tests/model-visibility.spec.ts` | 现有可见性测试（弃用过滤、总开关），**最重要的参考与扩展点** |
| `tests/section.client.spec.tsx` | 设置页组件测试 |
| `tests/dynamic-config.spec.ts` | 配置读写测试（`:64-68` 写 settings.yaml） |

持久化：DSH 0.1.5/0.1.6 走 `~/.dsh/settings.yaml` 的 `llm-opencode-zen` namespace；0.1.7 走 `configForms` profile 条目。两条路径都逐字段写、无需重启。字段加上 schema 后自动获得这两条路径，**不需要额外持久化代码**。

UI 原语：`Button/Switch/Tag` 来自 `@deepseek-ai/dsh-client-ui-primitives`，**该包没有 Checkbox 导出**。原生复选框参考宿主 `RiskConfirmation` 的写法：`<label><input type="checkbox" .../><span>{label}</span></label>`。插件不得引用其他插件的组件。

## 3. 已定决策（22 条，全部经用户确认）

### 语义与数据

1. **白名单语义，执行点 = 仅过滤选择器列表**（不硬拦截显式 id 引用）。
2. **新模型默认不勾选**。
3. **粒度 = 单模型**（`provider/model-id` 级），无 provider 整组勾选。
4. **批量操作 = 仅"全不选"按钮**，无"全选"。
5. ~~初始决定"即时生效"~~ → **被决策 15 覆盖：保存后生效**。
6. **空选合法**；勾选数为 0 时按 `enabled:false` 同等处理，选择器中整个 provider 撤下（不是显示 0 个模型的空壳）。
7-9, 11. **列表沿用 `ModelEditor` 现状**：数据源（`state.models.entries`）、搜索框、筛选 chips、排序、行内展示（名称 + id + NEW/弃用徽标）、收录范围，全部不新造。
10. **取消勾选在用模型**：下次选模型时体现，在跑请求/会话不中断。
12. **缺省态（升级兼容）**：字段缺失 = "从未设置过" = 视为全勾。**用户首次改动勾选列表的那一刻**物化快照（把当前全部模型展开写入，再叠加本次改动），此后严格按存储，新模型自此默认不勾。只改其它字段并保存**不触发**物化。
13. **三开关正交并存**：选择器可见 = `enabled` && 已勾选 && (`showDeprecatedModels` || 非弃用)。
16. **空选时设置页不加警示**，勾选状态自明。
18. **陈旧 id 永不清理**：勾选过的 id 若从目录消失，列表行消失但存储保留，模型恢复则勾选状态还原。**不得**在保存时清理不在目录中的 id（目录拉取失败/网关抖动会洗掉用户状态）。
19. **元数据缺失（unavailable）模型与普通模型无差别**：正常可勾（原因已拼在 name 文本里可见），始终进不了选择器，元数据恢复即自愈。不加禁用态、不排除、不加新契约字段。

### 交互与生效

15+17. **整页统一保存后生效**：
   - 勾选列表走 StagedForm 暂存（新 FieldSpec 字段）。
   - `enabled`、`showDeprecatedModels` 从**点击即写迁入暂存**，随 Save 落盘；现有 `pickerSaving`/`pickerFailed` 即时反馈机制**移除**。
   - 完成后整页无任何即时写控件，所有改动统一走 Save/Discard。
   - **已知代价（用户接受）**：`enabled` 开关是已上线控件，行为变更（点开关后需再点 Save）。
20. **"全不选"按钮位置**：筛选 chips 行右侧，紧挨作用对象，与页脚 Save/Discard 空间分离。
21. **刷新保护**：`state.dirty` 时挂 `beforeunload`，离开/刷新前弹原生"更改尚未保存"确认。挂在暂存表单 dirty 上，对所有暂存字段统一生效。
22. **Discard 维持无确认**（一击清空），不加任何弹窗。
14. **承载形态**：勾选框**嵌入 `ModelEditor` 现有列表行**，行结构从纯 `<button>` 改为"勾选框 + 行按钮"的容器（这同时修复嵌套交互元素的 a11y 问题）。一份列表、一个搜索、一组筛选同时服务"可用性勾选"和"容量编辑"。分区标题文案需改为涵盖两种用途（如"模型管理"，en 相应调整），不能嵌了勾选还叫"模型上限"。

## 4. 实施步骤（建议顺序）

1. **Host schema**（`src/config.ts`）：新增字段 `enabledModels?: string[]`（或 `Record<string, boolean>`，推荐前者：存"已勾 id 列表"更贴合白名单语义、天然支持决策 12 的物化）。含义：`undefined` = 从未设置 = 全勾；数组 = 严格白名单。注意 `modelLimits`（`Record<string,...>`）是现成的按模型 id 键控字段先例。
2. **执行点**（`src/adapter.ts:158` 附近）：`listModels` 在弃用过滤之外追加勾选过滤。过滤函数必须处理 `undefined`（= 全放行）。**空选时**（非 undefined 且为空数组）配合 `src/index.ts` 的 `registration.replace` 从选择器撤下 provider，参考 `enabled:false` 的现有实现（`:146-164`）与弃用开关触发刷新的先例（`:165-170`）。
3. **客户端字段与暂存**（`src/client/section-controller.ts`）：`OpencodeZenSettings` 加字段；FieldSpec 列表加暂存字段；projection 输出勾选状态与已勾数量；新增暂存动作 `setCheckedModels`（改草稿，不直接写 scope）；实现决策 12 的**首次改动物化**逻辑（草稿为 `undefined` 时先以当前全量 id 铺底再叠加改动）。
4. **迁移两个即时开关入暂存**（同文件 `:276-295`）：`setEnabled`/`setShowDeprecatedModels` 改为 stage 而非 `scope.set`；删除 `pickerSaving`/`pickerFailed` 及 Section 中对应 UI 反馈。注意 `enabled` 已在 FieldSpec 里（`:191`，为 override 徽标机制），只需让 UI 走暂存；`showDeprecatedModels` 目前不在 spec 里（`:192-199` 需新增）。
5. **UI 嵌入**（`src/client/ModelEditor.tsx` + `Section.module.css`）：
   - 行改容器结构：`<label><input type="checkbox"/></label>` + 原行按钮，事件不互扰（点勾选框不触发选中行，反之亦然）。
   - "全不选"按钮放 chips 行（`:56-59`）右侧。
   - 无障碍：容器化后避免 interactive 元素嵌套；勾选框需有 `aria-label`（含模型名）。
   - 分区标题改名（见决策 14）。
   - 样式复用现有 `.modelList`/`.modelChoice`/`.filters` 令牌，保持与现列表像素一致。
6. **beforeunload**（`staged-form.ts` 或 controller 层）：仅 `state.dirty` 时注册监听，save/discard 后注销。
7. **文案**（`src/client/locales.ts`）：新增 key 至少含：勾选框 aria、全不选按钮、改名后的分区标题、（如需）空列表提示。**en/zh 两套 key 严格镜像**。
8. **空列表现状确认**：`ModelEditor.tsx:85` 在列表为空时**不渲染任何提示**（仅 chips 计数为 0）。全不选后编辑器内部会显得空白，属既有行为；若观感明显不对，按全局标准补一条空态提示（属允许的顺手修复）。

## 5. 测试要求

- **`tests/model-visibility.spec.ts` 扩展**（核心）：
  - `undefined` 字段 = 全部模型可见（升级兼容）。
  - 指定列表 = 仅列表内模型可见；未勾选的不出现。
  - 空数组 = 选择器撤下 provider（对照 `enabled:false` 的现有断言方式）。
  - 勾选过滤与弃用过滤、`enabled` 三者正交组合。
  - 陈旧 id：存储含目录外 id 不报错、目录恢复后还原。
  - 显式 id 引用路径**不受**勾选影响（防硬拦截回归）。
- **`tests/section.client.spec.tsx` 扩展**：
  - 勾选改动进入 dirty、Save 后落盘、Discard 后还原。
  - 决策 12：首次改动触发物化（断言写入的是全量快照 + 本次改动），仅改其它字段保存不物化。
  - `enabled`/`showDeprecatedModels` 改为暂存后不再即时写（原即时写断言需改写）。
  - 全不选按钮行为；`beforeunload` 仅 dirty 时注册。
- **`tests/dynamic-config.spec.ts`**：新字段的 schema 读写往返。
- 全部现有测试必须继续通过（`vitest`）；`pickerSaving`/`pickerFailed` 相关既有断言按新行为改写，不是删除覆盖。

## 6. 验收清单（端到端，对照本节逐条验证）

1. 升级已有配置（无新字段）：选择器里模型**不增不减**，与升级前完全一致。
2. 设置页勾掉某模型 → 点 Save → 打开会话模型选择器：该模型消失；其余模型、弃用开关、总开关行为不变。
3. 勾掉的模型若被 headless patch 显式引用：请求照常工作（执行点仅在选择器）。
4. 取消勾选当前会话正在用的模型 → Save → 当前会话不中断，下次打开选模型处该模型消失。
5. 全不选 → Save → 选择器中整个 `opencode-zen` provider 消失（不是空壳）。设置页无警示条（决策 16）。
6. 改动勾选后**不点 Save** 直接刷新页面 → 弹出原生确认；取消则草稿还在，确认离开再回来草稿丢失（符合预期）。
7. 改动后点 Discard → 一击还原，无确认弹窗。
8. 首次改动勾选（此前无字段）→ Save → 配置文件里出现**全量** id 列表（含未动的）+ 本次改动结果；此后新出现的模型默认不勾。
9. `enabled`、弃用开关点击后**不再**立即生效，Save 后才生效；`pickerSaving` 反馈消失，Save 按钮态承担反馈。
10. UI 像素级检查：勾选框与行按钮点击互不干扰；NEW/弃用徽标、搜索、四个筛选 chips 计数在勾选模式下照常工作；分区标题与新功能相符；en/zh 切换无缺 key、无溢出。
11. 元数据缺失的模型（name 含 `metadata unavailable`）可勾，且不出现在选择器。

## 7. 明确的"不要做"清单

- 不要给显式 id 引用加硬拦截/报错（决策 1 的执行点约束）。
- 不要在保存时清理目录外的陈旧勾选 id（决策 18）。
- 不要给 `ZenModel` 加 unavailable 字段或改名字符串格式（决策 19 走既有 name 文本）。
- 不要给空选状态加设置页警示条（决策 16）。
- 不要给 Discard 加确认，不要加"全选"按钮（决策 22、4）。
- 不要把勾选过滤实现为独立的新列表组件/新分区（决策 14：嵌入现有列表）。
- 不要改 `showDeprecatedModels`/`enabled` 的开关位置与视觉，只改生效方式（决策 13、17）。
- 不要动 CHANGELOG.md（自动生成）；提交消息不加 agent 共同作者；全局禁用破折号"-"以外的长横线。
