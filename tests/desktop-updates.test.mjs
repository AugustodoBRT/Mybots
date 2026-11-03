import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { findChrome, AIS } from '../pc/doctor.mjs';

const require = createRequire(import.meta.url);
const { feedVersion, isNewer, feedFile, updatesItself } = require('../desktop/electron/updates-core.js');

test('the update feed: version read from latest*.yml and compared as x.y.z numbers', () => {
  assert.equal(feedVersion('version: 0.61.0\nfiles:\n  - url: MyBots-0.61.0-linux-x86_64.AppImage\n'), '0.61.0');
  assert.equal(feedVersion("version: '1.0.2'\n"), '1.0.2'); assert.equal(feedVersion('sem versão'), null); assert.equal(feedVersion(undefined), null);
  assert.equal(isNewer('0.61.0', '0.60.0'), true); assert.equal(isNewer('0.60.0', '0.60.0'), false); assert.equal(isNewer('0.9.0', '0.60.0'), false);
  assert.equal(isNewer('1.0.0', '0.99.9'), true); assert.equal(isNewer('0.60.10', '0.60.9'), true); assert.equal(isNewer('x.y.z', '0.1.0'), false); assert.equal(isNewer('0.61', '0.60.0'), false);
  assert.equal(feedFile('win32', 'x64'), 'latest.yml'); assert.equal(feedFile('darwin', 'arm64'), 'latest-mac.yml'); assert.equal(feedFile('linux', 'x64'), 'latest-linux.yml');
});

test('who updates by itself: AppImage and Windows; .deb and macOS only warn', () => {
  assert.equal(updatesItself('win32', {}), true); assert.equal(updatesItself('linux', { APPIMAGE: '/x/MyBots.AppImage' }), true);
  assert.equal(updatesItself('linux', {}), false); assert.equal(updatesItself('darwin', {}), false);
});

test('first-run assistant: Chrome is looked for in the places of each system, and every AI has a login command', () => {
  assert.equal(findChrome('linux', path => path === '/usr/bin/chromium'), '/usr/bin/chromium');
  assert.equal(findChrome('darwin', path => path.endsWith('Google Chrome')), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(findChrome('linux', () => false), null); assert.equal(findChrome('plan9', () => true), null);
  for (const item of AIS) { assert.ok(item.key && item.name && item.login && /^https:\/\//.test(item.link)); }
});
