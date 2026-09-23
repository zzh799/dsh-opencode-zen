# dsh-opencode-zen

[English](README.en.md)

功能：让你在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中完美使用 OpenCode 网关的**两档**服务，支持流式回复、工具调用和图片输入。

| | OpenCode Zen | OpenCode Go |
|---|---|---|
| 路由 / provider id | `opencode-zen` | `opencode-go` |
| 计费 | 按量付费，按 token 计 | 订阅制（当前 $10/月） |
| 模型 | 完整目录（Claude、GPT、Gemini、开源模型等） | 一组精选开源编程模型 |
| 额度 | 受账户余额限制 | 滚动窗口：每 5 小时、每周、每月 |
| 用量接口 | 无 | `GET /zen/go/v1/usage` |

两档默认共用同一把 `OPENCODE_API_KEY`，也共用适配器调优（目录刷新间隔、流空闲超时、图片预算）。详见 [docs/go-subscription.md](docs/go-subscription.md)。

插件会自动添加会话请求头、读取网关模型目录，无需给模型配置协议、模态、上下文长度、最大输出 token。

## 功能说明

- **会话请求头**：每次请求包含 Harness User-Agent 和 `x-opencode-session`。同一会话保持相同 ID，最佳缓存命中率。
- **流式与历史**：支持流式输出、工具调用及历史回放，协议请求由 pi-ai 执行。
- **图片输入**：支持目录中声明图片能力的模型。
- **两档独立**：设置页一个页面两个面板，各有自己的开关、凭据、端点、模型列表与勾选白名单。哪一档没有可用凭据，那一档的路由就不会注册，也不会出现在模型选择器里。
- **配额显示**：Go 档的额度窗口显示在设置页，也可在对话输入框中看到；仅作展示，不会改变这一档提供的任何内容。
- **模型管理**：在设置页勾选要出现在会话模型列表中的模型；未勾选的模型不再出现在列表里，正在使用它的会话不受影响，下次打开选模型处才体现。
- **模型容量覆盖**：可按模型覆盖上下文窗口和最大输出，空值继承在线目录。
- **提示与缓存**：插件不增加隐藏系统提示；会话 ID 用于网关路由。

## 安装与使用

兼容清单：
 `0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.6-alpha.1`、`0.1.6-alpha.2`、`0.1.7-alpha.1` 和 `0.1.7-alpha.2`

### 在 DSH 中安装（推荐）

1. 打开 DSH 的 **插件** 页面，点击右上角 **添加插件**。
2. 输入 `dsh-opencode-zen`，点击 **安装**。
3. 安装成功后，如果出现 **立即启用**，点击即可。

然后打开 **设置 → OpenCode**，填入 API Key 并保存，即可在会话中选择两档的模型。

若当前 DSH 没有「添加插件」入口，可使用下面的命令行方式。

### 命令行安装（备选）

```sh
dsh plugin --profile web add dsh-opencode-zen@0.3.0
```

安装后启动或重启 `dsh web`，然后：

1. 打开 **设置 → OpenCode**。
2. 填入 OpenCode API Key 并保存。
3. 在会话的模型选择器中选择模型。

### 无头模式

安装到 Headless profile：

```sh
dsh plugin --profile headless add dsh-opencode-zen@0.3.0
```

将以下内容保存为 `headless.patch.yml`，选择默认模型：

```yaml
- id: agent-default-model
  config:
    provider: opencode-zen        # Go 档换成 opencode-go
    model: deepseek-v4.1-flash
```

在 Bash 或 Zsh 中读取 API Key，然后运行任务：

```sh
read -s OPENCODE_API_KEY
export OPENCODE_API_KEY
dsh --profile headless --patch ./headless.patch.yml "你好"
```

模型 ID 须在当前网关目录中可用。Web 和 Headless 使用各自的 profile，需要分别安装插件。

如需从源码构建并安装本地包：

```sh
npm ci
npm pack
dsh plugin --profile web add ./dsh-opencode-zen-0.3.0.tgz
```

开发依赖包含多代 DSH 的真实测试包，它们的 peer 依赖互相冲突，仓库根目录的 `.npmrc` 已默认启用 `legacy-peer-deps`，无需再手动传参（pnpm 从 git 安装本插件时执行的裸 `npm install` 也依赖这份配置）。Headless 用户将 `web` 换成 `headless`。

