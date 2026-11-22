const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// This image variant deliberately has no internal AI. MCP uses the same
// operational tools directly, without constructing a Mastra agent or its memory.
// The base image is pinned in Dockerfile; fail rather than patch unfamiliar code.
function disableInternalAi(appRoot = '/app', nginxFile = '/etc/nginx/nginx.conf') {
  const backend = path.join(appRoot, 'apps/backend/dist');
  const chat = path.join(backend, 'libraries/nestjs-libraries/src/chat');
  const edit = (file, before, after) => {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.split(before).length - 1, 1, `Upstream marker changed: ${file}: ${before}`);
    fs.writeFileSync(file, source.replace(before, after));
  };

  const mcp = path.join(chat, 'start.mcp.js');
  edit(mcp, 'const mastra_service_1 = require("./mastra.service");', '');
  edit(mcp, '    const mastraService = app.get(mastra_service_1.MastraService, { strict: false });', '');
  edit(mcp, `    const mastra = await mastraService.mastra();
    const agent = mastra.getAgent('postiz');
    const agentTools = await agent.listTools();`,
  '    const agentTools = await loadToolsService.loadTools();');
  edit(mcp, '        agents: { postiz: agent },', '        // Internal agents disabled; operational MCP tools remain available.');

  const api = path.join(backend, 'apps/backend/src/api/api.module.js');
  edit(api, 'const copilot_controller_1 = require("./routes/copilot.controller");', '');
  edit(api, '    copilot_controller_1.CopilotController,', '');

  // Keep DI tokens used by existing controllers, but do not import their AI
  // implementations. Normal PostsService and all Temporal workers stay intact.
  function disabledService(file, name, methods) {
    assert.ok(fs.readFileSync(file, 'utf8').includes(`exports.${name}`), `Missing service ${name}`);
    fs.writeFileSync(file, `"use strict";
const { Injectable, ServiceUnavailableException } = require('@nestjs/common');
class ${name} {
${methods.map(method => `  ${method}() { throw new ServiceUnavailableException('Internal AI is disabled on this instance.'); }`).join('\n')}
}
Injectable()(${name});
exports.${name} = ${name};
`);
  }
  disabledService(path.join(chat, 'mastra.service.js'), 'MastraService', ['mastra']);
  const agentDir = path.join(backend, 'libraries/nestjs-libraries/src/agent');
  disabledService(path.join(agentDir, 'agent.graph.service.js'), 'AgentGraphService', ['start']);
  disabledService(path.join(agentDir, 'agent.graph.insert.service.js'), 'AgentGraphInsertService', ['newPost']);

  const loader = path.join(chat, 'load.tools.service.js');
  for (const line of [
    'const agent_1 = require("@mastra/core/agent");',
    'const openai_1 = require("@ai-sdk/openai");',
    'const memory_1 = require("@mastra/memory");',
    'const mastra_store_1 = require("./mastra.store");',
  ]) edit(loader, line, '');
  let source = fs.readFileSync(loader, 'utf8');
  const agentMethod = /    async agent\(\) \{[\s\S]+?(?=\n};\nexports.LoadToolsService)/g;
  assert.equal([...source.matchAll(agentMethod)].length, 1, 'Unexpected tools loader class');
  source = source.replace(agentMethod, `    async agent() {
        throw new common_1.ServiceUnavailableException('Internal AI is disabled on this instance.');
    }`);
  fs.writeFileSync(loader, source);

  // Patch both SSR and browser copies: hiding only one causes hydration drift.
  const frontend = path.join(appRoot, 'apps/frontend/.next');
  let menu = 0, popup = 0;
  const browserChunks = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!file.endsWith('.js')) continue;
      let js = fs.readFileSync(file, 'utf8');
      const old = js;
      if (js.includes('path:"/agents"')) {
        assert.equal(js.split('name:"Agent",icon:').length - 1, 1, 'Expected the Agent menu label');
        js = js.replace('name:"Agent",icon:', 'name:"Brand Hub",icon:');
      }
      js = js.replaceAll('path:"/agents"', () => { menu++; return 'path:"/hub/",onClick:()=>{window.location.assign("/hub/")}'; });
      js = js.replace(/\(0,([\w$]+)\.jsx\)\(([\w$]+)\.([\w$]+),\{className:"mobile:!z-\[460\] mobile:!bottom-\[112px\]"/g,
        (_, jsx) => { popup++; return `(0,${jsx}.jsx)((()=>null),{className:"mobile:!z-[460] mobile:!bottom-[112px]"`; });
      if (js !== old) {
        fs.writeFileSync(file, js);
        if (file.startsWith(path.join(frontend, 'static/chunks') + path.sep)) browserChunks.push(file);
      }
    }
  }
  walk(path.join(frontend, 'server'));
  walk(path.join(frontend, 'static/chunks'));
  assert.equal(menu, 2, 'Expected SSR and browser navigation copies');
  assert.equal(popup, 6, 'Expected five SSR and one browser chat popup copies');

  // Immutable asset URLs must change, otherwise an existing browser can keep
  // displaying the old AI controls even after a page refresh.
  assert.equal(browserChunks.length, 2, 'Expected two changed browser chunks');
  const renamed = browserChunks.map(file => {
    const oldName = path.basename(file);
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
    const newName = oldName.replace(/\.js$/, `.noai-${hash}.js`);
    fs.renameSync(file, path.join(path.dirname(file), newName));
    return [oldName, newName];
  });
  function updateAssetReferences(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { updateAssetReferences(file); continue; }
      if (!/\.(js|json|html|rsc|txt|meta)$/.test(file)) continue;
      const old = fs.readFileSync(file, 'utf8');
      let text = old;
      for (const [before, after] of renamed) text = text.replaceAll(before, after);
      if (text !== old) fs.writeFileSync(file, text);
    }
  }
  updateAssetReferences(frontend);

  edit(nginxFile, 'worker_processes                auto;', 'worker_processes                1;');
  edit(nginxFile, '        location /api/ {', `        # Disable internal AI entry points; leave MCP, uploads and posts intact.
        location ~ ^/agents(?:/|$) {
            return 302 /launches;
        }
        location ~ ^/api/(?:copilot(?:/|$)|public/agent/?$|posts/generator(?:/|$)) {
            return 404;
        }

        location /api/ {`);
  console.log('Disabled internal agents, AI chat and AI routes; preserved MCP tools and scheduler. Nginx workers: 1.');
}

module.exports = { disableInternalAi };
if (require.main === module) disableInternalAi();
