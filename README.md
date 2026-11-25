<div align="center">
  <img src="public/favicon.svg" width="76" height="76" alt="zmusicstats 黑胶 Z 标志" />
  <h1>zmusicstats</h1>
  <p><strong>把不同播放器里的你，收进同一张唱片。</strong></p>
  <p>跨平台听歌报告 · 黑胶风格 · 中英文切换 · 手机与电脑</p>
  <p>
    <a href="https://zmusicstats.app">体验网站</a> ·
    <a href="#本地运行">本地运行</a> ·
    <a href="https://github.com/zzzachariah/zmusicstats/issues">反馈与建议</a>
  </p>
</div>

---

## 你的音乐，有迹可循

**zmusicstats** 是一个个人听歌统计网站。连接网易云音乐和 QQ 音乐，选择一段时光，把平台提供的听歌记录整理成一份可以探索、也可以分享的音乐报告，无需手动导出文件。

| 看见什么 | 留下什么 |
| :--- | :--- |
| **音乐画像** | 根据常听曲风生成一句属于你的描述，让听歌时长变成可感知的时间比喻 |
| **听歌平台** | 查看各平台的曲目来源、播放次数，以及实际或估算时长 |
| **常听曲目** | 跨平台歌曲排名、专辑封面、曲目详情与共同偏爱 |
| **曲风偏好** | 探索曲风占比，以及每种曲风里最常听的歌曲 |
| **分享海报** | 自选模块和曲目数量，导出封面、长图或系列图片 |

报告分析、音乐画像与海报生成**无需 AI API**。界面支持中英文，适配电脑和手机。

## 平台支持

| 平台 | 当前状态 | 连接方式 |
| :--- | :--- | :--- |
| 网易云音乐 | 支持 | App 扫码；同手机可保存二维码后，在扫一扫中从相册识别 |
| QQ 音乐 | 支持 | 扫码，或手机跳转 App 授权后返回浏览器 |
| Apple Music | 暂不支持 | 授权入口暂未开放 |

可以先连接多个平台，再点击 **「继续，选择统计时段」**，选择最近几个月、自定范围或全部可读取历史。

## 本地运行

准备 **Node.js 24+** 和 npm。本地运行不需要云服务、数据库或 AI 密钥；读取音乐平台数据时需要联网。

### 1. 安装项目

```bash
git clone https://github.com/zzzachariah/zmusicstats.git
cd zmusicstats
npm ci
cp .env.example .env
```

### 2. 安装音乐接入服务

```bash
npm run setup:netease
npm run setup:qq
```

在 `.env` 中填写以下两项，其余配置可保留默认值：

```dotenv
NETEASE_API_BASE_URL=http://127.0.0.1:3101
QQ_API_BASE_URL=http://127.0.0.1:3201
```

### 3. 启动

```bash
npm run dev
```

打开 **[localhost:5173](http://localhost:5173)**，即可连接账号并生成报告。启动命令会一并运行网页、账号接入服务和已安装的音乐接入服务。

手机与电脑连接同一 Wi-Fi 后，可访问终端显示的 **Network** 地址。使用期间保持电脑和终端运行，按 `Ctrl+C` 停止服务。

> 想先看看效果？在开始页选择 **「先看看示例报告」**，无需连接账号。示例数据会明确标注。

## 关于数据

- **以平台实际返回为准。** 历史范围因账号和平台而异，不等于完整的逐次播放日志；当月未结束的月报不纳入统计。
- **估算与实际分开。** 平台未提供总时长时，按已取得歌曲的「次数 × 歌长」估算，并标注 `≈`；缺失数据不冒充实际记录。
- **曲风不凭空猜测。** 曲风图只纳入播放次数大于 10 的歌曲，并展示有可靠标签的覆盖情况。
- **本机保管连接。** 本地版的登录状态与历史缓存使用 `.auth-state/` 加密保存；`.env`、私钥和本机数据均不提交到仓库。网易云与 QQ 接入基于非官方接口适配。

<details>
<summary><strong>开发命令与技术栈</strong></summary>

```bash
npm test       # 运行检查
npm run build  # 类型检查与前端构建
```

React · TypeScript · Vite · Node.js · Motion

中文字体：Noto Serif SC / Noto Sans SC；英文字体：Instrument Serif / Manrope。字体随项目提供。

</details>

---

<div align="center">
  <sub>Created by <a href="https://github.com/zzzachariah">Zach</a> · Made for the music you return to.</sub>
</div>
