# Contributing

Thanks for helping improve Summarize Video To Text.

## Report a problem

Open an issue in this repository with your Obsidian version, plugin version, operating system, reproduction steps, and expected and actual behavior. Include a public example video URL if it helps reproduce the issue.

Do not include account tokens, preview bypass secrets, vault contents, or other private data. Redact screenshots and logs before sharing them. Report security concerns privately to hi@summarizevideototext.com rather than posting credentials or an exploit in a public issue.

## Development

1. Clone the repository and run `npm ci`.
2. Run `npm run dev` for a watch build, or `npm run build:debug` for a single debug build.
3. Copy `main.js`, `manifest.json`, and `styles.css` into a test vault's `.obsidian/plugins/summarize-video-to-text/` directory, then enable or reload the plugin.

Debug builds default to the preview server. See the README's development section for server configuration. Use a separate test vault and keep secrets out of Git.

Before opening a pull request, run:

```sh
npm test
npm run build
```

The release build type-checks the source and uses the production server by default. Generated build artifacts should not be committed.

## Pull requests

Keep changes focused and describe the problem, resulting behavior, and validation. Add meaningful regression coverage for behavior changes, and screenshots for visible UI changes when useful.

Use Obsidian's DOM helpers such as `createEl` and `createFragment`. Preserve user-written note sections, custom frontmatter, existing flashcards, and their review schedules. Document new network or clipboard access in the README.

Version bumps, tags, and public releases are managed by the maintainer. Do not overwrite an existing release.

Contributions are licensed under the repository's MIT license.
