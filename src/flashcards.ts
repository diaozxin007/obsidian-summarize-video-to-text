/**
 * 测验题 → Spaced Repetition 卡片(2026-09-14),纯函数,不 import obsidian。
 *
 * 为什么是独立的一张笔记,而不是排进视频笔记的生成区:笔记正文由主站
 * lib/export-obsidian.ts 一处定义(「单一事实源」),插件不往生成区里塞东西;
 * 而且 Spaced Repetition 插件会把复习进度以 `<!--SR:!2026-09-20,3,250-->`
 * 追加在卡片后面 —— 那是长在用户文件里的状态,绝不能被「刷新笔记」覆盖掉。
 *
 * 卡片格式是 st3v3nmw/obsidian-spaced-repetition 的**多行 basic**:正面、单独
 * 一行 `?`、背面,空行结束一张卡。选的是多行而不是单行 `::`,因为解析(带时间戳
 * 链接)经常比一行长。deck 用 Obsidian 的层级标签,标签行对其后所有卡片生效。
 *
 * 合并策略是**只追加、不删除**:已经在文件里的题按题干跳过(连同它的 SR 注释和
 * 用户自己的改动一起原样留下),只补新题。用户手写的卡片也因此安全。
 */

import type { QuizQuestion } from "./types";
import { watchPath } from "./video";

export const FLASHCARD_SUFFIX = "Flashcards";

export interface FlashcardInput {
  videoId: string;
  title: string;
  channel?: string;
  /** 视频笔记的文件名(不含扩展名),用来在卡片笔记顶部放一条 [[反链]] */
  noteName?: string;
  /** 视频笔记 frontmatter 里的 source(原平台链接);没有就只写 workspace */
  sourceUrl?: string;
  /** deck 标签,默认 #flashcards;层级标签(#flashcards/videos)会变成子 deck */
  tag: string;
  siteUrl: string;
  questions: QuizQuestion[];
  /** 落进 frontmatter.created,测试里传固定值 */
  now?: Date;
}

/** 卡片正面/背面里的 `::` 会被 SR 当成单行卡片的分隔符,躲开它(渲染出来还是 `::`) */
function escapeSeparators(text: string): string {
  return text.replace(/:{2,}/g, (m) => `:${"&#58;".repeat(m.length - 1)}`);
}

/**
 * 一张多行卡片以空行结束,所以正面和背面内部都不能有空行;
 * 单独成行的 `?` / `??` 也会被当成分隔符,缩进一格躲开。
 */
function oneBlock(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => (/^\?{1,2}$/.test(l) ? ` ${l}` : l))
    .join("\n")
    .trim();
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function stamp(siteUrl: string, videoId: string, ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `[${formatTime(ms)}](${siteUrl.replace(/\/+$/, "")}${watchPath(videoId)}?t=${seconds})`;
}

function yamlStr(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 一道四选一 → 一张卡片的文本(不含前后空行)。选项不写进正面,否则等于给出答案。 */
export function cardOf(q: QuizQuestion, siteUrl: string, videoId: string): string | null {
  const question = oneBlock(escapeSeparators(q.question ?? ""));
  const answer = q.options?.[q.answer];
  if (!question || !answer) return null;
  const back = [`**${oneBlock(escapeSeparators(answer))}**`];
  const explanation = oneBlock(escapeSeparators(q.explanation ?? ""));
  if (explanation) back.push(explanation);
  back.push(stamp(siteUrl, videoId, q.timeMs ?? 0));
  return [question, "?", ...back].join("\n");
}

/**
 * 整张卡片笔记。frontmatter 用 `svt_flashcards` 存 videoId,**不能用 `video_id`** ——
 * 那个键是「这是一篇视频笔记」的判据(Refresh video note 的守卫、对话侧栏的绑定),
 * 卡片笔记顶着它会被当成视频笔记刷新,然后因为没有 svt 标记而失败。
 */
export function buildFlashcardNote(input: FlashcardInput): { markdown: string; cards: number } {
  const cards = input.questions.map((q) => cardOf(q, input.siteUrl, input.videoId)).filter((c): c is string => !!c);
  const heading = `${input.title} - ${FLASHCARD_SUFFIX}`;
  // 键名和顺序跟着视频笔记走(主站 export-obsidian.ts):source 是原平台链接,
  // workspace 是主站的 watch 页
  const fm = ["---", `title: ${yamlStr(heading)}`];
  if (input.sourceUrl) fm.push(`source: ${yamlStr(input.sourceUrl)}`);
  fm.push(`workspace: ${yamlStr(`${input.siteUrl.replace(/\/+$/, "")}${watchPath(input.videoId)}`)}`);
  fm.push(`svt_flashcards: ${yamlStr(input.videoId)}`);
  if (input.channel) fm.push(`channel: ${yamlStr(input.channel)}`);
  fm.push(
    `created: ${(input.now ?? new Date()).toISOString()}`,
    "generator: obsidian-summarize-video-to-text",
    "---",
  );

  const head: string[] = [`# ${heading}`, ""];
  if (input.noteName) head.push(`[[${input.noteName}]]`, "");
  head.push(input.tag, "");

  return {
    markdown: [...fm, "", ...head, ...cards.flatMap((c) => [c, ""])].join("\n"),
    cards: cards.length,
  };
}

/** 卡片的题干 = 第一行去掉行首的 deck 标签(SR 允许卡片自带题目专属标签) */
function questionKey(line: string): string {
  return line
    .replace(/^(?:#[\w/-]+\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 文件里已有的题干集合:任何后面跟着单独一行 `?` / `??` 的行都算 */
function existingQuestions(md: string): Set<string> {
  const lines = md.split("\n");
  const out = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*\?{1,2}\s*$/.test(lines[i])) continue;
    // 多行卡片的正面可能有好几行,取紧挨着 `?` 往上直到空行的第一行
    let start = i - 1;
    while (start > 0 && lines[start - 1].trim() !== "") start--;
    const key = questionKey(lines[start]);
    if (key) out.add(key);
  }
  // 单行 `Q::A` 也认一下:用户可能把某张卡改成了单行格式,别因此重复追加
  for (const line of lines) {
    const m = /^(?!>)(.+?):{2,3}(?!#)/.exec(line);
    if (m) out.add(questionKey(m[1]));
  }
  return out;
}

export interface MergeResult {
  content: string;
  added: number;
  skipped: number;
}

/**
 * 把 fresh 里 existing 还没有的卡片追加到文件末尾。**不改动 existing 的任何一行** ——
 * 复习进度(`<!--SR:…-->`)、用户改过的措辞、手写的卡片都原样保留。
 */
export function mergeFlashcardNote(existing: string, fresh: string): MergeResult {
  const have = existingQuestions(existing);
  const blocks = fresh
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => /\n\?{1,2}\n/.test(b));
  const fresh1: string[] = [];
  let skipped = 0;
  for (const b of blocks) {
    const key = questionKey(b.split("\n")[0]);
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    fresh1.push(b);
  }
  if (!fresh1.length) return { content: existing, added: 0, skipped };
  const body = existing.replace(/\s+$/, "");
  return { content: [body, "", ...fresh1.flatMap((c) => [c, ""])].join("\n"), added: fresh1.length, skipped };
}
