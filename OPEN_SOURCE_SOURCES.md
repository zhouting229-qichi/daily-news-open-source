# 复用的开源底座和信源入口

本项目基于 [qianqiuqiu/news-aggregator](https://github.com/qianqiuqiu/news-aggregator)，保留原 MIT LICENSE、Node/SQLite 结构及 RSS 解析。改造代码针对全文取证、中文简报、来源透明度和运行状态。

## 已接入的参考入口

| 项目 | 上游位置 | 复用内容 |
|---|---|---|
| NewsNow（MIT） | `server/sources/thepaper.ts` | 澎湃公开 JSON 地址、文章 ID 与原文 URL 对应关系 |
| DailyHotApi（MIT） | `src/routes/thepaper.ts` | 同一澎湃接口的 `pubTimeLong` 发布时间字段 |
| NewsNow（MIT） | `server/sources/wallstreetcn.ts` | 华尔街见闻公开资讯流接口、发布时间和原文链接字段 |
| AIHOT（MIT） | `industry/sources.json` | Google Research 和 Microsoft Research 官方 RSS 地址与分层思路 |
| RSSHub（当前为 AGPL-3.0） | `lib/routes/nhk/news.tsx` | NHK WORLD 中文的公开列表、详情 JSON 地址和字段说明；独立编写薄适配，没有复制其源码 |
| RSSHub（当前为 AGPL-3.0） | `lib/routes/cctv/utils/news.ts` | 央视国内/国际的公开 JSONP 列表地址，独立实现数据解析及原文抓取 |
| RSSHub（当前为 AGPL-3.0） | `lib/routes/dw/rss.ts` | DW 中文公开 RDF RSS 地址，扩展原底座的 RSS1.0 解析 |
| 联合国官方新闻站 | 官方中文 RSS | 直接接入公开 RSS 和原文，无第三方中转 |

上述适配在 `server/src/brief/adapters.js` 和 `sources.json`，可在源配置中查看接口的参考项目。未把开源项目的名称作为新闻发布机构；新闻出处始终是实际媒体或原始机构。

## 检查过但未直接依赖的部分

TrendRadar 的 `trendradar/crawler/fetcher.py` 默认调用 `https://newsnow.busiyi.world/api/s`，并非另一套独立媒体来源。本版直接参考有原文 URL 的上游接口，减少中间服务依赖。未复制 TrendRadar 的 GPL 代码。

NewsNow、DailyHotApi 的热榜多为标题、热度和链接，不能单独用于事实核验；复用的是新闻发现入口，随后必须获取原文、核对日期并提取证据。

AIHOT 公开的是示范信源，不是其线上完整名单。本版仅采用明确公开的 RSS 地址。

## 原始项目链接

- https://github.com/newsnext/newsnow/blob/main/server/sources/thepaper.ts
- https://github.com/newsnext/newsnow/blob/main/server/sources/wallstreetcn.ts
- https://github.com/imsyy/DailyHotApi/blob/master/src/routes/thepaper.ts
- https://github.com/KKKKhazix/AIHOT/blob/main/industry/sources.json
- https://github.com/sansan0/TrendRadar/blob/master/trendradar/crawler/fetcher.py

公开接口不是长期可用承诺，也不意味着允许重发全文。页面只展示短摘要与必要的证据引文；本地测试记录见 `source-check.json`。

信源是否可用应以自己运行 `npm --prefix server run check:sources` 的结果为准。列表能读取不等于正文可核验；未配置接口的来源声明不能视为已接入来源。
