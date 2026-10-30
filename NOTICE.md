# 开源来源与署名

采集端基于 qianqiuqiu/news-aggregator，原作者 qianqiu 的 MIT 版权声明保留在根目录 LICENSE。新增新闻处理、摘要、阅读与同步代码随本项目以 MIT 许可证提供。

阅读端的 Sites/Vinext 模板使用了 OpenAI 的 MIT 许可构建插件，版权和完整许可保留于 `reader/scripts/vite/sites-vite-plugin.LICENSE`。其 vendored shadcn Tailwind 样式保留 `reader/vendor/shadcn-tailwind-4.13.0.LICENSE.md`。

NewsNow、DailyHotApi、AIHOT、RSSHub 等项目的参考入口与使用范围见 OPEN_SOURCE_SOURCES.md。这里只独立实现公开数据入口的适配，不把这些项目名称作为新闻发布机构。

npm 第三方依赖按各自许可证使用，版本在两个 package-lock.json 中固定。新闻原文、媒体名称与链接属于各自权利人，代码的 MIT 许可证不替代原文内容的使用条件。
