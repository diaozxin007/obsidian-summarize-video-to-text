/**
 * 主站 API 客户端(2026-09-04)。
 *
 * 走 Obsidian 的 requestUrl 而不是 fetch:插件里的 fetch 受 CORS 限制,requestUrl
 * 由 Obsidian 主进程代发,不受限;代价是不支持流式(summarize 的 SSE 整段收下再解析,
 * 见 sse.ts)。鉴权用主站签发的个人令牌(`svt_…`)做 Bearer,主站 requireSession()
 * 认这个头。
 *
 * 错误统一成 ApiError:主站两种错误体都兼容 —— `{code, message}`(analyze/summarize)
 * 和 `{error}`(youtube-transcript)。401 特殊处理成「未连接 / 令牌已撤销」,
 * 让主流程提示用户重新连接。
 */

import { requestUrl } from "obsidian";
import { VERCEL_BYPASS_HEADER } from "./build";
import { collectSummary, SseError } from "./sse";
import type { QuizQuestion, TranscriptResult, VideoAnalysis, VideoMeta } from "./types";
import type { QaMessage } from "./chat";

export class ApiError extends Error {
  actionUrl?: string;
  actionLabel?: string;
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ApiOptions {
  baseUrl: string;
  token: string;
  /** 主站 UI 语言,决定错误文案和默认输出语言(只认 en/zh) */
  uiLang: "en" | "zh";
  /** Vercel 部署保护绕过密钥;debug 包连 pre 时用,空则不发该头 */
  bypassSecret?: string;
}

const PLUGIN_UA = "obsidian-summarize-video-to-text";

export class SvtApi {
  private unified = false;
  constructor(private opts: ApiOptions) {}

