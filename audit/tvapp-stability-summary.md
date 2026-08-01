# TVAPP 候选源多轮稳定性复测

生成时间：2026-08-01T05:43:04.431Z
复测轮数：3

## 摘要
- 点播复测 8 个：ACTIVE 0、WATCH 6、REJECTED 2。
- 直播复测 10 个：ACTIVE 5、WATCH 2、REJECTED 3。

## 建议可提交给用户批准的候选
- ACTIVE | live | ZBDS IPv4 TXT | https://live.zbds.top/tv/iptv4.txt | success=1 media=1 play=0 p95=2549
- ACTIVE | live | 咪咕 IPTV | https://develop202.github.io/migu_video/interface.txt | success=1 media=1 play=0 p95=2574
- ACTIVE | live | ZBDS IPv4 M3U | https://live.zbds.top/tv/iptv4.m3u | success=1 media=1 play=0 p95=1649
- ACTIVE | live | Kimentanm IPTV | https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u | success=1 media=1 play=0 p95=2859
- ACTIVE | live | IPTV-org 全量 | https://iptv-org.github.io/iptv/index.m3u | success=1 media=1 play=0 p95=3617

## 仍建议观察
- WATCH | vod | 烂大街 | https://www.huyaapi.com/api.php/provide/vod/ | reason=SLOW_SOURCE | causes=DIRECT_PLAYBACK_UNAVAILABLE,AD_OR_PARSE_ENDPOINT
- WATCH | vod | 👖裤佬丨采集 | https://api.wsyzy.net/api.php/provide/vod | reason=SLOW_SOURCE | causes=SEARCH_UNAVAILABLE,SOURCE_SEARCH_GAP
- WATCH | vod | 🌼光速┃资源🌼 | https://api.guangsuapi.com/api.php/provide/vod/ | reason=SLOW_SOURCE | causes=DIRECT_PLAYBACK_UNAVAILABLE,AD_OR_PARSE_ENDPOINT
- WATCH | vod | 🌼豆瓣┃影视🌼 | https://caiji.dbzy5.com/api.php/provide/vod | reason=SLOW_SOURCE | causes=SEARCH_UNAVAILABLE; DIRECT_PLAYBACK_UNAVAILABLE,SOURCE_SEARCH_GAP,AD_OR_PARSE_ENDPOINT
- WATCH | vod | 🌼茅台┃影视🌼 | https://caiji.maotaizy.cc/api.php/provide/vod | reason=SLOW_SOURCE | causes=SEARCH_UNAVAILABLE; DIRECT_PLAYBACK_UNAVAILABLE,SOURCE_SEARCH_GAP,AD_OR_PARSE_ENDPOINT
- WATCH | vod | 🌼魔都┃影视🌼 | https://www.mdzyapi.com/api.php/provide/vod | reason=SLOW_SOURCE | causes=-
- WATCH | live | 游魂直播源 | https://www.iyouhun.com/tv/zb | reason=PARTIAL_CHANNEL_FAILURE | causes=AD_OR_PARSE_ENDPOINT
- WATCH | live | Suxuang IPv4 | https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv4.m3u | reason=PARTIAL_CHANNEL_FAILURE | causes=AD_OR_PARSE_ENDPOINT

## 拒绝或暂不纳入
- REJECTED | vod | 🌼电影┃天堂🌼 | https://caiji.dyttzyapi.com/api.php/provide/vod | reason=SOURCE_DETAIL_GAP | causes=SEARCH_UNAVAILABLE; DIRECT_PLAYBACK_UNAVAILABLE,SOURCE_SEARCH_GAP,AD_OR_PARSE_ENDPOINT,fetch failed,SOURCE_DETAIL_GAP,SOURCE_PLAYBACK_GAP
- REJECTED | vod | 非凡 | http://cj.ffzyapi.com/api.php/provide/vod/ | reason=SOURCE_DETAIL_GAP | causes=SEARCH_UNAVAILABLE; DIRECT_PLAYBACK_UNAVAILABLE,SOURCE_SEARCH_GAP,AD_OR_PARSE_ENDPOINT,fetch failed,SOURCE_DETAIL_GAP,SOURCE_PLAYBACK_GAP
- REJECTED | live | IPTV IPv6 | https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.m3u | reason=MEDIA_SEGMENT_UNAVAILABLE | causes=MEDIA_SEGMENT_UNAVAILABLE
- REJECTED | live | Suxuang IPv6 | https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv6.m3u | reason=MEDIA_SEGMENT_UNAVAILABLE | causes=MEDIA_SEGMENT_UNAVAILABLE,AD_OR_PARSE_ENDPOINT
- REJECTED | live | JackTV直播{翻} | https://php.946985.filegear-sg.me/jackTV.m3u | reason=MEDIA_SEGMENT_UNAVAILABLE | causes=MEDIA_SEGMENT_UNAVAILABLE

## 边界
- 本复测仍不修改正式注册表。
- ACTIVE 代表本轮多次复测稳定通过，但仍需用户批准后才能进入 canary 或正式源表。
- WATCH 代表核心链路可用但存在软问题；REJECTED 不建议展示。
