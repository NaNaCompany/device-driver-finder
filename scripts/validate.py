#!/usr/bin/env python3
"""Offline release checks. Run from scripts/validate.py in an app repository.

This validates structure and local output, not HTTP reachability, source accuracy,
translation quality, browser permissions, device access, or physical execution.
"""
from __future__ import annotations

import argparse
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET

LANGS = ["ko", "en", "es", "zh", "ja", "de"]
PUBLISHERS = ["GTM-NV2WWQXB", "G-2ZYSF0173P", "ca-pub-9767176956440077",
              "static.cloudflareinsights.com/beacon.min.js"]
FIRST_PARTY = {
    "microsoft.com", "windows.com", "xbox.com", "canon.com", "canon", "epson.com",
    "epson.biz", "brother.com", "brother-usa.com", "hp.com", "xerox.com",
    "lexmark.com", "ricoh.com", "kyoceradocumentsolutions.com", "samsung.com",
    "lg.com", "lgservice.com", "whirlpool.com", "maytag.com", "geappliances.com",
    "bosch-home.com", "bsh-group.com", "electrolux.com", "frigidaire.com",
    "aeg.com", "miele.com", "panasonic.com", "haier.com", "beko.com",
    "nvidia.com", "pytorch.org", "intel.com", "amd.com", "dell.com", "realtek.com",
    "broadcom.com", "qualcomm.com", "cisco.com", "google.com", "arduino.cc",
    "ftdichip.com", "silabs.com", "steampowered.com", "nintendo.com",
    "playstation.com", "sony.com", "logitech.com", "logi.com", "lenovo.com",
    "asus.com", "acer.com", "msi.com", "tp-link.com", "toshiba.com", "fujitsu.com",
}
BINARY_SUFFIXES = {
    ".exe", ".dll", ".msi", ".msp", ".msix", ".appx", ".cab", ".sys", ".drv",
    ".bin", ".rom", ".iso", ".img", ".dmg", ".pkg", ".deb", ".rpm", ".whl",
    ".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz", ".pdf", ".docx",
    ".ttf", ".otf", ".woff", ".woff2",
}
KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VERSION = re.compile(r"^[0-9]+(?:\.[0-9]+)+$")


