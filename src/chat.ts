/**
 * 视频对话侧栏的纯函数(2026-09-09),不 import obsidian,vitest 直接测。
 *
 * 上下文取自笔记本身,不再打 analyze:生成区里的 TL;DR / 关键洞见 / 章节 / 摘要
 * 就是主站问答 tab 用的那份「概览 + 章节大纲」。去掉字幕全文(几百行,费 token
 * 且不聚焦)、围栏代码(播放器块、mermaid)、问答记录、测验、链接地址和标记注释,
 * 剩下一段纯文本交给 /api/qa 的 summary 字段。
 */

import { SVT_END, SVT_START } from "./file";

export const CONTEXT_MAX = 12000;

export interface QaMessage {
  role: "q" | "a";
  content: string;
}

/** 从这些小节起不要(中英两套标签见主站 export-obsidian.ts LABELS);遇到别的小节恢复 */
const STOP_HEADING = /^#{1,6}\s*(Transcript|字幕全文|Q&A|问答记录|Quiz|测验|My notes|我的笔记|Diagram|图)(?:\s|\(|（|$)/;
const FENCE = /^\s*(```|~~~)/;

export function chatContextFromNote(md: string, title?: string): string {
  let body = md;
  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 4);
    if (end > 0) body = body.slice(end + 4);
  }
  const start = body.indexOf(SVT_START);
  if (start >= 0) {
    const stop = body.indexOf(SVT_END, start);
    body = body.slice(start + SVT_START.length, stop > start ? stop : undefined);
  }

  const out: string[] = [];
  let skip = false;
  let inFence = false;
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(line)) skip = STOP_HEADING.test(line);
    if (skip) continue;
    if (/^(Open on|在此打开)/.test(line.replace(/^\[/, ""))) continue;
    const text = line
      .replace(/^>\s?\[!\w+\]\s*/, "")
      .replace(/^>\s?/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/%%.*?%%/g, "")
      .trimEnd();
    if (text.trim()) out.push(text);
    else if (out.length && out[out.length - 1] !== "") out.push("");
  }
  const head = title ? `Video: ${title}\n` : "";
  return (head + out.join("\n").trim()).slice(0, CONTEXT_MAX);
}

/** 「加进笔记」的格式,和网站问答 tab 的「存入笔记」一致 */
export function formatQaForNote(q: string, a: string): string {
  return `${q.trim() ? `**Q:** ${q.trim()}\n\n` : ""}${a.trim()}`;
}
