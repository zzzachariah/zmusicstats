# 分享海报

生成器位于 `src/lib/poster.ts`。全部绘图在浏览器 Canvas 内完成，不发送报告到 AI 或图片服务，也不读取远程封面。

## 调用

```ts
import { exportPoster, exportPosterSeries, downloadPoster } from './lib/poster';

const cover = await exportPoster(report, {
  language: 'zh',
  theme: 'ink',
  format: 'cover',
});

const long = await exportPoster(report, {
  language: 'en',
  theme: 'paper',
  format: 'long',
});

const cards = await exportPosterSeries(report, { language: 'zh', theme: 'ink' });
downloadPoster(cover);
```

`exportPoster` 返回 `{ blob, url, filename }`；`exportPosterSeries` 返回该结构的数组。调用方负责在预览关闭或替换后调用 `URL.revokeObjectURL(url)`。

## 格式

- `cover`：1080 × 1440，黑胶主视觉、实际时长、Top 5、主要曲风。
- `long`：1080 × 2880，黑胶主视觉、各平台实际时长及占比、Top 10、曲风分布和规则洞察。
- `cards`：由 `exportPosterSeries` 生成四张 1080 × 1440 卡片，分别为封面、时长、歌曲、曲风及洞察。
- 可以通过 `section: 'listening' | 'tracks' | 'genres' | 'cover'` 单独生成指定卡片。

## 字体

中文标题使用 `Noto Serif SC Variable`，英文标题和大数字使用 `Instrument Serif`，正文使用 `Manrope Variable` 与 `Noto Sans SC Variable`，并保留系统字体回退。应用需加载对应字体 CSS。生成器会等待关键字形准备完成；没有字体时有系统字体回退。

## 数据边界

- `MusicReport.durationComparable` 为假时，不输出合计时长或平台占比；分平台卡仍可以显示各平台已确认的时长。
- 不可合并榜单时，仅从 `rankingMatchesPeriod` 为真的平台榜单交替选曲，并明确注明不构成跨平台总榜。
- 未知周期的最近播放列表不会印成月度 Top 排行；没有匹配周期榜单时显示该时间范围暂无排行。曲风使用数据层已经验证周期及计数的结果，不从最近播放推测月度分布。
- 可能遗漏另一平台未上榜播放的歌曲，以 `≥` 标注已知次数。
- 曲风展示保留报告提供的样本说明。
- 演示数据的每一张海报均有明确标记，且文件名包含 `demo`。
- 手机界面可用生成的图片 URL 提供长按保存，并在适用时使用系统分享；单独的下载函数是桌面及支持下载浏览器的回退方式。

## 已完成验证

- 定向 TypeScript 类型检查通过。
- 1080 × 1440 初始封面的中文／英文、深色／浅色以及缺失数据／分平台数据状态已在 Chrome 中检查。
- 已使用网易云、QQ 音乐、Apple Music 三平台演示数据，检查中文／英文长图及四张系列卡：平台列、Top 10、曲风及底部洞察均无溢出或重叠。
- 手机实际分享行为仍需真机验证。
