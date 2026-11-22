const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = '/app/apps/backend/dist/libraries/nestjs-libraries/src';
const original = [
  '        if ((0, dayjs_1.default)(getIntegration?.tokenExpiration).isBefore((0, dayjs_1.default)()) ||',
  '            forceRefresh) {',
].join('\n');
const patched = [
  '        if (getIntegration.deletedAt) {',
  '            return [];',
  '        }',
  '        if (((0, dayjs_1.default)(getIntegration?.tokenExpiration).isBefore((0, dayjs_1.default)()) &&',
  '            !integrationProvider.noRefreshBeforeCall) || forceRefresh) {',
].join('\n');

function rewrite(file, before, after, expectedCount) {
  const target = path.join(root, file);
  const source = fs.readFileSync(target, 'utf8');
  assert.equal(source.split(before).length - 1, expectedCount, `Unexpected upstream code in ${file}`);
  fs.writeFileSync(target, source.replaceAll(before, after));
}

// Backport gitroomhq/postiz-app#2464 while the runtime uses the v2.26.0 image.
rewrite('database/prisma/integrations/integration.service.js', original, patched, 1);
rewrite('database/prisma/posts/posts.service.js', original, patched, 2);
for (const provider of ['facebook', 'instagram']) {
  const identifier = `        this.identifier = '${provider}';`;
  rewrite(`integrations/social/${provider}.provider.js`, identifier, `${identifier}\n        this.noRefreshBeforeCall = true;`, 1);
}
