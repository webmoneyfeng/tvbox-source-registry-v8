export const DEFAULT_SOURCE_TARGET = 10;

function count(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function summarizeTarget(summary, target = DEFAULT_SOURCE_TARGET) {
  const required = Math.max(1, count(target));
  const active = count(summary?.active);
  const watch = count(summary?.watch);
  const corePlayable = count(summary?.corePlayable);
  return {
    target: required,
    active,
    watch,
    corePlayable,
    candidateTargetMet: corePlayable >= required,
    usableTargetMet: active + watch >= required,
    strictTargetMet: active >= required,
  };
}

export function evaluatePublicationGate({ vod, live, publishedTargetVerified = false } = {}) {
  const vodTarget = summarizeTarget(vod);
  const liveTarget = summarizeTarget(live);
  const blockers = [];
  if (!vodTarget.candidateTargetMet) blockers.push('VOD_CANDIDATE_TARGET_UNMET');
  if (!liveTarget.candidateTargetMet) blockers.push('LIVE_CANDIDATE_TARGET_UNMET');
  if (!vodTarget.usableTargetMet) blockers.push('VOD_USABLE_TARGET_UNMET');
  if (!liveTarget.usableTargetMet) blockers.push('LIVE_USABLE_TARGET_UNMET');
  if (!publishedTargetVerified) blockers.push('PUBLISHED_TARGET_NOT_VERIFIED');
  return {
    vod: vodTarget,
    live: liveTarget,
    publishedTargetVerified: Boolean(publishedTargetVerified),
    publicationReady: blockers.length === 0,
    degraded: blockers.length > 0,
    blockers,
  };
}
