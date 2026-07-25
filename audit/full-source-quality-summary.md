# TVBox source full-quality audit

Generated: 2026-07-25T11:17:54.754Z

Strict pass: VOD 0/10 entries (0 providers), live 5/12 entries (2 providers).
Operational pass: VOD 6 entries (6 providers), live 12 entries (3 providers).

| Kind | Source | Result | Root cause | Categories/Groups | Search | Detail | Playback | HD | Latency |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| vod | 百度资源 | FAIL | CATEGORY_API_ERROR | 43/54 | 4/5 | 0 | 0 | 0 | 1008ms |
| vod | 红牛直连 | FAIL | EMPTY_CATEGORY | 28/31 | 5/5 | 1 | 1 | 0.2 | 806ms |
| vod | 魔都动漫 | FAIL | EMPTY_CATEGORY | 40/42 | 5/5 | 1 | 1 | 0.7 | 2612ms |
| vod | 量子直连 | FAIL | EMPTY_CATEGORY | 39/44 | 5/5 | 1 | 1 | 1 | 1306ms |
| vod | 暴风资源 | FAIL | CATEGORY_API_ERROR | 49/49 | 5/5 | 0 | 0 | 0 | 1334ms |
| vod | 极速直连 | FAIL | EMPTY_CATEGORY | 36/39 | 4/5 | 1 | 0 | 0 | 811ms |
| vod | 金鹰直连 | FAIL | EMPTY_CATEGORY | 28/31 | 5/5 | 1 | 1 | 1 | 2339ms |
| vod | 最大资源 | FAIL | EMPTY_CATEGORY | 53/59 | 5/5 | 1 | 1 | 1 | 483ms |
| vod | 爱旦资源 | FAIL | EMPTY_CATEGORY | 37/70 | 5/5 | 1 | 0.983 | 0.719 | 1525ms |
| vod | 360直连 | FAIL | EMPTY_CATEGORY | 44/51 | 5/5 | 1 | 1 | 0.5 | 895ms |
| live | 范明明 IPv6 | FAIL | MEDIA_FAIL | 3/3 | - | - | 0.571 | 0.75 | 893ms |
| live | ZBDS IPv4 | PASS | PASS | 11/11 | - | - | 0.938 | 0.6 | 2338ms |
| live | IPTV-org 日本 | PASS | PASS | 1/1 | - | - | 1 | 0.5 | 404ms |
| live | IPTV-org 印度 | PASS | PASS | 1/1 | - | - | 0.769 | 0.6 | 542ms |
| live | IPTV-org 意大利 | PASS | PASS | 1/1 | - | - | 0.769 | 0.5 | 503ms |
| live | IPTV-org 美国 | FAIL | MEDIA_FAIL | 1/1 | - | - | 0.692 | 0.556 | 609ms |
| live | IPTV-org 英国 | FAIL | MEDIA_FAIL | 1/1 | - | - | 0.615 | 0.5 | 1057ms |
| live | IPTV-org 德国 | FAIL | MEDIA_FAIL | 1/1 | - | - | 0.692 | 0.556 | 1007ms |
| live | IPTV-org 法国 | FAIL | MEDIA_FAIL | 1/1 | - | - | 0.615 | 0.75 | 464ms |
| live | IPTV-org 泰国 | PASS | PASS | 1/1 | - | - | 0.769 | 0.7 | 997ms |
| live | IPTV-org 西班牙 | FAIL | MEDIA_FAIL | 1/1 | - | - | 0.538 | 0.571 | 1014ms |
| live | IPTV-org 荷兰 | FAIL | NO_HD | 1/1 | - | - | 0.923 | 0.417 | 1017ms |

Strict pass means every advertised category/group passed. Operational pass is the bounded runtime admission tier; a source can be operational while retaining an upstream category warning. Mirrors or alternate endpoints sharing one provider do not increase provider diversity.
