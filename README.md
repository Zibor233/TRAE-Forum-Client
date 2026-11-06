# TRAE社区第三方客户端 / TRAE Forum Client

版本 **0.1.1Beta** · MIT · 作者 [@小博同学](https://forum.trae.cn/u/%E5%B0%8F%E5%8D%9A%E5%90%8C%E5%AD%A6)

[下载安装包](https://github.com/Zibor233/TRAE-Forum-Client/releases) · [问题反馈](https://github.com/Zibor233/TRAE-Forum-Client/issues)

TRAE 中文社区的第三方客户端，支持瀑布流浏览、类别与标签筛选、评论、消息、发帖、实时预览和草稿。首页默认展示最新话题；有新帖或话题更新时提示点击刷新。客户端在后台低频检查新版本，仅提示可更新并打开 Releases 下载页。

本项目由社区用户开发，与 TRAE 官方无隶属关系。账户权限及论坛内容以官方服务为准。

鉴权走 Discourse 官方 **User API Key** 流程（`/user-api-key/new`）。由于该站点未开放 `auth_redirect` 白名单，授权结果通过「官方授权页 → 复制 payload → 回到本应用粘贴」完成，密钥只存在本机。

## 运行

桌面安装包现已接入：Windows x64、macOS Intel / Apple Silicon、Linux x64 / ARM64。
麒麟 V10 ARM64 为重点适配目标，仍需目标机器验证。
命令、自动构建及兼容性检查见 [桌面打包说明](doc/05-桌面打包.md)。

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>。`npm run dev` 会同时启动：

1. 本地代理 `http://127.0.0.1:8787`（`proxy/server.mjs`）
2. Vite 开发服务器 `http://localhost:5173`（`scripts/dev.mjs` 调起）

也可以分开启动：

```bash
npm run proxy   # 终端 1
npx vite        # 终端 2（依赖 vite.config.ts 里的 /api 转发）
```

生产构建与预览：

```bash
npm run build
npm run proxy
npx vite preview
```

> 预览/构建产物本身不带代理，需要 `npm run proxy` 在 8787 端口运行；若部署到线上，请用 Nginx 等把 `/api/*` 反代到 `https://forum.trae.cn/*`。

## 页面

- **信息流**：顶栏是官方 TRAE 图标（内联 SVG）+ 居中胶囊搜索框 + 创作中心/账号；左侧 220px 侧栏（发现 / RED / 直播 / 发布 / 通知 / 消息 + 红色登录按钮 + 更多 / 关于我们）；分类 Tab 来自 `/categories.json`。主体是 1024px 起四列、768–1024 三列、移动端两列瀑布流，卡片无投影，封面按图片真实宽高比伸缩，无图卡片走渐变色块 + 标题。
- **话题详情**：不再跳转整页，而是在信息流上打开弹层。遮罩 `rgba(0,0,0,.55)`，桌面 1180px 宽 / 85vh 高，左右分栏：左侧深色媒体区从首楼 `cooked` 提取图片做轮播（左右箭头 + `1/N`、支持键盘方向键）；右侧保留飞书式排版（16px / 行高 1.75、引用浅灰、代码等宽），顶部固定作者/标题/时间/分类，下方评论区，底部固定操作栏（评论输入、点赞、评论数、复制链接）。点遮罩或 Esc 关闭；`#/topic/{id}` 深链直接打开同一弹层。
- **搜索**：顶栏搜索框接 `/search.json`，展示相关话题与相关回复。

## 登录：User API Key 流程

### 探测结论（2026-11-04）

| 探测 | 结果 |
| --- | --- |
| `GET /user-api-key/new?...&auth_redirect=http://localhost:5173/...` | **200 text/html**，页面预加载 `"user_api_key_authorization":"{\"state\":\"generic_error\"}"` |
| 同样参数去掉 `auth_redirect`（`/user-api-key/new.json`） | **302** → SSO 登录页，说明参数校验通过 |
| `/user-api-key/new` 不带参数 | **400** |
| `/user-api-key/not-a-real-route` | **404**（路由存在性对照） |
| `HEAD /user-api-key/new` | **200**，响应头 `X-Discourse-Route: user_api_keys/new`、`Auth-Api-Version: 4`、`Auth-Api-Device-Code: true` |
| `GET /session/csrf.json` | **200** |
| `GET /users/{username}.json`（如 `TRAE-小阳`） | **200**，可读 `username/post_count` 等 |

**结论**：User API Key 流程是**开启的**（不是 403/404），但站点的 `allowed_user_api_auth_redirects` 没有包含任何本机或示例回调，所有尝试的回调（`localhost:5173`、`127.0.0.1:5173`、`:3000`、`:8080`、`https://`、`example.com`、`forum.trae.cn/user-api-key/callback`）都返回 `generic_error`。

因此采用 Discourse 官方页面的默认兜底：授权完成后页面直接展示 Base64 payload，用户复制回本应用解密。回调路由 `#/auth/callback` 的解析代码仍然保留，站点以后开放白名单即可自动登录。

### 密钥细节

- 前端用 `jsencrypt` 生成 2048 位 RSA 密钥（**PKCS#1 v1.5**，与 Discourse 默认 `pkcs1` padding 一致）；私钥只在本机内存/`sessionStorage` 的 pending 记录里，登录成功后立即丢弃。
- payload 解密后得到 `key`、`nonce`、`push`、`api: 4`；`nonce` 会与生成时比对，不一致直接拒绝。
- username 不在 payload 里：登录后用 `GET /session/current.json` + `User-Api-Key` 读取。
- 登录态保存到 `localStorage`（key、username、client_id、nonce、scopes、创建时间）。

### 首次授权操作

1. 点右上角圆形头像或左侧红色「登录」。
2. 面板会显示「密钥已就绪」，点「打开论坛授权页」（新窗口，`window.opener=null`）。
3. 在论坛官方页面登录并点击授权。
4. 官方页面会显示一段 Base64 payload，复制它。
5. 回到登录面板，粘贴到输入框并提交，解出 key 与 username 即完成登录。

### 密钥安全

- Api-Key **只在「浏览器 → 本机代理 → forum.trae.cn」之间流转**，不会发往任何第三方域名；代理日志不打印 key。
- 面板内提供撤销链接：`https://forum.trae.cn/u/{username}/preferences/apps`，也可在「退出本地登录」立即清除 localStorage。
- 密码不会经过本应用；授权页由官方域名承载。

## 代理

浏览器直接请求 `forum.trae.cn` 会被 CORS 拦截，因此所有请求都走本地代理：

| 能力 | 说明 |
| --- | --- |
| 路径 | 前端请求 `/api/xxx` → 代理转发 `https://forum.trae.cn/xxx` |
| CORS | 补 `Access-Control-Allow-Origin: *`，允许 `User-Api-Key / Api-Key / Api-Username` 请求头 |
| 缓存 | GET 200 响应内存缓存 60 秒（`x-proxy-cache: HIT/MISS`）；`/session/current.json` 不缓存 |
| 限速 | 读：每 IP 每 10 秒 40 次；写：每 IP 每分钟 20 次 |
| 读方法 | 仅 GET/HEAD/OPTIONS |
| 写方法 | 仅白名单 + 必须带 `User-Api-Key`，其余 405 / 401 |
| 鉴权读写 | 只有 `/session/current.json` 这一条读接口放行 `User-Api-Key`，其余读接口不带 key |
| 超时 | 上游 20 秒超时 |

写操作白名单：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/post_actions.json` 或 `/post_actions` | 点赞（`post_action_type_id=2`） |
| DELETE | `/post_actions/{id}?post_action_type_id=2` | 取消赞 |
| POST | `/posts.json` 或 `/posts` | 回复 / 发帖 |

API Key 鉴权的写操作免 CSRF，前端不需要 `X-CSRF-Token`。写失败时前端直接展示论坛返回的 `errors` 原文。

## 接口清单（实测）

| 接口 | 用途 | 关键字段 |
| --- | --- | --- |
| `GET /latest.json?page=N` | 最新信息流，`page=0` 起 | `topic_list.topics[]`、`more_topics_url` |
| `GET /latest.json?category={id}&page=N` | 分类筛选 | 同上 |
| `GET /top.json?page=N` | 热门信息流 | `topic_list.topics[]`，含 `views`、`like_count` |
| `GET /categories.json` | 分类列表 | `category_list.categories[]`：`id/name/color/topic_count` |
| `GET /t/{id}.json?page=N` | 话题详情 | `title/posts_count/like_count/views/tags/image_url`；`post_stream.posts[]`；每页 20 楼 |
| `GET /search.json?q=xxx` | 搜索 | `topics[]`、`posts[]`（`blurb`）、`grouped_search_result` |
| `GET /session/current.json` | 校验 key、取用户名（需 `User-Api-Key`） | `current_user.username/name/avatar_template` |
| `GET /users/{username}.json` | 用户资料（探测用） | `user.username/post_count` |
| `POST /post_actions.json` | 点赞 | 请求 `{ id, post_action_type_id: 2, flag_topic: false }` |
| `DELETE /post_actions/{id}?post_action_type_id=2` | 取消赞 | 无 body |
| `POST /posts.json` | 回复 / 发帖 | `{ raw, topic_id, reply_to_post_number? }` / `{ raw, title, category }` |

话题字段实测包含：`id/title/fancy_title/slug/posts_count/reply_count/like_count/views/created_at/bumped_at/category_id/tags[]/image_url/thumbnails/excerpt/pinned/has_accepted_answer`。

帖子字段实测包含：`post_number/username/name/created_at/cooked/avatar_template/post_type/actions_summary/reactions/reply_to_post_number/accepted_answer`。点赞数优先取 `actions_summary[id=2].count`，其次 `reactions[].count`。

`cooked` 是论坛渲染后的 HTML；前端用 DOMParser 清洗脚本、事件属性与 `javascript:` 链接后展示。

## 已知限制

1. **无法自动回调**：站点没开 `auth_redirect` 白名单，首次授权必须手动复制粘贴 payload；授权页不会自动把结果送回 localhost。
2. **未登录状态**：点赞、回复、发帖、评论框均为灰态，点击会打开登录面板，不会发出写请求。
3. **真实写操作需要你自己的论坛账号**：本原型不会也不能伪造成功；失败时按论坛 `errors` 原文提示。
4. **关注按钮禁用**：Discourse 关注需要额外的用户/群组接口，当前未实现，hover 提示前往官方页面。
5. **无视频/直播/通知/消息接口**：侧栏这些入口是占位（禁用态）；卡片不显示视频时长角标，详情遇到 `<video>` 会退回图片模式。
6. **无图片话题**：详情媒体区显示渐变 + 标题首字的占位块，不是真实媒体。
7. **长贴截断**：详情最多加载 300 楼（约 15 页），超出部分只有原文链接。
8. **点赞 action id**：取消赞依赖点赞接口返回的 `id`；若论坛未返回，会提示刷新后重试。
9. **匿名限流**：实测连续 15 次请求均 200，未见 429；代理已做缓存与本地限速兜底。
10. **数据实时性**：读缓存 60 秒，新帖最多延迟一分钟出现。

## 自测记录（2026-11-04）

- 只读接口：`latest/top/categories/t/{id}/search` 均 200；`/latest.json?page=2` 返回 30 条；话题 462911 共 86 楼、每页 20 楼。
- CORS：无 `Access-Control-Allow-Origin`；`OPTIONS` 404。
- User API Key：见上表探测证据；`/session/csrf.json`、`/users/{username}.json` 均 200。
- 代理写白名单：无 key 的 `POST /api/post_actions.json` → 401；`POST /api/t/123.json` → 405；`GET /api/latest.json?page=0` → 200。
- 页面：1280 宽下侧栏、搜索框「探索更多内容」、四列瀑布流 ≥ 8 卡、点击卡片打开分栏弹层、Esc 关闭；多图话题页码 `1/10 → 2/10`；桌面 390 宽下侧栏收起为底部 Tab、两列瀑布流。
- `npx tsc --noEmit` 与 `npm run build` 通过。

## 目录

```
index.html                 入口
vite.config.ts             /api dev proxy
proxy/server.mjs           本地代理（缓存/限速/写白名单/密钥透传）
scripts/dev.mjs            同时启动代理与 Vite
src/api.ts                 读接口 + 写接口 + 错误原文解析
src/lib/auth.ts            User API Key：密钥生成、授权 URL、payload 解密、localStorage
src/lib/format.ts          时间、数字、图片、HTML 清洗
src/pages/FeedPage.tsx     信息流（四列瀑布流 + 分类 Tab）
src/pages/SearchPage.tsx   搜索
src/components/TopicModal.tsx  详情弹层（媒体轮播 + 评论 + 操作栏）
src/components/Header.tsx      顶栏（官方 SVG logo + 搜索 + 创作中心）
src/components/Sidebar.tsx     侧栏与移动端底部 Tab
src/components/AuthModal.tsx   登录面板 / 密钥管理
src/components/Composer.tsx    回复与发帖弹窗
src/components/FeedCard.tsx    瀑布流卡片
src/components/Logo.tsx        TRAE 官方图标（内联 SVG，28×21）
```
