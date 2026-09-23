# Verification

Verification record for `dsh-opencode-zen` 0.2.0, which routes DeepSeek Harness to the OpenCode Zen pay-as-you-go gateway. Records for the predecessor `dsh-opencode-go` releases live in git history under tags `v0.1.3`-`v0.1.9`.

## Release 0.2.0 (2026-09-23)

This release retargets the plugin from the retired Go subscription to the pay-as-you-go endpoint `https://opencode.ai/zen/v1`, removes the subscription usage service and UsagePill UI, and applies the new identity table: package `dsh-opencode-zen`, bundle insert `opencode-zen`, route `opencode-zen`, settings namespace `llm-opencode-zen`. `OPENCODE_API_KEY` is unchanged because both gateways share one key. Zen exposes no balance or usage API (anomalyco/opencode#10448 stays open; `/zen/v1/usage` answers 404), which is why no usage feature ships.

Measured on macOS 15.7.5 / Node.js 26.7.0 / npm 11.19.0.

### Local checks

- `npm ci --legacy-peer-deps`: 445 packages, 0 vulnerabilities.
- `npm run typecheck`: strict Host and Client programs against installed declarations, both pass.
- `npm test` (runs the build first): all **218 tests in 16 files** pass. The suites cover adapter streaming against a loopback gateway (cached usage fields, session headers, Harness user agent, reasoning efforts including the `off` wire path, stop/image/tool refusals, unknown models, degraded listings), catalog three-source composition (live gateway listing + the models.dev `opencode` record + pi-ai builtin fallback) with discovery, ETag revalidation, outages and retirements, settings-backed dynamic configuration, deprecated-model visibility, per-model capacities, real Loader composition, image resizing/offload and immutable history, JSON responses, package compatibility, the distributed browser factory and CSS composition, stores and section UI, and a six-host matrix against published DSH packages: `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, `0.1.7-alpha.2`.
- `npm pack`: `dsh-opencode-zen-0.2.0.tgz` with 36 files - bundle patch, Host ESM, browser factory, type declarations, LICENSE, both READMEs, and the docs.

The published UI primitives still reference a missing source map; Vitest prints an upstream warning that does not affect test outcomes.

A retired-identifier scan over the whole tree (package names, `OPENCODE_GO_*`, `OpencodeGo*`, and related symbols) returns only two source comments that contrast models.dev's `opencode` record with the sibling `opencode-go` record - that distinction is an external fact the metadata lookup depends on - plus the archived `docs/transformation-plan.md`, which keeps old names on purpose. The distributed `lib/` contains no local absolute paths: the CSS-module build now hands esbuild repo-relative paths so the per-module comments stay portable.

### Reasoning-off coverage under Zen data

pi-ai's Zen builtin table declares `thinkingLevelMap.off: null` for the `deepseek-flash` family, and the live models.dev record for `deepseek-v4.1-flash` advertises effort levels only. Both sources agree that model cannot disable thinking, so requesting `off` for it fails with `UNSUPPORTED_REASONING_EFFORT` before any I/O. The wire assertion for `off` (`thinking: {type: 'disabled'}` with no `reasoning_effort`) therefore runs on `kimi-k2.6`: its live metadata is a pure toggle, and its builtin compat is the only Zen entry that keeps `thinkingFormat: 'deepseek'`, the branch that emits the explicit disable. A live probe of this wire stayed inconclusive for the funds reason below; the loopback fixture asserts the exact request body the adapter emits.

### Isolated installed checks

A fresh temporary consumer installed the official CLI plus the tarball without `--force` or `--legacy-peer-deps`:

```sh
npm init -y
npm install --ignore-scripts @deepseek-ai/dsh@0.1.7-alpha.2 /absolute/path/to/dsh-opencode-zen-0.2.0.tgz
```

Under an isolated `DSH_HOME`, the first `dsh plugin --profile headless add <tarball>` stopped at pnpm's build-policy gate (`ERR_PNPM_IGNORED_BUILDS` for `@google/genai` and `protobufjs`). Setting both `allowBuilds` entries to `false` in the profile's `pnpm-workspace.yaml` and retrying completed the installation. Because the interrupted first run had already written the dependency, the plugin manager's reconcile skipped bundle registration on the retry - it only registers dependencies new to that run - so adding `dsh-opencode-zen` to the profile's `dsh.profile.bundles` completed the registration. `dsh --profile headless --dump-config` then lists the `# == dsh-opencode-zen` bundle with `id: opencode-zen`.

From this project:

```sh
npm run verify:installed -- /absolute/path/to/consumer   # PASS
npm run verify:headless  -- /absolute/path/to/consumer   # PASS
```

The installed smoke resolves the tarball and the shared DSH services from the consumer, mounts them through the real Cordis Loader without an import mock, queries the catalog, streams three requests, checks session-header stability and isolation, authorization and User-Agent, then disposes the adapter to verify route removal. The headless smoke drives the official `dsh --profile headless` launcher with a temporary profile overlay against a loopback gateway; the task completes with `standalone-ok` and the outgoing request carries the session header. Both smokes bind OS-allocated loopback ports and clean up afterwards.

### Live endpoint checks (read-only)

- `GET https://opencode.ai/zen/v1/models` without credentials: HTTP 200, **79 models**, including `deepseek-v4.1-flash`.
- models.dev's live `opencode` record ("OpenCode Zen") serves **109 models** through `@ai-sdk/openai-compatible`.
- No live generation was possible on the verification date: the legacy stored key was rejected (HTTP 401 `Invalid credential`), and the current account key authenticated but every completion probe returned HTTP 402 `Insufficient account funds`. The funding layer rejects the request before any request-shape validation, so no wire behavior could be confirmed live. All wire behavior above rests on the loopback fixtures, which assert the exact request bodies the adapter emits.

### Remaining limits

- No paid model call and no manual Web/Desktop UI pass this release; the browser settings section is covered by the distributed-factory and component tests only.
- Non-macOS platforms and DSH versions outside the six tested releases are not verified.
- The predecessor npm package `dsh-opencode-go` is intentionally left published and not deprecated, and the old GitHub repository is untouched.
