# caoool 的完整自托管部署

代码保留完整 Stremio 动态目录、搜索、配置、数据库映射和图片功能。AI 匹配是可选增强，默认关闭；不影响已有 IMDb / TMDB / Trakt 映射路径。Rex 组件由本部署直接托管，npm 发布工作流只在上游仓库运行。

## 地址

- 配置页：https://douban-stremio-plugin.caoool.workers.dev/configure
- 默认安装地址：https://douban-stremio-plugin.caoool.workers.dev/manifest.json
- 后端及管理入口：https://douban-bridge-core.caoool.workers.dev/

配置完成后应使用配置页生成的 manifest 地址。没有 API 凭据时不能把“网页可访问”等同于影片匹配和点播已经验证通过。

## 需要填写的凭据

在 Cloudflare → Workers & Pages → **douban-bridge-core** → Settings → Variables and Secrets 添加下列项目，类型选 **Secret**，保存并部署。不要填到 `douban-stremio-plugin`，后者通过服务绑定调用 core。

| Secret 名称 | 内容 |
| --- | --- |
| `TMDB_API_KEY` | 已有 TMDB **API Key（v3，32 位短字符串）**或 **API Read Access Token（长字符串）**，任选一种 |
| `TRAKT_CLIENT_ID` | 自己 Trakt 应用的 Client ID；公开元数据查询不需要 Client Secret |
| `GITHUB_CLIENT_ID` | 自己 GitHub OAuth App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | 同一个 OAuth App 的 Client Secret |

`JWT_SECRET` 由部署时生成，保存在 Worker Secret；不用再生成。后台 Basic Auth 用户名在 KV `DASH_USER`，密码在 `DASH_PASS`；缺少任意一项时后台拒绝访问。管理员密码可在 Cloudflare KV 控制台查看或替换，不写入 GitHub。

### TMDB

已有 API Key 无需重新申请。在 https://www.themoviedb.org/settings/api 复制 **API Key（v3）**或 **API Read Access Token**，填入 core Worker 的 `TMDB_API_KEY` Secret。

