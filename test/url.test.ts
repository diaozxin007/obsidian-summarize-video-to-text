import { describe, expect, it } from "vitest";
import { extractUrl, urlAtColumn } from "../src/url";

describe("extractUrl", () => {
  it("takes the first http link out of arbitrary text", () => {
    expect(extractUrl("see https://youtu.be/dQw4w9WgXcQ and more")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(extractUrl("[t](https://www.youtube.com/watch?v=dQw4w9WgXcQ)")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(extractUrl("no link")).toBe("");
    expect(extractUrl(null)).toBe("");
  });
});

describe("urlAtColumn", () => {
  const line = "watch https://www.tiktok.com/@a/video/123 then https://a.b/c";
  it("returns the link under the column", () => {
    expect(urlAtColumn(line, 10)).toBe("https://www.tiktok.com/@a/video/123");
    expect(urlAtColumn(line, line.length)).toBe("https://a.b/c");
  });
  it("returns empty outside links", () => {
    expect(urlAtColumn(line, 2)).toBe("");
  });
});
