const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const backend = process.env.POSTIZ_TEST_BACKEND || '/app/apps/backend/dist';
const chat = path.join(backend, 'libraries/nestjs-libraries/src/chat');

function evaluate(file, dependencies, env = {}) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports, module: { exports }, process: { env }, URL, console,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return exports;
}

async function main() {
  class Disabled extends Error {}
  const common = { Injectable: () => () => {}, ServiceUnavailableException: Disabled };
  const tools = [
    { name: 'integrationList', run: async () => ({ id: 'channels' }) },
    { name: 'integrationSchedulePostTool', run: async () => ({ id: 'schedule' }) },
    { name: 'postsListTool', run: async () => ({ id: 'posts' }) },
    { name: 'uploadWidgetTool', mcpOnly: true, run: async () => ({ id: 'upload' }) },
    { name: 'unavailable', available: () => false, run: () => { throw Error('Unavailable tool ran'); } },
  ];
  const { LoadToolsService } = evaluate(path.join(chat, 'load.tools.service.js'), {
    tslib: { __decorate: (_, target) => target, __metadata: () => () => {}, __importDefault: value => ({ default: value }) },
    '@nestjs/common': common, '@nestjs/core': { ModuleRef: class {} },
    zod: { object: value => value, array: () => ({ default: () => [] }), string: () => ({}) },
    './tools/tool.list': { toolList: tools }, dayjs: () => {},
  });
  const loader = new LoadToolsService({ get: tool => tool });
  assert.deepEqual(Object.keys(await loader.loadTools()), ['integrationList', 'integrationSchedulePostTool', 'postsListTool']);
  assert.deepEqual(Object.keys(await loader.loadTools(true)), ['uploadWidgetTool']);
  await assert.rejects(loader.agent(), Disabled);

  class OrganizationService {}
  class OAuthService {}
  class McpRelayService {}
  let config;
  const stop = new Error('MCP configuration captured');
  const { startMcp } = evaluate(path.join(chat, 'start.mcp.js'), {
    './load.tools.service': { LoadToolsService },
    '@mastra/mcp': { MCPServer: class { constructor(value) { config = value; throw stop; } } },
    '../database/prisma/organizations/organization.service': { OrganizationService },
    '../database/prisma/oauth/oauth.service': { OAuthService },
    './async.storage': {}, './oauth-middleware': {},
    './ui/upload.widget': { UPLOAD_WIDGET_URI: 'ui://upload', uploadWidgetHtml: () => '<html/>' },
    './ui/clipping.widget': {},
    '../upload/upload.factory': { UploadFactory: { createStorage: () => ({ publicUrl: () => 'https://example.com/uploads/' }), clippingEnabled: () => false } },
    './mcp.relay.service': { McpRelayService },
  }, { NEXT_PUBLIC_BACKEND_URL: 'https://example.com/api' });
  await assert.rejects(startMcp({ get: token => token === LoadToolsService ? loader : {} }), error => error === stop);
  assert.equal(config.name, 'Postiz MCP');
  assert.equal(config.agents, undefined);
  assert.deepEqual(Object.keys(config.tools), ['integrationList', 'integrationSchedulePostTool', 'postsListTool', 'uploadWidgetTool']);

  for (const [file, name, method] of [
    ['chat/mastra.service.js', 'MastraService', 'mastra'],
    ['agent/agent.graph.service.js', 'AgentGraphService', 'start'],
    ['agent/agent.graph.insert.service.js', 'AgentGraphInsertService', 'newPost'],
  ]) {
    const mod = evaluate(path.join(backend, 'libraries/nestjs-libraries/src', file), { '@nestjs/common': common });
    assert.throws(() => new mod[name]()[method](), Disabled);
  }
  const api = fs.readFileSync(path.join(backend, 'apps/backend/src/api/api.module.js'), 'utf8');
  assert.ok(!api.includes('copilot_controller_1'));
  assert.ok(api.includes('posts_controller_1.PostsController'));
  const app = fs.readFileSync(path.join(backend, 'apps/backend/src/app.module.js'), 'utf8');
  assert.ok(app.includes('getTemporalModule'));

  // Check the actual patched backend JavaScript; Next's Turbopack wrapper isn't
  // standalone CommonJS, so syntax-check its function body without executing it.
  for (const file of [path.join(chat, 'start.mcp.js'), path.join(chat, 'load.tools.service.js'), path.join(backend, 'apps/backend/src/api/api.module.js')]) {
    execFileSync(process.execPath, ['--check', file]);
  }
  console.log('AI isolation tests passed: direct MCP tools and uploads retained; agents disabled; posts and Temporal retained.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
