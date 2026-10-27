const ADS = "<script async src=\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9767176956440077\"\n        crossorigin=\"anonymous\"></script>";
const GTM = "<script>\n        (function (w, d, s, l, i) {\n            w[l] = w[l] || []; w[l].push({\n                'gtm.start':\n                    new Date().getTime(), event: 'gtm.js'\n            });\n            var f = d.getElementsByTagName(s)[0],\n                j = d.createElement(s),\n                dl = l != 'dataLayer' ? '&l=' + l : '';\n            j.async = true;\n            j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;\n            f.parentNode.insertBefore(j, f);\n        })\n            (window, document, 'script', 'dataLayer', 'GTM-NV2WWQXB');\n    </script>";
const GA = "<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-2ZYSF0173P\"></script>\n<script>\n        window.dataLayer = window.dataLayer || [];\n        function gtag() { dataLayer.push(arguments); }\n        gtag('js', new Date());\n        gtag('config', 'G-2ZYSF0173P');\n    </script>";
const BODY = "<noscript><iframe src=\"https://www.googletagmanager.com/ns.html?id=GTM-NV2WWQXB\" height=\"0\" width=\"0\"\n            style=\"display:none;visibility:hidden\"></iframe></noscript>";
const CF = "<script>\n(function () {\n  function ensureBeacon() {\n    // Cloudflare may inject its beacon at the edge. Reuse that script when present.\n    if (document.querySelector('script[src*=\"static.cloudflareinsights.com/beacon.min.js\"]')) return;\n    var beacon = document.createElement('script');\n    beacon.defer = true;\n    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';\n    beacon.setAttribute('data-cf-beacon', JSON.stringify({token: '9f3423bb0d034d91bbe1a12afeff2429'}));\n    document.head.appendChild(beacon);\n  }\n  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureBeacon, {once: true});\n  else ensureBeacon();\n})();\n</script>";
export function completeTracking(source) {
  if (!/<html\b/i.test(source)) return source;
  const head = [];
  for (const [name, pattern, snippet] of [['AdSense', /ca-pub-\d+/, ADS], ['GTM', /GTM-[A-Z0-9]+/, GTM], ['Analytics', /G-2ZYSF0173P/, GA]]) {
    if (!pattern.test(source)) head.push(`<!-- NaNa publisher: ${name} -->\n${snippet}\n<!-- /NaNa publisher: ${name} -->`);
  }
  const body = source.includes('googletagmanager.com/ns.html') ? '' : `<!-- NaNa publisher: GTM fallback -->\n${BODY}\n<!-- /NaNa publisher: GTM fallback -->`;
  const cf = source.includes('cloudflareinsights.com/beacon.min.js') ? '' : `<!-- NaNa publisher: Cloudflare fallback -->\n${CF}\n<!-- /NaNa publisher: Cloudflare fallback -->`;
  if (!head.length && !body && !cf) return source;
  if (!/<head\b/i.test(source)) {
    const opening = /<html\b[^>]*>/i.exec(source);
    const match = /<(?:a|h1|main|header|div|p)\b/i.exec(source.slice(opening.index + opening[0].length));
    if (!match) throw new Error('Cannot locate implicit body');
    const at = opening.index + opening[0].length + match.index;
    source = source.slice(0,at) + '</head><body>' + source.slice(at);
    source = source.replace(/<html\b[^>]*>/i, m => m + '<head>');
    source = source.replace(/<\/html\s*>/i, '</body></html>');
  }
  if (head.length) source = source.replace(/<\/head\s*>/i, () => '\n' + head.join('\n') + '\n</head>');
  if (body) source = source.replace(/<body\b[^>]*>/i, m => m + '\n' + body + '\n');
  if (cf) source = source.replace(/<\/body\s*>/i, () => '\n' + cf + '\n</body>');
  return source;
}
