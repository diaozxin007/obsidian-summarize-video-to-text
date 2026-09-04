/**
 * Summarize Video To Text —— Obsidian 插件入口(2026-09-04)。
 *
 * 做的事只有三件:
 *   1. 账号连接:设置页按钮跳主站 /connect/obsidian,主站签发个人令牌后通过
 *      obsidian://svt-connect 回来(registerObsidianProtocolHandler),核对 state 存 token。
 *   2. 命令「Summarize video from URL」:弹窗要链接 → 调主站 analyze(+ 可选
 *      transcript / summarize / quiz)→ note.ts 拼笔记 → 写进设定目录并打开。
 *   3. 编辑器命令:选中一个链接直接跑,不弹窗。
 *
 * 所有 AI 计算都在主站做,插件不存密钥、不调模型;配额和积分也由主站按账号扣。
 */

import { moment, normalizePath, Notice, Plugin, TFile, type Editor } from "obsidian";
import { ApiError, SvtApi } from "./api";
import { extractUrl, UrlModal } from "./modal";
import { buildNote, safeFileName } from "./note";
import { DEFAULT_SETTINGS, SvtSettingTab, type SvtSettings } from "./settings";
import type { QuizQuestion, TranscriptResult } from "./types";

const PROTOCOL_ACTION = "svt-connect";

export default class SvtPlugin extends Plugin {
  settings: SvtSettings = { ...DEFAULT_SETTINGS };
  private settingTab?: SvtSettingTab;
  private running = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.settingTab = new SvtSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      void this.handleConnectCallback(params.token ?? "", params.state ?? "");
    });

    this.addCommand({
      id: "summarize-video-url",
      name: "Summarize video from URL",
      callback: () => new UrlModal(this.app, "", (url) => void this.run(url)).open(),
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

    this.addRibbonIcon("video", "Summarize video", () =>
      new UrlModal(this.app, "", (url) => void this.run(url)).open(),
    );
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
    });
  }

  /** Obsidian 界面语言 → 主站只认 en/zh */
  private uiLang(): "en" | "zh" {
    return moment.locale().toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  private outputLang(): string {
    return this.settings.outputLang || this.uiLang();
  }

  // ---------- 连接 ----------

  startConnect(): void {
    const state = randomState();
    this.settings.pendingState = state;
    void this.saveSettings();
    const vault = this.app.vault.getName();
    const url =
      `${this.settings.baseUrl}/connect/obsidian?state=${encodeURIComponent(state)}` +
      `&vault=${encodeURIComponent(vault)}`;
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

  async run(url: string): Promise<void> {
    if (this.running) {
      new Notice("Summarize Video: already working on a video, please wait.");
      return;
    }
    if (!this.settings.token) {
      new Notice("Summarize Video: connect your account in the plugin settings first.");
      return;
    }
    this.running = true;
    const notice = new Notice("Summarize Video: analyzing…", 0);
    try {
      const api = this.api();
      const outputLang = this.outputLang();

      const analysis = await api.analyze(url, outputLang);
      const videoId = analysis.videoId;

      // 剩下几步互不依赖,并行拿;单项失败不拖累整篇笔记
      notice.setMessage("Summarize Video: fetching details…");
      const [meta, transcript, summary, quiz] = await Promise.all([
        api.meta(videoId),
        this.settings.includeTranscript ? soft(() => api.transcript(url)) : null,
        this.settings.includeSummary
          ? soft(() => api.summarize(url, outputLang, this.settings.summaryTemplate))
          : null,
        this.settings.includeQuiz ? soft(() => api.quiz(videoId, outputLang, undefined)) : null,
      ]);

      const content = buildNote({
        url,
        videoId,
        analysis,
        title: meta?.title,
        channel: meta?.channel,
        thumbnail: meta?.thumbnail,
        lang: outputLang,
        summary: summary ? { template: this.settings.summaryTemplate, text: summary } : undefined,
        quiz: (quiz as QuizQuestion[] | null) ?? undefined,
        transcript: (transcript as TranscriptResult | null) ?? undefined,
        createdAt: new Date(),
      });

      const file = await this.writeNote(safeFileName(meta?.title || videoId), content);
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
