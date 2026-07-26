import { channelSample, liveContract, parseM3U } from './live.mjs';
import {
  classId,
  className,
  directMediaUrls,
  fetchDocument,
  fetchJson,
  nativeFilterInfo,
  playBranchContract,
  rowsOf,
} from './worker.mjs';

export const DEEP_SEARCH_TERMS = [
  '\u5929\u9053',
  '\u9065\u8fdc\u7684\u6551\u4e3b',
  '\u738b\u5fd7\u6587',
  '\u4eae\u5251',
  '\u7526\u73af\u4f20',
  new Date().getUTCFullYear().toString(),
];

function text(value) {
  return String(value ?? '').trim();
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row?.vod_id ?? row?.vod_id_str ?? row?.id ?? row?.vod_name ?? '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pageCountOf(data, rowCount) {
  const raw = data?.pagecount ?? data?.pageCount ?? data?.pages ?? data?.data?.pagecount ?? data?.data?.pageCount;
  const count = Number(raw);
  if (Number.isFinite(count) && count > 0) return Math.min(1000, Math.floor(count));
  const total = Number(data?.total ?? data?.data?.total);
  const limit = Number(data?.limit ?? data?.data?.limit) || rowCount;
  if (Number.isFinite(total) && total > 0 && limit > 0) return Math.min(1000, Math.ceil(total / limit));
  return 1;
}

function detailId(row) {
  return row?.vod_id ?? row?.vod_id_str ?? row?.id ?? '';
}

