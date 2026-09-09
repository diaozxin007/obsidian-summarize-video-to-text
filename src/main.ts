/**
 * Summarize Video To Text —— Obsidian 插件入口(2026-09-04)。
 *
 * 做的事:
 *   1. 账号连接:设置页按钮跳主站 /connect/obsidian,主站签发个人令牌后通过
 *      obsidian://svt-connect 回来(registerObsidianProtocolHandler),核对 state 存 token。
 *   2. 命令「Summarize video from URL」:弹窗要链接 → 调主站 analyze(+ 可选
 *      summarize / quiz,这两步计费)→ /api/export/obsidian 生成 Markdown(只读缓存)
 *      → 写进设定目录并打开。笔记格式只在主站一处定义,网站的导出按钮同一份。
 *   3. 编辑器命令:选中一个链接直接跑,不弹窗;右键菜单对光标下/选中的链接、
 *      以及阅读视图里的外链也有「Summarize video」。
 *   4. 嵌入播放器:渲染 ```svt-video 块,拦截时间戳链接的点击原地跳秒(player.ts)。
 *   5. 网站 → Obsidian:主站导出按钮打开 obsidian://svt-import?videoId=…,插件直接
 *      拉 export(分析已在网站做过,不再计费)。
 *   6. 「Refresh video note」:重新拉 export,只替换标记之间的生成区和我们的
 *      frontmatter 键,用户写在标记外的内容保留(file.ts mergeNote)。
 *   7. 视频对话侧栏(2026-09-09,chat-view.ts):右侧 ItemView 跟着当前视频笔记,
 *      上下文从笔记抽,问答和记录都走主站,和网站问答 tab 同一份。
 *
 * 所有 AI 计算都在主站做,插件不存密钥、不调模型;配额和积分也由主站按账号扣。
 */

import { MarkdownView, moment, normalizePath, Notice, Plugin, TFile, type Editor, type Menu, type WorkspaceLeaf } from "obsidian";
import { ApiError, SvtApi } from "./api";
import { BUILD_CHANNEL, VERCEL_BYPASS_COOKIE_FLAG, VERCEL_BYPASS_HEADER } from "./build";
import { extractUrl, urlAtColumn, UrlModal, type RunOptions } from "./modal";
import { mergeNote, safeFileName, summaryOf, videoIdOf } from "./file";
import { editorClickExtension, handleDocumentClick, renderVideoBlock } from "./player";
import { platformOf, VIDEO_BLOCK_LANG } from "./video";
import { DEFAULT_SETTINGS, SvtSettingTab, type SvtSettings } from "./settings";
import { SvtChatView, VIEW_TYPE_CHAT } from "./chat-view";

const PROTOCOL_ACTION = "svt-connect";
const IMPORT_ACTION = "svt-import";

export default class SvtPlugin extends Plugin {
  settings: SvtSettings = { ...DEFAULT_SETTINGS };
  private settingTab?: SvtSettingTab;
  private running = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (BUILD_CHANNEL === "debug") console.info(`[summarize-video] debug build → ${this.settings.baseUrl}`);

