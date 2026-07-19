import assert from 'node:assert/strict';
import test from 'node:test';
import { channelSample, liveContract, parseM3U } from '../src/live.mjs';

const sample = `#EXTM3U x-tvg-url="https://example.test/epg.xml"\n#EXTINF:-1 tvg-name="News" group-title="News",News\nhttps://example.test/news.m3u8\n#EXTINF:-1 group-title="Sports",Sports\nhttps://example.test/sports.m3u8\n#EXTINF:-1 group-title="Ads",公众号加群\nhttps://example.test/ad.m3u8\n`;

test('M3U parser extracts groups, EPG and removes infrastructure advertisements', () => {
  const parsed = parseM3U(sample);
  assert.equal(parsed.epgUrl, 'https://example.test/epg.xml');
  assert.equal(parsed.channels.length, 2);
  assert.equal(parsed.channels[0].group, 'News');
});

test('live contract validates a small clean playlist', () => {
  const input = Array.from({ length: 5 }, (_, i) => `#EXTINF:-1 group-title="G",C${i}\nhttps://example.test/${i}.m3u8`).join('\n');
  const result = liveContract('#EXTM3U\n' + input);
  assert.equal(result.ok, true);
  assert.equal(result.channelCount, 5);
  assert.equal(channelSample(result.sample, 2).length, 2);
});
