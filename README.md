# TVBox Source Registry v8.1

## v8.1.3 quality admission

The production directory currently contains 10 independently-addressed VOD
CMS endpoints and 12 independently-addressed live playlists. Each production
entry passed the current runtime contract probe; the quality audit additionally checks
category branches, direct media response, HD evidence and bounded latency. Upstream playlist
contents are kept intact and are not merged or rewritten.

The TVBox config exposes each admitted live playlist as its own direct live
entry. `/live.txt` remains available for clients that only support one M3U
endpoint. Candidates that fail a current probe remain in `audit/` only and are
not exposed by the config.

This is an independent source-registry project. It does not modify or deploy the
existing `tvbox-source-hub-v73` project.

## User entry

Import the full source configuration:

```text
https://tvbox-source-registry-v8.feng-yang.workers.dev/config.json
```

The configuration contains validated direct CMS source links. The TV client
queries those sources directly, so new episodes are visible when the upstream
source publishes them. Live playlists are exposed directly after their source
probes pass; `/live.txt` remains a compatibility endpoint.
This service does not proxy video streams,
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

A VOD probe checks class metadata, leaf-category samples, multiple search terms,
detail, direct play branches and a direct playable media URL. A live probe checks
M3U structure, groups and sample HLS responses;
source-internal duplicate rate is reported but the upstream playlist is not
rewritten. The initial registry is based on the previous project's source
admission report plus new live candidates; local and online probes are required
before a source becomes active.

## Free-tier boundary

The Worker/KV design is sized for Cloudflare Free limits and does not proxy video
traffic. User traffic still consumes Worker requests, so this is not a promise of
a free 10,000-user commercial SLA. The system exposes degradation instead of
automatically upgrading the account or creating a paid resource.
