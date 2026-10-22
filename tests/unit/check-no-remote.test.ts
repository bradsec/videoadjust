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
    const repo = 'https://github.com/bradsec/videomate';
    expect(checkRemote({ 'index.html': `<a class="repo-link" href="${repo}">x</a>` })).toEqual([]);
    expect(checkRemote({ 'index.html': `<img src="${repo}">` })).not.toEqual([]);
    expect(checkRemote({ 'index.html': `<a href="${repo}/evil">x</a>` })).not.toEqual([]);
    expect(checkRemote({ 'a.css': `a{background:url(${repo})}` })).not.toEqual([]);
    expect(js(`fetch("${repo}")`)).not.toEqual([]);
  });
});
