declare const __ZMUSICSTATS_UI_PREVIEW__: boolean;

/** A build-time mode, never controlled by a URL parameter or browser storage. */
export const IS_UI_PREVIEW = typeof __ZMUSICSTATS_UI_PREVIEW__ !== "undefined" && __ZMUSICSTATS_UI_PREVIEW__;

export const UI_PREVIEW_LABEL = {
  zh: "界面预览 · 使用示例数据",
  en: "UI preview · sample data",
};
export const UI_PREVIEW_CONNECTION_REASON = {
  zh: "线上界面预览，真实连接请使用本机版。",
  en: "Online UI preview. Use the local app to connect real music accounts.",
};
