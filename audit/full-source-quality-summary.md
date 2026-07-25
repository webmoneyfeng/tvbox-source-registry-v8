# TVBox source full-quality audit

Generated: 2026-07-25T13:11:10.605Z

Strict pass: VOD 0/14 entries (0 providers), live 3/18 entries (2 providers).
Admission: VOD ACTIVE/WATCH/REJECTED 0/10/4, live ACTIVE/WATCH/REJECTED 3/13/2.
Hard-gate operational pass: VOD 10 entries (10 providers), live 15 entries (5 providers). Target met: true.

| Kind | Source | Result | Root cause | Categories/Groups | Search | Detail | Playback | HD | Latency |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| vod | 豪华直连 | WATCH | EMPTY_CATEGORY:3 | 36/39 | 5/5 | 1 | 1 | 0.4 | 1924ms |
| vod | 红牛直连 | WATCH | EMPTY_CATEGORY:3 | 28/31 | 5/5 | 1 | 1 | 0.2 | 1404ms |
| vod | 魔都动漫 | WATCH | EMPTY_CATEGORY:2 | 40/42 | 5/5 | 1 | 1 | 0.8 | 3542ms |
| vod | 量子直连 | WATCH | EMPTY_CATEGORY:5 | 39/44 | 5/5 | 1 | 0.9 | 1 | 1767ms |
| vod | 非凡直连 | WATCH | EMPTY_CATEGORY:3 | 28/31 | 5/5 | 1 | 1 | 0.5 | 1019ms |
| vod | 金鹰资源 | REJECTED | SEARCH_FAIL | 28/31 | 0/5 | 1 | 1 | 1 | 905ms |
| vod | 最大资源 | WATCH | EMPTY_CATEGORY:6 | 53/59 | 5/5 | 1 | 1 | 1 | 609ms |
| vod | 速播直连 | WATCH | EMPTY_CATEGORY:1 | 30/31 | 5/5 | 1 | 1 | 0.3 | 2102ms |
| vod | 360直连 | WATCH | EMPTY_CATEGORY:7 | 44/51 | 5/5 | 1 | 1 | 0.4 | 752ms |
| vod | 新浪直连 | WATCH | EMPTY_CATEGORY:2 | 26/28 | 5/5 | 1 | 1 | 0.2 | 6543ms |
| vod | 百度资源 | REJECTED | DETAIL_FAIL | 41/54 | 4/5 | 0 | 0 | 0 | 955ms |
| vod | 暴风资源 | REJECTED | DETAIL_FAIL | 49/49 | 5/5 | 0 | 0 | 0 | 3171ms |
| vod | 极速直连 | REJECTED | MEDIA_FAIL | 36/39 | 4/5 | 1 | 0 | 0 | 863ms |
| vod | 爱旦资源 | WATCH | EMPTY_CATEGORY:35 | 35/70 | 5/5 | 1 | 0.936 | 0.705 | 1379ms |
| live | 范明明 IPv6 | WATCH | PARTIAL_MEDIA_FAILURE | 3/3 | - | - | 0.571 | 0.75 | 1004ms |
| live | IPTV-org 中国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.308 | 0.75 | 1146ms |
| live | IPTV-org 香港 | REJECTED | MEDIA_FAIL | 1/1 | - | - | 0.083 | 1 | 1118ms |
| live | IPTV-org 韩国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.692 | 0.333 | 352ms |
| live | IPTV-org 美国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.692 | 0.556 | 1520ms |
| live | IPTV-org 英国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.615 | 0.5 | 2398ms |
| live | IPTV-org 德国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.692 | 0.556 | 429ms |
| live | IPTV-org 加拿大 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.615 | 0.5 | 465ms |
| live | Suxuang IPv4 | WATCH | PARTIAL_MEDIA_FAILURE | 35/35 | - | - | 0.267 | 0.438 | 783ms |
| live | Guovin 汇总 | WATCH | PARTIAL_MEDIA_FAILURE | 40/40 | - | - | 0.333 | 0.4 | 887ms |
| live | Guovin IPv4 | WATCH | HD_EVIDENCE_LOW | 28/28 | - | - | 0.761 | 0.2 | 930ms |
| live | IPTV-org 泰国 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.692 | 0.778 | 341ms |
| live | IPTV-org 越南 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.231 | 0.333 | 1153ms |
| live | IPTV-org 意大利 | ACTIVE | PASS | 1/1 | - | - | 0.769 | 0.5 | 427ms |
| live | IPTV-org 印度 | ACTIVE | PASS | 1/1 | - | - | 0.846 | 0.636 | 1430ms |
| live | IPTV-org 巴西 | WATCH | PARTIAL_MEDIA_FAILURE | 1/1 | - | - | 0.615 | 0.75 | 1389ms |
| live | ZBDS IPv4 | ACTIVE | PASS | 11/11 | - | - | 0.95 | 0.526 | 3327ms |
| live | 范明明全量 | REJECTED | MEDIA_FAIL | 3/3 | - | - | 0.063 | 1 | 338ms |

Strict pass means no soft warnings. Hard-gate operational pass permits upstream empty categories, transient rate limits, stale metadata, slow responses or low HD evidence when the direct source, search, detail and playback contract remains usable. Mirrors or alternate endpoints sharing one provider do not increase provider diversity.
