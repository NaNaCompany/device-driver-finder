import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {completeTracking} from './publisher-tracking.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const config = read('app.json'), data = read('src/data.json'), dictionaries = read('src/ui.json');
const languages = config.languages, out = path.join(root, 'dist');
const rawMessages = config.type === 'directory' ? {} : read('src/messages.json');
const messages = rawMessages.messages || rawMessages;
const names = {ko: '한국어', en: 'English', es: 'Español', zh: '中文', ja: '日本語', de: 'Deutsch'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const route = (lang, entry) => (lang === 'ko' ? '' : lang + '/') + (entry ? 'entry/' + entry.slug + '/' : '');
const prefix = (lang, entry) => '../'.repeat((lang === 'ko' ? 0 : 1) + (entry ? 2 : 0)) || './';
const url = (lang, entry) => config.origin + '/' + route(lang, entry);
const category = (entry, lang) => data.categoryLabels?.[entry.category]?.[lang] || entry.category;
const link = source => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} <span aria-hidden="true">↗</span></a>`;
const sourceList = sources => `<ul class="sources">${sources.map(s => `<li>${link(s)}</li>`).join('')}</ul>`;
const noscript = {
  ko: '장치 선택·조건 계산에는 JavaScript가 필요합니다. 아래 공식 출처와 상세 페이지는 바로 열 수 있습니다.',
  en: 'Device selection and requirement checks need JavaScript. Official sources and detail pages below remain available.',
  es: 'La selección de dispositivos y la comprobación requieren JavaScript. Las fuentes oficiales y las páginas de detalle siguen disponibles.',
  zh: '设备选择和条件检查需要 JavaScript。下方官方来源和详情页仍可直接访问。',
  ja: 'デバイスの選択と条件確認には JavaScript が必要です。公式の出典と詳細ページは直接開けます。',
  de: 'Geräteauswahl und Anforderungsprüfung benötigen JavaScript. Offizielle Quellen und Detailseiten bleiben zugänglich.'
};

fs.mkdirSync(path.join(out, 'assets'), {recursive: true});
const core = {directory: 'core.mjs', device: 'device-core.mjs', cuda: 'cuda-core.mjs'}[config.type];
for (const name of ['app.js', 'style.css', core, 'data.json', 'icon.svg']) {
  fs.copyFileSync(path.join(root, 'src', name), path.join(out, 'assets', name));
}

function shell(lang, entry, body) {
  const ui = dictionaries[lang], p = prefix(lang, entry);
  const title = entry ? `${entry.code} · ${entry.text[lang].title}` : data.title[lang];
  const description = entry ? entry.text[lang].summary : data.description[lang];
  const alternatives = languages.map(l => `<link rel="alternate" hreflang="${l}" href="${url(l, entry)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${url('ko', entry)}">`;
  const menu = languages.map(l => `<a href="${p + route(l, entry)}" lang="${l}" hreflang="${l}"${l === lang ? ' aria-current="page"' : ''}>${names[l]}</a>`).join('');
  const structured = entry ? {
    '@context': 'https://schema.org', '@type': 'TechArticle', headline: title,
    description, inLanguage: lang, url: url(lang, entry), dateModified: data.checkedAt,
    publisher: {'@type': 'Organization', name: 'NaNa Lab', url: 'https://nanalab.kr/'},
    citation: entry.sources.map(s => s.url)
  } : {
    '@context': 'https://schema.org', '@type': config.type === 'directory' ? 'CollectionPage' : 'WebApplication',
    name: title, description, inLanguage: lang, url: url(lang),
    ...(config.type === 'directory' ? {} : {applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web browser'})
  };
  const state = {lang, type: config.type, slug: config.slug, ui, messages: messages[lang] || {}, entryId: entry?.id || null, dataURL: p + 'assets/data.json'};
  let html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#14243b"><meta name="robots" content="index,follow"><title>${esc(title)} · NaNa Lab</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${url(lang, entry)}">${alternatives}<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url(lang, entry)}"><link rel="icon" type="image/svg+xml" href="${p}assets/icon.svg"><link rel="stylesheet" href="${p}assets/style.css"><script type="application/ld+json">${json(structured)}</script></head>
<body><a class="skip" href="#main">${esc(ui.home)}</a><header class="topbar"><div class="shell"><a class="brand" href="${p + route(lang)}"><img class="icon" src="${p}assets/icon.svg" width="36" height="36" alt=""><span>NaNa Lab</span></a><nav class="languages" aria-label="Language">${menu}</nav></div></header><main class="shell" id="main">${body}<p id="status" class="status" role="status" aria-live="polite">${config.type !== 'directory' && !entry ? esc(ui.loading) : ''}</p></main><footer class="footer"><div class="shell">© 2026 NaNa Lab <span>${esc(ui.checked)} <time datetime="${data.checkedAt}">${data.checkedAt}</time></span></div></footer><a class="more-apps" href="https://nanalab.kr/apps/">More Apps</a><script id="app-config" type="application/json">${json(state)}</script><script type="module" src="${p}assets/app.js"></script></body></html>`;
  html = completeTracking(html).split(/\r?\n/).map(line => line.trimEnd()).join('\n').trimEnd() + '\n';
  const target = path.join(out, route(lang, entry), 'index.html');
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, html);
}

