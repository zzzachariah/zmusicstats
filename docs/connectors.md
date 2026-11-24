# 本地音乐平台接入

## 当前实现

`server/index.mjs` 是 Node 22+ 的独立接入服务，默认仅监听 `127.0.0.1:8787`。前端开发服务应将 `/api` 代理到该地址。音乐平台凭证保存在服务端，浏览器只收到一个 HttpOnly、SameSite=Strict 的本站会话 cookie。Apple Music 由官方 MusicKit 在浏览器完成授权，再把 Music User Token 交给后端保存；本站不把用户令牌写入浏览器本地存储。

首次连接后可以读取报告。同一浏览器的连接会在服务重启后恢复；本站会话超过 12 小时或平台登录过期后需要重新连接。这一版本是本地原型，尚未实现多实例或公众部署。

本机默认将有效连接用 AES-256-GCM 加密到 `.auth-state/sessions.enc`，随机密钥位于同目录 `session.key`；目录权限为 `0700`，文件权限为 `0600`。连接文件只保存连接凭证、安全昵称／头像及过期时间，待确认二维码与请求记录不落盘。用户请求导入的历史报告另存为同目录 `history.enc`，使用独立认证上下文和随机 nonce；每取得一个有内容且日期匹配的月份即加密保存，断开或会话过期会清除对应历史。`SESSION_STORE_PATH=off` 可改用纯内存。密钥与密文都不得由静态服务公开，也不要提交 Git；本地加密不能替代电脑账户权限保护。损坏或缺少密钥时保留原文件并停止加载，不静默覆盖。

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

账号、授权与报告返回均带 `Cache-Control: private, no-store`。公开专辑封面代理只返回通过类型与大小校验的图片，可单独缓存。错误格式统一为 `{ error: { code, message } }`，前端用 `code` 选择中英文提示。

| 方法与地址 | 请求／响应 |
| --- | --- |
| `GET /api/health` | 服务健康状态，不表示平台已经连接 |
| `GET /api/connections` | `{ providers: [{ id, name, configured, connected, methods, reasonCode, account }] }` |
| `POST /api/auth/netease/qr` | 返回 `{ id, provider, qrImage, expiresAt }`；`qrImage` 是图片 data URL |
| `GET /api/auth/netease/qr/:id` | 返回 `state: waiting / scanned / connected / expired`；前端每 2–3 秒轮询即可 |
| `POST /api/auth/qq/qr` | QQ 网关二维码；`qqmusic` 通道还返回同码绑定的 `mobileAuth`（见下） |
| `GET /api/auth/qq/qr/:id` | 同上 |
| `GET /api/auth/apple/config` | 验证开发者配置后返回 `{ developerToken, appName }`，用于官方 MusicKit 初始化 |
| `POST /api/auth/apple/token` | `{ musicUserToken }`；后端实际验证 Apple 用户授权后保存，不回传用户令牌 |
| `DELETE /api/connections/:provider` | 删除本站保存的这个平台连接、待确认二维码和报告缓存 |
| `GET /api/report?month=2026-10` | `{ mode: 'live', input: ReportInput, issues, fetchedAt }`，`input` 可直接交给 `src/lib/report.ts` |
| `GET /api/history/netease` | `{ job }`，包含状态、完成数量、失败月份和已保存月份 |
| `POST /api/history/netease` | 开始或继续读取全部候选月份；可发送 `{ refreshDuration: true }` 仅补全已保存月榜缺失的时长 |
| `DELETE /api/history/netease` | 停止继续读取，保留此前已取得的报告；断开平台连接才删除报告 |
| `GET /api/history/netease/reports` | `{ inputs, months, issues }`，导入期间即可读取已完成部分 |
| `GET /api/history/qq/months` | 已连接账号的真实 `availableDates`，只含已结束月份；目录不可读时明确报错 |
| `POST /api/metadata` | `{ tracks: [{ provider, id, title, artist, album? }] }`，每批最多 20 首，返回真实封面和可核对的曲风标签 |

