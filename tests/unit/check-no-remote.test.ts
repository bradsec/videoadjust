import { describe, expect, it } from 'vitest';
import { JS_URL_ALLOWLIST, checkRemote } from '../../scripts/check-no-remote.mjs';

const js = (code: string) => checkRemote({ 'assets/a.js': code });

describe('check-no-remote', () => {
  const bad: Record<string, string> = {
    'direct fetch': 'fetch("https://evil.example/a")',
    'URL held in a variable': 'const u="https://evil.example/a";fetch(u)',
    'new URL': 'new URL("https://evil.example/a")',
    'setAttribute src': 'el.setAttribute("src","https://evil.example/a.js")',
    'protocol-relative string': 'import("//cdn.evil.example/m.js")',
    'protocol-relative single quote': "s.src='//cdn.evil.example/m.js'",
    'protocol-relative IPv4': "fetch('//192.0.2.1/x')",
    'protocol-relative localhost with port': 'fetch("//localhost:8080/x")',
    'protocol-relative IPv6': 'fetch("//[::1]/x")',
    websocket: 'new WebSocket("wss://evil.example/s")',
  };
  for (const [name, code] of Object.entries(bad)) {
    it(`fails on ${name}`, () => expect(js(code)).not.toEqual([]));
  }

  it('passes an allowlisted spec link inside JS', () => {
    const url = [...JS_URL_ALLOWLIST][1];
    expect(js(`/* see ${url}. */const a=1`)).toEqual([]);
    expect(js(`throw new Error("see ${url}")`)).toEqual([]);
  });

  it('passes plain JS with no URLs and a division', () => {
    expect(js('const r=a//b.length;x=1')).toEqual([]);
  });

  it('fails on remote and protocol-relative URLs in HTML and CSS', () => {
    expect(
      checkRemote({ 'index.html': '<script src="https://evil.example/x.js"></script>' }),
    ).not.toEqual([]);
    expect(
      checkRemote({ 'index.html': '<script src="//cdn.evil.example/x.js"></script>' }),
    ).not.toEqual([]);
    expect(checkRemote({ 'a.css': '@import "//evil.example/a.css";' })).not.toEqual([]);
    expect(checkRemote({ 'a.css': '@import url(//evil.example/a.css);' })).not.toEqual([]);
    expect(checkRemote({ 'a.css': '@import url(//localhost:8080/a.css);' })).not.toEqual([]);
    expect(checkRemote({ 'a.css': '@import url(//192.0.2.1/a.css);' })).not.toEqual([]);
    expect(checkRemote({ 'a.css': 'a{background:url(https://evil.example/i.png)}' })).not.toEqual(
      [],
    );
  });

  it('allows the SVG namespace in markup and ignores the licences file', () => {
    expect(checkRemote({ 'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' })).toEqual([]);
    expect(checkRemote({ 'THIRD-PARTY-LICENSES.txt': 'https://github.com/x' })).toEqual([]);
  });

  it('allows the repo link only as an anchor href in HTML', () => {
    const repo = 'https://github.com/bradsec/videoadjust';
    expect(checkRemote({ 'index.html': `<a class="repo-link" href="${repo}">x</a>` })).toEqual([]);
    expect(checkRemote({ 'index.html': `<img src="${repo}">` })).not.toEqual([]);
    expect(checkRemote({ 'index.html': `<a href="${repo}/evil">x</a>` })).not.toEqual([]);
    expect(checkRemote({ 'a.css': `a{background:url(${repo})}` })).not.toEqual([]);
    expect(js(`fetch("${repo}")`)).not.toEqual([]);
  });

  describe('own-site URLs', () => {
    const site = 'https://videoadjust.com/';
    const html = (markup: string) => checkRemote({ 'index.html': markup });

    it('allows them in canonical, og:*, twitter:* and JSON-LD', () => {
      expect(html(`<link rel="canonical" href="${site}" />`)).toEqual([]);
      expect(html(`<meta property="og:url" content="${site}" />`)).toEqual([]);
      expect(html(`<meta property="og:image" content="${site}og-image.png" />`)).toEqual([]);
      expect(html(`<meta name="twitter:image" content="${site}og-image.png" />`)).toEqual([]);
      expect(html(`<script type="application/ld+json">{"url": "${site}"}</script>`)).toEqual([]);
    });

    it('allows the schema.org vocabulary name in JSON-LD only', () => {
      const ld = '{"@context": "https://schema.org"}';
      expect(html(`<script type="application/ld+json">${ld}</script>`)).toEqual([]);
      expect(html('<meta property="og:url" content="https://schema.org" />')).not.toEqual([]);
      expect(html('<script src="https://schema.org"></script>')).not.toEqual([]);
      expect(
        html('<script type="application/ld+json">{"@context": "https://schema.org/x.js"}</script>'),
      ).not.toEqual([]);
    });

    it('allows them in robots.txt and sitemap.xml', () => {
      expect(checkRemote({ 'robots.txt': `Sitemap: ${site}sitemap.xml\n` })).toEqual([]);
      expect(
        checkRemote({
          'sitemap.xml': `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}</loc></url></urlset>`,
        }),
      ).toEqual([]);
    });

    it('rejects them anywhere else', () => {
      expect(html(`<script src="${site}x.js"></script>`)).not.toEqual([]);
      expect(html(`<img src="${site}og-image.png" />`)).not.toEqual([]);
      expect(html(`<a href="${site}">x</a>`)).not.toEqual([]);
      expect(html(`<link rel="stylesheet" href="${site}a.css" />`)).not.toEqual([]);
      expect(html(`<meta name="description" content="${site}" />`)).not.toEqual([]);
      expect(html(`<script type="module">fetch("${site}")</script>`)).not.toEqual([]);
      expect(html(`<script type="application/ld+json" src="${site}x.js"></script>`)).not.toEqual(
        [],
      );
      expect(checkRemote({ 'a.css': `a{background:url(${site}i.png)}` })).not.toEqual([]);
      expect(checkRemote({ 'assets/a.js': `fetch("${site}")` })).not.toEqual([]);
      expect(checkRemote({ 'site.webmanifest': `{"start_url":"${site}"}` })).not.toEqual([]);
    });

    it('rejects other hosts even in those contexts', () => {
      expect(html('<link rel="canonical" href="https://evil.example/" />')).not.toEqual([]);
      expect(
        html(`<meta property="og:image" content="https://videoadjust.com.evil.example/a.png" />`),
      ).not.toEqual([]);
      expect(html('<meta property="og:image" content="https://evil.example/a.png" />')).not.toEqual(
        [],
      );
      expect(
        html('<script type="application/ld+json">{"url":"https://evil.example/"}</script>'),
      ).not.toEqual([]);
      expect(
        checkRemote({ 'robots.txt': 'Sitemap: https://evil.example/sitemap.xml' }),
      ).not.toEqual([]);
    });

    it('does not let one allowed tag shield the next', () => {
      expect(
        html(`<meta property="og:url" content="${site}" /><script src="${site}x.js"></script>`),
      ).not.toEqual([]);
    });
  });
});
