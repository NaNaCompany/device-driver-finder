# Device ID & Official Driver Finder

Original six-language static app: Korean, English, Spanish, Chinese, Japanese and German.

- Launch: https://nanalab.kr/device-driver-finder/
- Sitemap: https://nanalab.kr/device-driver-finder/sitemap.xml
- Source data: `src/data.json`; UI: `src/ui.json`; application: `src/app.js`.
- 0 scoped detail records; 6 public HTML pages.
- Sources checked: 2026-10-27. See `SOURCE_REVIEW.md` for evidence and limits.

## Build and verify

Use Node.js 24.19.0 and Python 3. No package installation is required.

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
python3 scripts/validate.py
git diff --exit-code -- dist
```

The GitHub Pages workflow tests and rebuilds the tracked `dist` directory, validates
every language/detail route and sitemap alternate, and deploys only after these checks.
Configure Pages to use GitHub Actions. A project CNAME is unnecessary because the
organization site owns the custom domain.

## Content and data boundaries

Code, explanations, translations and SVG line art are original work under the MIT
license. Official links cite technical facts. No manuals, copied manufacturer tables,
logos, proprietary fonts, drivers or other binaries are redistributed. Manufacturer
and product names identify the applicable product; no affiliation is implied.

The shipped publisher module contains the existing NaNa Lab Google Tag Manager,
Google Analytics, AdSense and Cloudflare beacon integrations. These services load
their own scripts. App inputs are not added to analytics events, URLs or storage.
Device permission and physical execution tests are distinct from parser/controller
unit tests and static validation. See `UPDATE.md` for the release verification boundary.
