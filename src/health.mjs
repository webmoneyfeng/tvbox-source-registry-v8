export const HEALTH_SCHEMA_VERSION = 'v8-health-4';
export const FAILURES_TO_HIDE = 3;
export const DEEP_AUDIT_FAILURES_TO_HIDE = 6;
export const SUCCESSES_TO_RECOVER = 2;
export const FAILURES_TO_QUARANTINE = 6;
export const PROBATION_SAMPLE_COUNT = 12;
export const PROBATION_SUCCESS_COUNT = 10;
export const PROBATION_MIN_MS = 6 * 60 * 60 * 1000;

const ADMISSION_TIERS = new Set(['ACTIVE', 'WATCH', 'REJECTED']);

function list(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function getAdmissionTier(probe, before = {}) {
  const requested = String(probe?.admissionTier || '').trim().toUpperCase();
  if (ADMISSION_TIERS.has(requested)) return requested;
  if (probe?.ok === true) return 'ACTIVE';
  if (!probe?.hardFailure && !probe?.hardViolation) return 'WATCH';
  return 'REJECTED';
}

export function sourceHealthKey(source) {
  return `${source.kind || 'vod'}:${source.slug}`;
}

export function effectiveAdmissionTier(source, healthRow) {
  if (
    healthRow?.admissionTier === 'REJECTED'
    && healthRow?.deepAuditOk === true
    && Number(healthRow?.consecutiveFailures || 0) < DEEP_AUDIT_FAILURES_TO_HIDE
  ) {
    const baseline = String(healthRow.deepAuditTier || source?.seedStatus || '').toUpperCase();
    if (baseline === 'ACTIVE' || baseline === 'WATCH') return baseline;
  }
  if (healthRow?.admissionTier === 'ACTIVE' || healthRow?.admissionTier === 'WATCH' || healthRow?.admissionTier === 'REJECTED') {
    return healthRow.admissionTier;
  }
  return source?.seedStatus === 'ACTIVE' ? 'ACTIVE' : 'WATCH';
}

export function verificationState(source, healthRow) {
  if (healthRow) return 'PROBED';
  if (source?.seedStatus === 'ACTIVE') return 'PREAUDITED_SEED';
  return 'UNVERIFIED';
}

export function emptyHealthState(generatedAt = null) {
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt,
    checkedAt: generatedAt,
    revision: 'seed',
    liveRevision: 'none',
    sources: {},
    cursor: 0,
    persistedAt: null,
    lastKnownGoodVOD: [],
    lastKnownGoodLIVE: [],
    discoveredSources: [],
    liveCatalog: [],
    liveCatalogBySource: {},
    lastDiscoveryAt: null,
    discoveryCursor: 0,
    lastDiscoveryFeed: null,
    lastDiscoveryError: null,
    lastDeepAuditAt: null,
  };
}

export function normalizeHealthState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyHealthState();
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt: value.generatedAt || null,
    checkedAt: value.checkedAt || value.generatedAt || null,
    revision: String(value.revision || 'seed'),
    liveRevision: String(value.liveRevision || 'none'),
    sources: value.sources && typeof value.sources === 'object' && !Array.isArray(value.sources)
      ? value.sources
      : {},
    cursor: Number.isInteger(value.cursor) ? value.cursor : 0,
    persistedAt: value.persistedAt || null,
    lastKnownGoodVOD: Array.isArray(value.lastKnownGoodVOD) ? value.lastKnownGoodVOD : [],
    lastKnownGoodLIVE: Array.isArray(value.lastKnownGoodLIVE) ? value.lastKnownGoodLIVE : [],
    discoveredSources: Array.isArray(value.discoveredSources) ? value.discoveredSources : [],
    liveCatalog: Array.isArray(value.liveCatalog) ? value.liveCatalog : [],
    liveCatalogBySource: value.liveCatalogBySource && typeof value.liveCatalogBySource === 'object' && !Array.isArray(value.liveCatalogBySource)
      ? value.liveCatalogBySource
      : {},
    lastDiscoveryAt: value.lastDiscoveryAt || null,
    discoveryCursor: Number.isInteger(value.discoveryCursor) ? value.discoveryCursor : 0,
    lastDiscoveryFeed: value.lastDiscoveryFeed || null,
    lastDiscoveryError: value.lastDiscoveryError || null,
    discoveryCount: Number(value.discoveryCount || 0),
    lastDeepAuditAt: value.lastDeepAuditAt || null,
  };
}

