// Fails if the built site could contact another origin. Absolute http(s) URLs are only
// allowed in THIRD-PARTY-LICENSES.txt and as text inside bundled JavaScript (licence headers,
// comments, strings such as spec links). Markup and CSS must carry none, and neither may
// JavaScript use one as a request target.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist', import.meta.url).pathname;
const ABSOLUTE = /https?:\/\/[^\s"'`)<>\\]+/g;
// A literal URL (or protocol-relative one) handed to something that fetches or loads it.
const JS_REQUEST = [
  /\bfetch\(\s*["'`]\s*(?:https?:)?\/\//,
  /\bXMLHttpRequest[\s\S]{0,80}\.open\([^)]*["'`]https?:\/\//,
  /\bnew\s+(?:Worker|SharedWorker|WebSocket|EventSource)\(\s*["'`]\s*(?:https?|wss?):\/\//,
  /\bimportScripts\(\s*["'`]https?:\/\//,
  /\bimport\(\s*["'`]https?:\/\//,
  /\bnavigator\.sendBeacon\(\s*["'`]https?:\/\//,
  /\.src\s*=\s*["'`]https?:\/\//,
  /\.href\s*=\s*["'`]https?:\/\//,
];
const MARKUP = /\b(?:src|href|action|poster|data|srcset)\s*=\s*["']\s*(?:https?:)?\/\//i;
const CSS_URL = /url\(\s*["']?\s*(?:https?:)?\/\//i;
const MARKUP_ALLOWED = /^(?:http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink))$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems = [];
const seen = new Map();
for (const file of walk(dist)) {
  const rel = relative(dist, file);
  if (rel === 'THIRD-PARTY-LICENSES.txt') continue;
  if (!/\.(?:js|mjs|html|css|webmanifest|json|svg|txt)$/.test(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const isJs = /\.m?js$/.test(rel);
  for (const m of text.match(ABSOLUTE) ?? []) {
    if (isJs) seen.set(m, (seen.get(m) ?? 0) + 1);
    else if (!MARKUP_ALLOWED.test(m)) problems.push(`${rel}: absolute URL ${m}`);
  }
  if (isJs) for (const re of JS_REQUEST) if (re.test(text)) problems.push(`${rel}: request to a literal remote URL (${re})`);
  if (rel.endsWith('.html') && MARKUP.test(text)) problems.push(`${rel}: remote src/href`);
  if (rel.endsWith('.css') && CSS_URL.test(text)) problems.push(`${rel}: remote url()`);
}

if (problems.length) {
  console.error('check:remote failed:\n' + problems.map((p) => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check:remote ok: no remote request targets in dist (${seen.size} URL strings in JS, all text only)`);
