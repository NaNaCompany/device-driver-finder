# Release record

## 2026-10-27

- Implemented Device ID & Official Driver Finder in ko, en, es, zh, ja and de.
- Added 0 scoped records and 6 static language/detail pages.
- Every route has its own canonical URL, reciprocal hreflang links and sitemap entry.
- Preserved four NaNa Lab publisher integrations and the small More Apps link.
- Official sources are citations; explanations, translations and icons are original.
- Local tests, static validation and deployment evidence are recorded in the workspace
  release audit. `VALIDATION.json` covers local structure, not indexing or physical tests.
- Browser visual inspection and real USB/HID/GPU access are separate checks. Do not
  interpret mocked controller tests or public HTTP readback as physical execution.

Launch: https://nanalab.kr/device-driver-finder/

Sitemap: https://nanalab.kr/device-driver-finder/sitemap.xml

Catalog handoff: one representative Korean card; all actual language/detail URLs
belong to this app sitemap. Main-site integration is tracked separately in UpdateQue.md.

## Local validation

- Fixed the initial loading label so it clears once the interactive controls are ready.
  Added a controller regression assertion for that transition.

- 39 parser/controller unit tests passed, including negative/error cases.
- All generated HTML, internal references, canonical/hreflang alternates and sitemap
  entries passed the offline validator. All pages contain the four publisher integrations.
- A second build reproduces the tracked static output byte for byte.
- Browser providers available: 0. Mobile viewport measurements and real device/GPU
  execution were not performed. Unit tests use controlled API/DOM substitutes.
- Exact GitHub Actions/environment deployment SHA and served-file readback are tracked
  outside the repository to avoid changing the source commit being verified.