export function applyProbe(previous, source, probe, checkedAt) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const ok = Boolean(probe.ok);
  const hardFailures = list(probe.hardFailures);
  const softWarnings = list(probe.softWarnings);
  const hardFailure = Boolean(probe.hardFailure || probe.hardViolation || hardFailures.length);
  const tier = getAdmissionTier(probe, before);
  const consecutiveSuccesses = ok ? Number(before.consecutiveSuccesses || 0) + 1 : 0;
  const consecutiveFailures = ok ? 0 : Number(before.consecutiveFailures || 0) + 1;
  const firstSeenAt = before.firstSeenAt || checkedAt;
  const samples = [...(Array.isArray(before.samples) ? before.samples : []), { at: checkedAt, ok, score: Number(probe.score?.total || 0) }].slice(-504);
  const probationWindow = samples.slice(-PROBATION_SAMPLE_COUNT);
  const probationSuccesses = probationWindow.filter((sample) => sample.ok).length;
  const ageMs = Date.parse(checkedAt) - Date.parse(firstSeenAt);
  const previousState = before.state || (source.seedStatus === 'ACTIVE' ? 'ACTIVE' : 'PROBATION');
  const deepOk = source.kind === 'live'
    ? Number(probe.playableCount || 0) >= 2
    : Boolean(probe.detailOk && probe.playOk);
  const deepAuditOk = Object.prototype.hasOwnProperty.call(before, 'deepAuditOk')
    ? Boolean(before.deepAuditOk)
    : before.lastDeepAuditAt
      ? (before.deepOk !== undefined ? Boolean(before.deepOk) : deepOk)
      : null;
  const verifiedQuarantineRecovery = previousState === 'QUARANTINED'
    && ok
    && !hardFailure
    && deepOk
    && (source.seedStatus === 'ACTIVE' || before.lastDeepAuditAt);
  let state = previousState;
  if (hardFailure || consecutiveFailures >= FAILURES_TO_QUARANTINE) state = 'QUARANTINED';
  else if (consecutiveFailures >= FAILURES_TO_HIDE) state = 'WATCH';
  else if (previousState === 'QUARANTINED') {
    state = verifiedQuarantineRecovery || consecutiveSuccesses >= SUCCESSES_TO_RECOVER ? 'WATCH' : 'QUARANTINED';
  }
  else if (ok && source.seedStatus === 'WATCH' && previousState !== 'ACTIVE' && previousState !== 'WATCH') {
    state = probationWindow.length >= PROBATION_SAMPLE_COUNT
      && probationSuccesses >= PROBATION_SUCCESS_COUNT
      && ageMs >= PROBATION_MIN_MS
      && deepOk
      ? tier
      : previousState === 'WATCH' ? 'WATCH' : 'PROBATION';
  } else if (ok) state = tier;
  return {
    slug: source.slug,
    kind: source.kind || 'vod',
    ok,
    admissionTier: tier,
    hardFailure,
    hardFailures,
    softWarnings,
    lastVerifiedAt: checkedAt,
    checkedAt,
    latencyMs: Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
    classCount: Number(probe.classCount || 0),
    categoryCount: Number(probe.categoryCount || 0),
    categoryOkCount: Number(probe.categoryOkCount || 0),
    categoryChecks: Array.isArray(probe.categoryChecks) ? probe.categoryChecks : [],
    emptyCategoryCount: Number(probe.emptyCategoryCount || 0),
    listCount: Number(probe.listCount || 0),
    searchCount: Number(probe.searchCount || 0),
    searchEvidence: Array.isArray(probe.searchEvidence) ? probe.searchEvidence : [],
    searchCapability: probe.searchCapability !== undefined ? Boolean(probe.searchCapability) : before.searchCapability,
    detailCapability: probe.detailCapability !== undefined
      ? Boolean(probe.detailCapability)
      : probe.detailOk !== undefined ? Boolean(probe.detailOk) : before.detailCapability,
    nativeFilterable: Boolean(probe.nativeFilterable),
    nativeSortable: Boolean(probe.nativeSortable),
    nativeFilterKeys: list(probe.nativeFilterKeys),
    nativeSortKeys: list(probe.nativeSortKeys),
    directPlaybackEligible: probe.directPlaybackEligible !== undefined
      ? Boolean(probe.directPlaybackEligible)
      : probe.playOk !== undefined ? Boolean(probe.playOk) : before.directPlaybackEligible,
    detailOk: probe.detailOk !== undefined ? Boolean(probe.detailOk) : before.detailOk,
    playOk: probe.playOk !== undefined ? Boolean(probe.playOk) : before.playOk,
    playBranchCount: Number(probe.playBranchCount || 0),
    directBranchCount: Number(probe.directBranchCount || 0),
    invalidBranchCount: Number(probe.invalidBranchCount || 0),
    latestAt: probe.latestAt || null,
    channelCount: Number(probe.channelCount || 0),
    groupCount: Number(probe.groupCount || 0),
    playableCount: Number(probe.playableCount || 0),
    sampleCount: Number(probe.sampleCount || 0),
    playableRate: Number(probe.playableRate || 0),
    encoding: probe.encoding || null,
    rootCauses: list(probe.rootCauses || [...hardFailures, ...softWarnings]),
    evidence: probe.evidence && typeof probe.evidence === 'object' ? probe.evidence : {},
    lastDeepAuditAt: probe.lastDeepAuditAt || null,
    duplicateRate: Number(probe.duplicateRate || 0),
    httpStatus: Number(probe.httpStatus || 0),
    error: ok ? '' : String(probe.error || hardFailures.join('; ') || 'probe failed').slice(0, 240),
    hardViolation: Boolean(probe.hardViolation || hardFailure),
    state,
    score: Number(probe.score?.total || 0),
    scoreBreakdown: probe.score || null,
    firstSeenAt,
    samples,
    rollingSuccessRate: Number((samples.filter((sample) => sample.ok).length / samples.length).toFixed(4)),
    deepOk,
    deepAuditOk,
    deepAuditTier: before.deepAuditTier || (deepAuditOk ? before.admissionTier : null),
    consecutiveSuccesses,
    consecutiveFailures,
    lastSuccessAt: ok ? checkedAt : before.lastSuccessAt || null,
    lastFailureAt: ok ? before.lastFailureAt || null : checkedAt,
  };
}

