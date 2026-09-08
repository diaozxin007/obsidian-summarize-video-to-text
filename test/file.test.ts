import { describe, expect, it } from "vitest";
import { mergeNote, OWNED_FM_KEYS, safeFileName, summaryOf, videoIdOf } from "../src/file";

const fresh = `---
title: "New title"
source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
workspace: "https://summarizevideototext.com/watch/dQw4w9WgXcQ"
video_id: "dQw4w9WgXcQ"
platform: youtube
lang: en
tags:
  - new-tag
created: 2026-09-05T00:00:00.000Z
updated: 2026-09-05T00:00:00.000Z
quiz_best: "8/10"
quiz_attempts: 2
generator: summarizevideototext.com
---

%% svt:start %%

# New title

## Summary

- fresh point

%% svt:end %%

## My notes
`;

const existing = `---
title: "Old title"
source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
video_id: "dQw4w9WgXcQ"
platform: youtube
lang: en
tags:
  - old-tag
  - mine
status: learning
created: 2026-09-04T00:00:00.000Z
updated: 2026-09-04T00:00:00.000Z
generator: summarizevideototext.com
---

%% svt:start %%

# Old title

## Summary

- old point

%% svt:end %%

## My notes

Keep this paragraph.
`;

describe("safeFileName", () => {
  it("strips characters Obsidian rejects and caps length", () => {
    expect(safeFileName('How to: "win" <fast>? #1 [guide]')).toBe("How to win fast 1 guide");
    expect(safeFileName("   ")).toBe("video");
    expect(safeFileName("x".repeat(300)).length).toBe(100);
  });
});

describe("frontmatter helpers", () => {
  it("reads video_id and the summary section", () => {
    expect(videoIdOf(existing)).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("# no frontmatter")).toBeNull();
    expect(summaryOf(existing)).toBe("- old point");
    expect(summaryOf("%% svt:start %%\n# x\n%% svt:end %%")).toBeNull();
  });
});

describe("mergeNote", () => {
  const merged = mergeNote(existing, fresh)!;
  it("replaces our frontmatter keys, keeps the user's and created", () => {
    expect(merged).toContain('title: "New title"');
    expect(merged).toContain("tags:\n  - new-tag\n");
    expect(merged).not.toContain("old-tag");
    expect(merged).toContain("status: learning");
    expect(merged).toContain("created: 2026-09-04T00:00:00.000Z");
    expect(merged).toContain("updated: 2026-09-05T00:00:00.000Z");
    expect(merged).toContain('workspace: "https://summarizevideototext.com/watch/dQw4w9WgXcQ"');
    expect(merged).toContain('quiz_best: "8/10"');
  });
  it("replaces the generated block and keeps the user's notes", () => {
    expect(merged).toContain("# New title");
    expect(merged).not.toContain("old point");
    expect(merged).toContain("## My notes\n\nKeep this paragraph.\n");
    expect(merged.indexOf("%% svt:start %%")).toBeLessThan(merged.indexOf("%% svt:end %%"));
  });
  it("drops owned keys the fresh note no longer has", () => {
    const withoutQuiz = fresh.replace('quiz_best: "8/10"\nquiz_attempts: 2\n', "");
    const m2 = mergeNote(merged, withoutQuiz)!;
    expect(m2).not.toContain("quiz_best");
    expect(m2).toContain("status: learning");
  });
  it("uses the server's ownedKeys when given (older bundled list stays a fallback)", () => {
    // 服务端把 summary_template 归为自己的键后,插件不升级也该跟着换
    const withTpl = fresh.replace("generator:", "summary_template: bullet_summary\ngenerator:");
    const old = merged.replace("generator:", "summary_template: mind_map\ngenerator:");
    const m = mergeNote(old, withTpl, [...OWNED_FM_KEYS.filter((k) => k !== "summary_template"), "summary_template"])!;
    expect(m).toContain("summary_template: bullet_summary");
    expect(m).not.toContain("mind_map");
    // 不在 ownedKeys 里的键当用户键保留
    const keep = mergeNote(old, withTpl, OWNED_FM_KEYS.filter((k) => k !== "summary_template"))!;
    expect(keep).toContain("summary_template: mind_map");
  });

  it("bundled OWNED_FM_KEYS matches the site's list", () => {
    expect([...OWNED_FM_KEYS]).toEqual([
      "title", "source", "workspace", "video_id", "platform", "channel", "lang", "tags",
      "updated", "summary_template", "summary_length", "quiz_best", "quiz_attempts", "generator",
    ]);
  });

  it("returns null without markers", () => {
    expect(mergeNote("# plain note", fresh)).toBeNull();
  });
});
