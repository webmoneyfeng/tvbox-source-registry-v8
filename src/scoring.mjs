function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function latencyPoints(latencyMs, maximum) {
  if (!Number.isFinite(latencyMs)) return 0;
  if (latencyMs <= 1500) return maximum;
  if (latencyMs <= 3000) return maximum * 0.8;
  if (latencyMs <= 5000) return maximum * 0.5;
  return maximum * 0.2;
}

function freshnessPoints(value, maximum, nowMs = Date.now()) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return maximum * 0.25;
  const ageHours = Math.max(0, nowMs - time) / 3600000;
  if (ageHours <= 24) return maximum;
  if (ageHours <= 72) return maximum * 0.75;
  if (ageHours <= 168) return maximum * 0.4;
  return maximum * 0.1;
}

export function scoreVodProbe(probe, nowMs = Date.now()) {
  const searchEvidence = Array.isArray(probe.searchEvidence) ? probe.searchEvidence : [];
  const searchHits = searchEvidence.filter((item) => item.ok).length;
  const availability = probe.listCount > 0 || probe.classCount > 0 ? 25 : 0;
  const contract = (searchHits > 0 ? 8 : 0) + (probe.detailOk ? 6 : 0) + (probe.playOk ? 6 : 0);
  const freshness = freshnessPoints(probe.latestAt, 20, nowMs);
  const coverage = searchEvidence.length ? (searchHits / searchEvidence.length) * 15 : 0;
  const playback = probe.playOk ? 15 : 0;
  const latency = latencyPoints(probe.latencyMs, 5);
  const total = clamp(availability + contract + freshness + coverage + playback + latency);
  return { total: Number(total.toFixed(2)), availability, contract, freshness: Number(freshness.toFixed(2)), coverage: Number(coverage.toFixed(2)), playback, latency: Number(latency.toFixed(2)) };
}

export function scoreLiveProbe(probe) {
  const playlist = probe.channelCount >= 5 ? 20 : 0;
  const parse = probe.groupCount > 0 ? 15 : 0;
  const ratio = probe.sampleCount ? probe.playableCount / probe.sampleCount : 0;
  const playback = ratio * 35;
  const freshness = probe.httpStatus >= 200 && probe.httpStatus < 400 ? 10 : 0;
  const quality = (probe.duplicateRate <= 0.05 ? 5 : 0) + (probe.groupCount >= 2 ? 5 : 0);
  const latency = latencyPoints(probe.latencyMs, 10);
  const total = clamp(playlist + parse + playback + freshness + quality + latency);
  return { total: Number(total.toFixed(2)), playlist, parse, playback: Number(playback.toFixed(2)), freshness, quality, latency: Number(latency.toFixed(2)) };
}
