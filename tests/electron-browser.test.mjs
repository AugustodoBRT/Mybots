import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';
import { electronInfo, connectElectron, electronCall } from '../pc/electron-link.mjs';

const real = { skip: !existsSync('/usr/bin/electron') || !(process.env.WAYLAND_DISPLAY || process.env.DISPLAY), timeout: 90000 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The MyBots window for real (Electron, started hidden), with a bot's shared browser attached to its tabs.
test('a janela em Electron hospeda o navegador dos bots: aba nova pela janela, imagem, e fechar a aba', real, async t => {
  const node = await mkdtemp(join(tmpdir(), 'mybots-electron-'));
  const child = spawn('/usr/bin/electron', ['--ozone-platform-hint=auto', `--user-data-dir=${join(node, 'profile')}`, join(import.meta.dirname, '..', 'desktop', 'electron'), '--hidden'], { env: { ...process.env, MYBOTS_PC_DIR: node, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await sleep(500); await rm(node, { recursive: true, force: true }); });
  for (let n = 0; n < 150 && !electronInfo(node); n++) await sleep(100);
  const info = electronInfo(node); assert.ok(info, 'a janela deixou seus dados na pasta do nó');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-bot-'));
  const session = new BrowserSession(directory, { mode: 'shared', connect: () => connectElectron(info), botId: '11111111-1111-4111-8111-111111111111' });
  t.after(async () => { await session.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await session.start();
  assert.ok(session.context.electron, 'o worker usa o navegador da janela');
  await session.page.setContent('<h1 id=x>Olá da janela</h1>');
  assert.match((await session.page.screenshot({ type: 'jpeg' })).subarray(0, 3).toString('hex'), /ffd8ff/, 'a aba de um bot que a pessoa não está vendo também gera imagem');
  await session.input({ type: 'tab_new' });
  assert.equal(session.pages.length, 2);
  const before = (await electronCall(info, '/tabs')).tabs.length;
  await session.closePage(session.pages[1]); await sleep(600);
  assert.equal((await electronCall(info, '/tabs')).tabs.length, before - 1, 'fechar a aba do bot fecha a aba da janela');
});
