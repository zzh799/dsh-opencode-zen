# Verification

Verification record for `dsh-opencode-zen` 0.3.5, which serves two OpenCode gateway plans from one mount, preceded by the 0.2.0 Zen-only release. Records for the predecessor `dsh-opencode-go` releases live in git history under tags `v0.1.3`-`v0.1.9`.

## Release 0.3.5 (2026-09-24)

Nothing in this release moves on the wire, in the configuration schema, or in the two route ids: every change is in what the settings page shows and in the listings it shows them from. Two commits carry it.

`feat: sort OpenCode models and stabilize DSH settings` gives those listings something to sort by. Zen rows gain the plan's price summary, derived from the models.dev cost record and carrying the source price beside the gateway's actual one; Go rows gain the monthly request capacity the public English Go documentation publishes, read over the same bounded-response path with a 24h TTL, a 10s timeout and a 2 MB cap, where a documentation outage is non-fatal and leaves the previous table or no estimate at all, never a fabricated zero. `sortModels` grew explicit `price`, `release` and `monthly` orders, each keeping retired models below active rows and breaking ties on the model name. The same commit hardens `readConfig`: DSH 0.1.7 can hand a plugin a mixed snapshot during a profile reload, and assuming every leaf has `.get()` made the whole entry disappear; leaves are now read either way and merged over the schema defaults.

`feat: keep each plan's settings behind its switch` reworks the page around those listings. The page leads with the Go panel. A plan whose switch is off shows that switch and nothing else, in both panels: the settings below it cannot take effect, and the switch is what brings them back. The standing hint paragraphs are gone, except where they explain a state the controls cannot show by themselves - the model editor's picker rule now sits behind a round help icon on the editor's own title, and the row's hover detail carries the source price, the per-million conversion and the source ratio. A model row is one line - name, badges, and the price this plan charges as a badge - and the model id and the release date stay in the detail pane beside it. `formatModelPrice` and `priceDetail` moved into the listing contract so the badge arithmetic is testable without a render; nine locale keys lost their only call sites (`pricePer100m`, `releasedOn`, `showDeprecatedHint`, `goReleasedOn`, `goIntro`, `goEnabledHint`, `goEnabledOff`, `goShowDeprecatedHint`, `goQuotaHint`) and five took their place.

Measured on macOS 15.7.5 / Node.js 22.22.2.

### Local checks

- `npm run typecheck`: strict Host and Client programs against installed declarations, both pass.
- `npm test` (runs the build first): all **284 tests in 21 files** pass, up from 272 in 21 files at 0.3.0. New coverage: a loader snapshot that mixes live references and plain leaves; the weighted per-100M-token formula and its plan multiplier; the `price`, `release` and `monthly` orders keeping retired rows last; the documentation page's current estimates parsed while struck-through and promotional values are ignored, and a documentation outage merging no estimate rather than breaking the listing; the explicit refresh control being the only path that forces the Go estimates; the default order surviving while status filters give way to sorting choices; Go rows held to name and monthly estimate with metadata in the detail pane; a Zen row held to one line with the actual price on its badge and the id and release date in the detail pane; the picker explanation on the help control rather than in the body; the Go panel leading the page with both panels keeping their own labeled region; a withdrawn plan dropping its settings while keeping its switch; and the price badge's arithmetic, including sub-cent prices, a source price equal to the actual one (no ratio) and a zero source price that cannot serve as a baseline.
- `npm pack`: `dsh-opencode-zen-0.3.5.tgz` with **43 files**, shasum `ea963e82a47604fd526e30bdab574dc242d0b944`.

The browser bundle is not byte-reproducible across builds: esbuild writes the CSS-module class map in hash order, so two builds of one tree differ in that map's key order while the class names themselves are identical. Nothing else in the bundle varies.

### Isolated installed checks

A fresh temporary consumer installed the official CLI plus the tarball, **without** `--legacy-peer-deps`:

```sh
npm init -y
npm install --ignore-scripts @deepseek-ai/dsh@0.1.7-alpha.2 /absolute/path/to/dsh-opencode-zen-0.3.5.tgz
```

From this project:

```sh
npm run verify:installed -- /absolute/path/to/consumer   # PASS
```

