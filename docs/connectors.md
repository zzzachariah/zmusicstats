# 本地音乐平台接入

## 当前实现

`server/index.mjs` 是 Node 22+ 的独立接入服务，默认仅监听 `127.0.0.1:8787`。前端开发服务应将 `/api` 代理到该地址。网关登录凭证只保存在这个进程的内存中；浏览器收到一个 HttpOnly、SameSite=Strict 的本站会话 cookie。Apple Music 由官方 MusicKit 在浏览器完成授权，再把 Music User Token 交给后端保存；本站不把用户令牌写入本地存储。

首次连接后可以读取报告，服务重启、本站会话超过 12 小时或平台登录过期后需要重新连接。这一版本是本地原型，并非已经完成多实例、账户持久化或公众部署的后端。

默认没有连接时会返回明确的不可用／未连接状态，不会用演示数据冒充真实报告。

## 启动网易云本地服务

本项目没有复制第三方网关源码。以下脚本把 MIT 许可的 `@neteasecloudmusicapienhanced/api@4.41.1` 安装到被 Git 忽略的 `work/netease-gateway` 中：

```sh
node server/setup-netease.mjs
node server/start-netease.mjs
```

网关只监听 `127.0.0.1:3101`，不要把它直接暴露到互联网。启动脚本不转发第三方请求日志，防止登录材料出现在日志中。

复制 `.env.example` 为 `.env` 后设置：

```dotenv
NETEASE_API_BASE_URL=http://127.0.0.1:3101
```

本机开发环境已经按此配置。再运行主项目的开发命令，或单独运行接入层：

```sh
node server/index.mjs
```

`server/index.mjs` 自动读取 `.env`。前端应与 API 使用同源代理；手机通过电脑局域网地址访问前端时，需要把那个完整来源加入 `APP_ORIGINS`，例如 `http://192.168.1.20:5173`。API 与音乐网关本身仍可留在 loopback。

## 浏览器接口

所有返回都带 `Cache-Control: private, no-store`。错误格式统一为 `{ error: { code, message } }`，前端用 `code` 选择中英文提示。

| 方法与地址 | 请求／响应 |
| --- | --- |
| `GET /api/health` | 服务健康状态，不表示平台已经连接 |
| `GET /api/connections` | `{ providers: [{ id, name, configured, connected, methods, reasonCode, account }] }` |
| `POST /api/auth/netease/qr` | 返回 `{ id, provider, qrImage, expiresAt }`；`qrImage` 是图片 data URL |
| `GET /api/auth/netease/qr/:id` | 返回 `state: waiting / scanned / connected / expired`；前端每 2–3 秒轮询即可 |
| `POST /api/auth/qq/qr` | 仅在部署者配置兼容的 QQ 网关时可用；格式同上 |
| `GET /api/auth/qq/qr/:id` | 同上 |
| `GET /api/auth/apple/config` | 验证开发者配置后返回 `{ developerToken, appName }`，用于官方 MusicKit 初始化 |
| `POST /api/auth/apple/token` | `{ musicUserToken }`；后端实际验证 Apple 用户授权后保存，不回传用户令牌 |
| `DELETE /api/connections/:provider` | 删除本站保存的这个平台连接、待确认二维码和报告缓存 |
| `GET /api/report?month=2026-10` | `{ mode: 'live', input: ReportInput, issues, fetchedAt }`，`input` 可直接交给 `src/lib/report.ts` |

二维码 ID 绑定浏览器会话；其他浏览器不能取得或确认它。登录、断开等写请求必须带匹配的 `Origin`。请求中不支持传入任意上游 URL。音乐凭证不写入 URL、前端存储或响应。

### 可选的 QQ 官方个人密钥接入

设置 `ENABLE_QQ_PERSONAL_KEY=true` 后，可在可信的本地界面向 `POST /api/auth/qq/key` 发送 `{ apiKey }`。密钥按本站浏览器会话隔离，绝不使用一把全局密钥为全部访客读取同一账号。该方式不是扫码授权；默认关闭，首版 UI 可以不展示。

QQ 官方月报没有已核实的整月总秒数字段，所以此路径的月时长返回 `null`，不参加时长占比。其月度明细歌曲的 `sum` 含义也未充分说明，当前只保留歌曲排行顺序，不假设为播放次数。近六个月的流派统计不会被当成选定月份的流派。

## Apple Music 官方接入

首版包含 Apple Music provider，使用官方 MusicKit，而不是 QQ／网易云的扫码网关。

部署者在自己的 Apple Developer 配置中创建 MusicKit 所需的开发者令牌，然后只将已经签名的开发者 JWT 设置到 `APPLE_MUSIC_DEVELOPER_TOKEN`。本项目不会自动注册、购买 Apple Developer 会员，也不会读取其他项目的密钥。开发者签名私钥 `.p8` 不应该进入前端、本项目的公开文件或 Git。

未配置、令牌格式不正确或已过期时，Apple Music 能力返回 `configured: false` 和 `APPLE_NOT_CONFIGURED`。配置接口还会用官方 `/v1/test` 验证开发者令牌，Apple 拒绝时返回 `APPLE_CONFIG_INVALID`，不继续假装授权成功。

前端的官方接入方式：

