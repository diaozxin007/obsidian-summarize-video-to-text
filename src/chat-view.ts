/**
 * 视频对话侧栏(2026-09-09)。右侧一个 ItemView,跟着当前打开的视频笔记走
 * (frontmatter 有 video_id 的,插件导入和主站导出都会写这个键),上下文从笔记
 * 正文抽(chat.ts),提问走主站 /api/qa,对话记录走 /api/qa/history —— 和网站
 * 问答 tab 是同一份,两边互通。requestUrl 不支持流式,回答整段收下再显示。
 * 每条回答可「Add to note」追加到笔记末尾(用户区,刷新笔记不会动它)。
 *
 * 2026-09-09 改成文档式排版(用户反馈原版「很幼稚」,给了一张参考图):提问是一块
 * 灰色气泡,回答像正文一样铺开,操作只留一排小图标,输入框是一张安静的卡片,回车即发。
 * 打开的不是视频笔记时,如果对话栏正显示着,就顺手把侧栏收起来,切回视频笔记再展开。
 */

import {
  ItemView,
  MarkdownRenderer,
  Notice,
  setIcon,
  TFile,
  type WorkspaceLeaf,
  type WorkspaceMobileDrawer,
  type WorkspaceSidedock,
} from "obsidian";
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
  /**
   * 当前打开的是一篇非视频笔记。绑定仍留着(切回来不用重拉历史),但界面上
   * 明确告诉用户「这篇不是视频笔记」,而不是继续显示上一个视频的对话让人误会。
   */
  private detached: TFile | null = null;
  /** 侧栏是我们因为「不是视频笔记」自动收起的;只有这种情况切回视频笔记才自动展开,用户手动开合的不碰 */
  private autoCollapsed = false;
  /** onOpen 跑完才允许动侧栏:用户在普通笔记上刚打开对话栏,不能马上又给收回去 */
  private ready = false;
  private messages: QaMessage[] = [];
  /** 按 videoId 缓存拉过的历史,笔记之间来回切不闪 */
  private histories = new Map<string, QaMessage[]>();
  private busy = false;
  private loadSeq = 0;
  private headEl!: HTMLElement;
  private msgsEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private hintEl!: HTMLElement;
  private langEl!: HTMLElement;

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
    this.composerEl = root.createDiv({ cls: "svt-chat-composer" });
    this.inputEl = this.composerEl.createEl("textarea", {
      cls: "svt-chat-input",
      attr: { rows: "3", placeholder: "Ask about this video…" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send();
      }
    });
    const foot = this.composerEl.createDiv({ cls: "svt-chat-composer-foot" });
    this.hintEl = foot.createSpan({ cls: "svt-chat-hint", text: "Enter to send · Shift+Enter for a new line" });
    this.langEl = foot.createSpan({ cls: "svt-chat-lang" });
    this.render();
    this.bindTo(this.app.workspace.getActiveFile());
    this.ready = true;
  }

  /**
   * 跟随笔记:是视频笔记就绑定并拉历史;是别的 .md 就进「不是视频笔记」状态;
   * file 为 null(焦点落在侧栏本身,比如点输入框)不动,免得点一下对话就没了。
   */
  bindTo(file: TFile | null): void {
    if (!file || file.extension !== "md") return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const videoId = typeof fm?.video_id === "string" ? fm.video_id : "";
    if (!videoId) {
      if (this.detached?.path === file.path) return;
      const wasDetached = this.detached !== null;
      this.detached = file;
      this.render();
      if (!wasDetached) this.collapseDock();
      return;
    }
    this.detached = null;
    this.expandDock();
    if (this.bound && this.bound.videoId === videoId && this.bound.file.path === file.path) {
      this.render();
      return;
    }
    this.bound = {
      file,
      videoId,
      title: typeof fm?.title === "string" && fm.title ? fm.title : file.basename,
      lang: typeof fm?.lang === "string" && fm.lang ? fm.lang : this.plugin.outputLang(),
    };
    this.messages = this.histories.get(videoId) ?? [];
    this.busy = false;
    this.render();
    if (!this.messages.length) void this.loadHistory();
  }

  /** 对话栏所在的侧栏(左右都算);被拖进主区域就返回 null,不做自动开合 */
  private dock(): WorkspaceSidedock | WorkspaceMobileDrawer | null {
    const root = this.leaf.getRoot();
    const ws = this.app.workspace;
    if (root === ws.rightSplit) return ws.rightSplit;
    if (root === ws.leftSplit) return ws.leftSplit;
    return null;
  }

  /** 只在对话栏正显示在眼前时收(侧栏展开着、而且当前 tab 是我们);藏在别的 tab 后面就别动用户的侧栏 */
  private collapseDock(): void {
    const dock = this.dock();
    if (!this.ready || !dock || dock.collapsed || !this.containerEl.isShown()) return;
    dock.collapse();
    this.autoCollapsed = true;
  }

  private expandDock(): void {
    if (!this.autoCollapsed) return;
    this.autoCollapsed = false;
    const dock = this.dock();
    if (!dock || !dock.collapsed) return;
    dock.expand();
    void this.app.workspace.revealLeaf(this.leaf);
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
        this.histories.set(b.videoId, msgs);
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
    this.langEl.setText(b && !this.detached ? b.lang.toUpperCase() : "");

    if (this.detached) {
      this.headEl.createDiv({ cls: "svt-chat-title", text: "Video chat" });
      const empty = this.msgsEl.createDiv({ cls: "svt-chat-empty" });
      empty.createDiv({
        text: `“${this.detached.basename}” isn't a video note. Open a note imported by Summarize Video To Text to chat about its video.`,
      });
      if (b) {
        // 用 <a> 而不是 <button>:Obsidian 给 button:not(.clickable-icon) 配了底色和阴影,压过自定义类
        const back = empty.createEl("a", { cls: "svt-chat-link", text: `Back to “${b.title}”`, attr: { role: "button", tabindex: "0" } });
        back.addEventListener("click", (e) => {
          e.preventDefault();
          void this.app.workspace.getLeaf(false).openFile(b.file);
        });
      }
      this.setInputEnabled(false);
      return;
    }
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
    if (m.role === "q") {
      this.msgsEl.createDiv({ cls: "svt-chat-q", text: m.content });
      return;
    }
    const body = this.msgsEl.createDiv({ cls: "svt-chat-a markdown-rendered" });
    if (!m.content) {
      body.createSpan({ cls: "svt-chat-thinking", text: "Thinking…" });
      return;
    }
    void MarkdownRenderer.render(this.app, m.content, body, this.bound?.file.path ?? "", this);
    const tools = this.msgsEl.createDiv({ cls: "svt-chat-tools" });
    const add = tools.createEl("button", { cls: "clickable-icon svt-chat-tool", attr: { "aria-label": "Add to note" } });
    setIcon(add, "plus");
    add.addEventListener("click", () => void this.addToNote(i, add));
    const copy = tools.createEl("button", { cls: "clickable-icon svt-chat-tool", attr: { "aria-label": "Copy" } });
    setIcon(copy, "copy");
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(m.content);
      new Notice("Copied.");
    });
  }

  private setInputEnabled(on: boolean): void {
    this.inputEl.disabled = !on;
    this.composerEl.toggleClass("is-disabled", !on);
    this.hintEl.setText(this.busy ? "Thinking…" : "Enter to send · Shift+Enter for a new line");
  }

  private async send(): Promise<void> {
    const b = this.bound;
    const q = this.inputEl.value.trim();
    if (!b || this.detached || !q || this.busy) return;
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
      this.histories.set(b.videoId, this.messages);
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
    this.histories.delete(b.videoId);
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
    setIcon(btn, "check");
    btn.setAttribute("aria-label", "Added to note");
    btn.disabled = true;
    new Notice("Added to note.");
  }
}
