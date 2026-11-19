const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Mirror libraries/helpers/src/subdomain/subdomain.management.ts in the pinned
// upstream image, including the prebuilt Next.js proxy. Fail on upstream drift.
const compiledHelper = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCookieUrlFromDomain = getCookieUrlFromDomain;
const { parse } = require("tldts");
function getCookieUrlFromDomain(domain) {
  const url = parse(domain, { allowPrivateDomains: true });
  if (url.hostname?.endsWith('.up.railway.app')) return url.hostname;
  return url.domain ? '.' + url.domain : url.hostname;
}
`;
for (const app of ['backend']) {
  const target = `/app/apps/${app}/dist/libraries/helpers/src/subdomain/subdomain.management.js`;
  assert.ok(fs.readFileSync(target, 'utf8').includes('getCookieUrlFromDomain'), `Missing upstream helper: ${app}`);
  fs.writeFileSync(target, compiledHelper);
}

const before = '}(e);return t.domain?"."+t.domain:t.hostname}';
const after = '}(e,{allowPrivateDomains:true});return t.hostname&&t.hostname.endsWith(".up.railway.app")?t.hostname:t.domain?"."+t.domain:t.hostname}';
let replacements = 0;
function patchNext(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) patchNext(target);
    else if (entry.name.endsWith('.js')) {
      const source = fs.readFileSync(target, 'utf8');
      if (!source.includes(before)) continue;
      const count = source.split(before).length - 1;
      assert.equal(count, 1, 'Ambiguous cookie helper in Next.js chunk');
      fs.writeFileSync(target, source.replace(before, after));
      replacements += count;
    }
  }
}
patchNext('/app/apps/frontend/.next/server');
assert.equal(replacements, 1, 'Expected exactly one pinned Next.js cookie helper');
console.log('Patched cookie domains in backend and Next.js proxy.');