class Page(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.lang = ""
        self.ids: list[str] = []
        self.canonical: list[str] = []
        self.alternates: list[tuple[str, str]] = []
        self.links: list[tuple[str, str]] = []
        self.anchors: list[str] = []
        self.h1 = 0
        self.titles: list[str] = []
        self.descriptions: list[str] = []
        self.text: list[str] = []
        self._title = False
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang", "")
        if a.get("id"):
            self.ids.append(a["id"])
        if tag == "h1":
            self.h1 += 1
        if tag == "title":
            self._title = True
            self.titles.append("")
        if tag == "meta" and a.get("name", "").lower() == "description":
            self.descriptions.append(a.get("content", ""))
        if tag == "link":
            rel = a.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical.append(a.get("href", ""))
            if "alternate" in rel and a.get("hreflang"):
                self.alternates.append((a["hreflang"], a.get("href", "")))
        if tag == "a" and a.get("href"):
            self.anchors.append(a["href"])
        for attr in ("href", "src", "poster", "action", "data-src"):
            if a.get(attr):
                self.links.append((f"{tag}.{attr}", a[attr]))
        if a.get("srcset"):
            for item in a["srcset"].split(","):
                if item.strip():
                    self.links.append(("srcset", item.strip().split()[0]))

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False

    def handle_data(self, data):
        self.text.append(data)
        if self._title:
            self.titles[-1] += data


class Validator:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.dist = self.root / "dist"
        self.errors: list[str] = []
        self.source_urls: set[str] = set()
        self.source_hosts: set[str] = set()
        self.external: set[str] = set()
        self.internal_count = 0
        self.pages: dict[str, Page] = {}

    def require(self, truth, message):
        if not truth:
            self.errors.append(message)
        return bool(truth)

    def read_json(self, path: Path):
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as e:
            self.errors.append(f"{path.relative_to(self.root)}: {e}")
            return {}

    def string(self, value):
        return isinstance(value, str) and bool(value.strip())

    def localized(self, value, where):
        if not self.require(isinstance(value, dict), f"{where}: expected language object"):
            return
        self.require(set(value) == set(LANGS), f"{where}: exactly six languages required")
        for lang in LANGS:
            self.require(self.string(value.get(lang)), f"{where}.{lang}: empty/missing text")

    def source_url(self, value, where):
        if not self.require(self.string(value), f"{where}: missing URL"):
            return
        try:
            u = urlsplit(value)
            valid = (u.scheme == "https" and bool(u.hostname) and not u.username
                     and not u.password and u.port in (None, 443)
                     and not any(c.isspace() for c in value))
        except ValueError:
            valid = False
        if not self.require(valid, f"{where}: invalid HTTPS URL or embedded credentials: {value}"):
            return
        host = u.hostname.lower()
        self.source_urls.add(value)
        self.source_hosts.add(host)
        allowed = any(host == d or host.endswith("." + d) for d in FIRST_PARTY)
        self.require(allowed, f"{where}: first-party domain review required: {host}")

    def sources(self, sources, where):
        if not self.require(isinstance(sources, list) and bool(sources), f"{where}: sources required"):
            return
        for i, source in enumerate(sources):
            if not self.require(isinstance(source, dict), f"{where}[{i}]: object required"):
                continue
            self.require(self.string(source.get("label")), f"{where}[{i}]: label required")
            self.source_url(source.get("url"), f"{where}[{i}]")

    def texts(self, text, where):
        if not self.require(isinstance(text, dict), f"{where}: text object required"):
            return
        self.require(set(text) == set(LANGS), f"{where}: six languages required")
        for lang in LANGS:
            t = text.get(lang, {})
            if not self.require(isinstance(t, dict), f"{where}.{lang}: object required"):
                continue
            for k in ("title", "summary", "escalation", "scope"):
                self.require(self.string(t.get(k)), f"{where}.{lang}.{k}: required")
            c = t.get("checks")
            self.require(isinstance(c, list) and 2 <= len(c) <= 4
                         and all(self.string(x) for x in c), f"{where}.{lang}: 2-4 checks required")

    def schema(self, config, data, ui):
        self.slug = config.get("slug", "")
        self.kind = config.get("type", "")
        self.origin = str(config.get("origin", "")).rstrip("/")
        self.require(bool(KEY.fullmatch(self.slug)), "app.slug: invalid slug")
        self.require(self.kind in ("directory", "device", "cuda"), "app.type: invalid type")
        self.require(config.get("languages") == LANGS, "app.languages: expected ko,en,es,zh,ja,de")
        self.require(self.origin == f"https://nanalab.kr/{self.slug}", "app.origin: unexpected origin")
        self.require(data.get("slug") == self.slug, "data.slug differs from app.slug")
        try:
            checked = data["checkedAt"]
            self.require(date.fromisoformat(checked).isoformat() == checked, "data.checkedAt: use YYYY-MM-DD")
        except (KeyError, ValueError, TypeError):
            self.errors.append("data.checkedAt: invalid date")
        self.localized(data.get("title"), "data.title")
        self.localized(data.get("description"), "data.description")
        self.require(isinstance(ui, dict) and set(ui) == set(LANGS), "src/ui.json: six dictionaries required")
        keys = set(ui.get("ko", {})) if isinstance(ui, dict) and isinstance(ui.get("ko"), dict) else set()
        self.require(bool(keys), "src/ui.json: empty Korean dictionary")
        for lang in LANGS:
            d = ui.get(lang, {}) if isinstance(ui, dict) else {}
            self.require(isinstance(d, dict) and set(d) == keys and all(self.string(v) for v in d.values()),
                         f"src/ui.json.{lang}: key parity and nonempty translations required")
        for category, labels in data.get("categoryLabels", {}).items():
            self.localized(labels, f"categoryLabels.{category}")
        entries = data.get("entries", [])
        if not self.require(isinstance(entries, list), "data.entries: expected array"):
            entries = []
        self.entries = entries
        if self.kind == "device":
            self.require(entries == [], "device: entries must be empty")
        else:
            self.require(bool(entries), "directory/CUDA: entries required")
        ids, slugs = [], []
        for i, entry in enumerate(entries):
            where = f"entries[{i}]"
            if not self.require(isinstance(entry, dict), f"{where}: object required"):
                continue
            for field, dest in (("id", ids), ("slug", slugs)):
                value = entry.get(field, "")
                self.require(isinstance(value, str) and bool(KEY.fullmatch(value)), f"{where}.{field}: invalid")
                dest.append(value)
            for field in ("code", "brand"):
                self.require(self.string(entry.get(field)), f"{where}.{field}: required")
            self.require(bool(KEY.fullmatch(str(entry.get("category", "")))), f"{where}.category: invalid")
            self.require(isinstance(entry.get("aliases"), list) and all(self.string(x) for x in entry["aliases"]),
                         f"{where}.aliases: string array required")
            models = entry.get("models")
            self.require(isinstance(models, list) and bool(models) and all(self.string(x) for x in models),
                         f"{where}.models: actual product/model scope required")
            self.sources(entry.get("sources"), where + ".sources")
            self.texts(entry.get("text"), where + ".text")
        self.require(len(ids) == len(set(ids)), "entries: duplicate id")
        self.require(len(slugs) == len(set(slugs)), "entries: duplicate slug")
        if self.kind == "cuda":
            self.cuda_schema(data)
        if self.kind == "device":
            self.device_schema(data)
        if "sources" in data:
            self.sources(data["sources"], "data.sources")

    def cuda_schema(self, data):
        profiles = data.get("profiles", [])
        self.require(isinstance(profiles, list) and len(profiles) == 8, "CUDA: exactly eight profiles required")
        self.require(len(self.entries) == 8, "CUDA: exactly eight detail entries required")
        if not isinstance(profiles, list):
            return
        ids = []
        for p in profiles:
            if not self.require(isinstance(p, dict), "CUDA profile: object required"):
                continue
            where = "profiles." + str(p.get("id", "?"))
            ids.append(p.get("id"))
            self.require(bool(KEY.fullmatch(str(p.get("id", "")))), where + ": invalid id")
            self.require(p.get("kind") in ("toolkit", "pytorch-wheel"), where + ": invalid kind")
            self.require(bool(VERSION.fullmatch(str(p.get("cuda", "")))), where + ": invalid CUDA version")
            self.localized(p.get("label"), where + ".label")
            minimum = p.get("minimumDriver", {})
            self.require(isinstance(minimum, dict) and set(minimum) == {"linux", "windows"}
                         and all(VERSION.fullmatch(str(x)) for x in minimum.values()), where + ": invalid driver floors")
            self.require(p.get("minimumKind") in ("minor-version-compatibility", "verified-release-baseline"),
                         where + ": minimumKind required")
            self.require(p.get("platformScope") == ["linux-x86_64", "windows-x86_64"], where + ": platform scope required")
            self.require(self.string(p.get("installLinkKind")), where + ": installLinkKind required")
            self.source_url(p.get("installUrl"), where + ".installUrl")
            if p.get("kind") == "pytorch-wheel":
                self.require(bool(VERSION.fullmatch(str(p.get("torch", "")))), where + ": torch version required")
                self.source_url(p.get("indexUrl"), where + ".indexUrl")
                for flag, expected in (("wheelListingVerified", True), ("pythonWheelVerified", False), ("gpuKernelsVerified", False)):
                    self.require(p.get(flag) is expected, where + ": incorrect verification boundary " + flag)
            self.sources(p.get("sources"), where + ".sources")
            self.texts(p.get("text"), where + ".text")
        self.require(len(ids) == len(set(ids)) and set(ids) == {e.get("id") for e in self.entries},
                     "CUDA: profiles and entries must have identical unique IDs")
        policy = data.get("policy", {})
        for key in ("automaticDriverRead", "commandsGenerated", "fullCompatibilityClaim", "forwardCompatibilityPackagesEvaluated", "physicalExecutionVerified"):
            self.require(policy.get(key) is False, "CUDA policy must explicitly be false: " + key)

    def device_schema(self, data):
        vendors = data.get("vendors", [])
        self.require(isinstance(vendors, list) and bool(vendors), "device: vendors required")
        if not isinstance(vendors, list):
            return
        ids = []
        for v in vendors:
            if not self.require(isinstance(v, dict), "device vendor: object required"):
                continue
            ns, vid = v.get("namespace"), v.get("vendorId", "")
            self.require(ns in ("pci", "usb"), "device vendor namespace: pci/usb required")
            self.require(isinstance(vid, str) and bool(re.fullmatch(r"[0-9A-Fa-f]{4}", vid)), "device vendorId: four hex digits required")
            self.require(v.get("id") == f"{ns}-{str(vid).lower()}", "device vendor id must include namespace")
            ids.append(v.get("id"))
            self.require(self.string(v.get("brand")), "device vendor: brand required")
            self.source_url(v.get("supportUrl"), "vendor.supportUrl")
            self.sources(v.get("sources"), "vendor.sources")
        self.require(len(ids) == len(set(ids)), "device: duplicate namespaced vendor ID")
        print("Device boundary: namespace/vendor schema only; browser identity/driver detection claims require source/UI review.")

    def route(self, lang, entry=None):
        prefix = "" if lang == "ko" else lang + "/"
        return self.origin + "/" + prefix + (f"entry/{entry['slug']}/" if entry else "")

    def alternates(self, entry=None):
        return {**{l: self.route(l, entry) for l in LANGS}, "x-default": self.route("ko", entry)}

    def local_path(self, url):
        parsed = urlsplit(url)
        base = urlsplit(self.origin)
        if (parsed.scheme, parsed.netloc) != (base.scheme, base.netloc):
            return None
        path = unquote(parsed.path)
        prefix = base.path.rstrip("/") + "/"
        if not path.startswith(prefix):
            return None
        target = (self.dist / path[len(prefix):]).resolve()
        if not target.is_relative_to(self.dist.resolve()):
            self.errors.append("link escapes dist: " + url)
            return None
        return target / "index.html" if target.is_dir() or path.endswith("/") else target

    def check_link(self, page_url, value, where):
        absolute = urljoin(page_url, value)
        parsed = urlsplit(absolute)
        if parsed.scheme not in ("https", "http"):
            self.require(parsed.scheme in ("mailto", "tel"), f"{where}: unsupported URL protocol: {value}")
            return
        self.require(parsed.scheme == "https" and not parsed.username and not parsed.password,
                     f"{where}: insecure link/credentials: {value}")
        local = self.local_path(absolute)
        if local is None:
            self.external.add(absolute)
            return
        self.internal_count += 1
        self.require(local.is_file(), f"{where}: missing internal target: {value}")
        if parsed.fragment and local.suffix == ".html" and local.is_file():
            target_url = absolute.split("#", 1)[0].split("?", 1)[0]
            target = self.pages.get(target_url)
            if target is None:
                target = Page(local.read_text(encoding="utf-8"))
            self.require(unquote(parsed.fragment) in target.ids, f"{where}: missing fragment: {value}")

    def output(self, data):
        expected = {}
        for entry in [None] + self.entries:
            for lang in LANGS:
                expected[self.route(lang, entry)] = (lang, entry)
        actual_files = set(self.dist.rglob("*.html"))
        expected_files = {self.local_path(url) for url in expected}
        self.require(actual_files == expected_files, f"dist HTML routes differ: expected {len(expected_files)}, found {len(actual_files)}")
        for url, (lang, entry) in expected.items():
            path = self.local_path(url)
            if not path or not self.require(path.is_file(), "missing page: " + url):
                continue
            p = Page(path.read_text(encoding="utf-8"))
            self.pages[url] = p
            self.require(p.lang == lang, url + ": incorrect html lang")
            self.require(p.h1 == 1, url + ": exactly one h1 required")
            self.require(p.canonical == [url], url + ": canonical mismatch")
            self.require(len(p.alternates) == 7 and dict(p.alternates) == self.alternates(entry), url + ": hreflang mismatch")
            self.require(len(p.titles) == 1 and self.string(p.titles[0]), url + ": title required")
            self.require(len(p.descriptions) == 1 and self.string(p.descriptions[0]), url + ": meta description required")
            self.require(len(p.ids) == len(set(p.ids)), url + ": duplicate HTML id")
            for token in PUBLISHERS:
                self.require(token in p.source, url + ": missing publisher integration " + token)
            self.require("https://nanalab.kr/apps/" in p.anchors, url + ": More Apps link missing")
            self.require("More Apps" in " ".join(p.text), url + ": More Apps label missing")
            if entry:
                for source in entry.get("sources", []):
                    self.require(source["url"] in p.anchors, url + ": missing detail source " + source["url"])
                self.require(data.get("checkedAt", "") in " ".join(p.text), url + ": source date missing")
            elif self.kind == "directory":
                for ident in ("search", "brand-filter", "category-filter"):
                    self.require(ident in p.ids, url + ": missing control #" + ident)
        for url, page in self.pages.items():
            for kind, link in page.links:
                self.check_link(url, link, url + " " + kind)
        self.sitemap(expected)
        core = {"directory": "core.mjs", "device": "device-core.mjs", "cuda": "cuda-core.mjs"}.get(self.kind, "core.mjs")
        for name in ("style.css", "app.js", core, "data.json", "icon.svg"):
            self.require((self.dist / "assets" / name).is_file(), "missing asset: assets/" + name)
        published_data = self.read_json(self.dist / "assets" / "data.json")
        self.require(published_data == data, "dist/assets/data.json differs from src/data.json")
        for path in self.dist.rglob("*"):
            if not path.is_file():
                continue
            head = path.read_bytes()[:8]
            binary = (path.suffix.lower() in BINARY_SUFFIXES or head.startswith((b"MZ", b"\x7fELF", b"PK\x03\x04", b"%PDF-", b"\x1f\x8b")))
            self.require(not binary, "binary/document/font hosted: " + str(path.relative_to(self.dist)))
            if path.suffix in (".css", ".js", ".mjs"):
                content = path.read_text(encoding="utf-8")
                refs = re.findall(r'''(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']''', content)
                if path.suffix == ".css":
                    refs += [m.strip().strip("\"'") for m in re.findall(r"url\(\s*([^)]*)\)", content)]
                asset_url = self.origin + "/" + path.relative_to(self.dist).as_posix()
                for ref in refs:
                    self.check_link(asset_url, ref, str(path.relative_to(self.dist)))

    def sitemap(self, expected):
        path = self.dist / "sitemap.xml"
        try:
            tree = ET.parse(path)
        except (OSError, ET.ParseError) as e:
            self.errors.append("sitemap.xml: " + str(e))
            return
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
        found = []
        for node in tree.findall("s:url", ns):
            loc = node.findtext("s:loc", default="", namespaces=ns)
            found.append(loc)
            if not self.require(loc in expected, "sitemap unknown URL: " + loc):
                continue
            links = [(x.get("hreflang"), x.get("href")) for x in node.findall("x:link", ns) if x.get("rel") == "alternate"]
            self.require(len(links) == 7 and dict(links) == self.alternates(expected[loc][1]), "sitemap alternates mismatch: " + loc)
        self.require(len(found) == len(set(found)), "sitemap duplicate URL")
        self.require(set(found) == set(expected), "sitemap must contain every generated language/detail URL")

    def run(self):
        config = self.read_json(self.root / "app.json")
        data = self.read_json(self.root / "src" / "data.json")
        ui = self.read_json(self.root / "src" / "ui.json")
        self.schema(config, data, ui)
        if not self.errors:
            self.output(data)
        report = {
            "pass": not self.errors, "slug": self.slug, "type": self.kind, "languages": LANGS,
            "entries": len(self.entries), "pages": len(self.pages),
            "internalLinksChecked": self.internal_count, "externalLinksObserved": len(self.external),
            "publisherPages": sum(all(x in p.source for x in PUBLISHERS) for p in self.pages.values()),
            "origin": self.origin, "binariesHosted": sum("binary/document/font hosted:" in e for e in self.errors),
            "sourceHosts": sorted(self.source_hosts), "sourceUrlsCheckedStatically": len(self.source_urls),
            "httpReachabilityChecked": False, "browserOrPhysicalExecutionChecked": False,
        }
        if self.errors:
            report["errors"] = self.errors
        (self.root / "VALIDATION.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print("Boundary: offline HTML/data/link checks only; source HTTP responses (including 403), factual/translation review and browser/physical execution are separate.")
        return 0 if report["pass"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    return Validator(args.root).run()


if __name__ == "__main__":
    sys.exit(main())
