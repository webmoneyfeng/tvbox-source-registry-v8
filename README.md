# TVBox Source Registry v8.2

## v8.2 native-source admission

The registry currently contains 16 independently-addressed VOD CMS endpoints
and 23 independently-addressed live playlists. Admission reports keep separate
`ACTIVE`, `WATCH` and `REJECTED` tiers. `WATCH` entries have passed the hard
contract but carry a soft warning such as an upstream empty category, partial
channel failure or unknown freshness. They can fill the usable-source target;
the strict and usable counts are always reported separately.

The full audit checks native class metadata, category requests, search, detail,
direct media response, playlist groups, sampled playback, naming and bounded
latency. An empty category from an upstream source is recorded as evidence; it
is not rewritten or silently removed.

The TVBox config exposes each visible direct source with its real registry name.
Candidates with a hard failure remain in `audit/` only and are not exposed by
the config. A `WATCH` tier is an internal health state and is not displayed as
a user-facing label.

This is an independent source-registry project. It does not modify or deploy the
existing `tvbox-source-hub-v73` project.

## User entry

Import the full source configuration:

```text
https://tvbox-source-registry-v8-canary.feng-yang.workers.dev/config.json
```

The canary configuration contains validated direct CMS source links. The TV client
queries those sources directly, so new episodes are visible when the upstream
source publishes them. Live playlists are exposed directly after their source
contract passes; `/live.txt` remains a compatibility endpoint.
This service does not proxy video streams,
build a full catalogue snapshot, or promise that every public source is complete.

Native capability rules are deliberately conservative: `filterable` is `1`
only when the upstream response exposes usable filter options; otherwise it is
`0`. No categories whitelist, synthetic sort, title rewrite or filter adapter
is added. `searchable` is `1` only after a live search probe succeeds;
`changeable` is `1` only when a direct playback probe permits client fallback;
unprobed sources do not advertise either capability.

## Maintenance model

- Cloudflare Worker Cron rotates source probes every 5 minutes.
- A source is hidden after three consecutive full-contract failures.
- A new or recovered source needs a probation window before it becomes active.
- Physical duplicate hosts are rejected at build time.
- Public discovery extracts only standard type-1 CMS and M3U/TXT links.
- Scripts, JARs, parsers, ad pages and invalid media endpoints are excluded.
- GitHub runs deterministic CI only; it is not the runtime update path.
- KV stores health state, last-known-good source links and a bounded live channel list.
- Registry seed entries are marked as `PREAUDITED_SEED` until their first live KV
  probe; this state is visible in `/status.json` but never appears in TVBox names.

## Validation contract

A VOD probe checks class metadata, sampled native categories, multiple search
terms, detail, direct play branches and a direct playable media URL. A live probe checks
M3U structure, groups and sample HLS responses;
source-internal duplicate rate is reported but the upstream playlist is not
rewritten. The initial registry is based on the previous project's source
admission report plus new live candidates; local and online probes are required
before a source becomes active.

Useful reports:

- `audit/full-source-quality-latest.json`: hard-gate, soft-warning and target counts.
- `audit/native-capability-latest.json`: native classes, filters and request evidence.
- `audit/source-naming-latest.json`: unique names and provider/domain traceability.
- `audit/deployment-truth-latest.json`: endpoint, revision and cache-header checks.
- `audit/free-budget-latest.json`: Worker/KV free-tier estimate and traffic boundary.
- `audit/v82-stage-progress-summary.md`: canary progress and formal-release gates.
- `audit/source-admission-v82.json`: full candidate deep audit plus the explicit
  candidate/usable/strict/published target gate.

## Free-tier boundary

The Worker/KV design is sized for Cloudflare Free limits and does not proxy video
traffic. User traffic still consumes Worker requests, so this is not a promise of
a free 10,000-user commercial SLA. The system exposes degradation instead of
automatically upgrading the account or creating a paid resource.
