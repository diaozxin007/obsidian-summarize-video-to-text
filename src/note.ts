/**
 * 把主站返回的分析结果拼成一篇 Obsidian 笔记(2026-09-04)。
 *
 * 纯函数,不 import obsidian —— 这样 vitest 能直接测。笔记结构:
 *   frontmatter(title/source/video_id/platform/channel/lang/tags/created)
 *   播放器(YouTube,可选;否则缩略图)→ TL;DR callout → 关键洞见 → 章节(时间戳链接)→ 摘要(可选)
 *   → 图(可选,只有主站渲染校验过的 mermaid 才放)→ 测验(可选,答案折叠)
 *   → 字幕(可选,折叠 callout)
 *
 * 时间戳链接:YouTube 用 `watch?v=ID&t=NNs` 浏览器里也能跳到秒;TikTok 用自定义
 * `?t=NN`,只有插件的嵌入播放器认;IG / 上传文件没有可跳的地址,只写纯文本时间。
 */

import type { Platform, QuizQuestion, VideoAnalysis } from "./types";
import { canEmbed, platformOf, timestampUrl, videoBlock, watchPath } from "./video";

export { platformOf };

export interface NoteInput {
  /** 用户给的原始视频链接(source) */
  url: string;
  /**
   * 主站地址(不带尾斜杠)。给了就在标题下放「Open on <站点>」指向工作区页
   * (播放器 + 分析 + 问答 + 测验都在那),原链接退居 Source。2026-09-04 用户要求:
   * 笔记里的「查看视频」应该进我们的页面,不是 YouTube。
   */
  siteUrl?: string;
  videoId: string;
  analysis: VideoAnalysis;
  title?: string;
  channel?: string;
  thumbnail?: string;
  /** YouTube / TikTok 放 ```svt-video 播放器块代替缩略图(插件渲染,时间戳可原地跳秒) */
  embedPlayer?: boolean;
  /** 输出语言代码,写进 frontmatter.lang */
  lang: string;
  summary?: { template: string; text: string };
  quiz?: QuizQuestion[];
  transcript?: { text: string; lang: string };
  createdAt: Date;
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function timestampLink(platform: Platform, videoId: string, ms: number, sourceUrl?: string): string {
  const label = formatTime(ms);
  const href = timestampUrl(platform, videoId, Math.floor(ms / 1000), sourceUrl);
  return href ? `[${label}](${href})` : label;
}

/** Obsidian 文件名不能含 \ / : * ? " < > | ,链接语法里 # ^ [ ] 也会出问题 */
export function safeFileName(name: string, fallback = "video"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return cleaned || fallback;
}

/** frontmatter tag:不能有空格和 # ,统一成 kebab-case */
export function toTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase();
}

function yamlStr(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/** callout 里每行都要 `> ` 前缀,空行也要 */
function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

const LETTERS = "ABCDEFGH";

export function buildNote(input: NoteInput): string {
  const { analysis, videoId } = input;
  const platform = platformOf(videoId);
  const title = input.title?.trim() || `Video ${videoId}`;
  const tags = Array.from(new Set(analysis.overview.tags.map(toTag).filter(Boolean)));

  const fm: string[] = ["---"];
  fm.push(`title: ${yamlStr(title)}`);
  fm.push(`source: ${yamlStr(input.url)}`);
  if (input.siteUrl) fm.push(`workspace: ${yamlStr(`${input.siteUrl}${watchPath(videoId)}`)}`);
  fm.push(`video_id: ${yamlStr(videoId)}`);
  fm.push(`platform: ${platform}`);
  if (input.channel) fm.push(`channel: ${yamlStr(input.channel)}`);
  fm.push(`lang: ${input.lang}`);
  if (tags.length) {
    fm.push("tags:");
    for (const t of tags) fm.push(`  - ${t}`);
  }
  fm.push(`created: ${input.createdAt.toISOString()}`);
  fm.push("generator: summarizevideototext.com");
  fm.push("---");

  const out: string[] = [fm.join("\n"), ""];
  out.push(`# ${title}`, "");
  if (input.siteUrl) {
    const host = input.siteUrl.replace(/^https?:\/\//, "");
    out.push(`[Open on ${host}](${input.siteUrl}${watchPath(videoId)}) · [Source](${input.url})`, "");
  } else {
    out.push(`[Open video](${input.url})`, "");
  }
  if (input.embedPlayer && canEmbed(platform)) {
    out.push(videoBlock(videoId, input.title), "");
  } else if (input.thumbnail) {
    out.push(`![thumbnail](${input.thumbnail})`, "");
  }

  if (analysis.overview.tldr) {
    out.push("> [!summary] TL;DR", quoteBlock(analysis.overview.tldr), "");
  }

  if (analysis.overview.keyInsights.length) {
    out.push("## Key insights", "");
    for (const k of analysis.overview.keyInsights) {
      out.push(`- **${k.title}** ${k.detail}`.trimEnd());
    }
    out.push("");
  }

  if (analysis.chapters.length) {
    out.push("## Chapters", "");
    for (const ch of analysis.chapters) {
      out.push(`### ${timestampLink(platform, videoId, ch.startMs, input.url)} ${ch.title}`, "");
      for (const p of ch.points) {
        out.push(`- ${timestampLink(platform, videoId, p.timeMs, input.url)} ${p.text}`);
      }
      out.push("");
    }
  }

  if (input.summary?.text) {
    out.push("## Summary", "", input.summary.text.trim(), "");
  }

  // 只放主站渲染校验通过的图;Obsidian 原生渲染 ```mermaid
  if (analysis.diagram?.svg && analysis.diagram.code) {
    out.push("## Diagram", "", "```mermaid", analysis.diagram.code.trim(), "```", "");
  }

  if (input.quiz?.length) {
    out.push("## Quiz", "");
    input.quiz.forEach((q, i) => {
      out.push(`${i + 1}. ${q.question} ${timestampLink(platform, videoId, q.timeMs, input.url)}`);
      q.options.forEach((opt, j) => out.push(`   - ${LETTERS[j] ?? j + 1}. ${opt}`));
      const ans = LETTERS[q.answer] ?? String(q.answer + 1);
      out.push("", "   > [!success]- Answer", `   > **${ans}.** ${q.explanation}`.trimEnd(), "");
    });
  }

  if (input.transcript?.text) {
    out.push(`> [!note]- Transcript (${input.transcript.lang})`);
    out.push(quoteBlock(input.transcript.text.trim()), "");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
