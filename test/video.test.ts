import { describe, expect, it } from "vitest";
import { parseTimeParam, parseVideoBlock, parseYoutubeLink, videoBlock } from "../src/video";
import { linkAtLinePos } from "../src/player";

describe("parseYoutubeLink", () => {
  it("reads id and seconds from the note's timestamp links", () => {
    expect(parseYoutubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toEqual({
      videoId: "dQw4w9WgXcQ",
      seconds: 12,
    });
  });
  it("accepts other YouTube URL shapes and time formats", () => {
    expect(parseYoutubeLink("https://youtu.be/dQw4w9WgXcQ?t=90")).toEqual({ videoId: "dQw4w9WgXcQ", seconds: 90 });
    expect(parseYoutubeLink("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s")?.seconds).toBe(3723);
    expect(parseYoutubeLink("https://www.youtube.com/embed/dQw4w9WgXcQ?start=5")?.seconds).toBe(5);
    expect(parseYoutubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.seconds).toBeNull();
  });
  it("rejects non-YouTube links", () => {
    expect(parseYoutubeLink("https://www.tiktok.com/@a/video/1?t=3")).toBeNull();
    expect(parseYoutubeLink("not a url")).toBeNull();
    expect(parseTimeParam("abc")).toBeNull();
  });
});

describe("video block", () => {
  it("round-trips through the markdown block", () => {
    const md = videoBlock("dQw4w9WgXcQ", "Say \"hi\"\nsecond line");
    expect(md).toBe('```svt-video\nid: dQw4w9WgXcQ\ntitle: Say "hi" second line\n```');
    expect(parseVideoBlock(md.split("\n").slice(1, -1).join("\n"))).toEqual({
      id: "dQw4w9WgXcQ",
      title: 'Say "hi" second line',
    });
  });
  it("rejects blocks without a valid id", () => {
    expect(parseVideoBlock("title: x")).toBeNull();
    expect(parseVideoBlock("id: too-short")).toBeNull();
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
