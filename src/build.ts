/**
 * 编译期常量(2026-09-04)。esbuild 的 define 在打包时替换这两个标识符:
 * debug 渠道默认连 pre 预览站,release 渠道连生产站。vitest 不经过 esbuild,
 * 所以用 typeof 兜底,直接 import 也不会 ReferenceError。
 */

declare const __SVT_BUILD_CHANNEL__: "debug" | "release";
declare const __SVT_DEFAULT_BASE_URL__: string;

export const BUILD_CHANNEL: "debug" | "release" =
  typeof __SVT_BUILD_CHANNEL__ !== "undefined" ? __SVT_BUILD_CHANNEL__ : "release";

export const DEFAULT_BASE_URL: string =
  typeof __SVT_DEFAULT_BASE_URL__ !== "undefined"
    ? __SVT_DEFAULT_BASE_URL__
    : "https://summarizevideototext.com";

/** Vercel 部署保护的自动化绕过头/查询参数名 */
export const VERCEL_BYPASS_HEADER = "x-vercel-protection-bypass";
export const VERCEL_BYPASS_COOKIE_FLAG = "x-vercel-set-bypass-cookie";
