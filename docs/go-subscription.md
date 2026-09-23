# The OpenCode Go plan

`dsh-opencode-zen` serves two plans of the same platform, from one mount:

| | OpenCode Zen | OpenCode Go |
|---|---|---|
| Route (provider id) | `opencode-zen` | `opencode-go` |
| Endpoint | `https://opencode.ai/zen/v1` | `https://opencode.ai/zen/go/v1` |
| Billing | Pay as you go, per token | Flat subscription (currently $10/month) |
| Models | The full curated lineup (Claude, GPT, Gemini, open models) | A curated set of open coding models |
| Quota | Bounded by the account balance | Rolling windows: per 5 hours, per week, per month |
| Usage endpoint | none | `GET /zen/go/v1/usage` |
| Configuration | the top-level document fields | the `go` sub-object |

Both plans default to the same credential reference, `OPENCODE_API_KEY`, and one
API key works for either. They also share the adapter tuning both use: the
catalog refresh interval, the stream idle timeout, and the three image budgets.

## Configuration

```yaml
- id: llm-opencode-zen
  name: 'dsh-opencode-zen'
  config:
    # OpenCode Zen: the top-level fields.
    enabled: true
    apiKeyEnv: OPENCODE_API_KEY
    baseURL: https://opencode.ai/zen/v1
    refreshMinutes: 60
    enabledModels: []            # absent = every model; empty = the route withdraws
    go:
      # OpenCode Go: its own switch, credential, endpoint and whitelist.
      enabled: true
      apiKeyEnv: OPENCODE_API_KEY
      baseURL: https://opencode.ai/zen/go/v1
```

Both switches default to on. A plan registers its route only while its own
credential resolves, so pointing `go.apiKeyEnv` at a reference nobody set
withdraws exactly the Go route and leaves Zen alone. That gate is the reason a
reader with only one of the two plans never sees the other's models in a picker:
the plan they do not have has no credential, so it has no route.

## Settings page

One page covers both plans. Each panel holds its own switch, its own API key
(the key is written write-only through the credentials domain, never through the
settings document), its own model list with per-model capacities and picker
checkboxes, and - for Go - the subscription's quota windows. The credential
references, endpoints, and the shared adapter tuning sit behind the page's
advanced disclosure. One Save applies the whole page.

## Quota display, and what it does not do

The Go plan's quota appears in two places: the settings panel and a pill in the
conversation composer. The pill mounts only while the selected model belongs to
the Go plan, so other models send no usage traffic.

Both read the same probe, and the probe is **informational only**:

- `200` with a readable body - the subscription was detected; the three windows
  are shown with their percentages and reset times.
- `401`/`403` - no subscription was detected on this credential. The page says
  so, and nothing else changes.
- Anything else (offline, 5xx, a 404, an unreadable body) - `unknown`, worded as
  temporarily unavailable.

A probe result never registers, withdraws, or reconfigures anything. That
separation is deliberate: whether a reader without the subscription is refused
or silently billed against the pay-as-you-go balance is not something this
plugin can assume, so a wrong guess must not be able to close a working path.

## Coexistence with the standalone Go plugin

Do not install `dsh-opencode-go` (the 0.1.x package) alongside this one. Both
would claim the `opencode-go` route; the second registration is refused with
`DUPLICATE_ADAPTER` in the log, and the two plugins' settings pages would
disagree about which one owns the Go plan's configuration. This package serves
both plans on its own.
