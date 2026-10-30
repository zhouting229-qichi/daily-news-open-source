# 每日新闻

从可信媒体和机构公开入口发现新闻，抓取原文、核对日期与引文，再生成按重要性排序的中文日报。国内、国际统一排序，不设分类配额或固定条数。

包含两个模块：

- **根目录：采集与生成端。** Node.js、SQLite、RSS/公开接口、原文核验、中文摘要、本地基础阅读页、静态导出及 GitHub Actions。
- **`reader/`：完整阅读网站。** 深色列表、财经/科技/国际筛选、原文引用、历史详情、DeepSeek 追问和 Windows/安卓 PWA。生产托管目前针对 **Sites 私有站点**，其身份验证由平台提供。

基于 [qianqiuqiu/news-aggregator](https://github.com/qianqiuqiu/news-aggregator) 改造。开源来源和许可证见 [NOTICE.md](NOTICE.md)、[LICENSE](LICENSE) 和 [OPEN_SOURCE_SOURCES.md](OPEN_SOURCE_SOURCES.md)。

## 密钥与隐私

源码不包含 API 密钥、真实日报档案、数据库、原部署的网站地址、项目 ID 或账号信息。每位部署者使用自己的 DeepSeek API 配置和余额；Fork 不会获得原部署的 GitHub Secrets。

**公开这份源码，不要求把你自己的新闻网站公开。** `.env` 和 `.dev.vars` 仅保存在本机；云端密钥分别填写在自己的 GitHub Secrets 和 Sites 加密环境变量中。不要在 Issues、截图或聊天中发送密钥。详见 [SECURITY.md](SECURITY.md)。

## 本地启动采集端

需要 Node.js **24 或以上**、npm、Git。所有命令均从项目根目录执行。

```bash
npm --prefix server ci
npm start
```

浏览器打开 `http://127.0.0.1:8787/`。首次运行没有真实日报；历史演示资料会明确标记，不能当成今天的新闻。

需要生成真实日报时，将 `server/.env.example` 复制为 `server/.env`，在本机填写自己的 `LLM_API_KEY`。示例给出了 DeepSeek 官方地址和默认模型名，可按自己的服务调整。

```bash
npm --prefix server run check:sources
npm --prefix server run generate
```

生成会调用付费模型。默认 `AUTO_GENERATE=false`，不会因为仅启动本地预览就自动生成；需要本机自动更新时再改为 `true`。运行数据写入被 Git 忽略的 `server/data/`。

## 云端每日生成

工作流默认关闭。准备好自己的仓库后，在 Settings → Secrets and variables → Actions 配置：

| 类型 | 名称 | 用途 |
|---|---|---|
| Secret | `LLM_API_KEY` | 你自己的模型密钥，必填 |
| Secret | `LLM_BASE_URL` | 可选，默认 `https://api.deepseek.com` |
| Secret | `LLM_MODEL` | 可选，默认 `deepseek-flash` |
| Variable | `DAILY_NEWS_ENABLED` | 填 `true` 后才启用生成任务 |

启用 Actions 后，手动运行 **Daily News Cloud** 验证一次。此后每小时采集，按北京时间 08:00 起的每日周期最多成功生成一期；平台调度可能延迟，失败保留上一版和真实日期。模型生成每天最多尝试三次，生成前会持久化占用次数。

云端状态会提交到**你自己的运行仓库**的 `.news-state/state.json`，生成的静态页面也会作为 Actions Artifact 保存。因此，若日报和采集状态需要保密，请在自己的私有仓库运行，而不是公开 Fork 中运行。

## 完整阅读网站与手机安装

完整界面、AI 问答和安装功能在 `reader/`。本地预览、导入自己的日报和私有生产部署见 [reader/README.md](reader/README.md)。本项目没有附带 APK/EXE；Edge/Chrome 可把符合安装条件的网站安装为 PWA。

部署自己的私有 Sites 站点后，可以让采集端直接同步：

| 类型 | 名称 | 用途 |
|---|---|---|
| Variable | `DAILY_NEWS_SITE_URL` | **你自己的** HTTPS 站点根地址，不含路径、查询参数或密码 |
| Secret | `DAILY_NEWS_SITE_TOKEN` | 与该站点配套的服务访问凭证 |

不填写站点地址时，只采集和生成，完全跳过同步。配置后，任务将同步最新日报并读回核对，不会访问原作者或其他用户的站点。站点 AI 问答还需要在 Sites 加密配置中单独填写自己的 `LLM_API_KEY`，它不会自动从 GitHub 读取。

## 基础静态导出

```bash
npm run export
```

输出位于 `public-site/`。这是采集端的基础阅读页，**不包含服务端 AI 问答**，不要与 `reader/` 的完整网站混淆。设置 `PUBLIC_BASE_PATH` 可适配子路径。GitHub Pages 发布默认关闭，需要部署者主动设置 `PAGES_ENABLED=true` 并配置 Pages。

## 测试

```bash
npm test
cd reader
npm run install:ci
npm test
npm run build
```

测试使用合成数据和受控响应，不需要真实模型密钥，也不会访问任何私人部署。真实信息源可用性需要单独运行 `check:sources` 检查。

## 信息边界

只接受能获取正文、有有效日期且通过证据核验的消息；来源说法保留主体，AI 分析与报道事实分开。自动核验仍可能出错，请结合出处判断。

公开采集入口不等于任意转载全文的授权。项目展示摘要、必要短引文和来源链接；Reuters、AP 等没有配置入口的声明不能算作已接入来源。