The smoke ran against the bytes the tarball carries: the consumer's `lib/client.js` and `lib/index.js` are identical to the packed ones. It mounts through the real Cordis Loader without an import mock, asserts **both** routes register, lists each plan's catalog from its own endpoint (Zen's `deepseek-v4.1-flash` and Go's `glm-5.3`), streams on both, checks session-header stability and isolation, the Harness User-Agent, and per-plan authorization (`Bearer fixture-key` for Zen, `Bearer go-fixture-key` for Go), then disposes the adapter and verifies both routes are gone.

The headless launcher smoke was not re-run for this release. The change is confined to the settings page and the listings it reads; the Host entry that the launcher exercises - its routes, its config reads and its wire behaviour - is 0.3.0's, already covered by the 0.3.0 headless result and by the installed smoke above.

### Live endpoint checks (read-only, no credentials)

- `GET https://opencode.ai/zen/v1/models`: HTTP 200, **80 models**.
- `GET https://opencode.ai/zen/go/v1/models`: HTTP 200, **42 models**, up from 41 at 0.3.0.
- `GET https://opencode.ai/zen/go/v1/usage` with no credential: HTTP 401, which is what the usage service reports as `unknown`, not as "no subscription".
- `GET https://opencode.ai/docs/en/go/`: HTTP 200, 92 kB of server-rendered HTML carrying the model names and their monthly figures, which is what the Go estimates are read from.

### Remaining limits

- No paid model call and no manual Web UI pass this release; the settings page is covered by the distributed-factory and component tests only.
- The Go monthly estimates are read from a documentation page rather than an API, so a redesign of that page changes them. The failure is non-fatal by construction, and the value is display-only.
- Non-macOS platforms and DSH versions outside the six tested releases are not verified.

## Release 0.3.0 (2026-09-23)

This release adds the OpenCode Go subscription back, this time as the second plan of the same plugin rather than as a separate package: two LLM routes (`opencode-zen`, `opencode-go`), one settings page with a panel per plan, the Go quota in both the settings panel and the conversation composer, and one nested `go` configuration block. Every identity that existing configurations and profiles depend on is unchanged - package name, bundle insert `opencode-zen`, settings namespace `llm-opencode-zen`, locale namespace `settings.opencode-zen`, `name = 'llm-opencode-zen'`.

Measured on macOS 15.7.5 / Node.js 22.22.2; typecheck and the full test suite were re-run on Node.js 26.7.0 on 2026-09-24, immediately before tagging, and both pass.

### Local checks

- `npm run typecheck`: strict Host and Client programs against installed declarations, both pass.
- `npm test` (runs the build first): all **272 tests in 21 files** pass. New coverage: the two route descriptors and their separate pi-ai builtin tables; `readModelMetadata` reading `opencode` versus `opencode-go` and refusing the sibling's record; nested `go` schema defaults, live-reference construction and unpacking; both plans registering side by side with disjoint catalogs, per-plan credential gating, per-plan whitelist and deprecation switches, and discovery routed by provider id or by the `/zen/go/` endpoint segment; the usage probe's classification of 200/401/403/404/429/5xx/transport failure/no credential; nested staged-form reads, writes and clears through path ops; two model editors on one page with distinct landmarks, copy and DOM ids; the quota pill's polling, its stopping on provider switch, and its discarding of stale percentages; a nested Go block resolved through a real Loader composition; and the client entry reading the three self-mounted namespaces through the scope that injected them, where a read on the entry's own context fails the tracked-access guard and the page would report both gateways as unreachable.
- `npm pack`: `dsh-opencode-zen-0.3.0.tgz` with **43 files**.

### Isolated installed checks

A fresh temporary consumer installed the official CLI plus the tarball **without** `--legacy-peer-deps`:

```sh
npm init -y
npm install --ignore-scripts @deepseek-ai/dsh@0.1.7-alpha.2 /absolute/path/to/dsh-opencode-zen-0.3.0.tgz
```

Installing with `--legacy-peer-deps` instead leaves `@deepseek-ai/dsh-attachment` unhoisted, and the plugin's Host entry then fails to resolve it; the documented install above hoists it.

From this project:

```sh
npm run verify:installed -- /absolute/path/to/consumer   # PASS
npm run verify:headless  -- /absolute/path/to/consumer   # PASS
```

Both smokes were re-run on 2026-09-24 against a fresh consumer that installed the final 0.3.0 tarball (rebuilt after the client scope fix in the coverage list above): both PASS.

