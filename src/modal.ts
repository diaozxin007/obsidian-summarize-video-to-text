/**
 * 输入视频链接的弹窗(2026-09-04)。打开时预填:光标选中的 URL > 剪贴板里的 URL。
 * 弹窗里还能临时改输出语言和摘要模板(只对这一次生效,默认值来自设置)。
 */

import { App, Modal, Notice, Setting } from "obsidian";
import { OUTPUT_LANGS, SUMMARY_TEMPLATES } from "./settings";
import { extractUrl, urlAtColumn } from "./url";

export { extractUrl, urlAtColumn };

/** 一次运行的可选参数;空串模板 = 不要摘要 */
export interface RunOptions {
  outputLang: string;
  summaryTemplate: string;
  /** 这一篇要不要带字幕全文;默认取设置,弹窗里可临时改(2026-09-09) */
  includeTranscript: boolean;
  /** 顺带出一篇复习卡片笔记(2026-09-14);需要测验题,没有就现场生成 */
  flashcards: boolean;
}

export class UrlModal extends Modal {
  private value = "";
  private opts: RunOptions;

  constructor(
    app: App,
    private initial: string,
    defaults: RunOptions,
    private onSubmit: (url: string, opts: RunOptions) => void,
  ) {
    super(app);
    this.opts = { ...defaults };
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Summarize video");

    if (!this.initial) {
      try {
        this.initial = extractUrl(await navigator.clipboard.readText());
      } catch {
        /* 剪贴板权限被拒就空着 */
      }
    }
    this.value = this.initial;

    let inputEl: HTMLInputElement | undefined;
    new Setting(contentEl)
      .setName("Video URL")
      .setDesc("YouTube, TikTok or Instagram link")
      .addText((t) => {
        inputEl = t.inputEl;
        t.inputEl.addClass("svt-url-input"); // 宽度在 styles.css,社区审核不让写行内 style
        t.setPlaceholder("https://www.youtube.com/watch?v=…")
          .setValue(this.value)
          .onChange((v) => (this.value = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(contentEl).setName("Output language").addDropdown((d) => {
      for (const l of OUTPUT_LANGS) d.addOption(l.code, l.name);
      d.setValue(this.opts.outputLang).onChange((v) => (this.opts.outputLang = v));
    });

    new Setting(contentEl)
      .setName("Summary")
      .setDesc("Extra template summary below the chapters (counts as another summary on your plan).")
      .addDropdown((d) => {
        d.addOption("", "None");
        for (const t of SUMMARY_TEMPLATES) d.addOption(t.id, t.name);
        d.setValue(this.opts.summaryTemplate).onChange((v) => (this.opts.summaryTemplate = v));
      });

    new Setting(contentEl)
      .setName("Include transcript")
      .setDesc("Append the full timestamped transcript (long videos add hundreds of lines).")
      .addToggle((t) => t.setValue(this.opts.includeTranscript).onChange((v) => (this.opts.includeTranscript = v)));

    new Setting(contentEl)
      .setName("Also make flashcards")
      .setDesc(
        "Write a second note of spaced-repetition cards from the video's quiz. " +
          "Quizzes are a Pro feature; if this video has no quiz yet, one is generated now and counts against your plan.",
      )
      .addToggle((t) => t.setValue(this.opts.flashcards).onChange((v) => (this.opts.flashcards = v)));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Create note").setCta().onClick(() => this.submit()),
    );

    // 让用户一打开就能敲回车
    window.setTimeout(() => {
      inputEl?.focus();
      inputEl?.select();
    }, 0);
  }

  private submit(): void {
    const url = extractUrl(this.value.trim());
    if (!url) {
      new Notice("Paste a video link first.");
      return;
    }
    this.close();
    this.onSubmit(url, this.opts);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
