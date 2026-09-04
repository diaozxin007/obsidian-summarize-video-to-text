import { describe, expect, it } from "vitest";
import {
  embedUrl,
  parseTimeParam,
  parseVideoBlock,
  parseVideoLink,
  timestampUrl,
  videoBlock,
  watchPath,
  watchUrl,
} from "../src/video";
import { linkAtLinePos } from "../src/player";

describe("parseVideoLink", () => {
  it("reads YouTube id and seconds from the note's timestamp links", () => {
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toEqual({
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      seconds: 12,
    });
  });
  it("accepts other YouTube URL shapes and time formats", () => {
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=90")?.seconds).toBe(90);
    expect(parseVideoLink("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s")?.seconds).toBe(3723);
    expect(parseVideoLink("https://www.youtube.com/embed/dQw4w9WgXcQ?start=5")?.seconds).toBe(5);
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.seconds).toBeNull();
  });
  it("reads TikTok links with the plugin's ?t= parameter", () => {
    expect(parseVideoLink("https://www.tiktok.com/@scout2015/video/6718335390845095173?t=12")).toEqual({
      platform: "tiktok",
      videoId: "tt-6718335390845095173",
      seconds: 12,
    });
    expect(parseVideoLink("https://www.tiktok.com/video/6718335390845095173")?.seconds).toBeNull();
  });
  it("rejects other links", () => {
    expect(parseVideoLink("https://www.instagram.com/reel/C8CaBfWs1mr/?t=3")).toBeNull();
    expect(parseVideoLink("https://www.tiktok.com/@a")).toBeNull();
    expect(parseVideoLink("not a url")).toBeNull();
    expect(parseTimeParam("abc")).toBeNull();
  });
});

describe("watch / timestamp urls", () => {
  it("keeps the real TikTok handle when the source link has one", () => {
    const src = "https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1";
    expect(watchUrl("tiktok", "tt-6718335390845095173", src)).toBe(
      "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    );
    expect(timestampUrl("tiktok", "tt-6718335390845095173", 12, src)).toBe(
      "https://www.tiktok.com/@scout2015/video/6718335390845095173?t=12",
    );
  });
  it("falls back to a placeholder handle for short links", () => {
    expect(watchUrl("tiktok", "tt-123456", "https://vm.tiktok.com/ZMabc/")).toBe(
      "https://www.tiktok.com/@tiktok/video/123456",
    );
  });
  it("has no link for platforms without a seekable page", () => {
    expect(timestampUrl("instagram", "ig-abc", 5)).toBeNull();
    expect(timestampUrl("upload", "up-abc", 5)).toBeNull();
  });
});

describe("watchPath", () => {
  it("mirrors the site's per-platform watch routes", () => {
    expect(watchPath("dQw4w9WgXcQ")).toBe("/watch/dQw4w9WgXcQ");
    expect(watchPath("tt-123")).toBe("/watch/tt/123");
    expect(watchPath("ig-C8CaBfWs1mr")).toBe("/watch/ig/C8CaBfWs1mr");
    expect(watchPath("up-abc")).toBe("/watch/up/abc");
  });
});

describe("video block", () => {
  it("round-trips through the markdown block", () => {
    const md = videoBlock("dQw4w9WgXcQ", "Say \"hi\"\nsecond line");
    expect(md).toBe('```svt-video\nid: dQw4w9WgXcQ\ntitle: Say "hi" second line\n```');
    expect(parseVideoBlock(md.split("\n").slice(1, -1).join("\n"))).toEqual({
      id: "dQw4w9WgXcQ",
      platform: "youtube",
      title: 'Say "hi" second line',
    });
  });
  it("derives the platform from the composite id", () => {
    expect(parseVideoBlock("id: tt-6718335390845095173")).toEqual({
      id: "tt-6718335390845095173",
      platform: "tiktok",
      title: undefined,
    });
    expect(parseVideoBlock("id: ig-C8CaBfWs1mr")).toBeNull();
    expect(parseVideoBlock("title: x")).toBeNull();
    expect(parseVideoBlock("id: too-short")).toBeNull();
  });
  it("builds per-platform embed urls", () => {
    expect(embedUrl({ id: "dQw4w9WgXcQ", platform: "youtube" })).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&rel=0",
    );
    expect(embedUrl({ id: "tt-6718335390845095173", platform: "tiktok" })).toMatch(
      /^https:\/\/www\.tiktok\.com\/player\/v1\/6718335390845095173\?controls=1&/,
    );
  });
});

describe("linkAtLinePos", () => {
  const line = "- [00:12](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s) Hello [x](https://a.b/c)";
  it("finds the link covering the click column", () => {
    expect(linkAtLinePos(line, 4)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s");
    expect(linkAtLinePos(line, line.length - 2)).toBe("https://a.b/c");
  });
  it("returns null outside any link", () => {
    expect(linkAtLinePos(line, 0)).toBeNull();
    expect(linkAtLinePos(line, line.indexOf("Hello") + 1)).toBeNull();
  });
});
