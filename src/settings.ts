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

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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
  bypassSecret: "",
};

export class SvtSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SvtPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    // ---- 账号 ----
    new Setting(containerEl).setName("Account").setHeading();

    if (s.token) {
      new Setting(containerEl)
        .setName("Connected")
        .setDesc(
          `Token ${s.token.slice(0, 8)}… · connected ${s.connectedAt ? new Date(s.connectedAt).toLocaleString() : ""}`,
        )
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
            .setWarning()
            .onClick(async () => {
              s.token = "";
              s.connectedAt = "";
              await this.plugin.saveSettings();
              new Notice("Disconnected. You can revoke the token on the website under Connect → Obsidian.");
              this.display();
            }),
        );
    } else {
      new Setting(containerEl)
        .setName("Connect to summarizevideototext.com")
        .setDesc(
          s.pendingState
            ? "Waiting for the browser… finish signing in, then Obsidian will receive the token automatically."
            : "Opens the website in your browser. Sign in (or create a free account), and you'll be sent back here.",
        )
        .addButton((b) =>
          b
            .setButtonText(s.pendingState ? "Open again" : "Connect")
            .setCta()
            .onClick(() => this.plugin.startConnect()),
        );

      new Setting(containerEl)
        .setName("Or paste a token")
        .setDesc("If the browser can't open Obsidian, copy the token shown on the website and paste it here.")
        .addText((t) =>
          t.setPlaceholder("svt_…").onChange(async (v) => {
            const token = v.trim();
            if (!token.startsWith("svt_") || token.length < 20) return;
            await this.plugin.acceptToken(token);
            this.display();
          }),
        );
    }

    // ---- 输出 ----
    new Setting(containerEl).setName("Note").setHeading();

    new Setting(containerEl)
      .setName("Output language")
      .setDesc("Language of the generated summary. Auto picks Chinese or English from Obsidian's language.")
      .addDropdown((d) => {
        for (const l of OUTPUT_LANGS) d.addOption(l.code, l.name);
        d.setValue(s.outputLang).onChange(async (v) => {
          s.outputLang = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Folder")
      .setDesc("Where new notes go. Created if missing. Leave empty for the vault root.")
      .addText((t) =>
        t.setPlaceholder("Video Notes").setValue(s.folder).onChange(async (v) => {
          s.folder = v.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Include transcript")
      .setDesc("Append the timestamped transcript in a collapsed callout.")
      .addToggle((t) =>
        t.setValue(s.includeTranscript).onChange(async (v) => {
          s.includeTranscript = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Include summary")
      .setDesc("Also generate a template summary (counts as an extra summary on your plan).")
      .addToggle((t) =>
        t.setValue(s.includeSummary).onChange(async (v) => {
          s.includeSummary = v;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (s.includeSummary) {
      new Setting(containerEl).setName("Summary template").addDropdown((d) => {
        for (const t of SUMMARY_TEMPLATES) d.addOption(t.id, t.name);
        d.setValue(s.summaryTemplate).onChange(async (v) => {
          s.summaryTemplate = v;
          await this.plugin.saveSettings();
        });
      });
    }

    new Setting(containerEl)
      .setName("Include quiz")
      .setDesc("Add multiple-choice questions with collapsed answers.")
      .addToggle((t) =>
        t.setValue(s.includeQuiz).onChange(async (v) => {
          s.includeQuiz = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Include Q&A history")
      .setDesc("Questions you asked about the video on the website, with the answers.")
      .addToggle((t) =>
        t.setValue(s.includeQa).onChange(async (v) => {
          s.includeQa = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Embed video player")
      .setDesc(
        "YouTube and TikTok: put a player at the top of the note. Timestamp links then jump the player instead of opening the browser.",
      )
      .addToggle((t) =>
        t.setValue(s.embedPlayer).onChange(async (v) => {
          s.embedPlayer = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Open note after creating")
      .addToggle((t) =>
        t.setValue(s.openAfterCreate).onChange(async (v) => {
          s.openAfterCreate = v;
          await this.plugin.saveSettings();
        }),
      );

    // ---- 高级 ----
    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc(
        `This is a ${BUILD_CHANNEL} build; the default is ${DEFAULT_BASE_URL}. ` +
          "Only change this if you were told to (e.g. to test a preview deployment).",
      )
      .addText((t) =>
        t.setPlaceholder(DEFAULT_BASE_URL).setValue(s.baseUrl).onChange(async (v) => {
          s.baseUrl = v.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Preview bypass secret")
      .setDesc(
        "Only for preview servers behind Vercel Deployment Protection. Sent as the " +
          "x-vercel-protection-bypass header; leave empty for the public site.",
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.bypassSecret).onChange(async (v) => {
          s.bypassSecret = v.trim();
          await this.plugin.saveSettings();
        });
      });
  }
}
