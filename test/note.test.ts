import { describe, expect, it } from "vitest";
import { buildNote, formatTime, platformOf, safeFileName, timestampLink, toTag } from "../src/note";
import type { VideoAnalysis } from "../src/types";

const analysis: VideoAnalysis = {
  videoId: "dQw4w9WgXcQ",
  overview: {
    tags: ["Machine Learning", "#AI", "deep/learning"],
    tldr: "Line one.\n\nLine two.",
    keyInsights: [{ title: "Insight A", detail: "Detail A" }],
  },
  chapters: [
    {
      startMs: 0,
      endMs: 65000,
      title: "Intro",
      points: [{ timeMs: 12000, text: "Hello" }],
    },
    {
      startMs: 3725000,
      endMs: 3800000,
      title: "Late chapter",
      points: [],
    },
  ],
  diagram: { type: "flowchart", code: "graph TD; A-->B" },
};

describe("helpers", () => {
  it("formats time with hours only when needed", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65000)).toBe("01:05");
    expect(formatTime(3725000)).toBe("1:02:05");
  });

  it("detects platform from composite id", () => {
    expect(platformOf("dQw4w9WgXcQ")).toBe("youtube");
    expect(platformOf("tt-123")).toBe("tiktok");
    expect(platformOf("ig-abc")).toBe("instagram");
    expect(platformOf("up-xyz")).toBe("upload");
  });

  it("links YouTube timestamps to the second, plain text elsewhere", () => {
    expect(timestampLink("youtube", "dQw4w9WgXcQ", 12000)).toBe(
      "[00:12](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s)",
    );
    expect(timestampLink("tiktok", "tt-1", 12000)).toBe("00:12");
  });

  it("sanitizes file names and tags", () => {
    expect(safeFileName('How to: "win" <fast>? #1 [guide]')).toBe("How to win fast 1 guide");
    expect(safeFileName("   ")).toBe("video");
    expect(safeFileName("x".repeat(300)).length).toBe(100);
    expect(toTag("Machine Learning")).toBe("machine-learning");
    expect(toTag("#AI")).toBe("ai");
    expect(toTag("deep/learning")).toBe("deep-learning");
  });
});

describe("buildNote", () => {
  const base = {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
    analysis,
    lang: "en",
    createdAt: new Date("2026-09-04T00:00:00Z"),
  };

  it("writes frontmatter, callouts, chapters with links", () => {
    const md = buildNote({ ...base, title: 'Say "hi"', channel: "Chan", thumbnail: "https://i/1.jpg" });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Say \\"hi\\""');
    expect(md).toContain("platform: youtube");
    expect(md).toContain("tags:\n  - machine-learning\n  - ai\n  - deep-learning");
    expect(md).toContain("created: 2026-09-04T00:00:00.000Z");
    expect(md).toContain('# Say "hi"');
    expect(md).toContain("![thumbnail](https://i/1.jpg)");
    // 多段 TL;DR 每行都要带引用符,空行是 ">"
    expect(md).toContain("> [!summary] TL;DR\n> Line one.\n>\n> Line two.");
    expect(md).toContain("- **Insight A** Detail A");
    expect(md).toContain("### [00:00](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0s) Intro");
    expect(md).toContain("- [00:12](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s) Hello");
    expect(md).toContain("### [1:02:05](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3725s) Late chapter");
    expect(md).not.toContain("\n\n\n");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("embeds a player block instead of the thumbnail when asked (YouTube only)", () => {
    const md = buildNote({ ...base, title: "T", thumbnail: "https://i/1.jpg", embedPlayer: true });
    expect(md).toContain("[Open video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n```svt-video\nid: dQw4w9WgXcQ\ntitle: T\n```");
    expect(md).not.toContain("![thumbnail]");
    const tt = buildNote({
      ...base,
      url: "https://www.tiktok.com/@a/video/1",
      videoId: "tt-1",
      analysis: { ...analysis, videoId: "tt-1" },
      thumbnail: "https://i/2.jpg",
      embedPlayer: true,
    });
    expect(tt).not.toContain("svt-video");
    expect(tt).toContain("![thumbnail](https://i/2.jpg)");
  });

  it("falls back to the video id as title", () => {
    const md = buildNote(base);
    expect(md).toContain("# Video dQw4w9WgXcQ");
    expect(md).not.toContain("channel:");
    expect(md).not.toContain("![thumbnail]");
  });

  it("only embeds the diagram when the server validated it", () => {
    expect(buildNote(base)).not.toContain("```mermaid");
    const withSvg = { ...analysis, diagram: { ...analysis.diagram!, svg: "<svg/>" } };
    expect(buildNote({ ...base, analysis: withSvg })).toContain("## Diagram\n\n```mermaid\ngraph TD; A-->B\n```");
  });

  it("adds optional summary, quiz and transcript sections", () => {
    const md = buildNote({
      ...base,
      summary: { template: "bullet_summary", text: "- point 1\n- point 2\n" },
      quiz: [
        {
          question: "What?",
          options: ["x", "y", "z"],
          answer: 1,
          explanation: "Because y.",
          timeMs: 5000,
        },
      ],
      transcript: { text: "[00:00] hi\n[00:05] there", lang: "en" },
    });
    expect(md).toContain("## Summary\n\n- point 1\n- point 2\n");
    expect(md).toContain("1. What? [00:05](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s)");
    expect(md).toContain("   - A. x\n   - B. y\n   - C. z");
    expect(md).toContain("   > [!success]- Answer\n   > **B.** Because y.");
    expect(md).toContain("> [!note]- Transcript (en)\n> [00:00] hi\n> [00:05] there");
    // 顺序:Summary 在 Chapters 后、Quiz 前;Transcript 最后
    expect(md.indexOf("## Chapters")).toBeLessThan(md.indexOf("## Summary"));
    expect(md.indexOf("## Summary")).toBeLessThan(md.indexOf("## Quiz"));
    expect(md.indexOf("## Quiz")).toBeLessThan(md.indexOf("Transcript (en)"));
  });

  it("uses plain timestamps for non-YouTube platforms", () => {
    const md = buildNote({
      ...base,
      url: "https://www.tiktok.com/@a/video/1",
      videoId: "tt-1",
      analysis: { ...analysis, videoId: "tt-1" },
    });
    expect(md).toContain("platform: tiktok");
    expect(md).toContain("### 00:00 Intro");
    expect(md).not.toContain("youtube.com/watch");
  });
});