二维码 ID 绑定浏览器会话；其他浏览器不能取得或确认它。登录、断开等写请求必须带匹配的 `Origin`。请求中不支持传入任意上游 URL。音乐凭证不写入 URL、前端存储或响应。

### QQ 音乐同手机授权入口

`qqmusic` 通道使用当前二维码 PNG 内的官方短链。后端通过纯 JS PNG/QR 解码读取短链，仅允许 `https://c6.y.qq.com/base/fcgi-bin/u`，最多跟随 3 次受限重定向、总计 5 秒，终点只接受 `https://y.qq.com/m/client/qr_code_login/authorize.html` 及唯一的 `qrcode_id` 参数。不会把网关 `unikey` 当作二维码 ID，也不会因为用户点击打开 App 再生成一枚码。

二维码响应可包含：

```ts
mobileAuth: {
  status: "available" | "unavailable";
  kind: "app-authorization";
  url?: string; // QQ 官方 Universal Link；包含同一二维码的短期授权页地址
  code?: string; // 解码／网络／白名单失败的稳定错误码
  expiresAt: number; // 毫秒，与外层二维码 expiresAt 完全一致
  verification: "device-test-required";
}
```

可用入口按 QQ 官方 SDK 的 `qqmusic://qq.com/ui/openUrl?p=...` 格式包装授权页，再放入 `https://music.qq.com/unilink/download.html?scheme=...`。短期授权地址与二维码图像包含相同的待确认信息，不是已登录用户凭证；它只发给创建二维码的浏览器，不写日志、持久存储或分析事件。二维码截止时间从创建请求开始保守计时，解析链接不会延长有效期。

解析失败仅返回 `mobileAuth.status = unavailable` 和错误码，原扫码路径仍可使用。前端应在未过期时显示链接，返回页面后继续轮询原 `id`；打开 App、网页隐藏或官方落地页加载都不等于登录成功，只有原二维码返回 `803` 才保存连接。官方代码和临时未登录二维码已核对，实际 iPhone 打开后完成确认及 `803` 仍需本人验证。

