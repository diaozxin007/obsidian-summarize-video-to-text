/**
 * 插件设置(2026-09-04)。
 *
 * 连接流程:设置页「Connect」→ 生成随机 state 存进 pendingState → 系统浏览器打开
 * 主站 /connect/obsidian?state=…&vault=… → 用户登录/签发令牌 → 主站跳
 * obsidian://svt-connect?token=…&state=… → main.ts 的协议处理器核对 state 后存 token。
 * state 是一次性的:防止别的网页伪造 obsidian:// 链接往插件里塞令牌。
 *
 * 令牌明文存在 vault 的 .obsidian/plugins/…/data.json 里,和其他需要 API key 的
 * 社区插件一样;README 提醒同步 vault 的人注意。
 */

import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import { BUILD_CHANNEL, DEFAULT_BASE_URL } from "./build";
import type SvtPlugin from "./main";

export { DEFAULT_BASE_URL };

export const OUTPUT_LANGS: Array<{ code: string; name: string }> = [
  { code: "", name: "Auto (follow Obsidian)" },
  { code: "en", name: "English" },
  { code: "zh", name: "中文" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "hi", name: "हिन्दी" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "it", name: "Italiano" },
  { code: "ar", name: "العربية" },
];

/** 主站模板 id(src/lib/llm/templates.ts),这里只挑最常用的几个 */
export const SUMMARY_TEMPLATES: Array<{ id: string; name: string }> = [
  { id: "chapter_summary", name: "Chapter summary" },
  { id: "key_insights", name: "Key insights" },
  { id: "bullet_summary", name: "Bullet summary" },
  { id: "table_summary", name: "Table summary" },
  { id: "chapter_digest", name: "Chapter digest" },
];

export interface SvtSettings {
  baseUrl: string;
  token: string;
  /** 连接成功的时间,只用于设置页展示 */
  connectedAt: string;
  /** 正在进行的连接流程的 state;成功或取消后清空 */
  pendingState: string;
  outputLang: string;
  folder: string;
  includeSummary: boolean;
  summaryTemplate: string;
  includeTranscript: boolean;
  includeQuiz: boolean;
  /** 把你在网站上和这条视频的问答记录也带进笔记 */
  includeQa: boolean;
  /** YouTube / TikTok 笔记嵌入播放器(svt-video 块);关掉则放缩略图 */
  embedPlayer: boolean;
  openAfterCreate: boolean;
  /** 新建笔记时顺带出卡片;弹窗里的「Also make flashcards」默认值 */
  flashcardsOnCreate: boolean;
  /** 「Create flashcards」写到哪个目录;空 = vault 根目录 */
  flashcardsFolder: string;
  /** Spaced Repetition 的 deck 标签;层级标签(#flashcards/videos)会变成子 deck */
  flashcardTag: string;
  /**
   * Vercel 部署保护的绕过密钥(Protection Bypass for Automation)。只有 debug 包
   * 连 pre 预览站时才需要;请求加 x-vercel-protection-bypass 头,连接页 URL 也带上
   * 让浏览器种绕过 cookie。生产站不需要,留空即可。
   */
  bypassSecret: string;
}

export const DEFAULT_SETTINGS: SvtSettings = {
  baseUrl: DEFAULT_BASE_URL,
  token: "",
  connectedAt: "",
  pendingState: "",
  outputLang: "",
  folder: "Video Notes",
  includeSummary: false,
  summaryTemplate: "chapter_summary",
  includeTranscript: true,
  includeQuiz: false,
  includeQa: true,
  embedPlayer: true,
  openAfterCreate: true,
  flashcardsOnCreate: false,
  flashcardsFolder: "Flashcards",
  flashcardTag: "#flashcards",
  bypassSecret: "",
};

/**
 * 设置页走 1.13 的声明式 API(getSettingDefinitions):Obsidian 自己渲染并把每一项
 * 收进设置搜索;状态变化(连接/断开、等待浏览器回调)后由 main.ts 调 update() 重建。
 * 值的读写默认落到 plugin.settings,这里只覆盖 setControlValue 做归一化和存盘。
 */
