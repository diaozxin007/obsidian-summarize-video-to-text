/**
 * 嵌入播放器(2026-09-04)。
 *
 * 渲染:```svt-video 代码块 → <div class="svt-video"><iframe …></iframe></div>,
 * 阅读模式和实时预览都走 registerMarkdownCodeBlockProcessor。
 *
 * 跳秒:时间戳是普通外链(YouTube 带 t=NNs,TikTok 带自定义 ?t=NN)。两处拦截 ——
 *   1. 阅读模式:document 捕获阶段的 click,命中 <a href="…youtube…&t=…"> 就找同一个
 *      leaf 里对应 videoId 的 iframe;
 *   2. 实时预览:链接不是 <a>,用 CodeMirror 的 domEventHandlers 拿到点击位置,
 *      从该行文本里把 [label](url) 挖出来。
 * 找到播放器就 postMessage seekTo + playVideo 并拦下事件;找不到放行,照旧开浏览器。
 *
 * YouTube 的 postMessage 协议就是 IFrame API 底层用的那套:先发 {event:"listening"}
 * 播放器才开始收指令,所以 iframe onload 和每次跳秒前都发一次,多发无害。
 * TikTok 的是对象消息 {"x-tiktok-player":true, type:"seekTo"|"play", value},不用握手。
 */

import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { embedUrl, parseVideoBlock, parseVideoLink } from "./video";

const DATA_ATTR = "data-svt-video";

export function renderVideoBlock(source: string, el: HTMLElement): void {
  const block = parseVideoBlock(source);
  if (!block) {
    el.createEl("pre", { text: "svt-video: missing or invalid `id: <youtube id>`" });
    return;
  }
  const wrap = el.createDiv({ cls: ["svt-video", `svt-video-${block.platform}`] });
  const iframe = wrap.createEl("iframe");
  iframe.src = embedUrl(block);
  iframe.setAttribute(DATA_ATTR, block.id);
  iframe.setAttribute("data-svt-platform", block.platform);
  iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("loading", "lazy");
  if (block.title) iframe.title = block.title;
  if (block.platform === "youtube") iframe.addEventListener("load", () => listen(iframe));
}

/** YouTube 收 JSON 字符串;TikTok 收对象 */
function post(iframe: HTMLIFrameElement, msg: Record<string, unknown>, asString = true): void {
  iframe.contentWindow?.postMessage(asString ? JSON.stringify(msg) : msg, "*");
}

function listen(iframe: HTMLIFrameElement): void {
  post(iframe, { event: "listening", id: 1, channel: "widget" });
}

function seek(iframe: HTMLIFrameElement, seconds: number): void {
  if (iframe.getAttribute("data-svt-platform") === "tiktok") {
    post(iframe, { "x-tiktok-player": true, type: "seekTo", value: seconds }, false);
    post(iframe, { "x-tiktok-player": true, type: "play" }, false);
    return;
  }
  listen(iframe);
  post(iframe, { event: "command", func: "seekTo", args: [seconds, true] });
  post(iframe, { event: "command", func: "playVideo", args: [] });
}

/** 从点击处向上找所在的 leaf(阅读模式和实时预览共用),没有就退到整个文档 */
function scopeOf(from: Element): ParentNode {
  return from.closest(".workspace-leaf-content") ?? from.closest(".popover") ?? document;
}

/** 同一范围内有该视频的播放器就跳秒并返回 true */
export function seekInScope(from: Element, videoId: string, seconds: number): boolean {
  const iframe = scopeOf(from).querySelector<HTMLIFrameElement>(`iframe[${DATA_ATTR}="${videoId}"]`);
  if (!iframe) return false;
  seek(iframe, seconds);
  iframe.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}

/** 阅读模式:挂在 document 捕获阶段 */
export function handleDocumentClick(e: MouseEvent): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!a) return;
  const link = parseVideoLink(a.getAttribute("href") ?? "");
  if (!link || link.seconds === null) return;
  if (seekInScope(a, link.videoId, link.seconds)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

const MD_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

/** 实时预览:点击位置落在哪个 [label](url) 里 */
export function linkAtLinePos(lineText: string, col: number): string | null {
  MD_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK.exec(lineText))) {
    if (col >= m.index && col <= m.index + m[0].length) return m[1];
  }
  return null;
}

export function editorClickExtension(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      click(e, view) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        const href = linkAtLinePos(line.text, pos - line.from);
        if (!href) return false;
        const link = parseVideoLink(href);
        if (!link || link.seconds === null) return false;
        if (!seekInScope(view.dom, link.videoId, link.seconds)) return false;
        e.preventDefault();
        return true;
      },
    }),
  );
}