  private async request<T>(
    path: string,
    init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; accept?: string },
  ): Promise<{ status: number; text: string; json: () => T; requestId?: string }> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
    const headers: Record<string, string> = {
      Accept: init.accept ?? "application/json",
      "X-Client": PLUGIN_UA,
    };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    if (this.opts.bypassSecret) headers[VERCEL_BYPASS_HEADER] = this.opts.bypassSecret;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await requestUrl({
        url,
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        throw: false,
      });
    } catch (e) {
      throw new ApiError(0, "network", `Could not reach ${url}: ${(e as Error).message}`);
    }
    const requestId = res.headers?.["x-request-id"] ?? res.headers?.["X-Request-Id"];
    if (res.status >= 400) throw this.toError(res.status, res.text, requestId);
    return {
      status: res.status,
      text: res.text,
      json: () => JSON.parse(res.text) as T,
      requestId,
    };
  }

  private toError(status: number, text: string, requestId?: string): ApiError {
    let code = `http_${status}`;
    let message = "";
    let details: { needed?: number; available?: number } = {};
    try {
      const j = JSON.parse(text) as { code?: string; error?: string; message?: string; needed?: number; available?: number };
      code = j.code ?? j.error ?? code;
      message = j.message ?? "";
      details = j;
      if (!message && typeof j.error === "string") message = j.error;
    } catch {
      /* 非 JSON 错误体 */
    }
    if (status === 401) {
      message = this.opts.uiLang === "zh"
        ? "未连接或令牌已失效,请在插件设置里重新连接。"
        : "Not connected, or the token was revoked. Reconnect in the plugin settings.";
    } else if (code === "insufficient_credits") {
      const amount = typeof details.needed === "number" && typeof details.available === "number"
        ? (this.opts.uiLang === "zh" ? `需要 ${details.needed} credits，当前余额 ${details.available}。` : `Requires ${details.needed} credits; your balance is ${details.available}. `) : "";
      message = this.opts.uiLang === "zh" ? `${amount}请使用同一账号充值后重试，尚未开始处理。` : `${amount}Top up the same account, then retry. Processing has not started.`;
    } else if (code === "processing_required") {
      message = this.opts.uiLang === "zh" ? "请先用同一账号生成这个视频，再导出或提问。" : "Process this video with the same account before exporting or asking questions.";
    } else if (code === "processing_in_progress") {
      message = this.opts.uiLang === "zh" ? "视频正在处理中，请稍后重试，不会重复扣费。" : "This video is still processing. Retry shortly; it will not be charged twice.";
    } else if (code === "generation_variant_unavailable") {
      message = this.opts.uiLang === "zh" ? "当前仅支持已生成结果的原语言和内含总结。" : "Use the saved result's language and included summary.";
    } else if (!message) {
      message = this.opts.uiLang === "zh" ? `请求失败(${status})` : `Request failed (${status})`;
    }
    const error = new ApiError(status, code, message, requestId);
    if (code === "insufficient_credits" || code === "pro_required") {
      error.actionUrl = `${this.opts.baseUrl.replace(/\/+$/, "")}${this.opts.uiLang === "zh" ? "/zh" : ""}/pricing`;
      error.actionLabel = this.opts.uiLang === "zh" ? "查看套餐 / 充值" : "View plans / buy credits";
    }
    return error;
  }

  /** 结构化分析:TL;DR / 洞见 / 章节 / 图。跟主站 watch 页同一个接口。 */
  async analyze(url: string, outputLang: string): Promise<VideoAnalysis & { outputLang?: string }> {
    let quoteToken: string | undefined;
    for (const processing of ["subtitles", "transcription"]) {
      try {
        const r = await this.request<{ billingVersion?: string; cached?: boolean; quoteToken?: string; outputLang?: string }>("/api/credits/quote", {
          body: { url, lang: this.opts.uiLang, outputLang, processing },
        });
        const quote = r.json();
        this.unified = quote.billingVersion === "v2";
        if (quote.billingVersion === "legacy") break;
        if (!this.unified || (!quote.cached && typeof quote.quoteToken !== "string")) {
          throw new ApiError(503, "billing_unavailable", "Unable to verify the credit quote. Please retry.");
        }
        // Reopen the saved language instead of attempting an unpriced regeneration.
        if (quote.cached && typeof quote.outputLang === "string") outputLang = quote.outputLang;
        quoteToken = quote.quoteToken;
        break;
      } catch (e) {
        if (e instanceof ApiError && e.code === "transcription_required" && processing === "subtitles") continue;
        // Older servers did not expose the quote route. All other failures stop processing.
        if (e instanceof ApiError && e.status === 404) break;
        throw e;
      }
    }
    const r = await this.request<VideoAnalysis>("/api/analyze", {
      body: { url, lang: this.opts.uiLang, outputLang, ...(quoteToken ? { quoteToken } : {}) },
    });
    const a = r.json();
    if (!a || !a.overview || !Array.isArray(a.chapters) || !a.videoId) {
      throw new ApiError(r.status, "bad_response", "Unexpected analyze response", r.requestId);
    }
    return { ...a, outputLang };
  }

  async transcript(url: string): Promise<TranscriptResult> {
    const r = await this.request<TranscriptResult>("/api/youtube-transcript", {
      body: { url, lang: this.opts.uiLang },
    });
    return r.json();
  }

  /** 模板摘要;SSE 整段收下解析。 */
  async summarize(url: string, outputLang: string, template: string): Promise<string> {
    const r = await this.request<never>("/api/summarize", {
      body: { url, lang: this.opts.uiLang, outputLang, template: this.unified ? "bullet_summary" : template },
      accept: "text/event-stream",
    });
    try {
      return collectSummary(r.text);
    } catch (e) {
      if (e instanceof SseError) throw new ApiError(r.status, e.code, e.message, r.requestId);
      throw e;
    }
  }

  async quiz(videoId: string, outputLang: string, title?: string): Promise<QuizQuestion[]> {
    const r = await this.request<{ questions?: QuizQuestion[] }>("/api/quiz", {
      body: { videoId, lang: this.opts.uiLang, outputLang, title },
    });
    return r.json().questions ?? [];
  }

  /** 标题/频道/缩略图;拿不到不算错,笔记退化成用 videoId 当标题。 */
  async meta(videoId: string): Promise<VideoMeta | null> {
    try {
      const r = await this.request<VideoMeta>(`/api/video-meta?v=${encodeURIComponent(videoId)}`, {});
      const m = r.json();
      return m.unavailable ? null : m;
    } catch {
      return null;
    }
  }

  /**
   * 笔记 Markdown 由主站生成(只读缓存,不计费;分析没缓存回 404)。
   * summary 是调用方自己从 /api/summarize 拿到的文本,主站只负责排进去。
   */
  async exportNote(input: {
    videoId: string;
    outputLang: string;
    include: { transcript: boolean; quiz: boolean; qa: boolean };
    embedPlayer: boolean;
    /** text 缺省时服务端按 template/length 查网站上生成过的摘要缓存 */
    summary?: { template: string; length?: string; text?: string };
  }): Promise<{ markdown: string; fileName: string; title: string; ownedKeys?: string[] }> {
    const r = await this.request<{ markdown?: string; fileName?: string; title?: string; ownedKeys?: string[] }>(
      "/api/export/obsidian",
      {
        body: {
          videoId: input.videoId,
          lang: this.opts.uiLang,
          outputLang: input.outputLang,
          include: input.include,
          embedPlayer: input.embedPlayer,
          summary: input.summary,
          siteUrl: this.opts.baseUrl.replace(/\/+$/, ""),
        },
      },
    );
    const j = r.json();
    if (!j.markdown) throw new ApiError(r.status, "bad_response", "Unexpected export response", r.requestId);
    return {
      markdown: j.markdown,
      fileName: j.fileName || input.videoId,
      title: j.title || input.videoId,
      ownedKeys: Array.isArray(j.ownedKeys) && j.ownedKeys.every((k) => typeof k === "string") ? j.ownedKeys : undefined,
    };
  }

  // ---------- 视频对话(2026-09-09,chat-view.ts) ----------

  /** 问答:主站回纯文本流,requestUrl 整段收下。summary 是调用方从笔记里抽的上下文。 */
  async ask(videoId: string, context: string, question: string, outputLang: string): Promise<string> {
    const r = await this.request<never>("/api/qa", {
      body: { videoId, summary: context, question, lang: this.opts.uiLang, outputLang },
      accept: "text/plain",
    });
    return r.text.trim();
  }

  /** 对话记录按 (用户, 视频, 界面语言) 存,键和网站问答 tab 一致,两边看到同一份 */
  async qaHistory(videoId: string): Promise<QaMessage[]> {
    const r = await this.request<{ messages?: unknown }>(
      `/api/qa/history?videoId=${encodeURIComponent(videoId)}&lang=${this.opts.uiLang}`,
      {},
    );
    const m = r.json().messages;
    return Array.isArray(m)
      ? (m as QaMessage[]).filter((x) => x && (x.role === "q" || x.role === "a") && typeof x.content === "string")
      : [];
  }

  async saveQaHistory(videoId: string, messages: QaMessage[]): Promise<void> {
    await this.request("/api/qa/history", { body: { videoId, lang: this.opts.uiLang, messages } });
  }

  async clearQaHistory(videoId: string): Promise<void> {
    await this.request(`/api/qa/history?videoId=${encodeURIComponent(videoId)}&lang=${this.opts.uiLang}`, {
      method: "DELETE",
    });
  }

  /**
   * 连接是否有效:/api/quota 走 Bearer。无效令牌返回 401。
   * 兼容旧服务器时，带令牌却拿到 anon 也视为失效。
   */
  async check(): Promise<{ plan?: string; credits?: { available: number } | null } | null> {
    try {
      const r = await this.request<{ plan?: string; credits?: { available: number } | null }>("/api/quota", {});
      const q = r.json();
      if (this.opts.token && q.plan === "anon") return null;
      return q;
    } catch (e) {
      if (e instanceof ApiError && e.unauthorized) return null;
      throw e;
    }
  }
}