    this.settingTab = new SvtSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      void this.handleConnectCallback(params.token ?? "", params.state ?? "");
    });
    this.registerObsidianProtocolHandler(IMPORT_ACTION, (params) => {
      void this.importFromSite(params.videoId ?? "", params.outputLang ?? "", {
        template: params.template ?? "",
        length: params.length ?? "",
        // 网站导出菜单的「包含字幕全文」勾选(2026-09-09);没带参数按插件设置
        transcript: params.transcript === undefined ? undefined : params.transcript !== "0" && params.transcript !== "false",
      });
    });

    this.addCommand({
      id: "summarize-video-url",
      name: "Summarize video from URL",
      callback: () => this.openModal(""),
    });

    this.addCommand({
      id: "summarize-selected-url",
      name: "Summarize video link in selection",
      editorCheckCallback: (checking: boolean, editor: Editor) => {
        const url = extractUrl(editor.getSelection());
        if (!url) return false;
        if (!checking) void this.run(url);
        return true;
      },
    });

    this.addCommand({
      id: "refresh-video-note",
      name: "Refresh video note",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter?.video_id) return false;
        if (!checking) void this.refresh(file);
        return true;
      },
    });

    this.addRibbonIcon("video", "Summarize video", () => this.openModal(""));

    // 视频对话侧栏:随当前打开的笔记切换绑定
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new SvtChatView(leaf, this));
    this.addCommand({
      id: "open-video-chat",
      name: "Open video chat",
      callback: () => void this.activateChat(),
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
          const view = leaf.view;
          if (view instanceof SvtChatView) view.bindTo(file);
        }
      }),
    );

    // 右键菜单:编辑器里光标下 / 选区里的链接
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        const cur = editor.getCursor();
        const url = extractUrl(editor.getSelection()) || urlAtColumn(editor.getLine(cur.line), cur.ch);
        if (url) this.addMenuItem(menu, url);
      }),
    );
    // 右键菜单:阅读视图 / 实时预览里渲染出来的外链
    this.registerEvent(
      this.app.workspace.on("url-menu", (menu: Menu, url: string) => {
        if (/^https?:\/\//i.test(url)) this.addMenuItem(menu, url);
      }),
    );

    // 嵌入播放器 + 时间戳跳秒
    this.registerMarkdownCodeBlockProcessor(VIDEO_BLOCK_LANG, (source, el) => renderVideoBlock(source, el));
    this.registerDomEvent(document, "click", handleDocumentClick, { capture: true });
    this.registerEditorExtension(editorClickExtension());
  }

  /** 打开(或聚焦)右侧的对话侧栏 */
  async activateChat(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
  }

  private addMenuItem(menu: Menu, url: string): void {
    menu.addItem((item) =>
      item
        .setTitle("Summarize video")
        .setIcon("video")
        .setSection("action")
        .onClick(() => this.openModal(url)),
    );
  }

  private openModal(initial: string): void {
    new UrlModal(this.app, initial, this.defaultRunOptions(), (url, opts) => void this.run(url, opts)).open();
  }

  private defaultRunOptions(): RunOptions {
    return {
      outputLang: this.settings.outputLang,
      summaryTemplate: this.settings.includeSummary ? this.settings.summaryTemplate : "",
      includeTranscript: this.settings.includeTranscript,
    };
  }

  // ---------- 设置 ----------

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SvtSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  api(): SvtApi {
    return new SvtApi({
      baseUrl: this.settings.baseUrl,
      token: this.settings.token,
      uiLang: this.uiLang(),
      bypassSecret: this.settings.bypassSecret,
    });
  }

  /** Obsidian 界面语言 → 主站只认 en/zh */
  private uiLang(): "en" | "zh" {
    return moment.locale().toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  outputLang(override?: string): string {
    return (override ?? this.settings.outputLang) || this.uiLang();
  }

  // ---------- 连接 ----------

  startConnect(): void {
    const state = randomState();
    this.settings.pendingState = state;
    void this.saveSettings();
    const vault = this.app.vault.getName();
    let url =
      `${this.settings.baseUrl}/connect/obsidian?state=${encodeURIComponent(state)}` +
      `&vault=${encodeURIComponent(vault)}`;
    // pre 预览站有 Vercel 部署保护:带上绕过密钥并让 Vercel 种 cookie,
    // 浏览器随后的登录/签发请求就不会被 SSO 拦下
    if (this.settings.bypassSecret) {
      url +=
        `&${VERCEL_BYPASS_HEADER}=${encodeURIComponent(this.settings.bypassSecret)}` +
        `&${VERCEL_BYPASS_COOKIE_FLAG}=true`;
    }
    window.open(url);
    this.settingTab?.display();
  }

  private async handleConnectCallback(token: string, state: string): Promise<void> {
    const expected = this.settings.pendingState;
    if (!expected || state !== expected) {
      new Notice("Summarize Video: ignored a connect request with an unknown state. Start again from the plugin settings.");
      return;
    }
    if (!token.startsWith("svt_")) {
      new Notice("Summarize Video: the token looks wrong. Copy it from the website and paste it in settings.");
      return;
    }
    await this.acceptToken(token);
    this.settingTab?.display();
  }

  /** 协议回调与手动粘贴共用:存 token、清 state、验一下 */
  async acceptToken(token: string): Promise<void> {
    this.settings.token = token;
    this.settings.pendingState = "";
    this.settings.connectedAt = new Date().toISOString();
    await this.saveSettings();
    try {
      const r = await this.api().check();
      if (r) new Notice(`Summarize Video: connected (plan: ${r.plan ?? "free"}).`);
      else new Notice("Summarize Video: the token was rejected by the server.");
    } catch {
      new Notice("Summarize Video: token saved, but the server could not be reached right now.");
    }
  }

  // ---------- 主流程 ----------

  /** opts 缺省时按设置来(命令「link in selection」不弹窗,走这条) */
  async run(url: string, opts?: RunOptions): Promise<void> {
    const o = opts ?? this.defaultRunOptions();
    if (!this.guard()) return;
    this.running = true;
    const notice = new Notice("Summarize Video: analyzing…", 0);
    try {
      const api = this.api();
      const outputLang = this.outputLang(o.outputLang);
      const analysis = await api.analyze(url, outputLang);
      const videoId = analysis.videoId;

      // 摘要 / 测验是计费步骤,按需并行跑;单项失败不拖累整篇笔记
      notice.setMessage("Summarize Video: preparing note…");
      const [summary] = await Promise.all([
        o.summaryTemplate ? soft(() => api.summarize(url, outputLang, o.summaryTemplate)) : null,
        this.settings.includeQuiz ? soft(() => api.quiz(videoId, outputLang, undefined)) : null,
      ]);

      const note = await api.exportNote({
        videoId,
        outputLang,
        include: this.include(o.includeTranscript),
        embedPlayer: this.settings.embedPlayer,
        summary: summary ? { template: o.summaryTemplate, text: summary } : undefined,
      });
      const file = await this.writeNote(safeFileName(note.fileName), note.markdown);
      notice.hide();
      new Notice(`Summarize Video: created ${file.path}`);
      if (this.settings.openAfterCreate) await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      notice.hide();
      this.reportError(e);
    } finally {
      this.running = false;
    }
  }

  /**
   * 网站导出按钮 → obsidian://svt-import?videoId=…&outputLang=…&template=…&length=…:
   * 分析已在网站做过;template/length 是用户在网站上看的那份详细总结,服务端按它查缓存
   * (2026-09-08 之前这条路的笔记永远没有摘要段)。
   */
  private async importFromSite(
    videoId: string,
    outputLang: string,
    opts: { template: string; length: string; transcript?: boolean },
  ): Promise<void> {
    if (!/^([\w-]{11}|tt-\d+|ig-[\w-]+|up-[\w-]+)$/.test(videoId)) {
      new Notice("Summarize Video: ignored an import link with a bad video id.");
      return;
    }
    if (!this.guard()) return;
    this.running = true;
    const notice = new Notice("Summarize Video: importing from the website…", 0);
    try {
      const note = await this.api().exportNote({
        videoId,
        outputLang: outputLang || this.outputLang(),
        include: this.include(opts.transcript),
        embedPlayer: this.settings.embedPlayer,
        summary: opts.template ? { template: opts.template, length: opts.length || undefined } : undefined,
      });
      const file = await this.writeNote(safeFileName(note.fileName), note.markdown);
      notice.hide();
      new Notice(`Summarize Video: created ${file.path}`);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      notice.hide();
      // 分析缓存过期了就走完整流程(会计费),用规范链接重新分析
      if (e instanceof ApiError && e.status === 404) {
        this.running = false;
        await this.run(canonicalUrl(videoId, this.settings.baseUrl), {
          outputLang,
          summaryTemplate: "",
          includeTranscript: opts.transcript ?? this.settings.includeTranscript,
        });
        return;
      }
      this.reportError(e);
    } finally {
      this.running = false;
    }
  }

  /** 刷新当前笔记:只换生成区和我们的 frontmatter 键 */
  private async refresh(file: TFile): Promise<void> {
    if (!this.guard()) return;
    this.running = true;
    const notice = new Notice("Summarize Video: refreshing note…", 0);
    try {
      const existing = await this.app.vault.read(file);
      const videoId = videoIdOf(existing);
      if (!videoId) throw new Error("This note has no video_id in its frontmatter.");
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      const lang = typeof fm.lang === "string" ? fm.lang : this.outputLang();
      // 摘要:frontmatter 记着当初的模板/长度就按它让服务端查缓存(可能已更新);
      // 老笔记没记的,把现有摘要段原文递回去,免得刷新把它刷没了
      const template = typeof fm.summary_template === "string" ? fm.summary_template : "";
      const length = typeof fm.summary_length === "string" ? fm.summary_length : undefined;
      const summaryText = template ? undefined : summaryOf(existing);
      const note = await this.api().exportNote({
        videoId,
        outputLang: lang,
        include: this.include(),
        embedPlayer: this.settings.embedPlayer,
        summary: template ? { template, length } : summaryText ? { template: "", text: summaryText } : undefined,
      });
      // vault.process 在回调里拿到的是落盘前最新内容,合并和写回是一步,不会盖掉
      // 用户在请求期间的改动(社区审核也要求用它替代 read + modify,2026-09-09)
      let merged: string | null = null;
      await this.app.vault.process(file, (current) => {
        merged = mergeNote(current, note.markdown, note.ownedKeys);
        return merged ?? current;
      });
      if (!merged) throw new Error("Could not find the %% svt:start %% / %% svt:end %% markers in this note.");
      notice.hide();
      new Notice("Summarize Video: note refreshed.");
      // 编辑器里打开着的话让它重读
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path === file.path && view.getMode() === "preview") view.previewMode.rerender(true);
    } catch (e) {
      notice.hide();
      this.reportError(e);
    } finally {
      this.running = false;
    }
  }

  /** transcript 可按次覆盖(弹窗开关 / 网站协议参数),其余跟设置 */
  private include(transcript?: boolean): { transcript: boolean; quiz: boolean; qa: boolean } {
    return {
      transcript: transcript ?? this.settings.includeTranscript,
      quiz: this.settings.includeQuiz,
      qa: this.settings.includeQa,
    };
  }

  /** 防重入 + 未连接提示;能跑返回 true */
  private guard(): boolean {
    if (this.running) {
      new Notice("Summarize Video: already working on a video, please wait.");
      return false;
    }
    if (!this.settings.token) {
      new Notice("Summarize Video: connect your account in the plugin settings first.");
      return false;
    }
    return true;
  }

  private async writeNote(baseName: string, content: string): Promise<TFile> {
    const folder = this.settings.folder;
    if (folder && !this.app.vault.getAbstractFileByPath(normalizePath(folder))) {
      await this.app.vault.createFolder(normalizePath(folder));
    }
    // 同名文件不覆盖,后缀递增
    for (let i = 0; i < 100; i++) {
      const name = i === 0 ? baseName : `${baseName} (${i})`;
      const path = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) {
        return this.app.vault.create(path, content);
      }
    }
    throw new Error("Too many notes with the same name");
  }

  private reportError(e: unknown): void {
    if (e instanceof ApiError) {
      const tail = e.requestId ? ` (ref ${e.requestId.slice(0, 8)})` : "";
      new Notice(`Summarize Video: ${e.message}${tail}`, 8000);
      console.error("[summarize-video]", e.status, e.code, e.message, e.requestId);
      return;
    }
    new Notice(`Summarize Video: ${(e as Error)?.message ?? String(e)}`, 8000);
    console.error("[summarize-video]", e);
  }
}

/** 可选步骤失败只记日志、返回 null,不影响主笔记 */
async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[summarize-video] optional step failed:", e);
    if (e instanceof ApiError && e.status !== 404) {
      new Notice(`Summarize Video: skipped a section — ${e.message}`, 6000);
    }
    return null;
  }
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 复合 id → 能喂给 /api/analyze 的规范链接(与主站 lib/video-url.ts canonicalUrl 一致) */
function canonicalUrl(videoId: string, siteUrl: string): string {
  switch (platformOf(videoId)) {
    case "tiktok":
      return `https://www.tiktok.com/@tiktok/video/${videoId.slice(3)}`;
    case "instagram":
      return `https://www.instagram.com/reel/${videoId.slice(3)}/`;
    case "upload":
      return `${siteUrl}/watch/up/${videoId.slice(3)}`;
    default:
      return `https://www.youtube.com/watch?v=${videoId}`;
  }
}
