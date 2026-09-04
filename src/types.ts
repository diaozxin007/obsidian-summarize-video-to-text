/**
 * 主站 API 的返回形状(2026-09-04),和 summarizevideototext 仓库 src/lib/llm/types.ts 对齐。
 * 只列插件用到的字段;主站加字段不影响这里,删字段/改名才需要同步。
 */

export interface KeyInsight {
  title: string;
  detail: string;
}

export interface ChapterPoint {
  timeMs: number;
  text: string;
}

export interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
  points: ChapterPoint[];
}

export interface VideoDiagram {
  type: string;
  code: string;
  /** 主站只有渲染校验通过才带 svg;没 svg 的 mermaid 源码可能画不出来,不要塞进笔记 */
  svg?: string;
}

export interface VideoAnalysis {
  overview: {
    tags: string[];
    tldr: string;
    keyInsights: KeyInsight[];
  };
  chapters: Chapter[];
  diagram?: VideoDiagram;
  videoId: string;
  cached?: boolean;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** options 的下标 */
  answer: number;
  explanation: string;
  timeMs: number;
}

export interface VideoMeta {
  title: string;
  channel: string;
  thumbnail: string;
  unavailable?: boolean;
}

export interface TranscriptResult {
  /** 每行 `[mm:ss] text` */
  text: string;
  lang: string;
}

export type Platform = "youtube" | "tiktok" | "instagram" | "upload" | "other";
