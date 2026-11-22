const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const appRequire = createRequire('/app/package.json');
const { parse } = appRequire('acorn');
const { simple } = appRequire('acorn-walk');
const root = '/app/apps/backend/dist/libraries/nestjs-libraries/src';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadMethod(file, name) {
  const source = read(`database/prisma/${file}`);
  let method;
  simple(parse(source, { ecmaVersion: 'latest' }), {
    MethodDefinition(node) {
      if (node.key.name === name) method = source.slice(node.start, node.end);
    },
  });
  assert.ok(method, `Expected upstream method ${name}`);
  return vm.runInNewContext(`({${method}}).${name}`, {
    dayjs_1: { default: value => ({ isBefore: () => value === 'expired' }) },
    redis_service_1: { ioRedis: { get: async () => null, set: async () => {} } },
    process: { env: {} },
  });
}

const routes = [
  ['integrations/integration.service.js', 'checkAnalytics', [{ id: 'org' }, 'channel', 7], 'analytics', 'published'],
  ['posts/posts.service.js', 'checkPostAnalytics', ['org', 'post', 7], 'postAnalytics', 'published'],
  ['posts/posts.service.js', 'getMissingContent', ['org', 'post'], 'missing', 'missing'],
];

for (const [file, name, args, providerMethod, releaseId] of routes) {
  test(`${name} skips deleted channels and keeps the expected refresh behavior`, async () => {
    const method = loadMethod(file, name);
    const calls = [];
    const integration = { type: 'social', tokenExpiration: 'expired', internalId: 'channel', token: 'page-token' };
    const provider = {
      async [providerMethod](id, token) {
        calls.push(['provider', token]);
        assert.equal(id, 'channel');
        return 'result';
      },
    };
    const context = {
      getIntegrationById: async () => integration,
      _postRepository: { getPostById: async () => ({ id: 'post', releaseId, integration }) },
      _integrationManager: { getSocialIntegration: () => provider },
      _refreshIntegrationService: { refresh: async () => { calls.push(['refresh']); return { accessToken: 'renewed' }; } },
      resolveRelease: async () => ({ releaseId }),
    };

    integration.deletedAt = new Date();
    assert.equal((await method.call(context, ...args, true)).length, 0);
    assert.deepEqual(calls, []);

    delete integration.deletedAt;
    provider.noRefreshBeforeCall = true;
    assert.equal(await method.call(context, ...args), 'result');
    assert.deepEqual(calls.splice(0), [['provider', 'page-token']]);

    assert.equal(await method.call(context, ...args, true), 'result');
    assert.deepEqual(calls.splice(0), [['refresh'], ['provider', 'renewed']]);

    delete provider.noRefreshBeforeCall;
    assert.equal(await method.call(context, ...args), 'result');
    assert.deepEqual(calls, [['refresh'], ['provider', 'renewed']]);
  });
}

test('Facebook and Instagram opt out of refresh on stored expiration', () => {
  for (const provider of ['facebook', 'instagram']) {
    const source = read(`integrations/social/${provider}.provider.js`);
    assert.ok(source.includes(`this.identifier = '${provider}';\n        this.noRefreshBeforeCall = true;`));
  }
});
