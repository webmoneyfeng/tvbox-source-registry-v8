export const ADMISSION_TIERS = Object.freeze(['ACTIVE', 'WATCH', 'PROBATION', 'REJECTED']);

export function summarizeAttempts(attempts = []) {
  const rows = Array.isArray(attempts) ? attempts : [];
  const total = rows.length;
  const successCount = rows.filter((row) => row?.ok).length;
  const detailOkCount = rows.filter((row) => row?.detailOk).length;
  const playOkCount = rows.filter((row) => row?.playOk).length;
  const mediaOkCount = rows.filter((row) => Number(row?.playableCount || 0) >= 2 || row?.mediaOk === true).length;
  const latencies = rows.map((row) => Number(row?.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const averageLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;
  const p95LatencyMs = latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]
    : null;
  const rootCauses = [...new Set(rows.flatMap((row) => Array.isArray(row?.rootCauses) ? row.rootCauses : row?.rootCause ? [row.rootCause] : []))].filter(Boolean);
  return {
    total,
    successCount,
    successRate: total ? Number((successCount / total).toFixed(4)) : 0,
    detailOkRate: total ? Number((detailOkCount / total).toFixed(4)) : 0,
    playOkRate: total ? Number((playOkCount / total).toFixed(4)) : 0,
    mediaOkRate: total ? Number((mediaOkCount / total).toFixed(4)) : 0,
    averageLatencyMs,
    p95LatencyMs,
    rootCauses,
  };
}

export function classifyVodStability(summary) {
  if (!summary || !summary.total) return { tier: 'REJECTED', reason: 'NO_ATTEMPTS' };
  if (summary.detailOkRate < 1) return { tier: 'REJECTED', reason: 'SOURCE_DETAIL_GAP' };
  if (summary.playOkRate < 1) return { tier: 'REJECTED', reason: 'SOURCE_PLAYBACK_GAP' };
  if (Number(summary.p95LatencyMs || 0) > 12000) return { tier: 'WATCH', reason: 'SLOW_SOURCE' };
  if (summary.successRate >= 0.95 && summary.rootCauses.length === 0) return { tier: 'ACTIVE', reason: 'STABLE_FULL_PASS' };
  if (summary.successRate >= 2 / 3 && summary.playOkRate >= 2 / 3) return { tier: 'WATCH', reason: 'SOFT_OR_PARTIAL_PASS' };
  return { tier: 'REJECTED', reason: summary.rootCauses[0] || 'UNSTABLE_SOURCE' };
}

export function classifyLiveStability(summary) {
  if (!summary || !summary.total) return { tier: 'REJECTED', reason: 'NO_ATTEMPTS' };
  if (summary.mediaOkRate >= 0.95 && summary.rootCauses.length === 0) return { tier: 'ACTIVE', reason: 'STABLE_MEDIA_PASS' };
  if (summary.mediaOkRate >= 2 / 3) return { tier: 'WATCH', reason: 'PARTIAL_CHANNEL_FAILURE' };
  return { tier: 'REJECTED', reason: summary.rootCauses[0] || 'MEDIA_SEGMENT_UNAVAILABLE' };
}
