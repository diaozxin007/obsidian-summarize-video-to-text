import { describe, expect, it } from "vitest";
import { buildFlashcardNote, cardOf, mergeFlashcardNote } from "../src/flashcards";
import type { QuizQuestion } from "../src/types";

const SITE = "https://summarizevideototext.com";

function q(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question: "What does the speaker call the forgetting curve?",
    options: ["A myth", "An exponential decay of recall", "A study method", "A type of graph paper"],
    answer: 1,
    explanation: "He describes memory decaying exponentially without review.",
    timeMs: 201_000,
    ...over,
  };
}

describe("cardOf", () => {
  it("多行格式:正面、单独一行 ?、背面,选项不出现在正面", () => {
    const card = cardOf(q(), SITE, "dQw4w9WgXcQ");
    expect(card).toBe(
      [
        "What does the speaker call the forgetting curve?",
        "?",
        "**An exponential decay of recall**",
        "He describes memory decaying exponentially without review.",
        "[3:21](https://summarizevideototext.com/watch/dQw4w9WgXcQ?t=201)",
      ].join("\n"),
    );
    expect(card).not.toContain("A type of graph paper");
  });

  it("题干里的 :: 会被 SR 当单行卡片分隔符,要躲开", () => {
    const card = cardOf(q({ question: "What is X::Y in the demo?" }), SITE, "dQw4w9WgXcQ")!;
    expect(card).not.toMatch(/^[^\n]*::/m);
    expect(card.startsWith("What is X:&#58;Y in the demo?")).toBe(true);
  });

  it("解析里的空行会提前结束卡片,要压掉", () => {
    const card = cardOf(q({ explanation: "First line.\n\nSecond line." }), SITE, "dQw4w9WgXcQ")!;
    expect(card).not.toContain("\n\n");
    expect(card).toContain("First line.\nSecond line.");
  });

  it("时间是 0 也给链接;缺正确选项的题跳过", () => {
    expect(cardOf(q({ timeMs: 0 }), SITE, "dQw4w9WgXcQ")).toContain("[0:00](");
    expect(cardOf(q({ options: [], answer: 0 }), SITE, "dQw4w9WgXcQ")).toBeNull();
  });

  it("超过一小时用 h:mm:ss", () => {
    expect(cardOf(q({ timeMs: 3_723_000 }), SITE, "dQw4w9WgXcQ")).toContain("[1:02:03](");
  });
});

describe("buildFlashcardNote", () => {
  const note = buildFlashcardNote({
    videoId: "dQw4w9WgXcQ",
    title: "How memory works",
    channel: "Some Channel",
    noteName: "How memory works",
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tag: "#flashcards/videos",
    siteUrl: SITE,
    questions: [q(), q({ question: "Second question?" })],
    now: new Date("2026-09-14T10:00:00Z"),
  });

  it("用 svt_flashcards 而不是 video_id —— 别让它被当成视频笔记刷新", () => {
    expect(note.markdown).toContain('svt_flashcards: "dQw4w9WgXcQ"');
    expect(note.markdown).not.toMatch(/^video_id:/m);
  });

  it("source / workspace 跟视频笔记同义", () => {
    expect(note.markdown).toContain('source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(note.markdown).toContain('workspace: "https://summarizevideototext.com/watch/dQw4w9WgXcQ"');
    expect(note.markdown).toContain("# How memory works - Flashcards");
  });

  it("deck 标签单独成行,排在卡片前面", () => {
    const lines = note.markdown.split("\n");
    const tagLine = lines.findIndex((l) => l === "#flashcards/videos");
    const firstCard = lines.findIndex((l) => l === "?");
    expect(tagLine).toBeGreaterThan(0);
    expect(tagLine).toBeLessThan(firstCard);
  });

  it("回链视频笔记,卡片之间用空行隔开", () => {
    expect(note.markdown).toContain("[[How memory works]]");
    expect(note.cards).toBe(2);
    expect(note.markdown).toContain("\n\nSecond question?\n?\n");
  });
});

describe("mergeFlashcardNote", () => {
  const fresh = buildFlashcardNote({
    videoId: "dQw4w9WgXcQ",
    title: "How memory works",
    tag: "#flashcards",
    siteUrl: SITE,
    questions: [q(), q({ question: "Second question?" })],
  }).markdown;

  it("已有的卡片一行不动,复习进度保留", () => {
    const existing = [
      "---",
      'svt_flashcards: "dQw4w9WgXcQ"',
      "---",
      "",
      "#flashcards",
      "",
      "What does the speaker call the forgetting curve?",
      "?",
      "**An exponential decay of recall**",
      "<!--SR:!2026-09-20,3,250-->",
      "",
    ].join("\n");
    const r = mergeFlashcardNote(existing, fresh);
    expect(r.skipped).toBe(1);
    expect(r.added).toBe(1);
    expect(r.content).toContain("<!--SR:!2026-09-20,3,250-->");
    expect(r.content).toContain("Second question?");
    // 那道旧题没有被重新写一遍
    expect(r.content.match(/forgetting curve\?/g)).toHaveLength(1);
  });

  it("重复执行是幂等的", () => {
    const first = mergeFlashcardNote(fresh, fresh);
    expect(first.added).toBe(0);
    expect(first.skipped).toBe(2);
    expect(first.content).toBe(fresh);
  });

  it("用户手写的卡片和单行格式的卡片都不会被重复追加", () => {
    const existing = [
      "#flashcards",
      "",
      "What does the speaker call the forgetting curve?::An exponential decay of recall",
      "",
      "My own card",
      "?",
      "My own answer",
      "",
    ].join("\n");
    const r = mergeFlashcardNote(existing, fresh);
    expect(r.skipped).toBe(1);
    expect(r.added).toBe(1);
    expect(r.content).toContain("My own card");
  });
});
