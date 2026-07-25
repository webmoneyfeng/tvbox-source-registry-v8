# TVBox source directory v8.1

## Scope (v8.1.4)

This version publishes validated source links instead of building a second
catalogue. The TV client queries each upstream source directly. The service does
not proxy media, merge programme records, rewrite titles, or promise cross-source
deduplication. The registry currently contains 14 VOD endpoints and 18 live
playlists; current admission reports distinguish strict `ACTIVE`, usable `WATCH`
and hard-failed `REJECTED` entries.

Only public, standard TVBox/FongMi-compatible endpoints that are permitted for
the intended use are eligible for registration.

## Runtime flow

```text
candidate feed
  -> canonical URL and physical-host deduplication
  -> VOD/live contract probe
  -> rolling health state in KV
  -> ACTIVE/WATCH source directory
  -> TVBox config
  -> direct upstream requests from the TV client
```

VOD and live sources are kept in separate registries. A source is visible after
its hard contract passes listing or playlist, search/detail or channel parsing,
and a direct media sample. Soft warnings such as an upstream empty category,
partial channel failure or slow response place the source in `WATCH` but do not
erase the original source.

## State machine

| State | TV visibility | Meaning |
| --- | --- | --- |
| `ACTIVE` | visible | Contract and playback probes pass |
| `WATCH` | visible | Hard contract passes; a soft warning is recorded |
| `PROBATION` | hidden | New source awaiting stable samples |
| `QUARANTINED` | hidden | Repeated failure or hard violation |

One failed probe does not remove a source. Three consecutive failures hide it;
recovery requires two successful probes and the probation rules.

## Update behavior

- The Worker cron checks a bounded number of sources every five minutes.
- KV stores health state and the last known good source directory only.
- A new episode becomes visible when the upstream CMS publishes it; no catalogue
  rebuild is required.
- `checkedAt` describes the last probe. `updatedAt` changes only when the visible
  source set changes.
- Config, status and source responses use `no-store` and carry a stable registry revision.
- On a failed probe cycle the previous valid directory remains active.
- Live entries are exposed as direct upstream playlist URLs; `/live.txt` is a
  compatibility endpoint and is not the only live entry in the TVBox config.

## Free-tier boundary

The Worker does not proxy video or media segments. This keeps the registry small
and avoids turning subscriber playback into Worker traffic. The design uses one
Worker, one KV namespace, and bounded scheduled probes. It does not guarantee a
free commercial SLA for large user populations because each TV client still
calls the upstream sources directly.

## Migration rule

The v7.3 catalogue Worker, Pages snapshot project, catalogue KV namespace, and
scheduled GitHub workflows are retired only after a separately verified formal
cutover. The v7.3 repository is archived rather than deleted so the last known
implementation remains recoverable without continuing to execute.
