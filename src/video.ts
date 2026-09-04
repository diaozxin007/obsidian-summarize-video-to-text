/**
 * 嵌入播放器相关的纯函数(2026-09-04),不 import obsidian,vitest 直接测。
 *
 * 笔记里 YouTube 视频写成一个 ```svt-video 代码块(见 videoBlock),插件把它渲染成
 * 播放器(player.ts)。时间戳仍然是普通的 youtube.com 外链 —— 笔记拷到别处照样能点;
 * 在 Obsidian 里插件拦截点击,同一页有这个视频的播放器就原地跳秒。
 */

export const VIDEO_BLOCK_LANG = "svt-video";

export interface YoutubeLink {
  videoId: string;
  /** 链接里的 t 参数换算成秒;没有则 null */
  seconds: number | null;
}

/** 认 watch?v=、youtu.be/、/embed/、/shorts/ 四种写法;t 支持 90 / 90s / 1m30s / 1h2m3s */
export function parseYoutubeLink(href: string): YoutubeLink | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) id = m[1];
    }
  } else if (host === "youtu.be") {
    const m = /^\/([\w-]{11})/.exec(u.pathname);
    if (m) id = m[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = u.searchParams.get("t") ?? u.searchParams.get("start");
  return { videoId: id, seconds: t === null ? null : parseTimeParam(t) };
}

export function parseTimeParam(t: string): number | null {
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || m[0] === "") return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export interface VideoBlock {
  id: string;
  title?: string;
}

/** 代码块内容是几行 `key: value`;只认 id(必填)和 title */
export function parseVideoBlock(source: string): VideoBlock | null {
  const out: Partial<VideoBlock> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key === "id" && /^[\w-]{11}$/.test(value)) out.id = value;
    else if (key === "title" && value) out.title = value;
  }
  return out.id ? (out as VideoBlock) : null;
}

export function videoBlock(videoId: string, title?: string): string {
  const lines = ["```" + VIDEO_BLOCK_LANG, `id: ${videoId}`];
  if (title) lines.push(`title: ${title.replace(/\r?\n/g, " ")}`);
  lines.push("```");
  return lines.join("\n");
}

export function embedUrl(videoId: string): string {
  // enablejsapi=1 让 iframe 接受 postMessage 指令(seekTo / playVideo),不用加载
  // youtube.com/iframe_api 那个远程脚本
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0`;
}