function isDirectMedia(url) {
  return /^https?:\/\//iu.test(url)
    && /(?:m3u8|mp4|\.ts)(?:[?#]|$)/iu.test(url)
    && !/(?:player\.html|iframe|parse|jiexi|gplay|ad[sx]?\b)/iu.test(url);
}

function mediaLooksPlayable(result) {
  if (!result || result.status < 200 || result.status >= 400) return false;
  const preview = String(result.text || '').slice(0, 512);
  if (/(?:<html\b|<iframe\b|player\.html|解析|广告|发布页|公众号|加群)/iu.test(preview)) return false;
  return /#EXTM3U/iu.test(preview)
    || /(?:mpegurl|video\/|audio\/|application\/octet-stream)/iu.test(result.contentType || '');
}

function rootCauses(hardFailures, softWarnings) {
  return [...new Set([...hardFailures, ...softWarnings])];
}

function uniqueList(values) {
  return [...new Set((values || []).filter(Boolean))];
}

async function mapWithConcurrency(items, limit, callback) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

async function probeMedia(url) {
  const result = await fetchDocument(url, 256 * 1024);
  let segment = null;
  if (result.ok && /#EXTM3U/iu.test(String(result.text || ''))) {
    const segmentPath = String(result.text)
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'));
    if (segmentPath) {
      try {
        const segmentUrl = new URL(segmentPath, result.finalUrl || url).toString();
        const segmentResult = await fetchDocument(segmentUrl, 128 * 1024);
        segment = {
          url: segmentUrl,
          status: segmentResult.status,
          ok: segmentResult.status >= 200 && segmentResult.status < 400,
          latencyMs: segmentResult.latencyMs,
        };
      } catch {
        segment = { url: segmentPath, status: 0, ok: false, latencyMs: null };
      }
    }
  }
  return {
    url,
    status: result.status,
    ok: mediaLooksPlayable(result),
    latencyMs: result.latencyMs,
    contentType: result.contentType || '',
    encoding: result.encoding || null,
    hardViolation: Boolean(result.hardViolation),
    segment,
  };
}

export { mediaLooksPlayable };

async function probeDetailRows(rows, limit = 8) {
  const samples = uniqueRows(rows).filter((row) => detailId(row)).slice(0, limit);
  const checks = await mapWithConcurrency(samples, 3, async (row) => {
    const id = detailId(row);
    const detail = await fetchJson({ api: row.__sourceApi }, { ac: 'detail', ids: id });
    const detailRow = rowsOf(detail.data)[0] || detail.data?.data?.[0] || null;
    const urls = detailRow ? directMediaUrls(detailRow) : [];
    const media = await mapWithConcurrency(urls.slice(0, 3), 2, probeMedia);
    const branches = playBranchContract(detailRow);
    return {
      id: String(id),
      title: text(detailRow?.vod_name || row?.vod_name),
      status: detail.status,
      ok: Boolean(detail.ok && detailRow),
      branchCount: branches.branchCount,
      directBranchCount: branches.directBranchCount,
      invalidBranchCount: branches.invalidBranchCount,
      media,
      playable: media.some((item) => item.ok),
      encoding: detail.encoding || null,
    };
  });
  return checks;
}

export async function auditVodSource(source, options = {}) {
  const started = Date.now();
  const categoryStart = Math.max(0, Number(options.categoryStart || 0));
  const requestedCategoryLimit = Number(options.categoryLimit || 0);
  const requireCompleteCategories = Boolean(options.requireCompleteCategories);
  const hardFailures = [];
  const softWarnings = [];
  try {
    const classListing = await fetchJson(source, { ac: 'list' });
    const listing = await fetchJson(source, { ac: 'videolist', pg: 1 });
    const classes = classListing.data ? classListing.data.class || classListing.data.classes || classListing.data.data?.class || [] : [];
    const classRows = Array.isArray(classes) ? classes : [];
    const native = nativeFilterInfo(classListing.data || listing.data || {});
    const categories = classRows.slice(
      categoryStart,
      requestedCategoryLimit > 0 ? categoryStart + requestedCategoryLimit : classRows.length,
    );
    const categoryCoverage = {
      total: classRows.length,
      start: categoryStart,
      requested: requestedCategoryLimit > 0 ? requestedCategoryLimit : classRows.length,
      audited: categories.length,
      complete: categoryStart === 0 && categories.length === classRows.length,
      nextStart: categoryStart + categories.length < classRows.length
        ? categoryStart + categories.length
        : null,
    };
    if (requireCompleteCategories && !categoryCoverage.complete) {
      softWarnings.push('CATEGORY_AUDIT_PARTIAL');
    }
    const categoryChecks = [];
    const collectedRows = [...rowsOf(listing.data).map((row) => ({ ...row, __sourceApi: source.api }))];

    for (const category of categories) {
      const id = classId(category);
      const first = await fetchJson(source, { ac: 'videolist', t: id, pg: 1 });
      const firstRows = rowsOf(first.data);
      collectedRows.push(...firstRows.map((row) => ({ ...row, __sourceApi: source.api })));
      const pages = pageCountOf(first.data, firstRows.length);
      const pageNumbers = [...new Set([1, pages > 1 ? 2 : 1, pages].filter((page) => page >= 1))];
      const pageChecks = [{ page: 1, status: first.status, count: firstRows.length, ok: Boolean(first.ok && firstRows.length) }];
      for (const page of pageNumbers.slice(1)) {
        const result = await fetchJson(source, { ac: 'videolist', t: id, pg: page });
        const rows = rowsOf(result.data);
        collectedRows.push(...rows.map((row) => ({ ...row, __sourceApi: source.api })));
        pageChecks.push({ page, status: result.status, count: rows.length, ok: Boolean(result.ok && rows.length) });
      }
      categoryChecks.push({
        id,
        name: className(category),
        status: first.status,
        ok: Boolean(first.ok && firstRows.length),
        count: firstRows.length,
        pageCount: pages,
        pages: pageChecks,
        latestAt: firstRows.map((row) => row?.vod_time || row?.vod_time_add || row?.vod_pubdate || '').filter(Boolean).sort().at(-1) || null,
      });
    }

    if (!classListing.ok || !classRows.length) hardFailures.push('CATEGORY_SCHEMA_ERROR');
    if (!listing.ok || !rowsOf(listing.data).length) hardFailures.push('API_UNAVAILABLE');
    const emptyCategoryCount = categoryChecks.filter((item) => !item.ok).length;
    if (emptyCategoryCount) softWarnings.push(`SOURCE_EMPTY_CATEGORY:${emptyCategoryCount}`);

    const searchChecks = [];
    for (const term of DEEP_SEARCH_TERMS) {
      const result = await fetchJson(source, { wd: term, pg: 1 });
      const rows = rowsOf(result.data);
      collectedRows.push(...rows.map((row) => ({ ...row, __sourceApi: source.api })));
      searchChecks.push({
        term,
        status: result.status,
        ok: Boolean(result.ok && rows.length),
        count: rows.length,
        exactTitleHits: rows.filter((row) => text(row?.vod_name).toLowerCase().includes(term.toLowerCase())).length,
      });
    }
    const searchCapability = searchChecks.some((item) => item.ok);
    if (!searchCapability) hardFailures.push('SEARCH_UNAVAILABLE');
    else if (searchChecks.some((item) => !item.ok)) softWarnings.push('SOURCE_SEARCH_GAP');

    const detailChecks = await probeDetailRows(collectedRows, Number(options.detailSample || 8));
    const detailOkCount = detailChecks.filter((item) => item.ok).length;
    const playableCount = detailChecks.filter((item) => item.playable).length;
    if (!detailOkCount) hardFailures.push('SOURCE_DETAIL_GAP');
    if (!playableCount) hardFailures.push('SOURCE_PLAYBACK_GAP');
    if (detailChecks.some((item) => item.invalidBranchCount > 0)) hardFailures.push('INVALID_PLAY_BRANCH');

    const mediaChecks = detailChecks.flatMap((item) => item.media);
    const hardViolation = mediaChecks.some((item) => item.hardViolation);
    if (hardViolation) hardFailures.push('AD_OR_PARSE_ENDPOINT');
    const mediaPlayableCount = mediaChecks.filter((item) => item.ok).length;
    const mediaPlayableRate = mediaChecks.length ? mediaPlayableCount / mediaChecks.length : 0;
    const playableRate = detailChecks.length ? playableCount / detailChecks.length : 0;
    if (Date.now() - started > 15000) softWarnings.push('SLOW_SOURCE');

    const finalHardFailures = uniqueList(hardFailures);
    const finalSoftWarnings = uniqueList(softWarnings);
    const ok = finalHardFailures.length === 0;
    return {
      kind: 'vod',
      slug: source.slug,
      name: source.displayName || source.provider,
      api: source.api,
      ok,
      admissionTier: finalHardFailures.length ? 'REJECTED' : finalSoftWarnings.length ? 'WATCH' : 'ACTIVE',
      hardFailures: finalHardFailures,
      softWarnings: finalSoftWarnings,
      rootCauses: rootCauses(finalHardFailures, finalSoftWarnings),
      classCount: classRows.length,
      categoryCount: categories.length,
      categoryOkCount: categoryChecks.filter((item) => item.ok).length,
      emptyCategoryCount,
      categoryCoverage,
      categoryChecks,
      listCount: rowsOf(listing.data).length,
      searchChecks,
      searchCapability,
      detailChecks,
      detailOkRate: detailChecks.length ? detailOkCount / detailChecks.length : 0,
      playableRate,
      mediaPlayableRate,
      mediaSampleCount: mediaChecks.length,
      mediaPlayableCount,
      native: {
        filterable: native.nativeFilterable,
        sortable: native.nativeSortable,
        filterKeys: native.nativeFilterKeys,
        sortKeys: native.nativeSortKeys,
        filters: native.filters,
      },
      latestAt: categoryChecks.map((item) => item.latestAt).filter(Boolean).sort().at(-1) || null,
      encoding: classListing.encoding || listing.encoding || null,
      latencyMs: Date.now() - started,
      evidence: {
        classListing: { status: classListing.status, encoding: classListing.encoding || null },
        listing: { status: listing.status, encoding: listing.encoding || null },
        categoryCoverage,
        categories: categoryChecks,
        search: searchChecks,
        detail: detailChecks.map((item) => ({ id: item.id, status: item.status, ok: item.ok, playable: item.playable })),
        media: mediaChecks.map((item) => ({
          url: item.url,
          status: item.status,
          ok: item.ok,
          latencyMs: item.latencyMs,
          segment: item.segment,
        })),
      },
    };
  } catch (error) {
    return {
      kind: 'vod',
      slug: source.slug,
      name: source.displayName || source.provider,
      api: source.api,
      ok: false,
      admissionTier: 'REJECTED',
      hardFailures: ['PROBE_EXCEPTION'],
      softWarnings: [],
      rootCauses: ['PROBE_EXCEPTION'],
      error: String(error?.message || error).slice(0, 240),
      latencyMs: Date.now() - started,
    };
  }
}

export async function auditLiveSource(source, options = {}) {
  const started = Date.now();
  const hardFailures = [];
  const softWarnings = [];
  try {
    const document = await fetchDocument(source.api, 4 * 1024 * 1024);
    const parsed = parseM3U(document.text);
    const contract = liveContract(document.text);
    if (!document.ok || !contract.ok) hardFailures.push('PLAYLIST_SCHEMA_ERROR');
    if (!parsed.channels.length) hardFailures.push('PLAYLIST_UNAVAILABLE');
    const byGroup = new Map();
    for (const channel of parsed.channels) {
      const group = channel.group || '\u5176\u4ed6';
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(channel);
    }
    const sampleLimit = Number(options.channelSample || 24);
    const samples = [...byGroup.values()].flatMap((rows) => rows.slice(0, 4)).slice(0, sampleLimit);
    const checks = await mapWithConcurrency(samples, 3, async (channel) => {
      const media = await probeMedia(channel.url);
      return { channel: channel.name, group: channel.group, url: channel.url, ...media };
    });
    const playable = checks.filter((item) => item.ok).length;
    const playableRate = checks.length ? playable / checks.length : 0;
    if (playable < Math.min(2, checks.length || 2)) hardFailures.push('PLAYLIST_UNAVAILABLE');
    else if (playableRate < 0.75) softWarnings.push('PARTIAL_CHANNEL_FAILURE');
    if (contract.duplicateRate > 0.35) softWarnings.push('DUPLICATE_RATE_HIGH');
    if (Date.now() - started > 15000) softWarnings.push('SLOW_SOURCE');
    if (checks.some((item) => item.hardViolation)) hardFailures.push('AD_OR_PARSE_ENDPOINT');
    const finalHardFailures = uniqueList(hardFailures);
    const finalSoftWarnings = uniqueList(softWarnings);
    const ok = finalHardFailures.length === 0;
    return {
      kind: 'live',
      slug: source.slug,
      name: source.displayName || source.provider,
      api: source.api,
      ok,
      admissionTier: finalHardFailures.length ? 'REJECTED' : finalSoftWarnings.length ? 'WATCH' : 'ACTIVE',
      hardFailures: finalHardFailures,
      softWarnings: finalSoftWarnings,
      rootCauses: rootCauses(finalHardFailures, finalSoftWarnings),
      channelCount: contract.channelCount,
      groupCount: contract.groupCount,
      duplicateRate: contract.duplicateRate,
      sampleCount: samples.length,
      playableCount: playable,
      playableRate,
      channelChecks: checks,
      encoding: document.encoding || null,
      latencyMs: Date.now() - started,
      evidence: {
        playlist: {
          status: document.status,
          contentType: document.contentType || '',
          encoding: document.encoding || null,
          bytes: document.bytes?.byteLength || null,
        },
        channels: checks,
      },
    };
  } catch (error) {
    return {
      kind: 'live',
      slug: source.slug,
      name: source.displayName || source.provider,
      api: source.api,
      ok: false,
      admissionTier: 'REJECTED',
      hardFailures: ['PROBE_EXCEPTION'],
      softWarnings: [],
      rootCauses: ['PROBE_EXCEPTION'],
      error: String(error?.message || error).slice(0, 240),
      latencyMs: Date.now() - started,
    };
  }
}