代码会自动识别：32 位 v3 Key 通过 `api_key` 查询参数发送，Read Access Token 通过 `Authorization: Bearer` 发送。图片配置中的有效个人凭据优先于 Worker Secret；未填写或格式无效时使用 Worker Secret。两种认证在本项目使用的 v3 接口上权限相同，见 [TMDB 官方认证说明](https://developer.themoviedb.org/docs/authentication-application)。

### Trakt

1. 登录 https://developer.trakt.tv/apps ，在 Developer 区连接 GitHub 进行验证，再创建应用。当前不要求 VIP。
2. `App name`：`Douban Stremio Personal`。
3. `Description`：`Personal, non-commercial Stremio catalog addon that matches Douban movies and TV shows to IMDb and TMDB IDs using Trakt public metadata.`
4. `App type`：**Production**，允许 HTTPS 回调；Development 仅接受 localhost。
5. `Redirect URIs`：`https://douban-bridge-core.caoool.workers.dev/`。当前插件不发起 Trakt 用户登录，该地址只是注册应用所需字段。
6. `Allowed origins` 留空；请求由 Worker 服务端发出。
7. 创建后进入 Credentials，复制 **Client ID**。如果显示 Pending approval，需等批准后测试 API，不能只凭拿到 ID 判断可用。

### GitHub 登录

在 https://github.com/settings/applications/new 创建 **OAuth App**：

- Application name：`Douban Stremio Personal`。
- Homepage URL：`https://douban-stremio-plugin.caoool.workers.dev/configure`。
- Callback URL 1：`https://douban-stremio-plugin.caoool.workers.dev/auth/github/callback`。
- Callback URL 2：`https://douban-bridge-core.caoool.workers.dev/auth/github/callback`。
- 当前代码没有刷新过期 access token 的流程：若出现 **Expire user access tokens**，取消勾选。
- 不需要 Enable Device Flow。

复制 Client ID；生成 Client Secret，分别存入 core 的 Secrets。登录为仓库拥有者 `caoool` 时直接获得完整配置权限，其他用户保留对本 fork 的 Star 校验。

## 发布顺序

需要 Node.js 24 和 pnpm。先 `pnpm install --frozen-lockfile`，然后：

```sh
pnpm --filter @douban-bridge/core test
pnpm --filter @douban-bridge/stremio test
pnpm --filter @douban-bridge/contracts test
pnpm --filter @douban-bridge/core build
pnpm --filter @douban-bridge/stremio build
```

已登录 Wrangler 的维护者按顺序执行，勿使用根目录 `pnpm deploy` 代替完整流程：

```sh
pnpm --filter @douban-bridge/core exec wrangler d1 migrations apply STREMIO_ADDON_DOUBAN --config wrangler.jsonc --remote
pnpm --filter @douban-bridge/core exec wrangler deploy --keep-vars
pnpm --filter @douban-bridge/stremio exec wrangler deploy
```

本 fork 已修正 `0000` 空库基线，后续迁移保留原顺序。不要删除迁移记录或覆盖现有数据。不要重用上游 D1 / KV / OAuth 标识。

TMDB 与 Trakt 凭据已在本部署验证，core 的 `triggers.crons` 使用 `0 * * * *` 每小时回填映射。新建其他部署时应先配置并验证凭据，再启用此计划；AI 开关关闭时不会触发 AI 任务。

## Rex 自托管

在 Core 的 `/rex` 页面登录并生成密钥，然后使用该页的安装按钮或复制组件链接：

`https://douban-bridge-core.caoool.workers.dev/widget/douban.js`

组件 ID 是 `caoool.douban.bridge`，与上游组件分开保存设置。目录、搜索与推荐仍支持云端增强和失败时的基础模式回退；密钥仅发送到本部署的 Core API，安装不依赖作者的 npm 包。上游作者署名保留。

Core 的 `build` 会先执行 Rslib，再把产物复制到 `apps/core/public/widget/douban.js`，最后由 Vite 打入 Core 静态资源。根目录构建也使用此流程，Turbo 会追踪组件源码变更。`dist/` 和生成的 `public/widget/` 不提交 Git；部署前运行 Core build 即可，无需发布 npm。

若以后更换 Core 域名，需要同时更新 `apps/core/wrangler.jsonc` 中的 `DASH_ORIGIN` 和 `apps/rex-widget/src/deployment.ts` 中的 `CORE_ORIGIN`，重新构建并部署。Rex 中已安装旧组件的设备还需更新或重新导入新的组件链接。

## AI 可选增强

默认 `AGENT_MATCH_ENABLED=false`，不需要模型或 Exa 账号。代码和 Queue / Gateway 资源保留。

以后若启用，先配置支持 Responses API、工具调用与图片的模型供应商及 AI Gateway custom provider，设置 KV `AGENT_MATCH_MODEL`、core `AGENT_MATCH_GATEWAY_PROVIDER` 和 `EXA_API_KEY`，然后将 `AGENT_MATCH_ENABLED` 改为 `true`。不能仅打开开关而不配置供应商。

`TOKENS_REPORT_ENABLED=false` 禁止向原作者的统计服务上报；网页也不加载原作者统计脚本。原有本地数据库用量记录保留。

## 验收

1. 配置页、JS/CSS/图标加载正常，保存后的安装地址指向本部署。
2. Manifest 中包含所选动态目录，catalog 能返回真实豆瓣条目。
3. 电影详情含有效 IMDb 默认视频 ID，所有 metadata 链接为完整 URL。
4. 剧集有真实季集列表，视频 ID 为 `tt…:季:集`（仅有 TMDB 映射时为 `tmdb:ID:季:集`）。
5. 用 Stremio 安装新地址，从列表点击电影与剧集，核对现有片源插件返回资源。元数据接口通过不代表实际视频已经播放成功。

## 上游

本项目 fork 自 https://github.com/baranwang/douban-bridge ，保留上游署名和 MIT 许可说明。