证据：[官方授权页脚本](https://y.qq.com/m/client/qr_code_login/authorize.8139bd67b.js?max_age=2592000)读取 `qrcode_id` 并在 QQ 音乐环境选择 `qqmusic`；[共同模块](https://y.qq.com/m/client/qr_code_login/img/common.bundle.1a5e78c66.js?max_age=2592000)将同一 ID 传入 `GetQRCodeStatus` / `QRCodeLogin`；[官方 Music SDK](https://y.qq.com/lib/commercial/h5/music-react-2.3.0.min.js)定义 `ui/openUrl` 和 Universal Link 包装；[官方 App 关联文件](https://music.qq.com/.well-known/apple-app-site-association)声明 `/unilink/*`。

`account` 是 `null` 或 `{ nickname, avatarUrl? }`，不返回平台用户 ID。网易云通过 `/user/account`、QQ 通过 `/login/status` 读取真实昵称，平台资料查询有 2.5 秒上限且每分钟至多刷新一次；查询失败不影响已确认连接。Apple 接口不提供个人昵称，显示 `Apple Music 账号`。二维码确认接口先完成连接，昵称由后续连接状态查询补齐。

历史导入同时最多读取两个月份。每个月先使用较短的 12 秒时限；遇到临时失败，再进行一次 30 秒读取。请求也把超时值传入网关，防止本站取消后上游 Axios 请求无限挂起。关闭网页不会停止服务端任务；服务重启后已完成报告仍保留，再次开始会复用无临时错误的结果。任务结束可以仍有失败月份，`complete` 只表示本轮处理结束，不表示每个月都成功。

候选目录综合当前官方时光机 `/api/vipmusic/newrecord/timedetail` 的年月集合、年度听歌目录与账号创建月份下界。创建日期不等于首次听歌日期，时光机月份也不保证新月报同样可读取；因此 `rangeVerified` 保持 `false`，逐月读到实际数据后才计入已导入报告。不会将超时、空结果或会员限制显示成“零播放”。

### 可选的 QQ 官方个人密钥接入

本机 QQ 扫码网关已单独安装，用户已通过 QQ 音乐 App 扫码确认，并在本机读取到真实账号信息与报告。配置、启动、通道选择与许可限制见 [QQ 本地接入指南](./qq-local.md)。默认 `qqmusic` 通道使用 QQ 音乐 App 扫码。该第三方网关仅用于当前本机验证，不等于腾讯官方开放平台授权。

设置 `ENABLE_QQ_PERSONAL_KEY=true` 后，可在可信的本地界面向 `POST /api/auth/qq/key` 发送 `{ apiKey }`。密钥按本站浏览器会话隔离，绝不使用一把全局密钥为全部访客读取同一账号。该方式不是扫码授权；默认关闭，首版 UI 可以不展示。

QQ 官方月报没有已核实的整月总秒数字段，所以此路径的月时长返回 `null`，不参加时长占比。其月度明细歌曲的 `sum` 含义也未充分说明，当前只保留歌曲排行顺序，不假设为播放次数。近六个月的流派统计不会被当成选定月份的流派。

## Apple Music 官方接入

首版包含 Apple Music provider，使用官方 MusicKit，而不是 QQ／网易云的扫码网关。

本机已经完成 MusicKit 开发者配置。服务端可使用权限受限的本机 `.p8` 文件按需签发并续期 developer token，也兼容 `APPLE_MUSIC_DEVELOPER_TOKEN` 中已签名的 ES256 JWT；配置方式见 [Apple 配置说明](./apple-setup.md)。本项目不会自动注册、购买 Apple Developer 会员，也不会读取其他项目的密钥。开发者签名私钥 `.p8` 不应该进入前端、本项目的公开文件或 Git。

开发者配置完成不等于订阅用户授权完成。本次用户没有 Apple Music 订阅，已选择跳过订阅账号授权，因此尚未验证订阅账号端到端读取。

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

配置中发送给浏览器的是 Apple 要求的已签名 developer token，不是私钥。用户授权后，后端通过 `/v1/me/storefront` 实际验证 Music User Token，再将其放入本站服务端会话。所有 Apple REST 请求使用 `Authorization: Bearer <developer token>` 和 `Music-User-Token` 请求头；不将用户令牌放入 URL。

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
- 网易云周期报告已接入 `/listen/data/report`。已核对月度 `listenTimeBlock.blockType = LISTEN_TIME_MONTH_BLOCK` 的 `playDuration` 为分钟，自动乘 60 转为统一秒数；该规则不用于单位不同的年度目录。未知结构仍返回 `null` 和 `DURATION_MAPPING_REQUIRED`。只有确实使用其他已核对结构时才配置 `NETEASE_DURATION_PATH` 和 `NETEASE_DURATION_UNIT` 覆盖映射。
- 网易云当月返回 `MONTH_NOT_READY`，未来月份返回 `FUTURE_MONTH`，不请求可能回落到上月的报告。已结束月份会核对上游实际 `startTime`／`endTime`；不匹配返回 `PERIOD_MISMATCH`。
- 网易云月报请求最多等待 40 秒，网络超时或不可达最多再试一次；二维码仍使用较短的原超时。完整 Top 20 请求失败而月报成功时，先返回已核实的月报第 1 名并标记 `TOP_RANK_PARTIAL`，不冒充完整榜单。
- 月报与歌曲资料分开读取；首次连接后的资料补全覆盖已取得曲目，按批查询可靠曲风、曲长和专辑封面。缺少可核对标签时保留缺失及覆盖说明，不让模型猜测。
- QQ 网关读取真实 `/user/listening-report` 和 `/user/listening-rank`，有可信总时长时使用 `listenSeconds`；未取得时不伪造官方总量。前端可按有明确周期、播放次数和曲长的样本估算时长，显示约等号及样本说明。
- 常听曲目放在同一张列表，按已取得的播放次数排序并保留平台标识。两家播放计数口径未统一，同曲跨平台次数不直接相加；“共同偏爱”单独使用忽略大小写与封面的歌名／艺人近似匹配，并保留匹配边界。
- 只有已结束的完整月份、确认的实际总时长才标记 `coverageComplete`。当前月份不显示完整月份占比。
- 成功报告在单个会话中缓存 5 分钟，包含上游失败的报告不缓存，连接更改会使缓存失效。读取中的旧账号结果不会在断开或切换后被写回。每分钟最多请求 24 个报告，允许读取一年各月并重试。
- 网易云网关的默认缓存忽略 POST 请求体。桥接层所有网易云请求均发送 `x-apicache-bypass: 1`，防止旧二维码状态或不同账号／月份的结果被复用；凭证始终放在请求体中。

## 已验证与待验证

自动测试覆盖会话隔离、来源校验、断开连接清除、请求竞态、凭证不泄露、超时错误、缺失值与时长单位处理。测试使用受控上游，不代表已验证真实账号。

运行：

```sh
node --test server/api.test.mjs server/session-store.test.mjs server/netease-cache.test.mjs
```

截至 2026-11-25，用户已分别完成网易云和 QQ 音乐本机二维码扫描与确认，网页已读取真实账号信息和周期报告。网易云验证包含更早的已结束月份，并已接入按月保存与重试；这不代表平台开放了从首次听歌起的全部历史。网络超时、空结果和不可用月份仍单独标记，不能当成没有听歌。

月度时长单位通过真实报告中“听了…分”的日摘要、每日及分时段总和、合理时间范围和两份独立客户端的执行映射交叉核对；不是单凭字段名称推断。`playDurationText` 是百分位文案，`totalPlayMonth.valueA` 是听歌天数，均不作为总时长。不同时间块或摘要的数值可能不同，统一使用月度 `listenTimeBlock.playDuration`，不以每日最高值或歌曲长度替代总量。

可复核的开源客户端执行映射（并非网易云官方单位承诺）：[Melodia 月／周分钟与年度秒的区别](https://github.com/rinchao0721/Melodia/blob/f70a6725eedf6083a7a5c900212c888ed63fbada/shared/src/commonMain/kotlin/com/lin0721/linmusic/feature/listendata/domain/ListenDataMapper.kt#L16)、[Scopify 的月度分钟映射](https://github.com/MT-SUPER-POWER/Scopify/blob/7c975de07ca8195d9da18379262283e8b0a59d13/repo/frontend/apps/web/lib/listeningReport/reportSummary.ts#L312)。

尚待验证：云端真实连接、不同账号的历史范围与会员限制、iPhone 同一台手机直接唤起 App 后完成确认并返回原网页，以及 Apple Music 订阅账号端到端读取。电脑展示二维码、手机扫描成功不能替代单手机跳转授权验证。

## 参考与使用范围

- [网易云网关 MIT 许可](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/LICENSE)
- [网易云接口文档](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/public/docs/home.md)
- [网易云月榜返回结构与贡献者验证](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/pull/200)
- [QQ 官方调用规范与个人使用范围](https://github.com/tencentmusic/qqmusic-skills/blob/main/qqmusic/SKILL.md)
- [QQ 官方报告字段](https://github.com/tencentmusic/qqmusic-skills/blob/main/qqmusic/me.md)
- [QQ 兼容网关接口文档](https://github.com/yakult-green-tea/qq-music-api/blob/main/docs/README.md)

QQ 兼容网关参考项目当前声明不可商用，本项目只实现配置后的 HTTP 接口兼容，不复制或捆绑其源码。代码许可和音乐平台授权范围是不同问题，面向公众发布前需分别确认。
