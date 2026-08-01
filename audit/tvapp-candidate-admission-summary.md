# TVAPP 候选源准入审计

生成时间：2026-08-01T05:05:00.871Z

## 摘要
- README 源区 URL：80 个；点播入口 41 个；直播入口 39 个。
- 点播抽取候选：64 个；新增 CMS 探测：40 个；PROBATION 4、WATCH 4、REJECTED 32。
- 直播清单可解析：27 个；首包抽样：14 个；PROBATION 8、WATCH 2、REJECTED 4。

## 点播可继续观察
- PROBATION | 烂大街 | https://www.huyaapi.com/api.php/provide/vod/ | class=31 list=20 search=27 detail=true play=true
- WATCH | 👖裤佬丨采集 | https://api.wsyzy.net/api.php/provide/vod | class=60 list=20 search=0 detail=true play=true
- PROBATION | 🌼光速┃资源🌼 | https://api.guangsuapi.com/api.php/provide/vod/ | class=28 list=20 search=27 detail=true play=true
- PROBATION | 🌼如意┃影视🌼 | http://cj.rycjapi.com/api.php/provide/vod | class=39 list=20 search=26 detail=true play=true
- WATCH | 🌼豆瓣┃影视🌼 | https://caiji.dbzy5.com/api.php/provide/vod | class=49 list=20 search=0 detail=true play=true
- WATCH | 🌼茅台┃影视🌼 | https://caiji.maotaizy.cc/api.php/provide/vod | class=50 list=20 search=0 detail=true play=true
- PROBATION | 🌼魔都┃影视🌼 | https://www.mdzyapi.com/api.php/provide/vod | class=42 list=20 search=27 detail=true play=true
- WATCH | 非凡 | http://cj.ffzyapi.com/api.php/provide/vod/ | class=31 list=20 search=0 detail=true play=true

## 直播可继续观察
- PROBATION | 游魂直播源 | https://www.iyouhun.com/tv/zb | channels=2922 groups=1 playable=2/2
- PROBATION | ZBDS IPv4 TXT | https://live.zbds.top/tv/iptv4.txt | channels=469 groups=1 playable=2/2
- PROBATION | 咪咕 IPTV | https://develop202.github.io/migu_video/interface.txt | channels=148 groups=13 playable=2/2
- WATCH | IPTV IPv6 | https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.m3u | channels=434 groups=37 playable=1/8
- PROBATION | Suxuang IPv4 | https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv4.m3u | channels=567 groups=35 playable=2/6
- PROBATION | Suxuang IPv6 | https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv6.m3u | channels=415 groups=16 playable=2/6
- PROBATION | ZBDS IPv4 M3U | https://live.zbds.top/tv/iptv4.m3u | channels=334 groups=10 playable=2/2
- PROBATION | Kimentanm IPTV | https://raw.githubusercontent.com/Kimentanm/aptv/master/m3u/iptv.m3u | channels=9 groups=3 playable=2/2
- WATCH | JackTV直播{翻} | https://php.946985.filegear-sg.me/jackTV.m3u | channels=91 groups=2 playable=1/8
- PROBATION | IPTV-org 全量 | https://iptv-org.github.io/iptv/index.m3u | channels=4344 groups=120 playable=2/3

## 边界
- 本审计只输出候选分级，不修改正式源注册表。
- 多仓、多线路、JS/PY/Spider/APP 内置源仅作为发现入口，不直接发布。
- 直播清单通过不等于频道全部可播，仍需多轮稳定性验证。