function record(entry, lang, interactive = true) {
  const t = entry.text[lang], ui = dictionaries[lang];
  const search = [entry.code, ...entry.aliases, entry.brand, category(entry, lang), ...entry.models, t.title, t.summary].join(' ');
  return `<a class="record-card" href="${prefix(lang) + route(lang, entry)}"${interactive ? ` data-record data-search="${esc(search)}" data-code="${esc(entry.code)}" data-aliases="${esc(JSON.stringify(entry.aliases))}" data-category="${esc(entry.category)}" data-brand="${esc(entry.brand)}"` : ''}><div class="record-top"><span class="code">${esc(entry.code)}</span><span class="brand-pill">${esc(entry.brand)}</span></div><h2 class="record-title">${esc(t.title)}</h2><p>${esc(t.summary)}</p><p class="record-meta">${esc(category(entry, lang))} · ${esc(entry.models.join(' · '))}</p><span class="record-open">${esc(ui.details)} <span aria-hidden="true">↗</span></span></a>`;
}

function directory(lang) {
  const ui = dictionaries[lang], brands = [...new Set(data.entries.map(e => e.brand))];
  const cats = [...new Set(data.entries.map(e => e.category))];
  return `<section class="hero"><h1>${esc(data.title[lang])}</h1></section><section class="panel"><div class="search-grid"><div class="field"><label for="search">${esc(ui.search)}</label><input type="search" id="search" placeholder="${esc(ui.placeholder)}" maxlength="500" autocomplete="off" spellcheck="false"></div><div class="field"><label for="brand-filter">${esc(ui.brand)}</label><select id="brand-filter"><option value="all">${esc(ui.all)}</option>${brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select></div><div class="field"><label for="category-filter">${esc(ui.category)}</label><select id="category-filter"><option value="all">${esc(ui.all)}</option>${cats.map(c => `<option value="${esc(c)}">${esc(data.categoryLabels?.[c]?.[lang] || c)}</option>`).join('')}</select></div></div><div class="toolbar"><span id="result-count" class="result-count" role="status" aria-live="polite">${esc(ui.results.replace('{n}', String(data.entries.length)))}</span><button type="button" class="secondary" id="clear-search">${esc(ui.clear)}</button></div></section><section class="record-list" aria-label="${esc(ui.results.replace('{n}', String(data.entries.length)))}">${data.entries.map(e => record(e, lang)).join('')}</section><p id="no-results" class="empty" hidden>${esc(ui.noResults)}</p>`;
}

function device(lang) {
  const ui = dictionaries[lang], m = messages[lang];
  return `<section class="hero"><h1>${esc(data.title[lang])}</h1></section><section class="panel"><div class="action-row">${['usb', 'hid', 'gpu'].map(type => `<button id="${type}-button" type="button" disabled>${esc(m[type + '-button'])}</button>`).join('')}</div><p class="notice">${esc(m['device-limited'])}</p><p class="notice">${esc(m['gpu-limited'])}</p></section><section class="panel"><form id="device-form"><div class="form-grid"><div class="field"><label for="namespace">${esc(m['namespace-label'])}</label><select id="namespace"><option value="">${esc(ui.select)}</option><option value="pci">PCI</option><option value="usb">USB</option></select></div><div class="field wide"><label for="hardware-id">${esc(m['manual-label'])}</label><input type="text" id="hardware-id" maxlength="500" autocomplete="off" spellcheck="false" placeholder="PCI\\VEN_8086&amp;DEV_1234 / USB\\VID_2341&amp;PID_0043"></div></div><p class="notice">${esc(m['manual-help'])}</p><div class="action-row"><button type="submit" disabled>${esc(m['lookup-button'])}</button><button type="button" class="secondary" id="clear-device-results">${esc(m['clear-button'])}</button></div></form></section><section id="device-result" class="output" aria-live="polite" aria-label="${esc(ui.result)}"></section><aside class="notice"><h2>${esc(ui.privacy)}</h2><p>${esc(m.privacy)}</p><p>${esc(m['vendor-limited'])}</p></aside><noscript><p class="notice">${esc(noscript[lang])}</p></noscript><details class="reference-list"><summary>${esc(ui.officialHelp)} · ${data.vendors.length}</summary><ul>${data.vendors.map(v => `<li>${esc(v.namespace.toUpperCase() + ' ' + v.vendorId + ' · ' + v.brand)} — <a href="${esc(v.supportUrl)}" rel="noopener noreferrer">${esc(ui.officialHelp)}</a>${sourceList(v.sources)}</li>`).join('')}</ul></details>`;
}