export function sourceIsVisible(source, healthRow) {
  if (!healthRow) return source.seedStatus === 'ACTIVE';
  const consecutiveFailures = Number(healthRow.consecutiveFailures || 0);
  const knownGood = Boolean(
    healthRow.lastSuccessAt
    || healthRow.ok === true
    || healthRow.deepOk === true
    || healthRow.lastDeepAuditAt,
  );
  const currentFailure = healthRow.ok === false
    || healthRow.admissionTier === 'REJECTED'
    || healthRow.hardFailure === true
    || (healthRow.hardFailures || []).length > 0;
  const deepBaselineGood = healthRow.deepAuditOk === true
    || (!Object.prototype.hasOwnProperty.call(healthRow, 'deepAuditOk')
      && Boolean(healthRow.lastDeepAuditAt)
      && healthRow.admissionTier !== 'REJECTED');
  const failureThreshold = deepBaselineGood ? DEEP_AUDIT_FAILURES_TO_HIDE : FAILURES_TO_HIDE;
  const transientFailure = currentFailure
    && knownGood
    && consecutiveFailures < failureThreshold
    && (deepBaselineGood || !healthRow.lastDeepAuditAt);
  if (healthRow.admissionTier === 'REJECTED' && !transientFailure) return false;
  if ((healthRow.hardFailure || (healthRow.hardFailures || []).length) && !transientFailure) return false;
  if ((healthRow.state === 'QUARANTINED' || healthRow.state === 'PROBATION') && !transientFailure) return false;
  if (consecutiveFailures >= failureThreshold) return false;
  if ((source.kind || 'vod') === 'vod' && !transientFailure && (healthRow.detailOk === false || healthRow.playOk === false || healthRow.directPlaybackEligible === false)) return false;
  if (source.kind === 'live' && !transientFailure && Object.prototype.hasOwnProperty.call(healthRow, 'playableCount') && Number(healthRow.playableCount || 0) < 2) return false;
  if (transientFailure) return true;
  if (healthRow.state === 'ACTIVE') return Number(healthRow.consecutiveFailures || 0) < FAILURES_TO_HIDE;
  if (healthRow.state === 'WATCH') return Boolean(healthRow.lastSuccessAt || healthRow.ok === true);
  if (healthRow.admissionTier === 'ACTIVE' || healthRow.admissionTier === 'WATCH') return Boolean(healthRow.lastSuccessAt || healthRow.ok === true);
  return source.seedStatus === 'ACTIVE' && healthRow.ok === true;
}

export function visibleSources(registry, healthState) {
  const state = normalizeHealthState(healthState);
  return registry.filter((source) => {
    const row = state.sources[sourceHealthKey(source)] || state.sources[source.slug];
    return sourceIsVisible(source, row);
  });
}

export function healthRevision(registry, healthState) {
  return visibleSources(registry, healthState).map((source) => sourceHealthKey(source)).join('|') || 'none';
}

export function updateHealthState(registry, previousState, probeRows, checkedAt) {
  const previous = normalizeHealthState(previousState);
  const nextSources = { ...previous.sources };
  for (const source of registry) {
    const probe = probeRows.find((row) => row.slug === source.slug && (row.kind || 'vod') === (source.kind || 'vod'));
    if (!probe) continue;
    const key = sourceHealthKey(source);
    nextSources[key] = applyProbe(previous.sources[key] || previous.sources[source.slug], source, probe, checkedAt);
  }
  const provisional = {
    ...previous,
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt: checkedAt,
    revision: previous.revision,
    sources: nextSources,
  };
  return { ...provisional, revision: healthRevision(registry, provisional) };
}
