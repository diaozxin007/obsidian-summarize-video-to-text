/**
 * 输入视频链接的弹窗(2026-09-04)。打开时预填:光标选中的 URL > 剪贴板里的 URL。
 */

import { App, Modal, Notice, Setting } from "obsidian";

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function extractUrl(text: string | null | undefined): string {
  return text?.match(URL_RE)?.[0] ?? "";
}

export class UrlModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private initial: string,
    private onSubmit: (url: string) => void,
  ) {
    super(app);
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
    this.onSubmit(url);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
