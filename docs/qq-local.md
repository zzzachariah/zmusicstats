# QQ 音乐本地连接服务

此服务用于本机开发验证；未作为线上或商业接入方案授权。

## 依赖与用途

安装的是项目作者发布的 npm 包 `@yakult-green-tea/qq-music-api@3.3.8`，与腾讯官方开放平台无关。依赖位于被 Git 忽略的 `work/qq-gateway/`，没有拷贝或修改上游源码。

上游 README 明确写明“当前代码仅供学习，不可做商业用途”；虽然 npm 元数据同时列出 MIT，不能据此将该接入视为已经获准商用。

来源：

- [上游项目和用途说明](https://github.com/yakult-green-tea/qq-music-api)
- [部署、登录与报告文档](https://github.com/yakult-green-tea/qq-music-api/blob/main/docs/README.md)
- [npm 包](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api)

## 安装与运行

在项目目录执行：

```sh
node server/setup-qq.mjs
node server/start-qq.mjs
```

安装过程固定版本、禁用依赖安装脚本。服务仅监听 `127.0.0.1:3201`，不向局域网直接暴露。如果需要换端口，可给启动脚本设置 `QQ_LOCAL_PORT`；主服务的地址配置必须同步修改。

主服务配置：

```dotenv
QQ_API_BASE_URL=http://127.0.0.1:3201
QQ_QR_CHANNEL=qqmusic
```

`qqmusic` 用已登录的 QQ 音乐 App 扫码；`qq` 用手机 QQ；`wechat` 用微信。通过 `/login/channels` 确认当前可用通道，不能使用错误的 App 扫描另一通道的二维码。

电脑显示二维码、手机扫描与确认的流程有明确实现。仅使用一台手机的同机授权路径仍需单独验证，不能将“手机扫码”理解为无需另一块显示屏。

## 本地保护与生命周期

- 上游默认启动会监听全部网络接口。包装器使用包公开的 Koa 应用导出，关闭其自动监听，再显式监听 `127.0.0.1`。设置 `NODE_ENV=test` 只利用该包明确的“导出但不自动启动服务器”行为，扫码仍使用真实上游服务。
- 只开放登录、听歌报告、歌曲曲风及健康检查路径；不开放歌单修改等无关功能。
- 校验 Host 和 Origin，拒绝外站页面直接调用此本地连接服务。
- 启动器抑制第三方日志，不输出二维码标识、账号 Cookie、会话 token 或加密密钥。
- 本地会话密钥首次生成于 `work/qq-gateway/.auth-state/session-secret`，权限为 `0600`；父目录为 `0700`。设备身份及加密会话保留在同目录，重启不会无故生成另一设备身份。
- 不要提交、分享或清理这份状态目录，除非有意重置本地音乐连接。
- 启动器退出时会关闭工作进程与 MQTT 连接。切换到统一开发启动器前，先停止单独运行的实例，避免占用同一端口。

## 与主服务的接口约定

1. `GET /login/qr/key?channel=qqmusic` 返回 `data.unikey`。
2. `GET /login/qr/create?key=...` 返回 `data.qrimg`，按 data URL 实际 MIME 类型展示。
3. `GET /login/qr/check?key=...` 的 `code`：`801` 等待扫描，`802` 等待确认，`803` 完成连接，`800` 过期或失败。
4. Node 模式的成功结果在 `cookie` 字符串中返回 `qqmusic_session=...`。主服务只在服务器内提取该值，通过后续请求的 `X-QQ-Session` 请求头传递。
5. `GET /login/qr/cancel?key=...` 取消未使用二维码。

不将上述网关凭证返回浏览器；浏览器只使用主服务自身的会话。

## 已完成验证

截至 2026-11-25，本机 Node 环境：

- `/health` 返回健康状态，实际监听地址确认为 `127.0.0.1:3201`。
- `/login/channels` 返回 `qq`、`wechat`、`qqmusic`，会话模式为 `stored`。
- `qqmusic` 通道成功取得二维码标识和 PNG 二维码，等待扫码与取消路径已检查。
- 外站 Origin 请求返回 `403`；不相关接口返回 `404`。
- 随后用户已使用 QQ 音乐 App 扫码确认，网页取得已连接状态、真实账号信息和周期报告。报告中未取得的官方总时长仍保持缺失，界面显示的样本估算有明确标注。

已验证的是电脑显示二维码、QQ 音乐 App 扫码确认的本机链路。iPhone 在同一台手机点击链接、唤起 App、确认并返回原网页的端到端流程仍未实测；打开 App 首页不算连接成功。QQ／微信通道已由服务声明支持，但未在这次检查中逐一完成扫码。云端网关及多人并发也尚未通过真实验证。
