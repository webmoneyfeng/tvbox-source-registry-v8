import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limits = { workerRequestsPerDay: 100000, subrequestsPerInvocation: 50, kvReadsPerDay: 100000, kvWritesPerDay: 1000, cronTriggers: 5 };
const estimate = {
  cronInvocationsPerDay: 288,
  maximumProbeSourcesPerInvocation: 5,
  maximumProbeSubrequestsPerSource: 5,
  discoverySubrequests: 1,
  kvSubrequests: 2,
  maximumSubrequestsPerInvocation: 28,
  maximumKvWritesPerDay: 288,
  configuredCronTriggers: 1,
};
const checks = {
  subrequests: estimate.maximumSubrequestsPerInvocation <= limits.subrequestsPerInvocation * 0.7,
  kvWrites: estimate.maximumKvWritesPerDay <= limits.kvWritesPerDay * 0.7,
  cronTriggers: estimate.configuredCronTriggers <= limits.cronTriggers,
  userTrafficCapacityKnown: false,
};
const report = {
  generatedAt: new Date().toISOString(),
  basis: 'Cloudflare Workers and KV Free limits verified 2026-07-19',
  limits,
  estimate,
  checks,
  verdict: Object.entries(checks).filter(([key]) => key !== 'userTrafficCapacityKnown').every(([, value]) => value) ? 'PASS_WITH_TRAFFIC_BOUNDARY' : 'FAIL',
  boundary: 'Worker request usage depends on TV client traffic. Free operation does not guarantee a 10,000-user commercial SLA.',
};
await mkdir(path.join(ROOT, 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'audit', 'free-budget-latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
if (report.verdict === 'FAIL') process.exitCode = 1;
