// Fails if the built site could contact another origin. Rather than guess how JavaScript
// makes a request, it collects every absolute or protocol-relative URL string in the built JS
// and fails on any that is not in JS_URL_ALLOWLIST. Markup, CSS and the manifest must carry
// no remote URL at all (apart from the SVG/XLink namespace names).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every URL that appears in the bundled JavaScript today, and why it is safe. They are
// specification links and error-message text inside comments or strings; none is ever passed to
// a loader. Adding an entry needs the same justification.
export const JS_URL_ALLOWLIST = new Set([
  'http://www.w3.org/2000/svg', // SVG namespace name for createElementNS, not fetched
  'https://aomediacodec.github.io/av1-isobmff/', // Mediabunny comment: AV1 ISOBMFF spec link
  'https://www.w3.org/TR/webcodecs-aac-codec-registration/', // Mediabunny comment: spec link
  'https://www.w3.org/TR/webcodecs-flac-codec-registration/', // Mediabunny comment: spec link
  'https://www.w3.org/TR/webcodecs-vorbis-codec-registration/', // Mediabunny comment: spec link
  'https://www.webmproject.org/vp9/mp4/', // Mediabunny comment: VP9 in MP4 spec link
  'https://rolldown.rs/in-depth/bundling-cjs#require-external-modules', // bundler message text
]);

// The footer and About dialog link to the repo, the author and the libraries. A link the user
// clicks navigates away and sends no media, so these are allowed, but only as exact anchor
// hrefs in HTML.
export const REPO_URL = 'https://github.com/bradsec/videoadjust';
export const LINK_URLS = [
  REPO_URL,
  'https://github.com/bradsec',
  'https://mediabunny.dev/',
  'https://github.com/mattdesl/gifenc',
];
const escape = (url) => url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const LINK_HREF = new RegExp(
  String.raw`(<a\s[^>]*\bhref=")(?:${LINK_URLS.map(escape).join('|')})(")`,
  'g',
);

// The site's own absolute URLs are metadata for crawlers and link previews, never requests the
// page makes. They are allowed only where a browser does not load them: canonical, og:* and
// twitter:* tags and JSON-LD blocks in HTML, plus robots.txt and sitemap.xml. The host must be
// followed by "/", so videoadjust.com.evil.example never matches.
const SITE_URL = /https:\/\/videoadjust\.com\/[\w./-]*/g;
const META_TAG = /<(?:link|meta)\b[^>]*>/g;
const IS_SHARE_META = /\brel="canonical"|\b(?:property="og:|name="twitter:)[\w:]+"/;
const JSON_LD = /(<script\s+type="application\/ld\+json"\s*>)([\s\S]*?)(<\/script>)/g;
// JSON-LD names its vocabulary with this URL; it is an identifier, never fetched.
const SCHEMA_CONTEXT = /("@context":\s*")https:\/\/schema\.org(")/g;
const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function withoutSiteMetadata(rel, source) {
  if (rel === 'robots.txt') return source.replace(SITE_URL, '');
  if (rel === 'sitemap.xml') return source.replace(SITE_URL, '').replace(SITEMAP_NS, '');
  if (!rel.endsWith('.html')) return source;
  return source
    .replace(META_TAG, (tag) => (IS_SHARE_META.test(tag) ? tag.replace(SITE_URL, '') : tag))
    .replace(
      JSON_LD,
      (_all, open, body, close) =>
        open + body.replace(SITE_URL, '').replaceAll(SCHEMA_CONTEXT, '$1$2') + close,
    );
}

const MARKUP_NS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
// Absolute http(s)/ws(s) URLs anywhere, and protocol-relative ones at the start of a string
// literal or after url( / @import / = in markup and CSS.
const ABSOLUTE = /(?:https?|wss?):\/\/[^\s"'`)<>\\]+/g;
// Protocol-relative: //host, //host:port, //1.2.3.4, //[::1], //localhost, in a JS string
// literal or after quote / ( / = / @import in markup and CSS.
const HOST = String.raw`\/\/(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)(?::\d+)?`;
const PROTO_REL_STRING = new RegExp('["\'`]' + HOST + '[^"\'`\\s]*', 'g');
const PROTO_REL_MARKUP = new RegExp('(?:["\'(=]|@import\\s+)\\s*' + HOST, 'g');

const normalise = (url) => url.replace(/[.,;:]+$/, '');

/** @param {Record<string, string>} files built text files by path relative to dist */
export function checkRemote(files) {
  const problems = [];
  for (const [rel, source] of Object.entries(files)) {
    if (rel === 'THIRD-PARTY-LICENSES.txt') continue;
    const isJs = /\.m?js$/.test(rel);
    const text = withoutSiteMetadata(
      rel,
      rel.endsWith('.html') ? source.replace(LINK_HREF, '$1$2') : source,
    );
    for (const raw of text.match(ABSOLUTE) ?? []) {
      const url = normalise(raw);
      if (isJs ? !JS_URL_ALLOWLIST.has(url) : !MARKUP_NS.has(url))
        problems.push(`${rel}: remote URL ${url}`);
    }
    for (const m of text.match(isJs ? PROTO_REL_STRING : PROTO_REL_MARKUP) ?? []) {
      problems.push(`${rel}: protocol-relative URL ${m.trim()}`);
    }
  }
  return problems;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const files = {};
  for (const file of walk(dist)) {
    const rel = relative(dist, file);
    if (/\.(?:js|mjs|html|css|webmanifest|json|svg|txt|xml)$/.test(rel))
      files[rel] = readFileSync(file, 'utf8');
  }
  const problems = checkRemote(files);
  if (problems.length) {
    console.error('check:remote failed:\n' + problems.map((p) => `  ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(
    `check:remote ok: no URL outside the allowlist in ${Object.keys(files).length} built files`,
  );
}