## 配置两档

设置页的**高级设置**里，两档各有自己的凭证引用名与网关地址，默认都指向 `OPENCODE_API_KEY` 与各自的官方端点。把 Go 档的凭证引用名改成别的已配置引用，即可让两档使用不同的 key：

```yaml
- id: llm-opencode-zen
  config:
    apiKeyEnv: OPENCODE_API_KEY          # Zen
    go:
      enabled: true                       # 默认开启；关掉只影响 Go 档
      apiKeyEnv: OPENCODE_GO_KEY          # Go，可留空沿用 Zen 的引用
      baseURL: https://opencode.ai/zen/go/v1
```

## 升级插件

更新 Web profile 中的插件到 npm 最新版本：

```sh
dsh plugin --profile web update dsh-opencode-zen --latest
```

完成后重启 `dsh web` 并刷新浏览器。Headless 用户将 `web` 换成 `headless`；如果两个 profile 都安装了插件，需要分别升级。

## 常见问题

### 同时装了 `dsh-opencode-go` 会怎样

本插件已包含 Go 档，**不要再安装 0.1.x 的独立包 `dsh-opencode-go`**。两者都会占用 `opencode-go` 路由，注册失败的一方会在日志中记录 `DUPLICATE_ADAPTER`，两个设置页也会对 Go 档的配置各说各话。移除独立包即可。

### 提示 `opencode-zen`（或 `opencode-go`）路由已被占用

同一 profile 中，一个路由只能由一个适配器提供。如果已经通过其他插件或通用 pi-ai 配置接入同名路由，请先停用那一项配置。另一档与其他提供方不受影响。

### 某档的模型没有出现在选择器里

按顺序确认：该档的开关是否打开、它自己引用的那个凭据是否已配置、模型是否在「模型管理」里被勾选。三者都满足时，保存后刷新模型列表即可。两档是独立判断的，一档被撤下不会影响另一档。

### 设置页说没有检测到 Go 订阅

说明 Go 的用量端点以 401/403 拒绝了这次探测，通常意味着当前凭据没有 Go 订阅。插件不会因此改动任何配置，Go 档的路由与模型保持可用；订阅生效后这条提示会自行消失。

### 没有出现预期的模型

先确认插件已启用且 API Key 已配置，再刷新设置页中的模型列表。插件每次读取模型列表都会请求该档网关的 `/models`，并同步 [models.dev 中对应的配置记录](https://models.dev/api.json)（Zen 读 `opencode`，Go 读 `opencode-go`）。模型的协议、上下文长度、输出上限和图片能力来自在线配置，新模型无需等待本插件或 pi-ai 发布新版本。

如果模型在设置页的「模型管理」里没有勾选，它也不会出现在会话模型列表中；勾选后保存即可。取消勾选不会中断已经在跑该模型的会话，改动在下次打开选模型处体现。

网关和在线配置已收录、且使用 Anthropic Messages、OpenAI Chat Completions 或 OpenAI Responses 协议的新模型，在下次读取或刷新列表时即可使用。刷新会绕过已有会话的目录缓存；直接请求尚未缓存的新模型也会立即重新同步。设置页显示完整模型列表。

网关已公布 ID 但尚无有效协议/能力配置的模型会在设置页的发现结果中标注配置暂不可用，暂不进入对话模型选择器，避免一个未配置的模型阻断整个列表；直接调用时会说明原因。配置补齐后，刷新列表即可使用。仅凭模型 ID 无法可靠推断调用方式。上游新增全新协议或协议特例时，仍可能需要适配。

模型具有推理能力但没有可调节的推理档位时（如 `union-alpha`），仍可正常选择和使用，只是不显示推理强度选项。

在线配置暂时不可达时，优先复用本次运行中成功获取的配置，以 pi-ai 内置配置作为备用。网关目录不可达时，已有请求可以使用上次目录；设置页刷新会显示失败，避免把旧目录误认为最新结果。`refreshMinutes` 只控制已有模型请求的缓存时长，不阻止主动读取列表获取新模型。

## 卸载

从对应 profile 移除插件，再重启应用：

```sh
dsh plugin --profile web remove dsh-opencode-zen
# 或
dsh plugin --profile headless remove dsh-opencode-zen
```

## 反馈

遇到 bug 或有功能建议请提 issue。

## 许可证

[MIT](LICENSE)
