import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
import { requestUrl } from "obsidian";
import { ApiError, SvtApi } from "../src/api";

const request = vi.mocked(requestUrl);
const url = "https://www.youtube.com/watch?v=LPZh9BOjkQs";
const analysis = { videoId: "LPZh9BOjkQs", overview: { tldr: "Ready" }, chapters: [] };
const api = () => new SvtApi({ baseUrl: "https://pre.summarizevideototext.com", token: "svt_test", uiLang: "en" });
function reply(status: number, body: unknown) {
  request.mockResolvedValueOnce({ status, text: JSON.stringify(body), headers: {}, json: body, arrayBuffer: new ArrayBuffer(0) });
}
function bodies() { return request.mock.calls.map(([input]) => JSON.parse(String(typeof input === "string" ? "{}" : input.body))); }
function paths() { return request.mock.calls.map(([input]) => new URL(typeof input === "string" ? input : input.url).pathname); }
beforeEach(() => request.mockReset());

describe("unified credits API", () => {
  it("quotes before generating and forwards the signed token with the same account", async () => {
    reply(200, { billingVersion: "v2", cached: false, quoteToken: "signed-native" }); reply(200, analysis);
    await api().analyze(url, "en");
    expect(paths()).toEqual(["/api/credits/quote", "/api/analyze"]);
    expect(bodies()[1].quoteToken).toBe("signed-native");
    expect(request.mock.calls.every(([r]) => typeof r !== "string" && r.headers?.Authorization === "Bearer svt_test")).toBe(true);
  });
  it("quotes AI transcription only after native subtitles are unavailable", async () => {
    reply(409, { code: "transcription_required" });
    reply(200, { billingVersion: "v2", quoteToken: "signed-ai" }); reply(200, analysis);
    await api().analyze(url, "en");
    expect(bodies().map(b => b.processing)).toEqual(["subtitles", "transcription", undefined]);
    expect(bodies()[2].quoteToken).toBe("signed-ai");
  });
  it("does not generate when credits are insufficient and provides a top-up link", async () => {
    reply(402, { code: "insufficient_credits", needed: 80, available: 20 });
    const error = await api().analyze(url, "en").catch(e => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 402, code: "insufficient_credits", actionUrl: "https://pre.summarizevideototext.com/pricing" });
    expect(error.message).toContain("80 credits");
    expect(paths()).toEqual(["/api/credits/quote"]);
  });
  it("stops before generation when transcription is too expensive", async () => {
    reply(409, { code: "transcription_required" }); reply(402, { code: "insufficient_credits" });
    await expect(api().analyze(url, "en")).rejects.toMatchObject({ code: "insufficient_credits" });
    expect(paths()).toEqual(["/api/credits/quote", "/api/credits/quote"]);
  });
  it("replays the saved language without a charge token and uses the included summary", async () => {
    reply(200, { billingVersion: "v2", cached: true, needed: 0, outputLang: "zh" }); reply(200, analysis);
    request.mockResolvedValueOnce({ status: 200, text: 'event: delta\ndata: {"text":"Saved summary"}\n\nevent: done\ndata: {}\n\n', headers: {}, json: {}, arrayBuffer: new ArrayBuffer(0) });
    const client = api();
    const result = await client.analyze(url, "en");
    await client.summarize(url, result.outputLang!, "chapter_summary");
    expect(result.outputLang).toBe("zh");
    expect(bodies()[1]).not.toHaveProperty("quoteToken");
    expect(bodies()[1].outputLang).toBe("zh");
    expect(bodies()[2].template).toBe("bullet_summary");
  });
  it("replays public references without a payment token", async () => {
    reply(200, { billingVersion: "v2", cached: true, freeExample: true, needed: 0 }); reply(200, analysis);
    await api().analyze(url, "en");
    expect(bodies()[1]).not.toHaveProperty("quoteToken");
  });
  it("fails closed on unavailable or malformed quotes", async () => {
    reply(503, { code: "billing_unavailable" });
    await expect(api().analyze(url, "en")).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset(); reply(200, { billingVersion: "v2", cached: false });
    await expect(api().analyze(url, "en")).rejects.toMatchObject({ code: "billing_unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("supports an explicitly legacy server", async () => {
    reply(200, { billingVersion: "legacy" }); reply(200, analysis);
    await api().analyze(url, "en");
    expect(bodies()[1]).not.toHaveProperty("quoteToken");
  });
  it("does not treat a revoked token as a guest account", async () => {
    reply(401, { code: "auth_required" });
    await expect(api().analyze(url, "en")).rejects.toMatchObject({ unauthorized: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("includes the owned video id in chat requests", async () => {
    request.mockResolvedValueOnce({ status: 200, text: "Answer", headers: {}, json: {}, arrayBuffer: new ArrayBuffer(0) });
    await api().ask("LPZh9BOjkQs", "Note context", "Why?", "en");
    expect(bodies()[0].videoId).toBe("LPZh9BOjkQs");
  });
});