export class SvtSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SvtPlugin) {
    super(app, plugin);
  }

  override getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof SvtSettings];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings as unknown as Record<string, unknown>;
    let v = value;
    if ((key === "folder" || key === "flashcardsFolder") && typeof v === "string") {
      v = v.trim().replace(/^\/+|\/+$/g, "");
    }
    // 标签少了 # 就不是标签,SR 找不到 deck —— 自动补上,空值退回默认
    if (key === "flashcardTag" && typeof v === "string") {
      const t = v.trim().replace(/\s+/g, "-");
      v = t ? (t.startsWith("#") ? t : `#${t}`) : DEFAULT_SETTINGS.flashcardTag;
    }
    if (key === "baseUrl" && typeof v === "string") v = v.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
    if (key === "bypassSecret" && typeof v === "string") v = v.trim();
    s[key] = v;
    await this.plugin.saveSettings();
    // 「Summary template」只在 includeSummary 打开时显示
    this.refreshDomState();
  }

  override getSettingDefinitions(): SettingDefinitionItem<keyof SvtSettings>[] {
    const s = this.plugin.settings;
    const connected = () => !!this.plugin.settings.token;

    return [
      {
        type: "group",
        heading: "Account",
        items: [
          {
            name: "Connected",
            desc: `Token ${s.token.slice(0, 8)}… · connected ${s.connectedAt ? new Date(s.connectedAt).toLocaleString() : ""}`,
            visible: connected,
            render: (setting) => {
              setting
                .addButton((b) =>
                  b.setButtonText("Check").onClick(async () => {
                    try {
                      const r = await this.plugin.api().check();
                      new Notice(r ? `Connected (plan: ${r.plan ?? "free"})` : "Token is no longer valid. Reconnect.");
                    } catch (e) {
                      new Notice(`Check failed: ${(e as Error).message}`);
                    }
                  }),
                )
                .addButton((b) =>
                  b
                    .setButtonText("Disconnect")
                    .setDestructive()
                    .onClick(async () => {
                      this.plugin.settings.token = "";
                      this.plugin.settings.connectedAt = "";
                      await this.plugin.saveSettings();
                      new Notice("Disconnected. You can revoke the token on the website under Connect → Obsidian.");
                      this.update();
                    }),
                );
            },
          },
          {
            name: "Connect to summarizevideototext.com",
            desc: s.pendingState
              ? "Waiting for the browser… finish signing in, then Obsidian will receive the token automatically."
              : "Opens the website in your browser. Sign in (or create a free account), and you'll be sent back here.",
            visible: () => !connected(),
            render: (setting) => {
              setting.addButton((b) =>
                b
                  .setButtonText(s.pendingState ? "Open again" : "Connect")
                  .setCta()
                  .onClick(() => this.plugin.startConnect()),
              );
            },
          },
          {
            name: "Or paste a token",
            desc: "If the browser can't open Obsidian, copy the token shown on the website and paste it here.",
            visible: () => !connected(),
            render: (setting) => {
              setting.addText((t) =>
                t.setPlaceholder("svt_…").onChange(async (v) => {
                  const token = v.trim();
                  if (!token.startsWith("svt_") || token.length < 20) return;
                  await this.plugin.acceptToken(token);
                  this.update();
                }),
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Note",
        items: [
          {
            name: "Output language",
            desc: "Language of the generated summary. Auto picks Chinese or English from Obsidian's language.",
            control: {
              type: "dropdown",
              key: "outputLang",
              options: Object.fromEntries(OUTPUT_LANGS.map((l) => [l.code, l.name])),
            },
          },
          {
            name: "Folder",
            desc: "Where new notes go. Created if missing. Leave empty for the vault root.",
            control: { type: "text", key: "folder", placeholder: "Video Notes" },
          },
          {
            name: "Include transcript",
            desc: "Append the timestamped transcript in a collapsed callout.",
            control: { type: "toggle", key: "includeTranscript" },
          },
          {
            name: "Include summary",
            desc: "Also generate a template summary (counts as an extra summary on your plan).",
            control: { type: "toggle", key: "includeSummary" },
          },
          {
            name: "Summary template",
            visible: () => this.plugin.settings.includeSummary,
            control: {
              type: "dropdown",
              key: "summaryTemplate",
              options: Object.fromEntries(SUMMARY_TEMPLATES.map((t) => [t.id, t.name])),
            },
          },
          {
            name: "Include quiz",
            desc: "Add multiple-choice questions with collapsed answers.",
            control: { type: "toggle", key: "includeQuiz" },
          },
          {
            name: "Include Q&A history",
            desc: "Questions you asked about the video on the website, with the answers.",
            control: { type: "toggle", key: "includeQa" },
          },
          {
            name: "Embed video player",
            desc: "YouTube and TikTok: put a player at the top of the note. Timestamp links then jump the player instead of opening the browser.",
            control: { type: "toggle", key: "embedPlayer" },
          },
          {
            name: "Open note after creating",
            control: { type: "toggle", key: "openAfterCreate" },
          },
        ],
      },
      {
        type: "group",
        heading: "Flashcards",
        items: [
          {
            name: "Make flashcards with every new note",
            desc:
              "Default for the 'Also make flashcards' toggle in the Summarize video dialog. " +
              "Each video without a quiz yet needs one generated, which counts against your plan (Pro).",
            control: { type: "toggle", key: "flashcardsOnCreate" },
          },
          {
            name: "Flashcards folder",
            desc: "Where 'Create flashcards from video note' puts the card notes. Created if missing.",
            control: { type: "text", key: "flashcardsFolder", placeholder: "Flashcards" },
          },
          {
            name: "Deck tag",
            desc:
              "Tag written at the top of every card note, used by the Spaced Repetition plugin to pick the deck. " +
              "Use a nested tag such as #flashcards/videos to get a sub-deck.",
            control: { type: "text", key: "flashcardTag", placeholder: "#flashcards" },
          },
        ],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            name: "Server URL",
            desc:
              `This is a ${BUILD_CHANNEL} build; the default is ${DEFAULT_BASE_URL}. ` +
              "Only change this if you were told to (e.g. to test a preview deployment).",
            control: { type: "text", key: "baseUrl", placeholder: DEFAULT_BASE_URL },
          },
          {
            name: "Preview bypass secret",
            desc:
              "Only for preview servers behind Vercel Deployment Protection. Sent as the " +
              "x-vercel-protection-bypass header; leave empty for the public site.",
            // 密钥要用 password 输入框,声明式控件没有这一种,自己渲染
            render: (setting) => {
              setting.addText((t) => {
                t.inputEl.type = "password";
                t.setValue(this.plugin.settings.bypassSecret).onChange((v) => void this.setControlValue("bypassSecret", v));
              });
            },
          },
        ],
      },
    ];
  }
}
