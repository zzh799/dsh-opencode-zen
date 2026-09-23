# dsh-opencode-zen

[中文](README.md)

Use OpenCode Zen, OpenCode's pay-as-you-go model gateway, in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with streaming replies, tool calls, and image input.

The plugin automatically adds the session headers required by OpenCode Zen and reads the gateway model catalog. There is no need to configure model protocols, modalities, context windows, or maximum output tokens manually.

## Features

- **Session headers**: Every request includes the Harness User-Agent and `x-opencode-session`. A session keeps the same ID to maximize cache hits.
- **Streaming and history**: Supports streaming output, tool calls, and history replay through pi-ai.
- **Image input**: Supports models that advertise image capability in the catalog.
- **Model management**: Check the models conversation pickers should offer; an unchecked model leaves the picker, while a conversation already using it keeps running and the change shows the next time a picker opens.
- **Model capacity overrides**: Override the context window and maximum output per model, with blank values inheriting the online catalog.
- **Prompt and caching**: The plugin does not add hidden system prompts; the session ID is used for gateway routing.

## Installation and usage

Supported DSH versions: `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, and `0.1.7-alpha.2`.

### Install from DSH (recommended)

1. Open the **Plugins** page in DSH and click **Add plugin** in the top-right corner.
2. Enter `dsh-opencode-zen` and click **Install**.
3. If prompted after installation, click **Enable now**.

Then open **Settings → OpenCode Zen**, enter and save your API key, and select an OpenCode Zen model in a conversation.

If your DSH version does not have an **Add plugin** entry, use the command-line method below.

### Command-line installation (alternative)

```sh
dsh plugin --profile web add dsh-opencode-zen@0.2.0
```

Start or restart `dsh web`, then:

1. Open **Settings → OpenCode Zen**.
2. Enter and save your OpenCode Zen API key.
3. Select an OpenCode Zen model from the conversation model picker.

### Headless

Install the plugin into the Headless profile:

```sh
dsh plugin --profile headless add dsh-opencode-zen@0.2.0
```

Save the following as `headless.patch.yml` to select a default model:

```yaml
- id: agent-default-model
  config:
    provider: opencode-zen
    model: deepseek-v4.1-flash
```

Read the API key in Bash or Zsh, then run a task:

```sh
read -s OPENCODE_API_KEY
export OPENCODE_API_KEY
dsh --profile headless --patch ./headless.patch.yml "Hello"
```

The model ID must be available in the current gateway catalog. Web and Headless use separate profiles, so install the plugin in each profile you use.

To build from source and install a local package:

```sh
npm ci
npm pack
dsh plugin --profile web add ./dsh-opencode-zen-0.2.0.tgz
```

The development dependencies include real test packages from multiple DSH generations whose peer dependencies conflict with each other. The `.npmrc` at the repository root enables `legacy-peer-deps` by default, so no extra flag is needed (the bare `npm install` that pnpm runs when installing this plugin from git also relies on it). For Headless, replace `web` with `headless`.

## Updating the plugin

Update the plugin in the Web profile to the latest npm version:

```sh
dsh plugin --profile web update dsh-opencode-zen --latest
```

Restart `dsh web` and refresh the browser afterwards. For Headless, replace `web` with `headless`; if both profiles have the plugin installed, update each one separately.

## FAQ

### The `opencode-zen` route is already in use

Only one adapter in a profile can provide the `opencode-zen` route. If another plugin or a generic pi-ai configuration already connects OpenCode Zen, disable that configuration first. Other providers can continue to run.

### An expected model is missing

Confirm that the plugin is enabled and an API key is configured, then refresh the model list in Settings. Each model-list read requests the gateway's `/models` endpoint and synchronizes the OpenCode Zen configuration from [models.dev](https://models.dev/api.json). Protocol support, context length, output limit, and image capability come from the online configuration, so new models do not require a release of this plugin or pi-ai.

Models that are present in the gateway and have an entry using Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses become available on the next list read or refresh. Refresh bypasses the existing catalog cache; a direct request for a previously unseen model also triggers an immediate resynchronization. The Settings page shows the complete discovery result.

A model that is not checked in the Settings page's model management also stays out of conversation pickers; check it and save. Unchecking does not interrupt a conversation already running that model, and the change shows the next time a picker opens.

A gateway model ID with no usable protocol or capability configuration is shown in Settings with a configuration-unavailable diagnostic and is kept out of the conversation picker, so one unconfigured model cannot block the rest of the list. Direct requests report the reason. Refresh after the upstream configuration is corrected. A model ID alone is not enough to reliably infer its transport; new protocols or protocol-specific exceptions may still require adapter changes.

A reasoning-capable model without adjustable reasoning levels (for example, `union-alpha`) remains selectable and usable; it simply has no reasoning-strength control.

If the online configuration is temporarily unavailable, the plugin prefers a configuration fetched successfully earlier in the process and falls back to pi-ai's built-in metadata. If the gateway catalog is unavailable, existing requests can use the last catalog; a Settings refresh reports the failure instead of presenting stale data as current. `refreshMinutes` controls the cache lifetime for ongoing model requests, but does not prevent an explicit model-list read from fetching fresh data.

## Uninstall

Remove the plugin from the relevant profile and restart the application:

```sh
dsh plugin --profile web remove dsh-opencode-zen
# or
dsh plugin --profile headless remove dsh-opencode-zen
```

## Feedback

Please open an issue for bugs or feature requests.

## License

[MIT](LICENSE)
