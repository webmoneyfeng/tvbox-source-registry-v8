export const HEALTH_SCHEMA_VERSION = 'v8-health-1';
export const FAILURES_TO_HIDE = 3;
export const SUCCESSES_TO_RECOVER = 2;
export const FAILURES_TO_QUARANTINE = 6;
export const PROBATION_SAMPLE_COUNT = 12;
export const PROBATION_SUCCESS_COUNT = 10;
export const PROBATION_MIN_MS = 6 * 60 * 60 * 1000;

export function sourceHealthKey(source) {
  return `${source.kind || 'vod'}:${source.slug}`;
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
  };
}

export function applyProbe(previous, source, probe, checkedAt) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const ok = Boolean(probe.ok);
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
  let state = previousState;
  if (probe.hardViolation || consecutiveFailures >= FAILURES_TO_QUARANTINE) state = 'QUARANTINED';
  else if (consecutiveFailures >= FAILURES_TO_HIDE) state = 'WATCH';
  else if (previousState === 'QUARANTINED') state = consecutiveSuccesses >= SUCCESSES_TO_RECOVER ? 'WATCH' : 'QUARANTINED';
  else if (previousState !== 'ACTIVE') {
    state = probationWindow.length >= PROBATION_SAMPLE_COUNT
      && probationSuccesses >= PROBATION_SUCCESS_COUNT
      && ageMs >= PROBATION_MIN_MS
      && deepOk
      ? 'ACTIVE'
      : previousState === 'WATCH' ? 'WATCH' : 'PROBATION';
  }
  return {
    slug: source.slug,
    kind: source.kind || 'vod',
    ok,
    checkedAt,
    latencyMs: Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
    classCount: Number(probe.classCount || 0),
    listCount: Number(probe.listCount || 0),
    searchCount: Number(probe.searchCount || 0),
    searchEvidence: Array.isArray(probe.searchEvidence) ? probe.searchEvidence : [],
    detailOk: Boolean(probe.detailOk),
    playOk: Boolean(probe.playOk),
    latestAt: probe.latestAt || null,
    channelCount: Number(probe.channelCount || 0),
    groupCount: Number(probe.groupCount || 0),
    playableCount: Number(probe.playableCount || 0),
    sampleCount: Number(probe.sampleCount || 0),
    duplicateRate: Number(probe.duplicateRate || 0),
    httpStatus: Number(probe.httpStatus || 0),
    error: ok ? '' : String(probe.error || 'probe failed').slice(0, 240),
    hardViolation: Boolean(probe.hardViolation),
    state,
    score: Number(probe.score?.total || 0),
    scoreBreakdown: probe.score || null,
    firstSeenAt,
    samples,
    rollingSuccessRate: Number((samples.filter((sample) => sample.ok).length / samples.length).toFixed(4)),
    deepOk,
    consecutiveSuccesses,
    consecutiveFailures,
    lastSuccessAt: ok ? checkedAt : before.lastSuccessAt || null,
    lastFailureAt: ok ? before.lastFailureAt || null : checkedAt,
  };
}

export function sourceIsVisible(source, healthRow) {
  if (!healthRow) return source.seedStatus === 'ACTIVE';
  if (healthRow.state) return healthRow.state === 'ACTIVE';
  if (healthRow.consecutiveFailures >= FAILURES_TO_HIDE) return false;
  return source.seedStatus === 'ACTIVE';
}

export function visibleSources(registry, healthState) {
  const state = normalizeHealthState(healthState);
  const initialized = Object.keys(state.sources).length > 0;
  return registry.filter((source) => {
    const row = state.sources[sourceHealthKey(source)] || state.sources[source.slug];
    return row ? sourceIsVisible(source, row) : !initialized && source.seedStatus === 'ACTIVE';
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
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt: checkedAt,
    revision: previous.revision,
    sources: nextSources,
  };
  return { ...provisional, revision: healthRevision(registry, provisional) };
}
