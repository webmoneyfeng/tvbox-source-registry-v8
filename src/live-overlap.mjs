import { createHash } from 'node:crypto';
import { normalizeChannelName, normalizeLiveUrl } from './live.mjs';

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function sharedCount(left, right) {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
}

export function profileLiveChannels(channels = []) {
  const rows = Array.isArray(channels) ? channels : [];
  const nameKeys = sortedUnique(rows.map((channel) => normalizeChannelName(channel?.name)));
  const urlKeys = sortedUnique(rows.map((channel) => normalizeLiveUrl(channel?.url)));
  const pairs = sortedUnique(rows.map((channel) => {
    const name = normalizeChannelName(channel?.name);
    const url = normalizeLiveUrl(channel?.url);
    return name && url ? `${name}|${url}` : '';
  }));
  const fingerprint = createHash('sha256').update(JSON.stringify({ nameKeys, urlKeys, pairs })).digest('hex');
  return { channelCount: rows.length, nameKeys, urlKeys, pairs, fingerprint };
}

export function summarizeLiveProfile(profile) {
  return {
    channelCount: Number(profile?.channelCount || 0),
    uniqueNames: Array.isArray(profile?.nameKeys) ? profile.nameKeys.length : 0,
    uniqueUrls: Array.isArray(profile?.urlKeys) ? profile.urlKeys.length : 0,
    fingerprint: String(profile?.fingerprint || ''),
  };
}

export function compareLiveProfiles(left, right) {
  const leftNames = Array.isArray(left?.nameKeys) ? left.nameKeys : [];
  const rightNames = Array.isArray(right?.nameKeys) ? right.nameKeys : [];
  const leftUrls = Array.isArray(left?.urlKeys) ? left.urlKeys : [];
  const rightUrls = Array.isArray(right?.urlKeys) ? right.urlKeys : [];
  const sharedNames = sharedCount(leftNames, rightNames);
  const sharedUrls = sharedCount(leftUrls, rightUrls);
  return {
    sameFingerprint: Boolean(left?.fingerprint && left.fingerprint === right?.fingerprint),
    sharedNames,
    sharedUrls,
    nameJaccard: ratio(sharedNames, leftNames.length + rightNames.length - sharedNames),
    urlJaccard: ratio(sharedUrls, leftUrls.length + rightUrls.length - sharedUrls),
    leftNameCoverage: ratio(sharedNames, leftNames.length),
    rightNameCoverage: ratio(sharedNames, rightNames.length),
    leftUrlCoverage: ratio(sharedUrls, leftUrls.length),
    rightUrlCoverage: ratio(sharedUrls, rightUrls.length),
  };
}
