const fs = require('node:fs');
const assert = require('node:assert/strict');
const file = '/app/package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(pkg.scripts.pm2, 'pnpm run pm2-run');
assert.equal(pkg.scripts['pm2-run'], 'pm2 delete all || true && pnpm run prisma-db-push && pnpm run --parallel pm2 && pm2 logs');
const start = 'pm2 delete all || true && pnpm run prisma-db-push && pm2 start /opt/postiz-railway/ecosystem.config.cjs && pm2 logs';
pkg.scripts.pm2 = start;
pkg.scripts['pm2-run'] = start;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');

const config = require('./ecosystem.config.cjs');
assert.deepEqual(config.apps.map(app => app.name), ['backend', 'orchestrator', 'frontend']);
for (const app of config.apps) {
  const target = require('node:path').resolve(app.cwd, app.script);
  assert.ok(fs.existsSync(target), `Missing application entry point: ${target}`);
  assert.ok(app.node_args.includes('dotenv/config'));
  assert.equal(app.env.DOTENV_CONFIG_PATH, '/app/.env');
  assert.equal(app.instances, 1);
  assert.equal(app.autorestart, true);
}
assert.ok(require.resolve('/app/node_modules/dotenv/config'));
console.log('PM2 starts the upstream backend, orchestrator and Next.js directly, preserving dotenv and database preparation.');
