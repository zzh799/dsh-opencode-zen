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
