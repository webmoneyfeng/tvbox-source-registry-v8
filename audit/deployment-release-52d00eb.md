# v8.2.3 deployment release evidence - 52d00eb

## Result
Deployment completed and validated.

## Code baseline
- Deployed code commit: 52d00eb477db
- Branch: $(git branch --show-current)
- Package version: $((System.Collections.Specialized.OrderedDictionary.packageVersion))
- Registry version: 8.2.3

## Production endpoints
- Main config: https://tv.webhome.eu.org/config.json
- Secondary config: https://tv.webclound.eu.org/config.json
- Worker.dev config: https://tvbox-source-registry-v8.feng-yang.workers.dev/config.json
- Live compatibility: https://tv.webhome.eu.org/live.txt
- Status: https://tv.webhome.eu.org/status.json
- Sources: https://tv.webhome.eu.org/sources.json

## Cloudflare deployment
- Canary Worker: 	vbox-source-registry-v8-canary
- Canary Version ID: e6d535f6-440b-4613-9c3c-a4d98da53ed6
- Production Worker: 	vbox-source-registry-v8
- Production Version ID: 17b36072-9f35-42fb-aebb-cde55e12ae76

## Validation evidence
- Local check: 57 tests passed, 0 failed.
- Canary audit: PASS.
- Production runtime coherence: PASS.
- Production status summary: PASS.
- Free budget: PASS_WITH_TRAFFIC_BOUNDARY.
- Visible VOD: 14.
- Visible live: 20.
- Degraded: false.

## Evidence files
- udit/canary-deploy-52d00eb.log
- udit/canary-audit-52d00eb.log
- udit/formal-deploy-52d00eb.log
- udit/runtime-coherence-formal-52d00eb.log
- udit/formal-status-summary-52d00eb.log
- udit/free-budget-52d00eb.log
- udit/encoding-coherence-formal-52d00eb-v82.json
- udit/deployment-truth-formal-52d00eb-v82.json
- udit/cache-coherence-formal-52d00eb-v82.json

## Boundaries
- No candidate expansion was performed for this deployment.
- No rejected or probation candidate source was published.
- No video stream proxying was introduced.
- Historical rollback evidence was not deleted.
