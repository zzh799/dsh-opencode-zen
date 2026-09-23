# 改造清单：`dsh-opencode-go` -> `dsh-opencode-zen`（v0.2.0）

> 2026-09-23 与维护者逐条确认的最终共识。实施完成后本文件转为实施记录存档。

## 定位

全新独立插件：为 DeepSeek Harness 接入 **OpenCode Zen 按量付费网关**（`https://opencode.ai/zen/v1`）。
与旧包 `dsh-opencode-go` 无关联，不做迁移支持；旧 npm 包不 deprecate，GitHub 旧仓库不动。

## 保留的能力

1. **LLM 路由/适配**：流式、工具调用、图片、`x-opencode-session` 头、Harness UA、`OPENCODE_API_KEY`
2. **模型目录三源合成**：网关 `/zen/v1/models`（免鉴权）+ models.dev 改读 `opencode` 记录（"OpenCode Zen"，109 模型）+ 内置表兜底
3. **设置页 UI**、**模型列表 remote 服务**、**conversion 工具集**、**config/JSON/remotes 基建**
4. **脚本与测试**（同步改名）

依据（外部事实）：
- Zen 无余额/用量 API（官方 issue anomalyco/opencode#10448 仍 open），`/zen/v1/usage` 实测 404；
  `/zen/go/v1/usage`（401 存在）返回的是 Go 订阅三档配额，Go 专属。
- Zen 端点 `https://opencode.ai/zen/v1`，与 Go 共用同一把 API key。
- `x-opencode-session` 是 Go 文档强制项；Zen 文档未提但网关同样记录该头（pi issue #4847），继续发送有益无害。
- models.dev 存在 `opencode` 记录（name "OpenCode Zen"），与 `opencode-go`（"OpenCode Go"）并存。

## 删除（Go 专属）

- 用量服务（`src/usage.ts`、`src/usage-contract.ts`）+ UsagePill UI + `conversation.input.right` 插槽 + 相关测试/夹具
- `examples/migrate-from-fork.patch.yml`（禁用旧 fork `llm-opencode-go` 适配器的迁移片段）
- `image.png`（Go 用量面板截图）
- `docs/assets/install-via-dsh.gif`（画面含旧包名安装命令，引用与文件一并删，待维护者日后重录）

## 标识全表照改

| 位置 | 新值 |
|---|---|
| npm 包名 / 版本 | `dsh-opencode-zen` / `0.2.0` |
| bundle insert id/name | `opencode-zen` / `dsh-opencode-zen` |
| LLM 路由 provider id | `opencode-zen` |
| Cordis fiber / settings namespace | `llm-opencode-zen` |
| 显示名 | `OpenCode Zen` |
| contract package/typeSymbol/descriptor | `dsh-opencode-zen#...` |
| 默认 baseURL | `https://opencode.ai/zen/v1` |
| repository/homepage/bugs | `github.com/zzh799/dsh-opencode-zen` |
| description / README（中英重写，无迁移章节） | Zen 版文案 |
| 测试 host 包名、冒烟 require、headless 示例、`@module` 注释、docs | 全部跟随 |
| 环境变量 `OPENCODE_API_KEY` | 不变（Go/Zen 共用 key） |

实现时核实：`getBuiltinModels('opencode-go')` 的 pi-ai 内置表是否有 `opencode` 键；
若无，兜底改为"网关 + models.dev"双源，并在代码注释写明依据。

## git / 仓库 / 目录

1. 删除本地 `origin` remote
2. 保留现有历史与 tags，版本 `0.2.0`
3. 用 `gh`（已登录 zzh799）创建公开仓库 `zzh799/dsh-opencode-zen`，指向新 origin 并推送
4. 本地目录与 orca worktree 目录都改名为 `dsh-opencode-zen`，`git worktree repair` 修复，`session_move` 迁移会话

## 发布

- 实施方：`npm ci --legacy-peer-deps` -> build -> typecheck -> 全部测试 -> `npm pack` + 冒烟验证 -> 重写 `docs/verification.md`
- 维护者：`npm login` 后手动 `npm publish`
- LICENSE 版权人改为 `Copyright (c) 2026 zzh799`

---

# 后续：Go 档回归（v0.3.0）

> 2026-09-23 记录。本文件上面的内容是 0.2.0 当时的决策存档，其中有一条结论是错的，在此订正。

## 订正："Go 已退役"不成立

上面第 17-22 行把 Go 称为"已退役订阅"，并据此删除 Go 档。**这个判断是错的。** OpenCode Go 仍在售卖并有官方文档（`opencode.ai/docs/go`，当前 $10/月），端点 `https://opencode.ai/zen/go/v1` 依然可用；实测 `GET /zen/go/v1/models` 返回 200 与 41 个模型，`GET /zen/go/v1/usage` 无凭据返回 401（端点存在、需鉴权）。官方文档还把 DeepSeek Harness 列为 Go 的"已知问题客户端"（session 头在部分模型路径缺失），这正是本插件存在的理由，对 Go 一档同样成立。

## 本次做法

不复活独立包，而是把 Go 作为**同一插件、同一设置页的第二档**加回来：

- 两条 LLM 路由 `opencode-zen` / `opencode-go`，各自一套目录、模型发现与模型列表 remote。
- 包名、bundle insert id（`opencode-zen`）、settings namespace（`llm-opencode-zen`）、locale namespace（`settings.opencode-zen`）**全部不变**，版本提到 0.3.0。理由是 0.1.7 的配置文档按 bundle entry id 键控，改 id 会让现有用户配置归零；只把设置页显示标题改为「OpenCode」。
- Go 的配置收进嵌套的 `go` 子对象，顶层字段保持 Zen 语义不变，老文档照常解析。嵌套 volatile 已被 DSH 宿主源码确认可用（`vendor/loader/src/config/entry.ts` 用 `volatileEntries` 收集带 path 的引用、逐层 `Reflect.get` 提交）。
- 两档各自按自己的凭据引用决定是否注册路由，默认都指向 `OPENCODE_API_KEY`，但可以分开设置。
- 配额显示：设置页三档进度条 + 对话输入框右侧用量丸，复用旧版 `UsagePill` 改造。探测结果**只做展示**：不回写配置、不控制路由。原因见下。

## 一个被否决的方案

曾考虑"探测到无 Go 订阅就不注册 Go 路由"。否决理由：非订阅者打 Go 端点究竟是 401 还是按 Zen 余额计费无法离线验证，若实际可用，抑制路由会封掉一条能用的通路；同时会把路由注册从"凭据可解析"这一同步事实，变成一次异步网络探测。改用"只展示、不干预"。

## 与旧独立包的关系

`dsh-opencode-go`（0.1.x）保持已发布、不 deprecate、旧仓库不动，但**不应与本包同时安装**：两者都会占用 `opencode-go` 路由，一方会以 `DUPLICATE_ADAPTER` 告败。已在 README 与 `docs/go-subscription.md` 写明。
