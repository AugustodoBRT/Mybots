// Import this first in a test that starts a supervisor: the extra IA accounts of the device (lib/accounts.mjs) decide when an IA
// counts as connected, so a test must not read the real ones (the phone of the person has some). Each test file gets an empty folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const folder = mkdtempSync(join(tmpdir(), 'mybots-test-accounts-'));
process.env.MYBOTS_ACCOUNTS = folder;
// Nothing is left behind in the temp folder (on the phone it is the one of the app's Linux).
process.on('exit', () => { try { rmSync(folder, { recursive: true, force: true }); } catch {} });
