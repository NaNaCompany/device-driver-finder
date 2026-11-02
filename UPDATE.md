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

## 2026-11-02 — Shared book banner

- Connected all public page types to `https://nanalab.kr/src_cdn/banner/astra.js`. Campaign, design, translated controls and the supplied YES24 book destination are maintained centrally in src_cdn.
- Shared archive assets load the banner on detail/list pages; other HTML and source templates include the stable deferred loader. HTML-only generator adapters retain the connection after rebuilds and pass non-HTML values through unchanged.
- The component is closable for the tab session, clears detected bottom navigation, and hides for modals/fullscreen/mobile input. The Astra practice site remains excluded. No additional analytics or ad-network requests are introduced by the component.
- Existing content, routes and publisher integrations are preserved. Direct HTML changes restore exactly to the baseline when the marked loader is removed. Workspace validation/deployment evidence: `.tools/shared-book-banner-20261102/`.
