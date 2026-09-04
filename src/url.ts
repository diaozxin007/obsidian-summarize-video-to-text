/** 从文本里挑链接的纯函数(2026-09-04),不 import obsidian,vitest 直接测。 */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** 文本里第一个 http(s) 链接;没有返回空串 */
export function extractUrl(text: string | null | undefined): string {
  URL_RE.lastIndex = 0;
  return text?.match(URL_RE)?.[0] ?? "";
}

/** 一行文本里覆盖第 col 列的 URL(右键菜单/光标下的链接用) */
export function urlAtColumn(lineText: string, col: number): string {
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(lineText))) {
    if (col >= m.index && col <= m.index + m[0].length) return m[0];
  }
  return "";
}
