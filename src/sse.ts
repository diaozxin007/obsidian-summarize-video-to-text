/**
 * 解析主站 /api/summarize 的 SSE 整体文本(2026-09-04)。
 *
 * Obsidian 的 requestUrl 不支持流式读 —— 响应是一次性回来的整段 text/event-stream。
 * 所以这里不做增量解析,拿到全文后按空行切帧,把 `event: delta` 的 text 拼起来,
 * 遇到 `event: error` 直接抛。帧格式见主站 src/app/api/summarize/route.ts 头注释。
 */

export interface SseFrame {
  event: string;
  data: string;
}

export function parseSse(raw: string): SseFrame[] {
  const frames: SseFrame[] = [];
  // 兼容 \r\n;帧之间是空行
  for (const block of raw.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // 注释/心跳
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const field = line.slice(0, idx);
      // 规范:冒号后第一个空格要去掉
      const value = line.slice(idx + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) frames.push({ event, data: data.join("\n") });
  }
  return frames;
}

export class SseError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SseError";
  }
}

/** 把整段 SSE 里的 delta 拼成摘要正文;服务端报 error 帧则抛 SseError。 */
export function collectSummary(raw: string): string {
  let out = "";
  for (const f of parseSse(raw)) {
    if (f.event === "delta") {
      try {
        const j = JSON.parse(f.data) as { text?: string };
        if (typeof j.text === "string") out += j.text;
      } catch {
        // 单帧坏了跳过,不让整篇摘要丢掉
      }
    } else if (f.event === "error") {
      let code = "upstream_error";
      let message = "Summary failed";
      try {
        const j = JSON.parse(f.data) as { code?: string; message?: string };
        code = j.code ?? code;
        message = j.message ?? message;
      } catch {
        /* 用默认值 */
      }
      throw new SseError(code, message);
    }
  }
  return out.trim();
}
