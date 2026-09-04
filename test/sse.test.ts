import { describe, expect, it } from "vitest";
import { collectSummary, parseSse, SseError } from "../src/sse";

const stream = [
  "event: status",
  'data: {"phase":"transcript"}',
  "",
  "event: meta",
  'data: {"lang":"en","videoId":"abc"}',
  "",
  "event: delta",
  'data: {"text":"Hello, "}',
  "",
  ": keep-alive",
  "",
  "event: delta",
  'data: {"text":"world.\\n"}',
  "",
  "event: done",
  "data: {}",
  "",
].join("\n");

describe("parseSse", () => {
  it("splits frames and keeps event names", () => {
    const frames = parseSse(stream);
    expect(frames.map((f) => f.event)).toEqual(["status", "meta", "delta", "delta", "done"]);
    expect(frames[2].data).toBe('{"text":"Hello, "}');
  });

  it("handles CRLF line endings", () => {
    const frames = parseSse(stream.replace(/\n/g, "\r\n"));
    expect(frames).toHaveLength(5);
  });

  it("joins multi-line data", () => {
    const frames = parseSse("event: x\ndata: a\ndata: b\n\n");
    expect(frames[0].data).toBe("a\nb");
  });
});

describe("collectSummary", () => {
  it("concatenates delta text", () => {
    expect(collectSummary(stream)).toBe("Hello, world.");
  });

  it("throws on an error frame with the server's code", () => {
    const bad = stream + '\nevent: error\ndata: {"code":"rate_limited","message":"Daily limit"}\n\n';
    expect(() => collectSummary(bad)).toThrowError(SseError);
    try {
      collectSummary(bad);
    } catch (e) {
      expect((e as SseError).code).toBe("rate_limited");
      expect((e as SseError).message).toBe("Daily limit");
    }
  });

  it("skips a malformed delta instead of failing", () => {
    expect(collectSummary("event: delta\ndata: {oops\n\nevent: delta\ndata: {\"text\":\"ok\"}\n\n")).toBe("ok");
  });
});
