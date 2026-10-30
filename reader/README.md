# 每日新闻阅读端

这是完整阅读界面的源码：深色单列新闻、分类筛选、原文依据、历史详情、DeepSeek 问答及 PWA。没有预装真实新闻、模型密钥或个人站点身份。

## 本地运行

需要 Node.js 24+。在本目录执行：

```bash
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_greedy_odin.sql
npm run dev
```

数据库迁移在新本地数据库上执行一次即可。浏览器访问开发服务器实际打印的本机地址，默认是 `http://localhost:5173/`。没有导入日报时会显示空状态，不会冒用某个历史日期的真实新闻。

本机开发使用模板提供的 localhost 测试登录。若需要 AI 追问，将 `.dev.vars.example` 复制为 `.dev.vars`，在本机填写自己的密钥，重启开发服务器后，通过 `/signin-with-chatgpt?return_to=/` 进入本地测试登录。该模拟身份仅供本地开发，不能用于公网。

## 导入自己的日报

先在项目根目录按主 README 生成日报并运行 `npm run export`。保持本机阅读端开发服务器运行，然后在根目录执行以下跨平台 Node 命令：

```bash
node --input-type=module -e "import {readFile} from 'node:fs/promises'; const {edition}=JSON.parse(await readFile('public-site/api/brief.json','utf8')); const r=await fetch('http://localhost:5173/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({editions:[edition]})}); console.log(r.status,await r.text()); if(!r.ok)process.exitCode=1;"
```

以上导入命令使用默认端口 5173；如果开发服务器打印了其他端口，请相应替换。接口只接受非空 live 日报并校验字段、来源与引用关系。未生成真实日报时，不要把演示资料改成 live 导入。

## 私有生产部署

当前生产实现需要 **Sites 托管**提供私有站点访问保护、可信身份头及 D1 数据库。它不是可直接开放到公网的独立鉴权模板。

1. 在支持 Sites 的开发环境中，从本目录创建一个**新的私有站点**。
2. 使用平台返回的项目 ID 更新本副本的 `.openai/hosting.json`；不要复制他人的项目 ID。模板本身故意不包含 ID。
3. 将 `LLM_API_KEY` 作为加密生产配置填写；`LLM_MODEL` 可选，默认 `deepseek-flash`。
4. 通过 Sites 的源码与部署流程构建并发布这个新站点，确认数据库迁移已应用。
5. 将平台提供的该站点服务访问配置与站点地址配对，按主 README 填写到自己的 GitHub Actions 配置，然后验证同步和读回。

生产密钥不写入 `.openai/hosting.json`。开发时的 localhost 模拟登录不能替代生产访问保护。源码可以公开，站点可以继续保持私人访问。

## 安装与更新

使用 Edge/Chrome 打开自己部署的 HTTPS 地址并登录；浏览器允许安装时，可使用页面安装按钮或浏览器菜单安装。Windows/安卓读取同一个云端站点；电脑关机不影响 GitHub 已启用的自动更新。

PWA 日常阅读需要网络。离线时显示提示，不持久缓存私人新闻或登录响应。浏览器的安装支持因设备与版本而异。

## 验证

```bash
npm test
npm run build
```

测试不需要真实 API 密钥。AI 问答每个已登录账号每小时最多 20 次请求，费用由站点部署者自己的 DeepSeek 账户承担。
