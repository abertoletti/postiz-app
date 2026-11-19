// Same three upstream processes, supervised directly by PM2. Preloading dotenv
// preserves the upstream .env loading without permanent pnpm/dotenv children.
const node_args = ['--experimental-require-module', '--require', 'dotenv/config'];
const env = { DOTENV_CONFIG_PATH: '/app/.env' };
module.exports = {
  apps: [
    {
      name: 'backend', cwd: '/app/apps/backend',
      script: './dist/apps/backend/src/main.js', node_args, env,
      instances: 1, exec_mode: 'fork', autorestart: true,
    },
    {
      name: 'orchestrator', cwd: '/app/apps/orchestrator',
      script: './dist/apps/orchestrator/src/main.js', node_args, env,
      instances: 1, exec_mode: 'fork', autorestart: true,
    },
    {
      name: 'frontend', cwd: '/app/apps/frontend',
      script: '/app/node_modules/next/dist/bin/next', args: ['start', '-p', '4200'],
      node_args, env, instances: 1, exec_mode: 'fork', autorestart: true,
    },
  ],
};
