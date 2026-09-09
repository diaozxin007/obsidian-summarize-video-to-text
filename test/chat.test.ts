import { describe, expect, it } from "vitest";
import { chatContextFromNote, formatQaForNote } from "../src/chat";

const NOTE = `---
title: "Demo | Video"
video_id: "abcdefghijk"
lang: en
---

%% svt:start %%

# Demo | Video

[Open on summarizevideototext.com](https://summarizevideototext.com/watch/abcdefghijk) · [Source](https://youtu.be/abcdefghijk)

\`\`\`svt-video
id: abcdefghijk
\`\`\`

> [!summary] TL;DR
> Short gist here.

## Key insights

- **First** detail one
- **Second** detail two

## Chapters

### [00:04](https://www.youtube.com/watch?v=abcdefghijk&t=4s) Intro

- [00:04](https://www.youtube.com/watch?v=abcdefghijk&t=4s) Point A

## Summary

### Part

- summary line

## Diagram

\`\`\`mermaid
graph TD; A-->B
\`\`\`

## Transcript (2 lines)

- [00:01](https://x) secret transcript line
- [00:02](https://x) another

%% svt:end %%

## My notes

user scribbles
`;

describe("chatContextFromNote", () => {
  const ctx = chatContextFromNote(NOTE, "Demo | Video");
  it("keeps gist, insights, chapters and summary", () => {
    expect(ctx).toContain("Video: Demo | Video");
    expect(ctx).toContain("Short gist here.");
    expect(ctx).toContain("**First** detail one");
    expect(ctx).toContain("### 00:04 Intro");
    expect(ctx).toContain("- summary line");
  });
  it("drops transcript, fences, notes, links and markers", () => {
    expect(ctx).not.toContain("secret transcript");
    expect(ctx).not.toContain("mermaid");
    expect(ctx).not.toContain("svt-video");
    expect(ctx).not.toContain("user scribbles");
    expect(ctx).not.toContain("https://");
    expect(ctx).not.toContain("%%");
    expect(ctx).not.toContain("Open on");
  });
  it("handles Chinese labels and notes without markers", () => {
    const zh = "## 关键洞见\n- a\n\n## 字幕全文(3 段)\n- 不要\n\n## 章节\n- b\n\n## 我的笔记\n私货";
    const c = chatContextFromNote(zh);
    expect(c).toContain("- a");
    expect(c).toContain("- b");
    expect(c).not.toContain("不要");
    expect(c).not.toContain("私货");
  });
  it("caps length", () => {
    expect(chatContextFromNote("x".repeat(20000)).length).toBeLessThanOrEqual(12000);
  });
});

describe("formatQaForNote", () => {
  it("prefixes the question", () => {
    expect(formatQaForNote(" why? ", "because\n")).toBe("**Q:** why?\n\nbecause");
    expect(formatQaForNote("", "just answer")).toBe("just answer");
  });
});