The installed smoke mounts through the real Cordis Loader without an import mock, asserts **both** routes register, lists each plan's catalog from its own endpoint (Zen's `deepseek-v4.1-flash` and Go's `glm-5.3`), streams on both, checks session-header stability and isolation, the Harness User-Agent, and per-plan authorization (`Bearer fixture-key` for Zen, `Bearer go-fixture-key` for Go), then disposes the adapter and verifies both routes are gone.

The headless smoke registers the plugin into a `headless` profile first. `dsh plugin add` stops at pnpm's build-policy gate (`ERR_PNPM_IGNORED_BUILDS` for `@google/genai` and `protobufjs`); setting both `allowBuilds` entries to `false` in the profile's `pnpm-workspace.yaml` and retrying then completes the install, but because the interrupted run had already written the dependency, the reconcile skips bundle registration - so `dsh-opencode-zen` had to be added to the profile's `dsh.profile.bundles` by hand. `dsh --profile headless --dump-config` then lists the `# == dsh-opencode-zen` bundle, and the run completes with `standalone-ok`.

### Live endpoint checks (read-only, no credentials)

- `GET https://opencode.ai/zen/v1/models`: HTTP 200, **80 models**.
- `GET https://opencode.ai/zen/go/v1/models`: HTTP 200, **41 models**, including `glm-5.3`, `kimi-k3`, and `deepseek-v4-flash`. The Go listing is unauthenticated, exactly like Zen's.
- `GET https://opencode.ai/zen/go/v1/usage` with no credential: HTTP 401, which is what the usage service reports as `unknown`, not as "no subscription".

The Go listing carries ids that the shipped pi-ai `opencode-go` table does not (for example `deepseek-flash`, `mimo-v2-pro`, `grok-4.5`); those resolve through models.dev when its record carries them and otherwise appear in the settings page as metadata-unavailable, which is the existing per-id isolation behaviour.

### Remaining limits

- No paid Go call was possible on the verification date, so the Go wire behaviour rests on the loopback fixtures and the installed smoke, which assert the exact request bodies and headers the adapter emits.
- What `GET /zen/go/v1/usage` answers for a key that is valid but carries no Go subscription is still unverified: the endpoint needs a credential. The plugin's probe is built so that this cannot matter - a probe result never registers, withdraws or reconfigures anything.
- Non-macOS platforms and DSH versions outside the six tested releases are not verified.

## Release 0.2.0 (2026-09-23)

This release retargets the plugin from the retired Go subscription to the pay-as-you-go endpoint `https://opencode.ai/zen/v1`, removes the subscription usage service and UsagePill UI, and applies the new identity table: package `dsh-opencode-zen`, bundle insert `opencode-zen`, route `opencode-zen`, settings namespace `llm-opencode-zen`. `OPENCODE_API_KEY` is unchanged because both gateways share one key. Zen exposes no balance or usage API (anomalyco/opencode#10448 stays open; `/zen/v1/usage` answers 404), which is why no usage feature ships.

Measured on macOS 15.7.5 / Node.js 26.7.0 / npm 11.19.0.

### Local checks

- `npm ci --legacy-peer-deps`: 445 packages, 0 vulnerabilities.
- `npm run typecheck`: strict Host and Client programs against installed declarations, both pass.
- `npm test` (runs the build first): all **218 tests in 16 files** pass. The suites cover adapter streaming against a loopback gateway (cached usage fields, session headers, Harness user agent, reasoning efforts including the `off` wire path, stop/image/tool refusals, unknown models, degraded listings), catalog three-source composition (live gateway listing + the models.dev `opencode` record + pi-ai builtin fallback) with discovery, ETag revalidation, outages and retirements, settings-backed dynamic configuration, deprecated-model visibility, per-model capacities, real Loader composition, image resizing/offload and immutable history, JSON responses, package compatibility, the distributed browser factory and CSS composition, stores and section UI, and a six-host matrix against published DSH packages: `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, `0.1.6-alpha.2`, `0.1.7-alpha.1`, `0.1.7-alpha.2`.
- `npm pack`: `dsh-opencode-zen-0.2.0.tgz` with 36 files - bundle patch, Host ESM, browser factory, type declarations, LICENSE, both READMEs, and the docs.

The published UI primitives still reference a missing source map, and their `Tooltip` is built on `useLayoutEffect`, which React's server renderer warns about in the distributed-factory suite; Vitest prints both upstream warnings, and neither affects test outcomes.

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
