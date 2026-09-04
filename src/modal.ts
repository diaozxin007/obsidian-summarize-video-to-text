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
        t.inputEl.style.width = "100%";
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
