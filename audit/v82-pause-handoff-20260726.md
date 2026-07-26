# v8.2 native audit pause handoff - 2026-07-26

## Pause reason
User asked to stop expanding candidates for now and persist current work for future continuation.

## Current branch and base
- branch: v8.2-native-audit
- base before this pause commit: 5166a40c0c0a
- production registry version observed: v8.2.3

## What was completed in this continuation
1. Runtime coherence was rechecked across:
   - https://tv.webhome.eu.org
   - https://tv.webclound.eu.org
   - https://tvbox-source-registry-v8.feng-yang.workers.dev
2. The successful retry evidence shows:
   - config/status/sources reachable
   - same revision
   - same version
   - no-store/no-cache
   - clean unique names
   - 14 VOD entries and 20 live entries visible
3. Fixed stale hard-coded v8.2.0 report versions in v8.2 audit scripts by importing REGISTRY_VERSION.
4. Added candidate audit offset and label support:
   - CANDIDATE_OFFSET
   - CANDIDATE_OFFSET_VOD
   - CANDIDATE_OFFSET_LIVE
   - CANDIDATE_AUDIT_LABEL
5. Added regression test ensuring v8.2 audit scripts inherit the canonical registry version.
6. Completed remaining live candidate offset=20 audit from the current candidate-discovery-v82.json.

## Candidate audit result
Current candidate discovery file had 20 eligible VOD and 22 eligible LIVE after registry physical-source dedupe.

Combined coverage:
- VOD audited: 20, ACTIVE 0, WATCH 0, REJECTED 20
- LIVE audited: 22, ACTIVE 0, WATCH 0, REJECTED 22
- New publishable candidate sources: 0

The last two live candidates rejected:
- https://szyyds.cn/tv/live/yy.txt
- https://z.szyyds.cn/iptv
Reasons: PLAYLIST_SCHEMA_ERROR, PLAYLIST_UNAVAILABLE, DUPLICATE_RATE_HIGH.

## Evidence files to keep
- audit/encoding-coherence-formal-continuation-20260726-2-v82.json
- audit/deployment-truth-formal-continuation-20260726-2-v82.json
- audit/cache-coherence-formal-continuation-20260726-2-v82.json
- audit/candidate-pool-v82-live-offset20-20260726.json
- audit/candidate-coverage-continuation-20260726.json
- audit/candidate-coverage-continuation-20260726.md

## Validation
`npm run check` passed with 57 tests, 0 failures after the changes.

## Do not do now
- Do not expand candidate feeds further in this pause.
- Do not publish any candidate source from this candidate pool.
- Do not deploy canary or production just for this pause.
- Do not delete v8.1.4 rollback evidence or historical audit files.

## Suggested future resume
1. Re-read production config/status/sources first.
2. Refresh public candidate discovery only when the user resumes expansion.
3. Audit candidates in labeled batches using the new offset support.
4. Promote only after PROBATION and repeated deep checks.
5. Canary before any production change.
