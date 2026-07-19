# TVBox Source Registry v8.1

This is an independent source-registry project. It does not modify or deploy the
existing `tvbox-source-hub-v73` project.

## User entry

Import the full source configuration:

```text
https://tvbox-source-registry-v8.feng-yang.workers.dev/config.json
```

The configuration contains validated direct CMS source links. The TV client
queries those sources directly, so new episodes are visible when the upstream
source publishes them. Live channels are emitted at `/live.txt` only after
playlist and channel probes pass. This service does not proxy video streams,
build a full catalogue snapshot, or promise that every public source is complete.

## Maintenance model

- Cloudflare Worker Cron rotates source probes every 5 minutes.
- A source is hidden after three consecutive full-contract failures.
- A new or recovered source needs a probation window before it becomes active.
- Physical duplicate hosts are rejected at build time.
- Public discovery extracts only standard type-1 CMS and M3U/TXT links.
- Scripts, JARs, parsers, ad pages and invalid media endpoints are excluded.
- GitHub runs deterministic CI only; it is not the runtime update path.
- KV stores health state, last-known-good source links and a bounded live channel list.

## Validation contract

A VOD probe checks listing, multiple search terms, detail, and a direct playable
media URL. A live probe checks M3U structure, groups, duplicate rate and sample
HLS responses. The initial registry is based on the previous project's source
admission report plus new live candidates; local and online probes are required
before a source becomes active.

## Free-tier boundary

The Worker/KV design is sized for Cloudflare Free limits and does not proxy video
traffic. User traffic still consumes Worker requests, so this is not a promise of
a free 10,000-user commercial SLA. The system exposes degradation instead of
automatically upgrading the account or creating a paid resource.
