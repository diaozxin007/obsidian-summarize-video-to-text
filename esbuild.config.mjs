import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";

// 三种模式(2026-09-04):
//   dev        watch,debug 渠道,默认连 pre 预览站
//   debug      一次性构建,同上;给别人装 debug 包用
//   production 压缩,release 渠道,默认连生产站
// 渠道和默认地址在编译期注入(见 src/build.ts),这样 debug 包装上就指向 pre,
// 不用每次去设置里改 Server URL。pre 有 Vercel 部署保护,绕过密钥不在这里、
// 也不进仓库,用户填在插件设置(data.json)里。
const mode = process.argv[2] ?? "dev";
const prod = mode === "production";
const watch = mode === "dev";
const channel = prod ? "release" : "debug";
const defaultBaseUrl = prod ? "https://summarizevideototext.com" : "https://pre.summarizevideototext.com";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  define: {
    __SVT_BUILD_CHANNEL__: JSON.stringify(channel),
    __SVT_DEFAULT_BASE_URL__: JSON.stringify(defaultBaseUrl),
  },
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  console.log(`built main.js (${channel}, default server ${defaultBaseUrl})`);
  process.exit(0);
}