function cuda(lang) {
  const ui = dictionaries[lang], m = messages[lang];
  return `<section class="hero"><h1>${esc(data.title[lang])}</h1></section><section class="panel"><p class="notice">${esc(m.automaticReadNotice)}</p><form id="cuda-form"><div class="form-grid"><div class="field"><label for="profile">${esc(m.profile)}</label><select id="profile">${data.profiles.map(p => `<option value="${p.id}">${esc(p.label[lang])}</option>`).join('')}</select></div><div class="field"><label for="os">${esc(m.os)}</label><select id="os"><option value="windows">Windows x86_64</option><option value="linux">Linux x86_64</option><option value="macos">macOS</option></select></div><div class="field"><label for="driver-version">${esc(m.driverVersion)}</label><input id="driver-version" type="text" maxlength="40" inputmode="decimal" spellcheck="false" autocomplete="off" placeholder="580.88"></div><div class="field"><label for="installed-toolkit">${esc(m.installedToolkit)}</label><input id="installed-toolkit" type="text" maxlength="40" inputmode="decimal" spellcheck="false" autocomplete="off" placeholder="13.0"></div></div><div class="action-row"><button type="submit" disabled>${esc(m.check)}</button></div></form><details><summary>${esc(m.pasteSmi)}</summary><div class="field"><label for="smi-output">${esc(m.pasteSmi)}</label><textarea id="smi-output" rows="5" maxlength="50000" spellcheck="false" autocomplete="off" placeholder="Driver Version: 580.88   CUDA Version: 13.0"></textarea></div><div class="action-row"><button id="parse-smi" type="button" class="secondary" disabled>${esc(m.parse)}</button></div><p>${esc(m.driverMaxCuda)}: <span id="driver-max-cuda">${esc(ui.unknown)}</span></p></details></section><section id="cuda-result" class="output" aria-live="polite" aria-label="${esc(ui.result)}"></section><aside class="notice"><p>${esc(m.layersNotice)}</p><p>${esc(m.limitedNotice)}</p></aside><noscript><p class="notice">${esc(noscript[lang])}</p></noscript><section class="record-list">${data.entries.map(e => record(e, lang, false)).join('')}</section>`;
}

function detail(lang, entry) {
  const ui = dictionaries[lang], t = entry.text[lang], p = prefix(lang, entry);
  return `<p class="breadcrumb"><a href="${p + route(lang)}">${esc(data.title[lang])}</a> / ${esc(entry.code)}</p><section class="hero"><div class="facts"><span class="code">${esc(entry.code)}</span><span class="brand-pill">${esc(entry.brand)}</span></div><h1>${esc(t.title)}</h1><div class="action-row"><button type="button" class="copy secondary" id="copy-code" data-code="${esc(entry.code)}">${esc(ui.copy)}</button></div></section><div class="detail-layout"><article class="detail-body"><section class="panel"><h2>${esc(ui.context)}</h2><p>${esc(t.summary)}</p><h2>${esc(ui.steps)}</h2><ol class="steps">${t.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ol><h2>${esc(ui.next)}</h2><p>${esc(t.escalation)}</p></section>${config.type === 'cuda' ? `<a class="button" href="${p + route(lang)}#${entry.id}">${esc(ui.check)} · ${esc(entry.code)}</a>` : ''}<section class="panel"><h2>${esc(ui.sources)}</h2>${sourceList(entry.sources)}<p class="record-meta">${esc(ui.checked)} <time datetime="${data.checkedAt}">${data.checkedAt}</time></p></section><a class="back-link" href="${p + route(lang)}">← ${esc(ui.home)}</a></article><aside class="sidebar panel"><h2>${esc(ui.scope)}</h2><p>${esc(t.scope)}</p><dl><dt>${esc(ui.models)}</dt><dd>${esc(entry.models.join(' · '))}</dd><dt>${esc(ui.category)}</dt><dd>${esc(category(entry, lang))}</dd><dt>${esc(ui.code)}</dt><dd class="code">${esc(entry.code)}</dd></dl></aside></div>`;
}

for (const lang of languages) {
  let body = config.type === 'directory' ? directory(lang) : config.type === 'device' ? device(lang) : cuda(lang);
  if (config.type === 'cuda') body = data.profiles.map(p => `<span id="${p.id}" class="profile-anchor" aria-hidden="true"></span>`).join('') + body;
  shell(lang, null, body);
  for (const entry of data.entries) shell(lang, entry, detail(lang, entry));
}
const all = languages.flatMap(lang => [null, ...data.entries].map(entry => {
  const alternates = languages.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(url(l, entry))}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(url('ko', entry))}"/>`;
  return `<url><loc>${esc(url(lang, entry))}</loc><lastmod>${data.checkedAt}</lastmod>${alternates}</url>`;
}));
fs.writeFileSync(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' + all.join('') + '</urlset>\n');
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.origin}/sitemap.xml\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
const report = {slug: config.slug, type: config.type, languages, entries: data.entries.length, pages: all.length, origin: config.origin, checkedAt: data.checkedAt, binariesHosted: 0};
fs.writeFileSync(path.join(root, 'BUILD.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
