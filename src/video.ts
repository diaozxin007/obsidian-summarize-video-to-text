/**
 * 嵌入播放器相关的纯函数(2026-09-04),不 import obsidian,vitest 直接测。
 *
 * 笔记里的视频写成一个 ```svt-video 代码块(见 videoBlock),插件把它渲染成播放器
 * (player.ts)。时间戳仍然是普通外链 —— 笔记拷到别处照样能点;在 Obsidian 里插件
 * 拦截点击,同一页有这个视频的播放器就原地跳秒。
 *
 * 平台差异:
 *   YouTube  watch?v=ID&t=NNs,浏览器里也能跳秒;嵌入走 /embed/ID?enablejsapi=1,
 *            指令是 JSON 字符串(IFrame API 底层协议)。
 *   TikTok   分享链接没有跳秒参数,自定义 ?t=NN(浏览器里点开只是从头播);嵌入走
 *            官方 player/v1/ID,指令是对象 {"x-tiktok-player":true,type,value}。
 *   Instagram / 上传文件:没有可控的嵌入播放器,不做。
 */

import type { Platform } from "./types";

export const VIDEO_BLOCK_LANG = "svt-video";

/** 主站 compositeId 规则:tt-/ig-/up- 前缀,其余是 YouTube 11 位 id */
export function platformOf(videoId: string): Platform {
  if (videoId.startsWith("tt-")) return "tiktok";
  if (videoId.startsWith("ig-")) return "instagram";
  if (videoId.startsWith("up-")) return "upload";
  if (/^[\w-]{11}$/.test(videoId)) return "youtube";
  return "other";
}

/** 能嵌入且能跳秒的平台 */
export function canEmbed(platform: Platform): boolean {
  return platform === "youtube" || platform === "tiktok";
}

export interface VideoLink {
  platform: "youtube" | "tiktok";
  /** 主站 compositeId:YouTube 11 位 / tt-数字 */
  videoId: string;
  /** 链接里的 t 参数换算成秒;没有则 null */
  seconds: number | null;
}

/**
 * YouTube 认 watch?v=、youtu.be/、/embed/、/shorts/;t 支持 90 / 90s / 1m30s / 1h2m3s。
 * TikTok 认 /@user/video/ID 和 /video/ID;t 只认秒数。
 */
export function parseVideoLink(href: string): VideoLink | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const t = u.searchParams.get("t") ?? u.searchParams.get("start");

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = /^\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return { platform: "youtube", videoId: id, seconds: t === null ? null : parseTimeParam(t) };
  }

  if (host === "tiktok.com") {
    const id = /^\/(?:@[^/]+\/)?video\/(\d{5,25})/.exec(u.pathname)?.[1];
    if (!id) return null;
    return { platform: "tiktok", videoId: `tt-${id}`, seconds: t === null ? null : parseTimeParam(t) };
  }
  return null;
}

export function parseTimeParam(t: string): number | null {
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || m[0] === "") return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * 时间戳链接的目标地址。TikTok 优先沿用用户给的 /@user/video/ID 链接(带真实用户名);
 * 短链或移动端链接拿不到用户名,用 @tiktok 占位,TikTok 会 302 到正确的用户。
 */
export function watchUrl(platform: Platform, videoId: string, sourceUrl?: string): string | null {
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${videoId}`;
  if (platform === "tiktok") {
    const id = videoId.slice(3);
    const m = sourceUrl ? /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.\-]+\/video\/\d+/.exec(sourceUrl) : null;
    return m ? m[0] : `https://www.tiktok.com/@tiktok/video/${id}`;
  }
  return null;
}

export function timestampUrl(platform: Platform, videoId: string, seconds: number, sourceUrl?: string): string | null {
  const base = watchUrl(platform, videoId, sourceUrl);
  if (!base) return null;
  return platform === "youtube" ? `${base}&t=${seconds}s` : `${base}?t=${seconds}`;
}

export interface VideoBlock {
  id: string;
  platform: "youtube" | "tiktok";
  title?: string;
}

/** 代码块内容是几行 `key: value`;只认 id(必填,compositeId)和 title,平台由 id 推出 */
export function parseVideoBlock(source: string): VideoBlock | null {
  const out: { id?: string; title?: string } = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key === "id" && (/^[\w-]{11}$/.test(value) || /^tt-\d{5,25}$/.test(value))) out.id = value;
    else if (key === "title" && value) out.title = value;
  }
  if (!out.id) return null;
  const platform = platformOf(out.id);
  if (platform !== "youtube" && platform !== "tiktok") return null;
  return { id: out.id, platform, title: out.title };
}

export function videoBlock(videoId: string, title?: string): string {
  const lines = ["```" + VIDEO_BLOCK_LANG, `id: ${videoId}`];
  if (title) lines.push(`title: ${title.replace(/\r?\n/g, " ")}`);
  lines.push("```");
  return lines.join("\n");
}

export function embedUrl(block: VideoBlock): string {
  if (block.platform === "tiktok") {
    // 官方嵌入播放器(developers.tiktok.com → Embed Player),支持 postMessage 控制
    const p = new URLSearchParams({
      controls: "1", progress_bar: "1", play_button: "1", volume_control: "1",
      fullscreen_button: "1", timestamp: "1", loop: "0", autoplay: "0",
      music_info: "0", description: "0", rel: "0", closed_caption: "1",
    });
    return `https://www.tiktok.com/player/v1/${block.id.slice(3)}?${p.toString()}`;
  }
  // enablejsapi=1 让 iframe 接受 postMessage 指令(seekTo / playVideo),不用加载
  // youtube.com/iframe_api 那个远程脚本
  return `https://www.youtube.com/embed/${block.id}?enablejsapi=1&rel=0`;
}
