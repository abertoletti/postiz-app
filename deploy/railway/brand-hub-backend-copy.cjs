const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = '/app/apps/backend/dist/libraries/nestjs-libraries/src';
const messages = [
  ['database/prisma/organizations/organization.service.js', 'No Postiz account found for this email', 'No Brand Hub account found for this email'],
  ['integrations/social/facebook.provider.js', 'Postiz is not authorized to publish as this page', 'Brand Hub is not authorized to publish as this page'],
  ['integrations/social/discord.provider.js', 'Discord rejected the Postiz bot token', 'Discord rejected the configured bot token'],
  ['integrations/social/threads.provider.js', 'uploaded to Postiz first', 'uploaded to the media library first'],
  ['integrations/social/tiktok.provider.js', 'upload the picture/video to Postiz', 'upload the picture/video to the media library'],
  ['integrations/social/youtube.provider.js', 'mark Postiz as a trusted app', 'mark the OAuth app used by this channel as trusted'],
];

for (const [file, oldCopy, newCopy] of messages) {
  const filename = path.join(root, file);
  const source = fs.readFileSync(filename, 'utf8');
  assert.equal(source.split(oldCopy).length, 2, `Expected error message in ${file}`);
  fs.writeFileSync(filename, source.replace(oldCopy, newCopy));
}
