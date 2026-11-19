const assert = require('node:assert/strict');
for (const app of ['backend']) {
  const { getCookieUrlFromDomain } = require(`/app/apps/${app}/dist/libraries/helpers/src/subdomain/subdomain.management.js`);
  assert.equal(getCookieUrlFromDomain('https://postiz-production-6556fb25.up.railway.app'), 'postiz-production-6556fb25.up.railway.app');
  assert.equal(getCookieUrlFromDomain('https://another-tenant.up.railway.app'), 'another-tenant.up.railway.app');
  assert.equal(getCookieUrlFromDomain('https://social.alessandrobertoletti.it'), '.alessandrobertoletti.it');
  assert.equal(getCookieUrlFromDomain('http://localhost:4200'), 'localhost');
  assert.equal(getCookieUrlFromDomain('http://127.0.0.1:4200'), '127.0.0.1');
}
console.log('Cookie domain tests passed: Railway tenant isolation, custom domains, localhost and IP.');
