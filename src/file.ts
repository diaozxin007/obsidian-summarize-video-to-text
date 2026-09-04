/**
 * 文件名与「刷新笔记」的合并(2026-09-04),纯函数,不 import obsidian。
 *
 * 笔记正文由主站 /api/export/obsidian 生成(主站 lib/export-obsidian.ts),插件只负责
 * 落盘。刷新时只换 frontmatter 里我们的键和 %% svt:start %% … %% svt:end %% 之间的
 * 生成区,用户自己写的东西(标记外的正文、自己加的 frontmatter 键、created)都保留。
 */

export const SVT_START = "%% svt:start %%";
export const SVT_END = "%% svt:end %%";

/** 主站 export-obsidian.ts 的 OWNED_FM_KEYS,两边要一致 */
const OWNED_FM_KEYS = new Set([
  "title", "source", "workspace", "video_id", "platform", "channel", "lang", "tags",
  "updated", "quiz_best", "quiz_attempts", "generator",
]);

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

interface FmEntry {
  key: string;
  /** 这一键的全部行(含续行,如 tags 的 `  - x`) */
  lines: string[];
}

interface Split {
  fm: FmEntry[] | null;
  body: string;
}

/** 只认最简单的 frontmatter:顶部 `---` … `---`,键是 `key:` 开头,缩进行归上一键 */
function split(md: string): Split {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { fm: null, body: md };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { fm: null, body: md };
  const fm: FmEntry[] = [];
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+):/.exec(line);
    if (m) fm.push({ key: m[1], lines: [line] });
    else if (fm.length) fm[fm.length - 1].lines.push(line);
  }
  return { fm, body: lines.slice(end + 1).join("\n") };
}

function joinFm(fm: FmEntry[]): string {
  return ["---", ...fm.flatMap((e) => e.lines), "---"].join("\n");
}

/** 笔记里的 video_id(frontmatter),没有返回 null */
export function videoIdOf(md: string): string | null {
  const { fm } = split(md);
  const e = fm?.find((x) => x.key === "video_id");
  const m = e && /^video_id:\s*"?([\w-]+)"?\s*$/.exec(e.lines[0]);
  return m ? m[1] : null;
}

/** 生成区里的「## Summary」段(到下一个二级标题为止),刷新时回传给主站免得丢 */
export function summaryOf(md: string, headings = ["Summary", "摘要"]): string | null {
  const gen = between(md);
  if (!gen) return null;
  const re = new RegExp(`^## (?:${headings.join("|")})\\n([\\s\\S]*?)(?=^## |^%% svt:end %%|(?![\\s\\S]))`, "m");
  const m = re.exec(gen);
  return m ? m[1].trim() : null;
}

function between(md: string): string | null {
  const a = md.indexOf(SVT_START);
  const b = md.indexOf(SVT_END);
  if (a < 0 || b < 0 || b < a) return null;
  return md.slice(a + SVT_START.length, b);
}

/**
 * 把 fresh(主站刚生成的完整笔记)合进 existing。找不到标记返回 null。
 */
export function mergeNote(existing: string, fresh: string): string | null {
  const ex = split(existing);
  const fr = split(fresh);
  const exGen = between(ex.body);
  const frGen = between(fr.body);
  if (exGen === null || frGen === null) return null;

  // frontmatter:我们的键用新的,用户的键原样保留,新增的键排在末尾
  let fm: FmEntry[] | null = null;
  if (fr.fm) {
    const freshMap = new Map(fr.fm.map((e) => [e.key, e]));
    fm = (ex.fm ?? []).map((e) => (OWNED_FM_KEYS.has(e.key) && freshMap.has(e.key) ? freshMap.get(e.key)! : e));
    const have = new Set(fm.map((e) => e.key));
    for (const e of fr.fm) {
      if (!have.has(e.key) && (OWNED_FM_KEYS.has(e.key) || e.key === "created")) fm.push(e);
    }
    // 用户 frontmatter 里我们已不再输出的键(例如这次没有 quiz_best)删掉,免得留旧值
    fm = fm.filter((e) => !OWNED_FM_KEYS.has(e.key) || freshMap.has(e.key));
  }

  const a = ex.body.indexOf(SVT_START);
  const b = ex.body.indexOf(SVT_END) + SVT_END.length;
  const body = ex.body.slice(0, a) + SVT_START + frGen + SVT_END + ex.body.slice(b);
  return (fm ? joinFm(fm) + "\n" : "") + body.replace(/^\n(?=\n)/, "");
}