```js
// 先注册 musickitloaded 事件，再加载 Apple 官方 SDK：
// https://js-cdn.music.apple.com/musickit/v3/musickit.js
await MusicKit.configure({ developerToken, app: { name: appName, build: '0.1.0' } });
// 在用户点击连接时调用，以允许浏览器打开授权窗口。
const music = MusicKit.getInstance();
const authorized = await music.authorize();
const musicUserToken = music.musicUserToken || authorized;
// token 为空时视为未授权；不写入本站 localStorage，不打印到日志。
```

配置中发送给浏览器的是 Apple 要求的已签名 developer token，不是私钥。用户授权后，后端通过 `/v1/me/storefront` 实际验证 Music User Token，再将其放入本站会话内存。所有 Apple REST 请求使用 `Authorization: Bearer <developer token>` 和 `Music-User-Token` 请求头；不将用户令牌放入 URL。

Apple 当前读取 `/v1/me/recent/played/tracks?types=songs,library-songs&limit=30`：歌曲名、歌手、专辑和 `genreNames` 可取，但没有所选月份的播放次数和实际收听时长。因此报告返回 `rankingPeriod: null`、`count: null`、`listenSeconds: null`，并给出 `APPLE_RECENT_NOT_PERIOD`，前端应标为“最近播放”，不能当作月度 Top 排行或计入月度时长饼图。歌曲元数据的 `durationInMillis` 只是曲长，不用于计算用户听歌小时数。

Heavy Rotation 可能返回专辑等资源，不能把专辑曲目展开后冒充个人常听歌曲榜。Apple 另有最新符合条件年份的 Replay API；它不是任意月报接口，当前版本没有把它混入月份统计。

断开时前端可调用 `music.unauthorize()` 撤销 MusicKit 授权，同时调用本站 `DELETE /api/connections/apple` 清除后端会话。

官方来源：

- [MusicKit Web v3 初始化](https://js-cdn.music.apple.com/musickit/v3/docs/iframe.html?id=get-started--page)
- [用户授权](https://js-cdn.music.apple.com/musickit/v3/docs/iframe.html?id=user-authorization--page)
- [Music User Token](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit)
- [Apple 最近播放歌曲字段](https://developer.apple.com/documentation/applemusicapi/get-v1-me-recent-played-tracks)
- [Heavy Rotation](https://developer.apple.com/documentation/applemusicapi/get-heavy-rotation-content)
- [Replay 年份范围](https://developer.apple.com/documentation/applemusicapi/get-the-user%27s-replay-data)

## 报告字段与实际验证范围

- 网易云月榜使用 `/listen/data/song/play/rank` 的 `data.songItems[]`，保留真实 `playCount`。返回未知字段时返回明确错误；不退回累计榜冒充月份榜。
- 网易云周期报告已接入 `/listen/data/report`，但时长字段、单位尚未经过真实账号核对。默认 `listenSeconds: null`，返回 `DURATION_MAPPING_REQUIRED`。管理员只有在核对真实返回与 App 报告一致后，才能配置 `NETEASE_DURATION_PATH` 和 `NETEASE_DURATION_UNIT`（`seconds` / `milliseconds` / `minutes`）。不要凭字段名称猜测单位。
- 当前网易云歌曲曲风字段尚未核实，保留空标签并返回 `GENRE_NOT_AVAILABLE`。不会让模型猜测。
- 可选 QQ 网关路径使用文档明确的 `/user/listening-report` `listenSeconds` 和 `/user/listening-rank` `listenCount`。歌曲曲风按需读取 Top 10，其余保留未识别。
- 不给真实曲目自动建立跨平台 `canonicalId`，不凭相同歌名合并不同版本。两家播放计数口径未统一，真实 `countDefinition` 仍为 `null`，不会制造跨平台总榜。
- 只有已结束的完整月份、确认的实际总时长才标记 `coverageComplete`。当前月份不显示完整月份占比。
- 报告在单个会话中缓存 5 分钟，连接更改会使缓存失效。读取中的旧账号结果不会在断开或切换后被写回。

## 已验证与待验证

自动测试覆盖会话隔离、来源校验、断开连接清除、请求竞态、凭证不泄露、超时错误、缺失值与时长单位处理。测试使用受控上游，不代表已验证真实账号。

运行：

```sh
node --test server/api.test.mjs
```

2026-11-24 已实际启动本机网易云网关，验证真实二维码创建成功（PNG）并取得 `waiting` 等待扫码状态；该验证没有登录任何用户账号。

真实账号扫码确认、历史月报字段、会员限制及只有一台手机时的登录仍需实际验证。QQ 网关没有预装，没有向未经授权的第三方服务发送用户凭证。

## 参考与使用范围

- [网易云网关 MIT 许可](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/LICENSE)
- [网易云接口文档](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/public/docs/home.md)
- [网易云月榜返回结构与贡献者验证](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/pull/200)
- [QQ 官方调用规范与个人使用范围](https://github.com/tencentmusic/qqmusic-skills/blob/main/qqmusic/SKILL.md)
- [QQ 官方报告字段](https://github.com/tencentmusic/qqmusic-skills/blob/main/qqmusic/me.md)
- [QQ 兼容网关接口文档](https://github.com/yakult-green-tea/qq-music-api/blob/main/docs/README.md)

QQ 兼容网关参考项目当前声明不可商用，本项目只实现配置后的 HTTP 接口兼容，不复制或捆绑其源码。代码许可和音乐平台授权范围是不同问题，面向公众发布前需分别确认。
