import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTvappPayload, parseTvappReadmeSources, tvappKnownNameForUrl } from '../src/tvapp.mjs';

test('TVAPP parser extracts only source sections and preserves labels', () => {
  const markdown = `# Demo
| App | [下载](https://example.com/app.apk) |

## 接口源 🌟
https://example.com/config.json # 示例点播

## 直播源 🌟
https://example.com/live.m3u # 示例直播

## 免责声明
https://example.com/not-a-source.json
`;
  const entries = parseTvappReadmeSources(markdown);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.kind), ['vod_index', 'live']);
  assert.equal(entries[0].label, '示例点播');
  assert.equal(entries[1].label, '示例直播');
});

test('TVAPP payload parser accepts comments and trailing commas without altering URLs', () => {
  const payload = parseTvappPayload(`
    // comment
    { "urls": [{ "name": "catalog", "url": "https://example.com/config.json" },], }
  `);
  assert.equal(payload.urls[0].url, 'https://example.com/config.json');
});

test('TVAPP known source names avoid raw host fallback', () => {
  assert.equal(
    tvappKnownNameForUrl('https://raw.githubusercontent.com/iptv-org/iptv/master/streams/tw.m3u'),
    'IPTV-org 台湾',
  );
  assert.equal(
    tvappKnownNameForUrl('https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u'),
    'Kimentanm IPTV',
  );
});
