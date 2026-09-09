/**
 * 视频对话侧栏(2026-09-09)。右侧一个 ItemView,跟着当前打开的视频笔记走
 * (frontmatter 有 video_id 的),上下文从笔记正文抽(chat.ts),提问走主站
 * /api/qa,对话记录走 /api/qa/history —— 和网站问答 tab 是同一份,两边互通。
 * requestUrl 不支持流式,回答整段收下再显示,期间显示 Thinking…。
 * 每条回答可「Add to note」追加到笔记末尾(用户区,刷新笔记不会动它)。
 */

import { ItemView, MarkdownRenderer, Notice, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import { ApiError } from "./api";
import { chatContextFromNote, formatQaForNote, type QaMessage } from "./chat";
import type SvtPlugin from "./main";

export const VIEW_TYPE_CHAT = "svt-chat";

interface Bound {
  file: TFile;
  videoId: string;
  title: string;
  /** 回答语言 = 笔记语言(frontmatter.lang) */
  lang: string;
}

export class SvtChatView extends ItemView {
  private bound: Bound | null = null;
  private messages: QaMessage[] = [];
  private busy = false;
  private loadSeq = 0;
  private headEl!: HTMLElement;
  private msgsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, private plugin: SvtPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return "Video chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("svt-chat");
    this.headEl = root.createDiv({ cls: "svt-chat-head" });
    this.msgsEl = root.createDiv({ cls: "svt-chat-msgs" });
    const form = root.createDiv({ cls: "svt-chat-form" });
    this.inputEl = form.createEl("textarea", {
      cls: "svt-chat-input",
      attr: { rows: "2", placeholder: "Ask about this video… (Enter to send, Shift+Enter for a new line)" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send();
      }
    });
    this.sendBtn = form.createEl("button", { cls: "svt-chat-send mod-cta", text: "Send" });
    this.sendBtn.addEventListener("click", () => void this.send());
    this.render();
    this.bindTo(this.app.workspace.getActiveFile());
  }

  /**
   * 跟随笔记:是视频笔记就绑定并拉历史。不是视频笔记(或焦点在侧栏本身,
   * getActiveFile 为 null)就保持上一次的绑定,免得点一下输入框对话就没了。
   */
  bindTo(file: TFile | null): void {
    if (!file || file.extension !== "md") return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const videoId = typeof fm?.video_id === "string" ? fm.video_id : "";
    if (!videoId) return;
    if (this.bound && this.bound.videoId === videoId && this.bound.file.path === file.path) return;
    this.bound = {
      file,
      videoId,
      title: typeof fm?.title === "string" && fm.title ? fm.title : file.basename,
      lang: typeof fm?.lang === "string" && fm.lang ? fm.lang : this.plugin.outputLang(),
    };
    this.messages = [];
    this.busy = false;
    this.render();
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const b = this.bound;
    if (!b || !this.plugin.settings.token) return;
    const seq = ++this.loadSeq;
    try {
      const msgs = await this.plugin.api().qaHistory(b.videoId);
      if (seq !== this.loadSeq || this.bound !== b || this.messages.length) return;
      if (msgs.length) {
        this.messages = msgs;
        this.render();
      }
    } catch {
      /* 历史拉不到不影响提问 */
    }
  }

  private render(): void {
    const b = this.bound;
    this.headEl.empty();
    this.msgsEl.empty();
    if (!b) {
      this.headEl.createDiv({ cls: "svt-chat-title", text: "Video chat" });
      this.msgsEl.createDiv({
        cls: "svt-chat-empty",
        text: "Open a video note created by Summarize Video To Text and the chat will follow it.",
      });
      this.setInputEnabled(false);
      return;
    }
    const title = this.headEl.createDiv({ cls: "svt-chat-title", text: b.title });
    title.title = b.file.path;
    const clear = this.headEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Clear conversation" } });
    setIcon(clear, "trash-2");
    clear.addEventListener("click", () => void this.clear());

    if (!this.messages.length) {
      this.msgsEl.createDiv({
        cls: "svt-chat-empty",
        text: "Ask anything about this video. Answers use the note's summary and chapters as context and are saved to your account.",
      });
    }
    this.messages.forEach((m, i) => this.renderMessage(m, i));
    this.setInputEnabled(!this.busy);
    this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
  }

  private renderMessage(m: QaMessage, i: number): void {
    const el = this.msgsEl.createDiv({ cls: `svt-chat-msg svt-chat-${m.role}` });
    if (m.role === "q") {
      el.createDiv({ cls: "svt-chat-bubble", text: m.content });
      return;
    }
    const body = el.createDiv({ cls: "svt-chat-bubble markdown-rendered" });
    if (!m.content) {
      body.createSpan({ cls: "svt-chat-thinking", text: "Thinking…" });
      return;
    }
    void MarkdownRenderer.render(this.app, m.content, body, this.bound?.file.path ?? "", this);
    const tools = el.createDiv({ cls: "svt-chat-tools" });
    const add = tools.createEl("button", { cls: "svt-chat-tool", text: "Add to note" });
    add.addEventListener("click", () => void this.addToNote(i, add));
    const copy = tools.createEl("button", { cls: "svt-chat-tool", text: "Copy" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(m.content);
      new Notice("Copied.");
    });
  }

  private setInputEnabled(on: boolean): void {
    this.inputEl.disabled = !on;
    this.sendBtn.disabled = !on;
    this.sendBtn.setText(this.busy ? "…" : "Send");
  }

  private async send(): Promise<void> {
    const b = this.bound;
    const q = this.inputEl.value.trim();
    if (!b || !q || this.busy) return;
    if (!this.plugin.settings.token) {
      new Notice("Summarize Video: connect your account in the plugin settings first.");
      return;
    }
    const context = chatContextFromNote(await this.app.vault.cachedRead(b.file), b.title);
    if (!context) {
      new Notice("Summarize Video: this note has no generated section to use as context.");
      return;
    }
    this.inputEl.value = "";
    const prior = this.messages;
    this.messages = [...prior, { role: "q", content: q }, { role: "a", content: "" }];
    this.busy = true;
    this.render();
    try {
      const answer = await this.plugin.api().ask(context, q, b.lang);
      this.messages = [...prior, { role: "q", content: q }, { role: "a", content: answer || "(empty answer)" }];
      // 只在成功后落库,和网站一致:失败不用占位文案盖掉上次存好的记录
      void this.plugin.api().saveQaHistory(b.videoId, this.messages).catch(() => undefined);
    } catch (e) {
      this.messages = prior;
      this.inputEl.value = q;
      new Notice(`Summarize Video: ${e instanceof ApiError ? e.message : ((e as Error)?.message ?? String(e))}`, 8000);
    } finally {
      this.busy = false;
      this.render();
      this.inputEl.focus();
    }
  }

  private async clear(): Promise<void> {
    const b = this.bound;
    if (!b) return;
    this.messages = [];
    this.render();
    try {
      await this.plugin.api().clearQaHistory(b.videoId);
    } catch {
      /* 服务端清不掉下次还会拉回来,提示一下 */
      new Notice("Summarize Video: could not clear the saved conversation on the server.");
    }
  }

  /** 这一问一答追加到笔记末尾 —— 标记之外的用户区,Refresh video note 不会碰 */
  private async addToNote(i: number, btn: HTMLButtonElement): Promise<void> {
    const b = this.bound;
    const a = this.messages[i];
    const q = this.messages[i - 1];
    if (!b || !a?.content) return;
    const block = formatQaForNote(q?.role === "q" ? q.content : "", a.content);
    await this.app.vault.process(b.file, (data) => `${data.replace(/\s+$/, "")}\n\n${block}\n`);
    btn.setText("Added");
    btn.disabled = true;
  }
}
